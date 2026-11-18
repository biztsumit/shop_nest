import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { formatPrice, type CreateRefund, type Refund } from '@shop/shared';
import { AuditService } from '../audit/audit.service.js';
import { ValidationFailedException } from '../common/validation.js';
import { EmailQueue } from '../email/email-queue.js';
import { orderRefundedMessage } from '../email/templates.js';
import type { Order, Refund as RefundRow } from '../generated/prisma/client.js';
import { ORDER_INCLUDE, OrdersService, toOrder } from '../orders/orders.service.js';
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
//
// Cash-on-delivery orders are different: there's no online payment to send money back to, so
// the shop pays the shopper back itself (UPI, bank transfer) and RECORDS it here, with a
// reference. See recordCashRefund.
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayClient,
    private readonly orders: OrdersService,
    private readonly emails: EmailQueue,
    private readonly audit: AuditService,
  ) {}

  async list(number: string): Promise<Refund[]> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: { refunds: { orderBy: { id: 'asc' } } } });
    if (!order) throw new NotFoundException('No such order');
    return order.refunds.map(toRefund);
  }

  // `actorId`: the admin, or null when the shop refunds by itself (a payment that came too late)
  async refund(number: string, input: CreateRefund, actorId: string | null, emailReason?: string): Promise<Refund> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: { payment: true, user: { select: { email: true, name: true } } } });
    if (!order) throw new NotFoundException('No such order');
    if (order.paymentMethod === 'COD') return this.recordCashRefund(order, input, actorId);
    if (input.reference) {
      throw new ValidationFailedException([{ path: 'reference', message: 'is only for cash-on-delivery orders (this one is refunded through Razorpay)' }]);
    }
    const payment = order.payment;
    if (!payment?.providerPaymentId || !(REFUNDABLE_ORDER as readonly string[]).includes(order.status) || !['CAPTURED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      throw new ConflictException('This order has no payment that can be refunded.');
    }

    // 1. Reserve
    const reserved = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ amount: number; refunded_amount: number }>>`
        SELECT amount, refunded_amount FROM payments WHERE id = ${payment.id}::uuid FOR UPDATE`;
      const amount = refundAmount(locked!.amount - locked!.refunded_amount, input);
      await tx.payment.update({ where: { id: payment.id }, data: { refundedAmount: { increment: amount } } });
      return tx.refund.create({ data: { orderId: order.id, paymentId: payment.id, amount, reason: input.reason, createdById: actorId } });
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
      // Recorded once the money is on its way (a refund Razorpay refused changed nothing).
      // actorId null = the shop refunded by itself.
      await this.audit.record(tx, {
        actorId,
        action: 'refund.create',
        entityType: 'order',
        entityId: order.number,
        summary: `${order.number}: refunded ${formatPrice(refund.amount)}${full ? ' (in full)' : ''}${input.restock ? ', items restocked' : ''}. Reason: ${input.reason}`,
        changes: { refundedAmount: { from: updated.refundedAmount - refund.amount, to: updated.refundedAmount } },
      });
      return refund;
    });

    this.logger.log({ orderId: order.id, refundId: saved.id, amount: saved.amount, actorId }, 'Refund made');
    const view = toOrder(await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE }));
    await this.emails.enqueue(orderRefundedMessage(order.user.email, order.user.name, view, saved.amount, emailReason ?? ''));
    return toRefund(saved);
  }

  // Cash on delivery: the shopper paid the courier, and the shop has already paid them back
  // outside the site. This only RECORDS that, so it's done (PROCESSED) at once. Same rules as an
  // online refund: never more than was paid in total, restock only with a full refund. The ORDER
  // row is locked while the refunds so far are added up, so two admins can't both record the
  // "last" refund.
  private async recordCashRefund(order: OrderRow, input: CreateRefund, actorId: string | null): Promise<Refund> {
    const reference = input.reference;
    if (!reference) {
      throw new ValidationFailedException([{ path: 'reference', message: 'is required for a cash-on-delivery order: how you paid it back, e.g. the UPI reference' }]);
    }
    const notPaid = () => new ConflictException('This cash-on-delivery order has not been paid, so there is nothing to refund. (It is paid when it is delivered.)');
    if (order.status !== 'DELIVERED' && order.status !== 'REFUNDED') throw notPaid();

    const saved = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text FROM orders WHERE id = ${order.id}::uuid FOR UPDATE`;
      if (locked!.status === 'REFUNDED') throw new ConflictException('This order has already been refunded in full.');
      if (locked!.status !== 'DELIVERED') throw notPaid();
      const so = await tx.refund.aggregate({ where: { orderId: order.id, status: { not: 'FAILED' } }, _sum: { amount: true } });
      const before = so._sum.amount ?? 0;
      const amount = refundAmount(order.total - before, input);
      const refund = await tx.refund.create({
        data: { orderId: order.id, amount, reason: input.reason, reference, status: 'PROCESSED', createdById: actorId },
      });
      const full = before + amount === order.total;
      if (full) await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } });
      if (input.restock) await this.orders.restock(tx, order.id);
      await this.audit.record(tx, {
        actorId,
        action: 'refund.create',
        entityType: 'order',
        entityId: order.number,
        summary: `${order.number}: refunded ${formatPrice(amount)}${full ? ' (in full)' : ''} outside the shop, reference ${reference}${input.restock ? ', items restocked' : ''}. Reason: ${input.reason}`,
        changes: { refundedAmount: { from: before, to: before + amount } },
      });
      return refund;
    });

    this.logger.log({ orderId: order.id, refundId: saved.id, amount: saved.amount, actorId }, 'Cash-on-delivery refund recorded');
    const view = toOrder(await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE }));
    await this.emails.enqueue(orderRefundedMessage(order.user.email, order.user.name, view, saved.amount, input.reason, reference));
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

type OrderRow = Order & { user: { email: string; name: string } };

// How much to refund, out of what's left: everything if no amount was given
function refundAmount(remaining: number, input: CreateRefund): number {
  const amount = input.amount ?? remaining;
  if (remaining === 0) throw new ConflictException('This order has already been refunded in full.');
  if (amount > remaining) throw new UnprocessableEntityException(`At most ${formatPrice(remaining)} can still be refunded.`);
  if (input.restock && amount !== remaining) throw new UnprocessableEntityException('Items can only be restocked with a full refund.');
  return amount;
}

const toRefund = (r: RefundRow): Refund => ({
  id: r.id,
  amount: r.amount,
  status: r.status,
  reason: r.reason,
  reference: r.reference,
  createdAt: r.createdAt.toISOString(),
});
