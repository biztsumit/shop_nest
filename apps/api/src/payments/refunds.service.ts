import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { formatPrice, type CreateRefund, type Refund } from '@shop/shared';
import { EmailQueue } from '../email/email-queue.js';
import { orderRefundedMessage } from '../email/templates.js';
import type { Refund as RefundRow } from '../generated/prisma/client.js';
import { OrdersService, toOrder } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RazorpayClient } from './razorpay.client.js';

const REFUNDABLE_ORDER = ['PAID', 'SHIPPED', 'DELIVERED', 'EXPIRED', 'CANCELLED'] as const;

// Giving money back. The tricky part: the database and Razorpay are two separate systems, and
// a refund must never happen twice (two clicks, two admins). So:
//   1. RESERVE the amount in our database first, inside a transaction that LOCKS the payment
//      row: "refunded so far" goes up, or the request is refused if it would pass the total
//   2. THEN ask Razorpay to send the money
//   3. If Razorpay refuses or can't be reached, UNDO the reservation
// A second request arriving during step 2 already sees the reserved amount.
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayClient,
    private readonly orders: OrdersService,
    private readonly emails: EmailQueue,
  ) {}

  async list(number: string): Promise<Refund[]> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: { payment: { include: { refunds: { orderBy: { id: 'asc' } } } } } });
    if (!order) throw new NotFoundException('No such order');
    return (order.payment?.refunds ?? []).map(toRefund);
  }

  // `actorId`: the admin, or null when the shop refunds by itself (a payment that came too late)
  async refund(number: string, input: CreateRefund, actorId: string | null, emailReason?: string): Promise<Refund> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: { payment: true, user: { select: { email: true, name: true } } } });
    if (!order) throw new NotFoundException('No such order');
    const payment = order.payment;
    if (!payment?.providerPaymentId || !(REFUNDABLE_ORDER as readonly string[]).includes(order.status) || !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      throw new ConflictException('This order has no payment that can be refunded.');
    }

    // 1. Reserve
    const reserved = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ amount: number; refunded_amount: number }>>`
        SELECT amount, refunded_amount FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const remaining = locked!.amount - locked!.refunded_amount;
      const amount = input.amount ?? remaining;
      if (remaining === 0) throw new ConflictException('This order has already been refunded in full.');
      if (amount > remaining) throw new UnprocessableEntityException(`At most ${formatPrice(remaining)} can still be refunded.`);
      if (input.restock && amount !== remaining) throw new UnprocessableEntityException('Items can only be restocked with a full refund.');
      await tx.payment.update({ where: { id: payment.id }, data: { refundedAmount: { increment: amount } } });
      return tx.refund.create({ data: { paymentId: payment.id, amount, reason: input.reason, createdById: actorId } });
    });

    // 2. Ask Razorpay
    let remote;
    try {
      remote = await this.razorpay.refund(payment.providerPaymentId, reserved.amount, { reason: input.reason, orderNumber: order.number });
    } catch (err) {
      // 3. Undo the reservation
      await this.prisma.$transaction([
        this.prisma.payment.update({ where: { id: payment.id }, data: { refundedAmount: { decrement: reserved.amount } } }),
        this.prisma.refund.update({ where: { id: reserved.id }, data: { status: 'FAILED' } }),
      ]);
      throw err instanceof BadGatewayException ? err : new BadGatewayException('The refund could not be made. Please try again.');
    }

    // Record the outcome; a full refund moves the order to REFUNDED
    const saved = await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.update({
        where: { id: reserved.id },
        data: { providerRefundId: remote.id, status: remote.status === 'processed' ? 'PROCESSED' : remote.status === 'failed' ? 'FAILED' : 'PENDING' },
      });
      const updated = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const full = updated.refundedAmount === updated.amount;
      await tx.payment.update({ where: { id: payment.id }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      if (full && order.status !== 'EXPIRED' && order.status !== 'CANCELLED') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
      }
      if (input.restock) await this.orders.restock(tx, order.id);
      return refund;
    });

    this.logger.log({ orderId: order.id, refundId: saved.id, amount: saved.amount, actorId }, 'Refund made');
    const view = toOrder(await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { position: 'asc' } } } }));
    await this.emails.enqueue(orderRefundedMessage(order.user.email, order.user.name, view, saved.amount, emailReason ?? ''));
    return toRefund(saved);
  }

  // Razorpay's webhook confirms (or fails) a refund that was still pending
  async applyRemoteStatus(providerRefundId: string, status: 'processed' | 'failed'): Promise<void> {
    await this.prisma.refund.updateMany({
      where: { providerRefundId, status: 'PENDING' },
      data: { status: status === 'processed' ? 'PROCESSED' : 'FAILED' },
    });
  }
}

const toRefund = (r: RefundRow): Refund => ({
  id: r.id,
  amount: r.amount,
  status: r.status,
  reason: r.reason,
  createdAt: r.createdAt.toISOString(),
});
