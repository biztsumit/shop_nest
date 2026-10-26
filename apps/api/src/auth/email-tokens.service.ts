import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { EmailTokenPurpose } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const LIFETIME_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 60 * 60 * 1000,   // a day: people don't always check email at once
  RESET_PASSWORD: 60 * 60 * 1000,      // an hour: a reset link is powerful, keep it short
};

const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex');

export const INVALID_LINK = 'This link is invalid or has expired. Please ask for a new one.';

// The secrets inside email links. Same rules as refresh tokens: random, stored only as a hash,
// single-use, expiring.
@Injectable()
export class EmailTokensService {
  constructor(private readonly prisma: PrismaService) {}

  // A new link for this purpose. Older unused links for the same purpose stop working: only
  // the newest email's link is valid.
  async issue(userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.emailToken.create({
        data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]) },
      }),
    ]);
    return token;
  }

  // Uses up a token and returns whose it was. Claimed atomically ("only if still unused, not
  // expired, and for this purpose"), so a link clicked twice at once works only once.
  async consume(token: string, purpose: EmailTokenPurpose): Promise<string> {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose) {
      throw new BadRequestException(INVALID_LINK);
    }
    const claimed = await this.prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BadRequestException(INVALID_LINK);
    }
    return row.userId;
  }
}
