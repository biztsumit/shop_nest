import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const SESSION_ENDED = 'Your session has ended. Please log in again.';

// Two tabs often refresh at the same moment with the same cookie. Only one can win; for a few
// seconds the other is told "retry" (it will then send the NEW cookie the winner received).
// After that, an old token coming back can only mean a copy: treated as theft.
const RETRY_WINDOW_MS = 10_000;

// A refresh token is 32 random bytes: far too many possibilities to guess. That's also why a
// FAST hash (SHA-256) is fine here, unlike passwords: there's nothing to "try" against it.
const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex');

export type IssuedRefreshToken = { token: string; expiresAt: Date };

@Injectable()
export class RefreshTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // A new token: for a new login (new family), or replacing a used one (same family)
  async issue(userId: string, familyId: string = randomUUID()): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get('REFRESH_TOKEN_DAYS', { infer: true }) * 86_400_000);
    // Only the hash is stored: someone who reads this table still can't use the tokens
    await this.prisma.refreshToken.create({ data: { userId, familyId, tokenHash: sha256(token), expiresAt } });
    return { token, expiresAt };
  }

  // ROTATION: swap a valid token for a new one in the same family. Each token works ONCE.
  async rotate(token: string): Promise<IssuedRefreshToken & { userId: string }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    const now = new Date();
    if (!row || row.revokedAt || row.expiresAt <= now) {
      throw new UnauthorizedException(SESSION_ENDED);
    }

    if (row.usedAt) {
      if (now.getTime() - row.usedAt.getTime() < RETRY_WINDOW_MS) {
        throw new ConflictException('This session was refreshed a moment ago. Please try again.');
      }
      // REUSE DETECTION: this token was already swapped, minutes or days ago. Either the real
      // user or a thief now holds the newer one, and we can't tell which. End the whole
      // family, so the thief is logged out too (the real user simply logs in again).
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException(SESSION_ENDED);
    }

    // Claim the token ATOMICALLY: "set used_at if it's still unused" is one SQL statement, so
    // when two requests race, exactly one gets count = 1. Reading first and writing later
    // (two steps) would let both through.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This session was refreshed a moment ago. Please try again.');
    }

    return { userId: row.userId, ...(await this.issue(row.userId, row.familyId)) };
  }

  // Logout: the family of this token (this device's login) stops working
  async revokeByToken(token: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (row) {
      await this.revokeFamily(row.familyId);
    }
  }

  // "Log out everywhere": every login of this user, on every device
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
