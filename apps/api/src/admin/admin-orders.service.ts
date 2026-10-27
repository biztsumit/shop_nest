import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminOrder, AdminOrderListQuery, AdminOrderSummary, OrderStatus, Page } from '@shop/shared';
import type { Env } from '../config/env.js';
import { EmailQueue } from '../email/email-queue.js';
import { orderShippedMessage } from '../email/templates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { OrdersService, toOrder } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ADMIN_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  user: { select: { id: true, name: true, email: true } },
  payment: { include: { refunds: { orderBy: { id: 'asc' } } } },
} satisfies Prisma.OrderInclude;

type AdminRow = Prisma.OrderGetPayload<{ include: typeof ADMIN_INCLUDE }>;

// What happens next to an order, and from which status. Each move is a CLAIM ("only if it's
// still X"), so two admins clicking at once can't, say, ship an order twice.
const MOVES = {
  ship: { from: 'PAID', to: 'SHIPPED', stamp: 'shippedAt' },
  deliver: { from: 'SHIPPED', to: 'DELIVERED', stamp: 'deliveredAt' },
} as const satisfies Record<string, { from: OrderStatus; to: OrderStatus; stamp: string }>;

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly emails: EmailQueue,
    private readonly config: ConfigService<Env, true>,
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
    const { from, to, stamp } = MOVES[move];
    const claimed = await this.prisma.order.updateMany({ where: { number, status: from }, data: { status: to, [stamp]: new Date() } });
    if (claimed.count === 0) {
      const order = await this.get(number);
      throw new ConflictException(`Only ${from.toLowerCase()} orders can be marked ${to.toLowerCase()}; this one is ${order.status.toLowerCase().replace('_', ' ')}.`);
    }
    this.logger.log({ number, from, to, actorId }, 'Order status changed');
    const order = await this.get(number);
    if (move === 'ship') {
      const link = `${this.config.get('WEB_ORIGIN', { infer: true })}/account/orders/${number}`;
      await this.emails.enqueue(orderShippedMessage(order.customer.email, order.customer.name, order, link));
    }
    return order;
  }

  // Unpaid orders only: a paid order gets its money back through a refund instead
  async cancel(number: string, actorId: string): Promise<AdminOrder> {
    const order = await this.prisma.order.findUnique({ where: { number } });
    if (!order) throw new NotFoundException('No such order');
    if (!(await this.orders.release(order.id, 'CANCELLED', ['PENDING_PAYMENT']))) {
      throw new ConflictException('Only unpaid orders can be cancelled here. For a paid order, make a full refund (with restock).');
    }
    this.logger.log({ number, actorId }, 'Order cancelled by an admin');
    return this.get(number);
  }
}

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
  refunds: (o.payment?.refunds ?? []).map((r) => ({ id: r.id, amount: r.amount, status: r.status, reason: r.reason, createdAt: r.createdAt.toISOString() })),
});
