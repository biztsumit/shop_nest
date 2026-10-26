import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, StartPayment, VerifyPayment } from '@shop/shared';
import type { Env } from '../config/env.js';
import { EmailQueue } from '../email/email-queue.js';
import { orderConfirmedMessage, orderRefundedMessage } from '../email/templates.js';
import { Prisma, type Payment as PaymentRow } from '../generated/prisma/client.js';
import { OrdersService, toOrder } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RazorpayClient, type RazorpayPayment } from './razorpay.client.js';

type Outcome = 'already-settled' | 'paid' | 'paid-late' | 'refund';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayClient,
    private readonly orders: OrdersService,
    private readonly emails: EmailQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // Step 1: the shopper clicks "Pay". A Razorpay order is created once per order and reused for
  // every attempt (a failed card, then UPI...).
  async start(userId: string, number: string): Promise<StartPayment> {
    const order = await this.prisma.order.findFirst({ where: { number, userId }, include: { user: true, payment: true } });
    if (!order) throw new NotFoundException('No such order');
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(order.status === 'PAID' ? 'This order is already paid.' : "This order can't be paid any more.");
    }
    const payment = order.payment ?? (await this.createPayment(order.id, order.number, order.total));
    const address = order.shippingAddress as { phone?: string };
    return {
      keyId: this.razorpay.keyId,
      razorpayOrderId: payment.providerOrderId,
      amount: payment.amount,
      currency: 'INR',
      orderNumber: order.number,
      prefill: { name: order.user.name, email: order.user.email, contact: address.phone ?? '' },
    };
  }

  private async createPayment(orderId: string, number: string, total: number): Promise<PaymentRow> {
    const razorpayOrder = await this.razorpay.createOrder(total, number, { orderId });
    try {
      return await this.prisma.payment.create({ data: { orderId, providerOrderId: razorpayOrder.id, amount: total } });
    } catch (err) {
      // Two "Pay" clicks at once both created a Razorpay order; the database kept the first.
      // The second Razorpay order is simply never paid: harmless.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.payment.findUniqueOrThrow({ where: { orderId } });
      }
      throw err;
    }
  }

  // Step 2: Checkout says "paid" and gives the browser a signed receipt, which it sends here
  async verify(userId: string, number: string, input: VerifyPayment): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { number, userId }, include: { payment: true } });
    if (!order) throw new NotFoundException('No such order');
    if (!order.payment || order.payment.providerOrderId !== input.razorpayOrderId) {
      throw new BadRequestException("This payment doesn't belong to this order.");
    }
    if (!this.razorpay.isValidPaymentSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
      this.logger.warn({ orderId: order.id }, 'Payment signature did not match');
      throw new BadRequestException("We couldn't verify this payment. If money was taken, it will be refunded automatically.");
    }
    await this.settle(order.payment, input.razorpayPaymentId);
    return this.orders.get(userId, number);
  }

  // Applies what Razorpay says about one payment. Three things call this, in any order and
  // possibly more than once for the same payment: the browser (verify), Razorpay's webhook, and
  // the reconciliation job. So it must be IDEMPOTENT: the second call changes nothing.
  //
  // The signature only proves Razorpay sent the ids. The facts (paid? how much?) come from
  // asking Razorpay directly.
  async settle(payment: PaymentRow, providerPaymentId: string): Promise<void> {
    let remote = await this.razorpay.fetchPayment(providerPaymentId);
    if (remote.order_id !== payment.providerOrderId) {
      throw new BadRequestException("This payment doesn't belong to this order.");
    }
    if (remote.status === 'authorized') {
      // Accounts can be set to only HOLD the money at first; take it now
      remote = await this.razorpay.capture(remote.id, payment.amount);
    }
    if (remote.status === 'failed') {
      await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'CREATED' }, data: { status: 'FAILED' } });
      return;
    }
    if (remote.status !== 'captured' && remote.status !== 'refunded') return;   // nothing final yet
    if (remote.amount !== payment.amount || remote.currency !== 'INR') {
      // Never happens with an honest Checkout: our server set the amount. Don't ship; investigate.
      this.logger.error({ paymentId: payment.id, expected: payment.amount, got: remote.amount }, 'Payment amount does not match the order');
      throw new BadRequestException("The amount paid doesn't match the order. We'll look into it and contact you.");
    }
    await this.markPaid(payment, remote);
  }

  private async markPaid(payment: PaymentRow, remote: RazorpayPayment): Promise<void> {
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx): Promise<Outcome> => {
      // CLAIM the payment: only the first caller to get here records it
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['CREATED', 'FAILED'] } },
        data: { status: 'CAPTURED', providerPaymentId: remote.id, method: remote.method, capturedAt: now },
      });
      if (claimed.count === 0) return 'already-settled';

      // The usual case: the order was waiting for exactly this
      const paid = await tx.order.updateMany({ where: { id: payment.orderId, status: 'PENDING_PAYMENT' }, data: { status: 'PAID', paidAt: now } });
      if (paid.count === 1) return 'paid';

      // Paid TOO LATE: the order expired (or was cancelled) meanwhile and its stock went back
      // on sale. If it's all still there, take it again and honour the order; if not, the
      // money goes back. (The expiry job and this payment can't both "win": both CLAIM the
      // order's status, and the database lets only one of them change it.)
      if (await this.orders.retake(tx, payment.orderId)) {
        await tx.order.update({ where: { id: payment.orderId }, data: { status: 'PAID', paidAt: now, cancelledAt: null } });
        return 'paid-late';
      }
      return 'refund';
    });

    if (outcome === 'already-settled') return;
    const row = await this.prisma.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      include: { items: { orderBy: { position: 'asc' } }, user: { select: { email: true, name: true } } },
    });
    const order = toOrder(row);
    if (outcome === 'refund') {
      await this.refundLatePayment(payment, remote.id, order, row.user);
      return;
    }
    this.logger.log({ orderId: order.id, number: order.number, late: outcome === 'paid-late' }, 'Order paid');
    const link = `${this.config.get('WEB_ORIGIN', { infer: true })}/account/orders/${order.number}`;
    await this.emails.enqueue(orderConfirmedMessage(row.user.email, row.user.name, order, link));
  }

  private async refundLatePayment(payment: PaymentRow, providerPaymentId: string, order: Order, user: { email: string; name: string }): Promise<void> {
    this.logger.warn({ orderId: order.id }, 'Payment arrived after the order expired and the stock is gone: refunding');
    await this.razorpay.refund(providerPaymentId, payment.amount, { reason: 'order expired before payment', orderNumber: order.number });
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', refundedAmount: payment.amount } });
    await this.emails.enqueue(
      orderRefundedMessage(user.email, user.name, order, payment.amount, 'Your payment arrived after the order had expired, and the items have since sold out. Sorry!'),
    );
  }
}
