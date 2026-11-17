import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EmailPreferences } from '@shop/shared';
import { TOKEN_ISSUER, UNSUBSCRIBE_AUDIENCE } from '../auth/tokens.js';
import { CartService } from '../cart/cart.service.js';
import type { Env } from '../config/env.js';
import { EmailQueue } from '../email/email-queue.js';
import { cartReminderMessage } from '../email/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const HOUR = 60 * 60 * 1000;
// A cart untouched this long is "abandoned"...
const REMIND_AFTER = 24 * HOUR;
// ...but one untouched for over a week is left alone: a reminder that late is just noise
const TOO_OLD = 7 * 24 * HOUR;
// Unsubscribe links keep working for a long time: people find old emails
const UNSUBSCRIBE_LINK_SECONDS = 365 * 24 * 60 * 60;

@Injectable()
export class CartRemindersService {
  private readonly logger = new Logger(CartRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly emails: EmailQueue,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // THE JOB (hourly, daytime): one reminder per abandoned cart. A shopper is due when
  //   - they want reminders, and their email address is confirmed (never email an address its
  //     owner hasn't confirmed: it may be someone else's)
  //   - their cart's LAST change is between 24 hours and 7 days ago
  //   - they haven't been reminded since that change (any change to the cart re-arms it)
  // Each shopper is CLAIMED first (cart_reminded_at set, only if still due), so two runs can't
  // both send. Returns how many reminders were queued.
  async sendReminders(now = new Date()): Promise<number> {
    const due = await this.prisma.$queryRaw<Array<{ id: string; email: string; name: string; last_change: Date; reminded_at: Date | null }>>`
      SELECT u.id::text, u.email, u.name, MAX(c.updated_at) AS last_change, u.cart_reminded_at AS reminded_at
      FROM users u JOIN cart_items c ON c.user_id = u.id
      WHERE u.cart_reminders AND u.email_verified_at IS NOT NULL
      GROUP BY u.id
      HAVING MAX(c.updated_at) < ${new Date(now.getTime() - REMIND_AFTER)}
         AND MAX(c.updated_at) > ${new Date(now.getTime() - TOO_OLD)}
         AND (u.cart_reminded_at IS NULL OR u.cart_reminded_at < MAX(c.updated_at))
      ORDER BY MAX(c.updated_at)
      LIMIT 200`;

    let sent = 0;
    for (const user of due) {
      const claimed = await this.prisma.user.updateMany({
        where: { id: user.id, OR: [{ cartRemindedAt: null }, { cartRemindedAt: { lt: user.last_change } }] },
        data: { cartRemindedAt: now },
      });
      if (claimed.count === 0) continue;

      // Today's prices and stock. Nothing left that can be bought: no email (the claim stays,
      // so this cart isn't looked at again until it changes)
      const cart = await this.cart.get(user.id);
      const buyable = cart.lines.filter((l) => l.problem === null);
      if (buyable.length === 0) continue;

      const web = this.config.get('WEB_ORIGIN', { infer: true });
      try {
        await this.emails.enqueue(cartReminderMessage(
          user.email,
          user.name,
          buyable.map((l) => ({ name: l.name, quantity: l.quantity, lineTotal: l.lineTotal })),
          cart.subtotal,
          `${web}/checkout`,
          `${web}/unsubscribe?token=${await this.unsubscribeToken(user.id)}`,
        ));
        sent++;
      } catch (err) {
        // Give the claim back: the next run tries again
        await this.prisma.user.update({ where: { id: user.id }, data: { cartRemindedAt: user.reminded_at } });
        this.logger.error({ err, userId: user.id }, 'Could not queue a cart reminder; will retry next run');
      }
    }
    if (sent > 0) this.logger.log({ sent }, 'Cart reminders queued');
    return sent;
  }

  async preferences(userId: string): Promise<EmailPreferences> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { cartReminders: true } });
    if (!user) throw new UnauthorizedException('Your session has ended. Please log in again.');
    return { cartReminders: user.cartReminders };
  }

  async setPreferences(userId: string, prefs: EmailPreferences): Promise<EmailPreferences> {
    await this.prisma.user.update({ where: { id: userId }, data: { cartReminders: prefs.cartReminders } });
    return prefs;
  }

  // The one-click link: whoever has the email may turn reminders off, without logging in.
  // (Turning them back ON needs the account page: a forwarded email shouldn't be able to.)
  async unsubscribe(token: string): Promise<void> {
    let userId: string;
    try {
      ({ sub: userId } = await this.jwt.verifyAsync<{ sub: string }>(token, { issuer: TOKEN_ISSUER, audience: UNSUBSCRIBE_AUDIENCE }));
    } catch {
      throw new BadRequestException('This link is invalid or too old. You can turn reminders off on your account page.');
    }
    await this.prisma.user.updateMany({ where: { id: userId }, data: { cartReminders: false } });
  }

  unsubscribeToken(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId }, { issuer: TOKEN_ISSUER, audience: UNSUBSCRIBE_AUDIENCE, expiresIn: UNSUBSCRIBE_LINK_SECONDS });
  }
}
