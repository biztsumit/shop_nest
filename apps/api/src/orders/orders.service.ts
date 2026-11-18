import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AdminShipment,
  type Shipment,
  codUnavailableReason,
  computeTotals,
  type Order,
  type OrderAddress,
  type OrderStatus,
  type OrderSummary,
  type Page,
  type PaymentMethod,
  type PlaceOrder,
  type QuoteResult,
} from '@shop/shared';
import { createHash } from 'node:crypto';
import { ValidationFailedException } from '../common/validation.js';
import type { Env } from '../config/env.js';
import { EmailQueue } from '../email/email-queue.js';
import { codOrderConfirmedMessage } from '../email/templates.js';
import { Prisma } from '../generated/prisma/client.js';
import { CartService } from '../cart/cart.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { MetricsService } from '../metrics/metrics.service.js';

// An order with what every view of it shows: its items, and its parcel (the active shipment,
// with its journey newest first)
export const ORDER_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  shipments: { where: { cancelledAt: null }, include: { events: { orderBy: { at: 'desc' } } } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type ShipmentRow = OrderWithItems['shipments'][number];

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly coupons: CouponsService,
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: MetricsService,
    private readonly emails: EmailQueue,
  ) {}

  // What checkout would cost right now (the cart's buyable lines, a coupon, delivery, and the
  // cash-on-delivery fee if chosen), and whether this shopper may pay on delivery at all
  async quote(userId: string, couponCode: string | null, paymentMethod: PaymentMethod = 'ONLINE'): Promise<QuoteResult> {
    const cart = await this.cart.get(userId);
    const discount = couponCode ? (await this.coupons.check(this.prisma, userId, couponCode, cart.subtotal)).discount : 0;
    const reason = codUnavailableReason(computeTotals(cart.subtotal, discount, 'COD').total, await this.emailVerified(userId));
    return { ...computeTotals(cart.subtotal, discount, paymentMethod), couponCode, paymentMethod, cod: { available: reason === null, reason } };
  }

  // PLACING AN ORDER. Everything below happens in ONE database transaction: either all of it
  // (order saved, stock taken, coupon used, cart emptied) or, on any error, none of it.
  //
  // Returns `replayed: true` when this Idempotency-Key was seen before: the SAME order comes
  // back, nothing new is created or charged.
  async place(userId: string, input: PlaceOrder, idempotencyKey: string): Promise<{ order: Order; replayed: boolean }> {
    // (The payment method joins the fingerprint only for COD, so online orders' fingerprints stay
    // exactly as they were before COD existed)
    const requestHash = sha256(JSON.stringify([
      input.addressId, input.couponCode, input.expectedTotal ?? null, ...(input.paymentMethod === 'COD' ? ['COD'] : []),
    ]));

    const earlier = await this.findByKey(userId, idempotencyKey);
    if (earlier) return { order: replay(earlier, requestHash), replayed: true };

    try {
      const order = await this.prisma.$transaction((tx) => this.create(tx, userId, input, idempotencyKey, requestHash));
      this.logger.log({ orderId: order.id, number: order.number, total: order.total, paymentMethod: order.paymentMethod }, 'Order placed');
      this.metrics.ordersPlaced.inc();
      const placed = toOrder(order);
      // An online order is confirmed by email once PAID (PaymentsService); a COD order is
      // confirmed now: there's no payment to wait for
      if (order.paymentMethod === 'COD') await this.confirmCod(userId, placed);
      return { order: placed, replayed: false };
    } catch (err) {
      // The same key arrived twice at the same moment: the second request waited at the order
      // INSERT (the unique index) until the first committed, then failed here. Answer with the
      // first one's order.
      if (isUniqueViolation(err, 'idempotency_key')) {
        const first = await this.findByKey(userId, idempotencyKey);
        if (first) return { order: replay(first, requestHash), replayed: true };
      }
      throw err;
    }
  }

  private async create(
    tx: Prisma.TransactionClient,
    userId: string,
    input: PlaceOrder,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<OrderWithItems> {
    const address = await tx.address.findFirst({ where: { id: input.addressId, userId } });
    if (!address) throw new NotFoundException('No such address');
    const cod = input.paymentMethod === 'COD';
    // Checked first (cheap); the order-total limit is checked once the total is known
    if (cod && !(await this.emailVerified(userId, tx))) throw refuseCod(codUnavailableReason(0, false)!);

    // FIRST, claim the idempotency key: inserting the order row is what a duplicate request
    // collides with (see place()). Totals are filled in at the end, once they're known.
    const shippingAddress: OrderAddress = {
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
    };
    const order = await tx.order.create({
      data: { userId, idempotencyKey, requestHash, shippingAddress, subtotal: 0, shippingFee: 0, total: 0 },
    });

    const lines = await tx.cartItem.findMany({
      where: { userId },
      // Sorted by variant: two orders for the same items lock the rows in the SAME order, so
      // they queue up behind each other instead of each holding a lock the other needs (a deadlock)
      orderBy: { variantId: 'asc' },
      include: {
        variant: {
          include: {
            product: { select: { slug: true, name: true, hsnCode: true, gstRate: true, images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1, select: { url: true } } } },
          },
        },
      },
    });
    if (lines.length === 0) throw new ConflictException('Your cart is empty.');

    // TAKE THE STOCK. One conditional UPDATE per line: "subtract, but only if there's enough and
    // the product is on sale". PostgreSQL locks the row while it does this, so two shoppers can't
    // both buy the last one: the second waits, then sees the new stock and gets 0 rows back.
    // RETURNING gives the price at THIS moment, which is the price charged.
    const shortages: string[] = [];
    const prices = new Map<string, number>();
    for (const line of lines) {
      const taken = await tx.$queryRaw<Array<{ price: number }>>`
        UPDATE product_variants v SET stock = v.stock - ${line.quantity}
        FROM products p
        WHERE v.id = ${line.variantId}::uuid AND p.id = v.product_id
          AND p.status = 'ACTIVE' AND v.stock >= ${line.quantity}
        RETURNING v.price`;
      if (taken[0]) prices.set(line.variantId, taken[0].price);
      else shortages.push(line.variant.product.name);
    }
    if (shortages.length > 0) {
      // Throwing rolls back the WHOLE transaction: the stock taken for the other lines too
      throw new ConflictException(`Some items can't be bought as they are: ${shortages.join(', ')}. Please review your cart.`);
    }

    const subtotal = lines.reduce((sum, line) => sum + prices.get(line.variantId)! * line.quantity, 0);
    const discount = input.couponCode ? (await this.coupons.redeem(tx, userId, input.couponCode, subtotal, order.id)).discount : 0;
    const totals = computeTotals(subtotal, discount, input.paymentMethod);
    const tooBig = cod ? codUnavailableReason(totals.total, true) : null;
    if (tooBig) throw refuseCod(tooBig);
    if (input.expectedTotal !== undefined && input.expectedTotal !== totals.total) {
      throw new ConflictException('Prices have changed since you started checking out. Please review your order.');
    }

    await tx.orderItem.createMany({
      data: lines.map((line, position) => ({
        orderId: order.id,
        variantId: line.variantId,
        productSlug: line.variant.product.slug,
        productName: line.variant.product.name,
        options: line.variant.options ?? {},
        sku: line.variant.sku,
        imageUrl: line.variant.product.images[0]?.url ?? null,
        unitPrice: prices.get(line.variantId)!,
        quantity: line.quantity,
        lineTotal: prices.get(line.variantId)! * line.quantity,
        // For the invoice: the GST rate the shopper bought at, even if the product's changes later
        hsnCode: line.variant.product.hsnCode,
        gstRate: line.variant.product.gstRate,
        position,
      })),
    });
    // Only the lines that were ordered: something added in another tab meanwhile stays
    await tx.cartItem.deleteMany({ where: { userId, id: { in: lines.map((l) => l.id) } } });

    // Online: unpaid orders hold their stock for a while, then expire. COD: confirmed at once,
    // nothing to wait for (it's paid when delivered)
    const minutes = this.config.get('ORDER_PAYMENT_MINUTES', { infer: true });
    return tx.order.update({
      where: { id: order.id },
      data: cod
        ? { ...totals, couponCode: input.couponCode, paymentMethod: 'COD', status: 'CONFIRMED' }
        : { ...totals, couponCode: input.couponCode, expiresAt: new Date(Date.now() + minutes * 60_000) },
      include: ORDER_INCLUDE,
    });
  }

  private async emailVerified(userId: string, db: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const user = await db.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    return user?.emailVerifiedAt != null;
  }

  private async confirmCod(userId: string, order: Order): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
    const link = `${this.config.get('WEB_ORIGIN', { infer: true })}/account/orders/${order.number}`;
    // The order stands even if the email can't be queued: the shopper sees it on screen
    await this.emails.enqueue(codOrderConfirmedMessage(user.email, user.name, order, link))
      .catch((err: unknown) => this.logger.error({ err, orderId: order.id }, 'Could not queue the COD confirmation email'));
  }

  // "My orders", newest first (ids are UUID v7: time-ordered)
  async list(userId: string, limit: number, cursor?: string): Promise<Page<OrderSummary>> {
    const rows = await this.prisma.order.findMany({
      where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: ORDER_INCLUDE,
    });
    const page = rows.slice(0, limit);
    return { data: page.map(toSummary), nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
  }

  async get(userId: string, number: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { number, userId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('No such order');
    return toOrder(order);
  }

  // The shopper changed their mind: before paying online, or (cash on delivery) before it ships
  async cancel(userId: string, number: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { number, userId }, include: { shipments: { where: { cancelledAt: null }, select: { id: true } } } });
    if (!order) throw new NotFoundException('No such order');
    // Already booked with a courier (being packed): the shop has to call that off first
    if (order.shipments.length > 0) {
      throw new ConflictException("Your order is already being packed for the courier, so it can't be cancelled here. Please contact us.");
    }
    if (!(await this.release(order.id, 'CANCELLED', ['PENDING_PAYMENT', 'CONFIRMED']))) {
      throw new ConflictException("This order can't be cancelled any more. If it's paid, contact us for a refund.");
    }
    return this.get(userId, number);
  }

  // Unpaid orders past their time: expire them and put their stock back on sale.
  // Run every minute by a background job (step 5.3). Returns how many expired.
  async expireOverdue(now = new Date()): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', expiresAt: { lt: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });
    let expired = 0;
    for (const { id } of due) {
      if (await this.release(id, 'EXPIRED', ['PENDING_PAYMENT'])) expired++;
    }
    if (expired > 0) this.logger.log({ expired }, 'Unpaid orders expired');
    return expired;
  }

  // Moves an order to CANCELLED, EXPIRED or RETURNED (a cash-on-delivery parcel sent back) and puts its stock (and coupon use) back.
  // The status change is a CLAIM: "only if it's still in one of `from`". If a payment arrives
  // at the same moment as the expiry job, exactly one of them wins; the stock is never
  // returned for an order that got paid, nor returned twice.
  async release(orderId: string, to: 'CANCELLED' | 'EXPIRED' | 'RETURNED', from: OrderStatus[], tx?: Prisma.TransactionClient): Promise<boolean> {
    const run = async (db: Prisma.TransactionClient) => {
      const claimed = await db.order.updateMany({
        where: { id: orderId, status: { in: from } },
        data: { status: to, ...(to === 'CANCELLED' ? { cancelledAt: new Date() } : to === 'RETURNED' ? { returnedAt: new Date() } : {}) },
      });
      if (claimed.count === 0) return false;
      await this.restock(db, orderId);
      await this.coupons.release(db, orderId);
      return true;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  // Puts an order's items back on the shelf (variants that still exist)
  async restock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const items = await tx.orderItem.findMany({ where: { orderId, variantId: { not: null } }, orderBy: { variantId: 'asc' } });
    for (const item of items) {
      await tx.productVariant.update({ where: { id: item.variantId! }, data: { stock: { increment: item.quantity } } });
    }
  }

  // The opposite, for an order paid AFTER it expired: take its stock again, but only if ALL of
  // it is still there. The rows are LOCKED first (FOR UPDATE) and checked together, so it's
  // all-or-nothing without throwing (the caller's transaction continues either way).
  async retake(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
    const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { variantId: 'asc' } });
    if (items.some((i) => i.variantId === null)) return false;   // a variant was deleted since
    const rows = await tx.$queryRaw<Array<{ id: string; stock: number; status: string }>>`
      SELECT v.id::text, v.stock, p.status::text FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = ANY(${items.map((i) => i.variantId!)}::uuid[])
      ORDER BY v.id
      FOR UPDATE OF v`;
    const available = new Map(rows.map((r) => [r.id, r.status === 'ACTIVE' ? r.stock : 0]));
    if (items.some((i) => (available.get(i.variantId!) ?? 0) < i.quantity)) return false;
    for (const item of items) {
      await tx.productVariant.update({ where: { id: item.variantId! }, data: { stock: { decrement: item.quantity } } });
    }
    return true;
  }

  private findByKey(userId: string, idempotencyKey: string) {
    return this.prisma.order.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } }, include: ORDER_INCLUDE });
  }
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// A repeat of a request we've already handled: fine if it's the SAME request, an error if the
// client reused the key for something else (that's a bug in the client, and guessing which
// one it meant could charge the wrong amount)
const replay = (order: OrderWithItems, requestHash: string): Order => {
  if (order.requestHash !== requestHash) {
    throw new UnprocessableEntityException('This Idempotency-Key was already used for a different order. Use a new key for a new order.');
  }
  return toOrder(order);
};

// Cash on delivery not allowed: a problem with the `paymentMethod` field (checkout shows it there)
const refuseCod = (message: string) => new ValidationFailedException([{ path: 'paymentMethod', message }]);

const isUniqueViolation = (err: unknown, field: string): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  JSON.stringify(err.meta ?? {}).includes(field);

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export const toOrder = (o: OrderWithItems): Order => ({
  id: o.id,
  number: o.number,
  status: o.status,
  paymentMethod: o.paymentMethod,
  items: o.items.map((i) => ({
    variantId: i.variantId,
    productSlug: i.productSlug,
    productName: i.productName,
    options: i.options as Record<string, string>,
    sku: i.sku,
    imageUrl: i.imageUrl,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    lineTotal: i.lineTotal,
  })),
  shippingAddress: o.shippingAddress as OrderAddress,
  subtotal: o.subtotal,
  discount: o.discount,
  shippingFee: o.shippingFee,
  codFee: o.codFee,
  total: o.total,
  couponCode: o.couponCode,
  createdAt: o.createdAt.toISOString(),
  expiresAt: o.status === 'PENDING_PAYMENT' ? iso(o.expiresAt) : null,
  paidAt: iso(o.paidAt),
  shippedAt: iso(o.shippedAt),
  deliveredAt: iso(o.deliveredAt),
  cancelledAt: iso(o.cancelledAt),
  returnedAt: iso(o.returnedAt),
  shipment: o.shipments[0] ? toShipment(o.shipments[0]) : null,
});

// A parcel as the shopper sees it
const toShipment = (s: ShipmentRow): Shipment => ({
  provider: s.provider,
  courierName: s.courierName,
  awb: s.awb,
  trackingUrl: s.trackingUrl,
  status: s.status,
  statusAt: s.statusAt.toISOString(),
  events: s.events.map((e) => ({ status: e.status, activity: e.activity, location: e.location, at: e.at.toISOString() })),
});

// ...and as admins see it: also the label to print, and whether a pickup was requested
export const toAdminShipment = (s: ShipmentRow): AdminShipment => ({
  ...toShipment(s),
  labelUrl: s.labelUrl,
  pickupRequestedAt: iso(s.pickupRequestedAt),
});

const toSummary = (o: OrderWithItems): OrderSummary => ({
  id: o.id,
  number: o.number,
  status: o.status,
  total: o.total,
  itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
  firstItem: { productName: o.items[0]?.productName ?? '', imageUrl: o.items[0]?.imageUrl ?? null },
  createdAt: o.createdAt.toISOString(),
});
