import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_STOCK_ALERTS } from '@shop/shared';
import type { Env } from '../config/env.js';
import { EmailQueue } from '../email/email-queue.js';
import { backInStockMessage } from '../email/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // The variants this shopper is still waiting for (to show "We'll email you" on the page)
  async waitingIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.stockAlert.findMany({ where: { userId, notifiedAt: null }, select: { variantId: true } });
    return rows.map((r) => r.variantId);
  }

  // "Email me when it's back". Asking twice is fine (PUT is idempotent). Asking again after an
  // email was sent (it sold out again) starts a new wait on the same row.
  async watch(userId: string, variantId: string): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, product: { status: 'ACTIVE' } }, select: { stock: true } });
    if (!variant) throw new NotFoundException("This product isn't available.");
    if (variant.stock > 0) throw new ConflictException("Good news: it's in stock right now. Add it to your cart instead.");

    const existing = await this.prisma.stockAlert.findUnique({ where: { userId_variantId: { userId, variantId } } });
    if (existing?.notifiedAt === null) return;
    if (!existing && (await this.prisma.stockAlert.count({ where: { userId, notifiedAt: null } })) >= MAX_STOCK_ALERTS) {
      throw new ConflictException(`You're already waiting for ${MAX_STOCK_ALERTS} items. Remove one from your account first.`);
    }
    await this.prisma.stockAlert.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId },
      update: { notifiedAt: null, createdAt: new Date() },
    });
  }

  async unwatch(userId: string, variantId: string): Promise<void> {
    await this.prisma.stockAlert.deleteMany({ where: { userId, variantId, notifiedAt: null } });
  }

  // THE JOB (every 5 minutes): waiting alerts whose variant has stock again, on a product that's
  // on sale. Checking on a timetable catches stock coming back by ANY route: an admin's edit, an
  // unpaid order expiring, a cancellation, a refund with restock.
  //
  // Each alert is CLAIMED first ("set notified_at, only if still null"), so two runs at once (or
  // a retry) can't email twice. If queueing the email then fails, the claim is undone and the
  // next run tries again. Returns how many emails were queued.
  async notifyRestocked(now = new Date()): Promise<number> {
    const due = await this.prisma.stockAlert.findMany({
      where: { notifiedAt: null, variant: { stock: { gt: 0 }, product: { status: 'ACTIVE' } } },
      orderBy: { id: 'asc' },
      take: 200,
      include: {
        user: { select: { email: true, name: true } },
        variant: { select: { price: true, options: true, product: { select: { name: true, slug: true } } } },
      },
    });

    let sent = 0;
    for (const alert of due) {
      const claimed = await this.prisma.stockAlert.updateMany({ where: { id: alert.id, notifiedAt: null }, data: { notifiedAt: now } });
      if (claimed.count === 0) continue;
      const { product, options, price } = alert.variant;
      const choice = Object.values(options as Record<string, string>).join(', ');
      const item = choice ? `${product.name} (${choice})` : product.name;
      const link = `${this.config.get('WEB_ORIGIN', { infer: true })}/products/${product.slug}`;
      try {
        await this.emails.enqueue(backInStockMessage(alert.user.email, alert.user.name, item, price, link));
        sent++;
      } catch (err) {
        await this.prisma.stockAlert.updateMany({ where: { id: alert.id }, data: { notifiedAt: null } });
        this.logger.error({ err, alertId: alert.id }, 'Could not queue a back-in-stock email; will retry next run');
      }
    }
    if (sent > 0) this.logger.log({ sent }, 'Back-in-stock emails queued');
    return sent;
  }
}
