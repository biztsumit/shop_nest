import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminOrderSchema, auditEventSchema, formatPrice, orderSchema, pageSchema, problemSchema, quoteResultSchema, refundSchema } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, waitForEmail } from './support/emails.js';
import { signUp, stockOf, variantOf } from './support/shopper.js';

describe('Cash on delivery (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  // A shopper (email confirmed unless told otherwise) with `quantity` of one item in the cart
  const shopper = async ({ price = 49900, quantity = 1, verified = true } = {}) => {
    const riya = await signUp(app, 'Riya');
    if (verified) await prisma.user.update({ where: { id: riya.user.id }, data: { emailVerifiedAt: new Date() } });
    const address = await riya.addAddress();
    const variantId = await variantOf(prisma, 'classic-tee', { price, stock: 5 });
    await riya.as('post', '/cart/items', { variantId, quantity }).expect(200);
    const quote = (paymentMethod: 'ONLINE' | 'COD') =>
      riya.as('post', '/orders/quote', { paymentMethod }).expect(200).then((res) => quoteResultSchema.parse(res.body));
    const place = (paymentMethod: 'ONLINE' | 'COD', extra: object = {}) =>
      riya.as('post', '/orders', { addressId: address.id, paymentMethod, ...extra }, { 'Idempotency-Key': randomUUID() });
    return { ...riya, variantId, quote, place };
  };
  const admin = async () => {
    const boss = await signUp(app, 'Meera');
    await prisma.user.update({ where: { id: boss.user.id }, data: { role: 'ADMIN' } });
    return boss;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    clearOutbox(app);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('the quote adds the ₹49 fee for COD, and says COD is available', async () => {
    const riya = await shopper();
    expect(await riya.quote('ONLINE')).toMatchObject({ codFee: 0, total: 54800, cod: { available: true, reason: null } });
    expect(await riya.quote('COD')).toMatchObject({ shippingFee: 4900, codFee: 4900, total: 59700, paymentMethod: 'COD' });
  });

  it('a COD order is CONFIRMED at once: no payment window, a confirmation email, no online payment', async () => {
    const riya = await shopper();
    const order = orderSchema.parse((await riya.place('COD', { expectedTotal: 59700 }).expect(201)).body);
    expect(order).toMatchObject({ status: 'CONFIRMED', paymentMethod: 'COD', codFee: 4900, total: 59700, expiresAt: null, paidAt: null });

    const email = await waitForEmail(app, (m) => m.subject === `Order ${order.number} confirmed (cash on delivery)`);
    expect(email.text).toContain('To pay on delivery: ₹597');

    const pay = await riya.as('post', `/orders/${order.number}/payment`).expect(409);
    expect(problemSchema.parse(pay.body).detail).toBe('This order is paid in cash on delivery.');
    // The expiry job leaves it alone, whenever it runs
    expect(await app.get(OrdersService).expireOverdue(new Date(Date.now() + 365 * 86_400_000))).toBe(0);
  });

  it('refused without a confirmed email, or above ₹5,000 with the fee', async () => {
    const unconfirmed = await shopper({ verified: false });
    expect((await unconfirmed.quote('COD')).cod).toEqual({ available: false, reason: 'Confirm your email address to pay on delivery.' });
    const res = await unconfirmed.place('COD').expect(422);
    expect(problemSchema.parse(res.body).errors).toEqual([{ path: 'paymentMethod', message: 'Confirm your email address to pay on delivery.' }]);
    expect(await stockOf(prisma, unconfirmed.variantId)).toBe(5);   // nothing was taken

    await resetDatabase(prisma);
    const big = await shopper({ price: 249900, quantity: 2 });   // ₹4,998 + ₹49 fee = ₹5,047
    expect((await big.quote('COD')).cod.available).toBe(false);
    const tooBig = await big.place('COD').expect(422);
    expect(problemSchema.parse(tooBig.body).errors?.[0]?.message).toMatch(/up to ₹5,000/);
    await big.place('ONLINE').expect(201);   // paying online is fine
  });

  it('confirmed → shipped → delivered; delivery is when it is paid (cash collected)', async () => {
    const riya = await shopper();
    const order = orderSchema.parse((await riya.place('COD').expect(201)).body);
    const boss = await admin();

    await boss.as('post', `/admin/orders/${order.number}/deliver`).expect(409);   // not shipped yet
    await boss.as('post', `/admin/orders/${order.number}/ship`).expect(200);
    await riya.as('post', `/orders/${order.number}/cancel`).expect(409);          // on its way: too late
    const delivered = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/deliver`).expect(200)).body);
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.paidAt).not.toBeNull();

    const history = pageSchema(auditEventSchema).parse((await boss.as('get', `/admin/audit?entityType=order&entityId=${order.number}`)).body).data;
    expect(history.map((e) => e.summary)).toEqual([
      `${order.number}: shipped → delivered (₹597 collected in cash)`,
      `${order.number}: confirmed → shipped`,
    ]);
  });

  it('cancelled before it ships, by the shopper or an admin: the stock goes back', async () => {
    const riya = await shopper({ quantity: 2 });
    const first = orderSchema.parse((await riya.place('COD').expect(201)).body);
    expect(await stockOf(prisma, riya.variantId)).toBe(3);
    expect(orderSchema.parse((await riya.as('post', `/orders/${first.number}/cancel`).expect(200)).body).status).toBe('CANCELLED');
    expect(await stockOf(prisma, riya.variantId)).toBe(5);

    await riya.as('post', '/cart/items', { variantId: riya.variantId, quantity: 1 }).expect(200);
    const second = orderSchema.parse((await riya.place('COD').expect(201)).body);
    const boss = await admin();
    expect(adminOrderSchema.parse((await boss.as('post', `/admin/orders/${second.number}/cancel`).expect(200)).body).status).toBe('CANCELLED');
    expect(await stockOf(prisma, riya.variantId)).toBe(5);
  });

  it('refused at the door: marked returned, unpaid, and the stock goes back (once)', async () => {
    const riya = await shopper({ quantity: 2 });
    const order = orderSchema.parse((await riya.place('COD').expect(201)).body);
    const boss = await admin();
    await boss.as('post', `/admin/orders/${order.number}/return`).expect(409);   // not shipped yet
    await boss.as('post', `/admin/orders/${order.number}/ship`).expect(200);
    clearOutbox(app);

    const returned = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/return`).expect(200)).body);
    expect(returned).toMatchObject({ status: 'RETURNED', paidAt: null });
    expect(returned.returnedAt).not.toBeNull();
    expect(await stockOf(prisma, riya.variantId)).toBe(5);
    const email = await waitForEmail(app, (m) => m.subject === `Order ${order.number} came back to us`);
    expect(email.text).toContain('you owe nothing');

    // Twice is refused (and restocks nothing); so is delivering it now, or refunding it
    await boss.as('post', `/admin/orders/${order.number}/return`).expect(409);
    await boss.as('post', `/admin/orders/${order.number}/deliver`).expect(409);
    await boss.as('post', `/admin/orders/${order.number}/refunds`, { reason: 'x', reference: 'UPI 1' }).expect(409);
    expect(await stockOf(prisma, riya.variantId)).toBe(5);

    const history = pageSchema(auditEventSchema).parse((await boss.as('get', `/admin/audit?entityType=order&entityId=${order.number}`)).body).data;
    expect(history[0]?.summary).toBe(`${order.number}: shipped → returned, not paid (items back on sale)`);
  });

  it('a delivered COD order is refunded outside the shop and recorded with a reference', async () => {
    const riya = await shopper({ quantity: 2 });
    const order = orderSchema.parse((await riya.place('COD').expect(201)).body);
    const boss = await admin();
    const refunds = `/admin/orders/${order.number}/refunds`;
    await boss.as('post', refunds, { reason: 'Too early', reference: 'UPI 1' }).expect(409);   // not paid yet
    await boss.as('post', `/admin/orders/${order.number}/ship`).expect(200);
    await boss.as('post', `/admin/orders/${order.number}/deliver`).expect(200);
    clearOutbox(app);

    // The reference (how the shop paid it back) is required
    const missing = await boss.as('post', refunds, { amount: 20000, reason: 'Wrong size' }).expect(422);
    expect(problemSchema.parse(missing.body).errors?.[0]?.path).toBe('reference');

    const part = refundSchema.parse((await boss.as('post', refunds, { amount: 20000, reason: 'Wrong size', reference: 'UPI 412345678901' }).expect(201)).body);
    expect(part).toMatchObject({ amount: 20000, status: 'PROCESSED', reference: 'UPI 412345678901' });
    const email = await waitForEmail(app, (m) => m.subject === `Refund for order ${order.number}`);
    expect(email.text).toContain('sent it to you directly (reference: UPI 412345678901)');

    await boss.as('post', refunds, { amount: order.total, reason: 'Too much', reference: 'UPI 2' }).expect(422);   // more than is left
    await boss.as('post', refunds, { reason: 'Returned', reference: 'NEFT 99', restock: true }).expect(201);       // the rest, restocked
    const after = adminOrderSchema.parse((await boss.as('get', `/admin/orders/${order.number}`)).body);
    expect(after.status).toBe('REFUNDED');
    expect(after.refunds.map((r) => r.amount)).toEqual([20000, order.total - 20000]);
    expect(await stockOf(prisma, riya.variantId)).toBe(5);
    await boss.as('post', refunds, { reason: 'Again', reference: 'UPI 3' }).expect(409);

    const history = pageSchema(auditEventSchema).parse((await boss.as('get', `/admin/audit?entityType=order&entityId=${order.number}`)).body).data;
    expect(history[0]?.summary).toBe(`${order.number}: refunded ${formatPrice(order.total - 20000)} (in full) outside the shop, reference NEFT 99, items restocked. Reason: Returned`);
  });

  it('a reference is only for cash-on-delivery refunds', async () => {
    const riya = await shopper();
    const order = orderSchema.parse((await riya.place('ONLINE').expect(201)).body);
    const boss = await admin();
    const res = await boss.as('post', `/admin/orders/${order.number}/refunds`, { reason: 'x', reference: 'UPI 1' }).expect(422);
    expect(problemSchema.parse(res.body).errors?.[0]?.path).toBe('reference');
  });
});
