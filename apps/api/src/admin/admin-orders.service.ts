import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatPrice, type AdminOrder, type AdminOrderListQuery, type AdminOrderSummary, type OrderStatus, type Page } from '@shop/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { EmailQueue } from '../email/email-queue.js';
import { orderCancelledMessage, orderDeliveredMessage, orderReturnedMessage, orderShippedMessage } from '../email/templates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { OrdersService, toOrder } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ADMIN_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  user: { select: { id: true, name: true, email: true } },
  payment: true,
  refunds: { orderBy: { id: 'asc' } },
} satisfies Prisma.OrderInclude;

type AdminRow = Prisma.OrderGetPayload<{ include: typeof ADMIN_INCLUDE }>;

// What happens next to an order, and from which statuses. Each move is a CLAIM ("only if it's
// still X"), so two admins clicking at once can't, say, ship an order twice. Each move also
// tells the shopper, by email. (CONFIRMED = cash on delivery, ready to ship.)
const MOVES = {
  ship: { from: ['PAID', 'CONFIRMED'], to: 'SHIPPED', stamp: 'shippedAt', email: orderShippedMessage },
  deliver: { from: ['SHIPPED'], to: 'DELIVERED', stamp: 'deliveredAt', email: orderDeliveredMessage },
} as const satisfies Record<string, { from: readonly OrderStatus[]; to: OrderStatus; stamp: string; email: unknown }>;

// Statuses an admin may cancel from: unpaid online orders, and COD orders not yet shipped
const CANCELLABLE: readonly OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly emails: EmailQueue,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  async list({ status, search, limit, cursor }: AdminOrderListQuery): Promise<Page<AdminOrderSummary>> {
    const rows = await this.prisma.order.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ number: search.toUpperCase() }, { user: { email: { contains: search.toLowerCase() } } }] } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: ADMIN_INCLUDE,
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        total: o.total,
        itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
        firstItem: { productName: o.items[0]?.productName ?? '', imageUrl: o.items[0]?.imageUrl ?? null },
        createdAt: o.createdAt.toISOString(),
        customer: o.user,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(number: string): Promise<AdminOrder> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: ADMIN_INCLUDE });
    if (!order) throw new NotFoundException('No such order');
    return toAdminOrder(order);
  }

  async move(number: string, move: keyof typeof MOVES, actorId: string): Promise<AdminOrder> {
    const { from, to, stamp, email } = MOVES[move];
    const current = await this.prisma.order.findUnique({ where: { number }, select: { id: true, status: true, paymentMethod: true, total: true } });
    if (!current) throw new NotFoundException('No such order');
    // Delivering a cash-on-delivery order is also when it's PAID: the courier collected the cash
    const cashCollected = move === 'deliver' && current.paymentMethod === 'COD';
    const now = new Date();
    // The claim and its audit record together: either both happen, or neither
    const moved = (from as readonly OrderStatus[]).includes(current.status) && await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { number, status: current.status },
        data: { status: to, [stamp]: now, ...(cashCollected ? { paidAt: now } : {}) },
      });
      if (claimed.count === 0) return false;
      // Cash collected = paid: the GST invoice is issued now, in the same transaction
      if (cashCollected) await this.invoices.issue(tx, current.id, now);
      await this.audit.record(tx, {
        actorId,
        action: `order.${move}`,
        entityType: 'order',
        entityId: number,
        summary: `${number}: ${statusWords(current.status)} → ${statusWords(to)}${cashCollected ? ` (${formatPrice(current.total)} collected in cash)` : ''}`,
        changes: { status: { from: current.status, to } },
      });
      return true;
    });
    if (!moved) {
      const order = await this.get(number);
      throw new ConflictException(`Only ${from.map(statusWords).join(' or ')} orders can be marked ${statusWords(to)}; this one is ${statusWords(order.status)}.`);
    }
    this.logger.log({ number, from: current.status, to, actorId }, 'Order status changed');
    const order = await this.get(number);
    await this.emails.enqueue(email(order.customer.email, order.customer.name, order, this.link(`/account/orders/${number}`)));
    return order;
  }

  // Unpaid online orders, and cash-on-delivery orders not yet shipped. A paid order gets its
  // money back through a refund instead.
  async cancel(number: string, actorId: string): Promise<AdminOrder> {
    const order = await this.prisma.order.findUnique({ where: { number } });
    if (!order) throw new NotFoundException('No such order');
    const cancelledNow = CANCELLABLE.includes(order.status) && await this.prisma.$transaction(async (tx) => {
      // Claimed from the status just read: if it moved on meanwhile (paid, shipped), nothing happens
      if (!(await this.orders.release(order.id, 'CANCELLED', [order.status], tx))) return false;
      await this.audit.record(tx, {
        actorId,
        action: 'order.cancel',
        entityType: 'order',
        entityId: number,
        summary: `${number}: cancelled ${order.status === 'CONFIRMED' ? 'before shipping (cash on delivery)' : 'before payment'} (items back on sale)`,
        changes: { status: { from: order.status, to: 'CANCELLED' } },
      });
      return true;
    });
    if (!cancelledNow) {
      throw new ConflictException('Only unpaid orders, or cash-on-delivery orders not yet shipped, can be cancelled here. For a paid order, make a full refund (with restock).');
    }
    this.logger.log({ number, actorId }, 'Order cancelled by an admin');
    const cancelled = await this.get(number);
    await this.emails.enqueue(orderCancelledMessage(cancelled.customer.email, cancelled.customer.name, cancelled, this.link('/products')));
    return cancelled;
  }

  // A cash-on-delivery parcel that came back: refused at the door, or the courier couldn't
  // deliver it. Nothing was paid, so there's nothing to refund: the items go back on sale and
  // a coupon it used can be used again. (A paid online order that comes back gets a refund
  // with restock instead.)
  async markReturned(number: string, actorId: string): Promise<AdminOrder> {
    const order = await this.prisma.order.findUnique({ where: { number } });
    if (!order) throw new NotFoundException('No such order');
    const returned = order.paymentMethod === 'COD' && order.status === 'SHIPPED' && await this.prisma.$transaction(async (tx) => {
      // A claim, like every move: two clicks can't restock twice, and a parcel marked delivered
      // meanwhile stays delivered
      if (!(await this.orders.release(order.id, 'RETURNED', ['SHIPPED'], tx))) return false;
      await this.audit.record(tx, {
        actorId,
        action: 'order.return',
        entityType: 'order',
        entityId: number,
        summary: `${number}: shipped → returned, not paid (items back on sale)`,
        changes: { status: { from: 'SHIPPED', to: 'RETURNED' } },
      });
      return true;
    });
    if (!returned) {
      throw new ConflictException('Only shipped cash-on-delivery orders can be marked returned. A paid order that comes back gets a full refund with restock.');
    }
    this.logger.log({ number, actorId }, 'Cash-on-delivery order returned');
    const view = await this.get(number);
    await this.emails.enqueue(orderReturnedMessage(view.customer.email, view.customer.name, view, this.link('/products')));
    return view;
  }

  // A page of the shop, as a full address for an email
  private link(path: string): string {
    return `${this.config.get('WEB_ORIGIN', { infer: true })}${path}`;
  }
}

// "PENDING_PAYMENT" → "pending payment", for messages and the audit log
const statusWords = (status: OrderStatus): string => status.toLowerCase().replace('_', ' ');

const toAdminOrder = (o: AdminRow): AdminOrder => ({
  ...toOrder(o),
  customer: o.user,
  payment: o.payment && {
    status: o.payment.status,
    method: o.payment.method,
    amount: o.payment.amount,
    refundedAmount: o.payment.refundedAmount,
    providerPaymentId: o.payment.providerPaymentId,
  },
  refunds: o.refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status, reason: r.reason, reference: r.reference, createdAt: r.createdAt.toISOString() })),
});
