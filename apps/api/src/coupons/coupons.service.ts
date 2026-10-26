import { Injectable, Logger } from '@nestjs/common';
import { couponDiscount, formatPrice } from '@shop/shared';
import { ValidationFailedException } from '../common/validation.js';
import type { Coupon as CouponRow, Prisma } from '../generated/prisma/client.js';

// A coupon that can't be used is a problem with the `couponCode` field: the checkout form shows
// the message right under the coupon box
const refuse = (message: string) => new ValidationFailedException([{ path: 'couponCode', message }]);

// Used by orders at three moments:
//   check   (quote): "would this code work, and for how much?" Changes nothing.
//   redeem  (placing an order, inside its transaction): the same checks, then it's USED
//   release (order cancelled or expired, inside that transaction): the use is given back
@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  async check(db: Prisma.TransactionClient, userId: string, code: string, subtotal: number): Promise<{ discount: number }> {
    const coupon = await db.coupon.findUnique({ where: { code } });
    return { discount: await this.validate(db, coupon, userId, subtotal) };
  }

  async redeem(tx: Prisma.TransactionClient, userId: string, code: string, subtotal: number, orderId: string): Promise<{ discount: number }> {
    // LOCK the coupon row until this order's transaction ends. Two shoppers racing for the last
    // use of "first 100 orders", or one shopper placing two orders at once, queue up here, and
    // each sees the other's use when it gets its turn.
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM coupons WHERE code = ${code} FOR UPDATE`;
    const coupon = locked ? await tx.coupon.findUnique({ where: { id: locked.id } }) : null;
    const discount = await this.validate(tx, coupon, userId, subtotal);
    await tx.coupon.update({ where: { id: coupon!.id }, data: { usedCount: { increment: 1 } } });
    await tx.couponRedemption.create({ data: { couponId: coupon!.id, userId, orderId, discount } });
    return { discount };
  }

  async release(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const redemption = await tx.couponRedemption.findUnique({ where: { orderId } });
    if (!redemption) return;
    await tx.couponRedemption.delete({ where: { id: redemption.id } });
    await tx.coupon.update({ where: { id: redemption.couponId }, data: { usedCount: { decrement: 1 } } });
    this.logger.log({ orderId, couponId: redemption.couponId }, 'Coupon use given back');
  }

  // Every rule, in the order a shopper would want to hear about them
  private async validate(db: Prisma.TransactionClient, coupon: CouponRow | null, userId: string, subtotal: number): Promise<number> {
    const now = new Date();
    if (!coupon || !coupon.active) throw refuse("This coupon code isn't valid.");
    if (coupon.startsAt && coupon.startsAt > now) throw refuse("This coupon isn't active yet.");
    if (coupon.endsAt && coupon.endsAt <= now) throw refuse('This coupon has expired.');
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) throw refuse('This coupon has been fully used.');
    const usedByMe = await db.couponRedemption.count({ where: { couponId: coupon.id, userId } });
    if (usedByMe >= coupon.perUserLimit) {
      throw refuse(coupon.perUserLimit === 1 ? "You've already used this coupon." : `You've used this coupon ${usedByMe} times, the most allowed.`);
    }
    if (subtotal < coupon.minSubtotal) {
      throw refuse(`Add ${formatPrice(coupon.minSubtotal - subtotal)} more to use this coupon (minimum ${formatPrice(coupon.minSubtotal)}).`);
    }
    return couponDiscount(coupon, subtotal);
  }
}
