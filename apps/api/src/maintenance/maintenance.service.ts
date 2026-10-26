import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 24 * 60 * 60 * 1000;

// Housekeeping: rows that have done their job and only take up space
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async cleanUp(now = new Date()): Promise<{ refreshTokens: number; emailTokens: number; webhookEvents: number }> {
    const dayAgo = new Date(now.getTime() - DAY);
    const [refreshTokens, emailTokens, webhookEvents] = await this.prisma.$transaction([
      // Expired over a day ago: they can't log anyone in, and reuse detection doesn't need them
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
      // Email links past their time (used or not)
      this.prisma.emailToken.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
      // Razorpay stops retrying an event after a day; a month of history is plenty
      this.prisma.webhookEvent.deleteMany({ where: { processedAt: { lt: new Date(now.getTime() - 30 * DAY) } } }),
    ]);
    const counts = { refreshTokens: refreshTokens.count, emailTokens: emailTokens.count, webhookEvents: webhookEvents.count };
    this.logger.log(counts, 'Cleaned up old rows');
    return counts;
  }
}
