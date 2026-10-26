import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthResponse, Login, Register, User } from '@shop/shared';
import type { Env } from '../config/env.js';
import { Prisma, type User as UserRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessTokenPayload } from './auth-user.js';
import { PasswordService } from './password.service.js';
import { ACCESS_AUDIENCE, TOKEN_ISSUER } from './tokens.js';

// One message for "no such account" AND "wrong password": telling them apart would let anyone
// find out which emails have an account here
const BAD_LOGIN = 'Wrong email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register({ name, email, password }: Register): Promise<AuthResponse> {
    const passwordHash = await this.passwords.hash(password);
    try {
      const user = await this.prisma.user.create({ data: { name, email, passwordHash } });
      return this.session(user);
    } catch (err) {
      // P2002 = a UNIQUE rule said no: the email is taken. Checking first ("does it exist?",
      // then insert) could race with a second sign-up; letting the database decide can't.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists. Log in instead?');
      }
      throw err;
    }
  }

  async login({ email, password }: Login): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same work, same answer, same time, whether or not the account exists
    const ok = await this.passwords.verifyOrWaste(user?.passwordHash, password);
    if (!user || !ok) {
      throw new UnauthorizedException(BAD_LOGIN);
    }
    return this.session(user);
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // A valid token for an account that has since been deleted
    if (!user) {
      throw new UnauthorizedException('Your session has ended. Please log in again.');
    }
    return toPublicUser(user);
  }

  private async session(user: UserRow): Promise<AuthResponse> {
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
});
