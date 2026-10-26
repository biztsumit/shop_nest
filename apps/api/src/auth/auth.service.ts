import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthResponse, ChangePassword, Login, Register, ResetPassword, User } from '@shop/shared';
import type { Env } from '../config/env.js';
import { Prisma, type User as UserRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessTokenPayload } from './auth-user.js';
import { EmailQueue } from '../email/email-queue.js';
import { passwordChangedMessage, resetPasswordMessage, verifyEmailMessage } from '../email/templates.js';
import { EmailTokensService } from './email-tokens.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokensService, SESSION_ENDED, type IssuedRefreshToken } from './refresh-tokens.service.js';
import { ACCESS_AUDIENCE, TOKEN_ISSUER } from './tokens.js';

// One message for "no such account" AND "wrong password": telling them apart would let anyone
// find out which emails have an account here
const BAD_LOGIN = 'Wrong email or password';

// What a login produces: the JSON answer (with the short-lived access token), and the
// long-lived refresh token, which the controller puts in an httpOnly cookie
export type Session = { response: AuthResponse; refresh: IssuedRefreshToken };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly emailTokens: EmailTokensService,
    private readonly emails: EmailQueue,
  ) {}

  async register({ name, email, password }: Register): Promise<Session> {
    const passwordHash = await this.passwords.hash(password);
    try {
      const user = await this.prisma.user.create({ data: { name, email, passwordHash } });
      // Not awaited as part of sign-up's success: if queueing the email fails, the account
      // still exists and the user can ask for a new link ("resend")
      await this.sendVerification(user).catch((err: unknown) => this.logger.error({ err, userId: user.id }, 'Could not queue the verification email'));
      return this.startSession(user);
    } catch (err) {
      // P2002 = a UNIQUE rule said no: the email is taken. Checking first ("does it exist?",
      // then insert) could race with a second sign-up; letting the database decide can't.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists. Log in instead?');
      }
      throw err;
    }
  }

  async login({ email, password }: Login): Promise<Session> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same work, same answer, same time, whether or not the account exists
    const ok = await this.passwords.verifyOrWaste(user?.passwordHash, password);
    if (!user || !ok) {
      throw new UnauthorizedException(BAD_LOGIN);
    }
    return this.startSession(user);
  }

  // A used-up access token + the refresh cookie → a new access token AND a new refresh token
  async refresh(refreshToken: string): Promise<Session> {
    const refresh = await this.refreshTokens.rotate(refreshToken);
    // Read the user again: the role in the new access token must be today's role (an admin
    // who was demoted stops being admin at the next refresh, within 15 minutes)
    const user = await this.prisma.user.findUnique({ where: { id: refresh.userId } });
    if (!user) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    return { response: await this.accessResponse(user), refresh };
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return refreshToken ? this.refreshTokens.revokeByToken(refreshToken) : Promise.resolve();
  }

  logoutEverywhere(userId: string): Promise<void> {
    return this.refreshTokens.revokeAllForUser(userId);
  }

  // ---------- Email verification ----------

  async verifyEmail(token: string): Promise<User> {
    const userId = await this.emailTokens.consume(token, 'VERIFY_EMAIL');
    // updateMany + "not verified yet": verifying twice keeps the FIRST date
    await this.prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
    return this.me(userId);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException(SESSION_ENDED);
    if (user.emailVerifiedAt) throw new ConflictException('Your email address is already confirmed.');
    await this.sendVerification(user);
  }

  // ---------- Passwords ----------

  // Always the same answer, whether or not the email has an account: otherwise this form
  // would tell anyone which emails are registered here
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = await this.emailTokens.issue(user.id, 'RESET_PASSWORD');
    await this.emails.enqueue(resetPasswordMessage(user.email, user.name, this.link('/reset-password', token)));
  }

  async resetPassword({ token, password }: ResetPassword): Promise<void> {
    const userId = await this.emailTokens.consume(token, 'RESET_PASSWORD');
    await this.setPassword(userId, password);
    // Opening the link proves they own the inbox: a good moment to confirm the email too
    await this.prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  }

  // From the account page, while logged in: needs the CURRENT password (a borrowed laptop with
  // a logged-in browser mustn't be enough to take over the account)
  async changePassword(userId: string, { currentPassword, newPassword }: ChangePassword): Promise<Session> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException(SESSION_ENDED);
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Your current password is not right.');
    }
    await this.setPassword(userId, newPassword);
    // Every other device was logged out: this one gets a fresh login
    return this.startSession(user);
  }

  // A new password ends EVERY login (if the old one leaked, so may the sessions made with it),
  // and tells the owner by email: if it wasn't them, they know at once
  private async setPassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(password) } });
    await this.refreshTokens.revokeAllForUser(userId);
    await this.emails.enqueue(passwordChangedMessage(user.email, user.name));
  }

  private async sendVerification(user: UserRow): Promise<void> {
    const token = await this.emailTokens.issue(user.id, 'VERIFY_EMAIL');
    await this.emails.enqueue(verifyEmailMessage(user.email, user.name, this.link('/verify-email', token)));
  }

  // Email links open the WEB APP, which calls the API with the token
  private link(path: string, token: string): string {
    return `${this.config.get('WEB_ORIGIN', { infer: true })}${path}?token=${token}`;
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // A valid token for an account that has since been deleted
    if (!user) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    return toPublicUser(user);
  }

  // A new login: a new refresh token FAMILY (this device), plus an access token
  private async startSession(user: UserRow): Promise<Session> {
    return { response: await this.accessResponse(user), refresh: await this.refreshTokens.issue(user.id) };
  }

  private async accessResponse(user: UserRow): Promise<AuthResponse> {
    const minutes = this.config.get('ACCESS_TOKEN_MINUTES', { infer: true });
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      issuer: TOKEN_ISSUER,
      audience: ACCESS_AUDIENCE,
      expiresIn: minutes * 60,
    });
    return { user: toPublicUser(user), accessToken, expiresIn: minutes * 60 };
  }
}

// The ONLY way a user leaves this service: picked field by field, so a new private column
// (like passwordHash) can never slip into a response by accident
export const toPublicUser = (user: UserRow): User => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  emailVerified: user.emailVerifiedAt !== null,
});
