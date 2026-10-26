import type { NestExpressApplication } from '@nestjs/platform-express';
import { cartSchema, orderSchema, orderSummarySchema, pageSchema, problemSchema, quoteResultSchema } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { signUp, stockOf, variantOf } from './support/shopper.js';

describe('Orders (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  // A shopper with an address and the given items in their cart
  const shopperWith = async (items: Array<[variantId: string, quantity: number]>, name = 'Riya') => {
    const shopper = await signUp(app, name);
    const address = await shopper.addAddress();
    for (const [variantId, quantity] of items) await shopper.as('post', '/cart/items', { variantId, quantity }).expect(200);
    const place = (key: string = randomUUID(), body: object = {}) =>
      shopper.as('post', '/orders', { addressId: address.id, ...body }, { 'Idempotency-Key': key });
    return { ...shopper, address, place };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('places an order: copies the items and address, takes the stock, empties the cart', async () => {
    const tee = await variantOf(prisma, 'classic-tee', { price: 49900, stock: 5 });
    const mug = await variantOf(prisma, 'steel-mug', { price: 29900, stock: 3 });
    const riya = await shopperWith([[tee, 2], [mug, 1]]);

    const quote = quoteResultSchema.parse((await riya.as('post', '/orders/quote', {}).expect(200)).body);
    expect(quote).toEqual({ subtotal: 129700, discount: 0, shippingFee: 0, total: 129700, couponCode: null });

    const res = await riya.place(undefined, { expectedTotal: 129700 }).expect(201);
    const order = orderSchema.parse(res.body);
    expect(order).toMatchObject({
      number: expect.stringMatching(/^SN\d{6}$/),
      status: 'PENDING_PAYMENT',
      subtotal: 129700,
      shippingFee: 0,
      total: 129700,
      shippingAddress: { fullName: 'Riya Sharma', pincode: '411001', city: 'Pune' },
    });
    expect(order.items.map((i) => [i.productName, i.quantity, i.unitPrice, i.lineTotal, i.sku])).toEqual(
      expect.arrayContaining([['Classic Tee', 2, 49900, 99800, 'CLASSIC-TEE-1'], ['Steel Mug', 1, 29900, 29900, 'STEEL-MUG-1']]),
    );
    expect(new Date(order.expiresAt!).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);

    expect(await stockOf(prisma, tee)).toBe(3);
    expect(await stockOf(prisma, mug)).toBe(2);
    expect(cartSchema.parse((await riya.as('get', '/cart')).body).lines).toEqual([]);

    // Later changes to the catalog and address book don't rewrite the order
    await prisma.productVariant.update({ where: { id: tee }, data: { price: 1 } });
    await riya.as('patch', `/addresses/${riya.address.id}`, { city: 'Mumbai' }).expect(200);
    const again = orderSchema.parse((await riya.as('get', `/orders/${order.number}`).expect(200)).body);
    expect(again.items.find((i) => i.productName === 'Classic Tee')!.unitPrice).toBe(49900);
    expect(again.shippingAddress.city).toBe('Pune');
  });

  it('adds ₹49 delivery below ₹999', async () => {
    const riya = await shopperWith([[await variantOf(prisma, 'classic-tee', { price: 49900 }), 1]]);
    expect(orderSchema.parse((await riya.place().expect(201)).body)).toMatchObject({ subtotal: 49900, shippingFee: 4900, total: 54800 });
  });

  it('not enough stock: nothing is taken for ANY line (one transaction)', async () => {
    const tee = await variantOf(prisma, 'classic-tee', { stock: 5 });
    const mug = await variantOf(prisma, 'steel-mug', { stock: 5 });
    const riya = await shopperWith([[tee, 2], [mug, 3]]);
    await prisma.productVariant.update({ where: { id: mug }, data: { stock: 1 } });   // sold elsewhere meanwhile

    const res = await riya.place().expect(409);
    expect(problemSchema.parse(res.body).detail).toMatch(/Steel Mug/);
    expect(await stockOf(prisma, tee)).toBe(5);   // the tee's stock was given back by the rollback
    expect(await prisma.order.count()).toBe(0);
    expect(cartSchema.parse((await riya.as('get', '/cart')).body).lines).toHaveLength(2);   // cart kept
  });

  it('the last one in stock: two shoppers at once, exactly one gets it', async () => {
    const lastOne = await variantOf(prisma, 'last-tee', { stock: 1 });
    const riya = await shopperWith([[lastOne, 1]], 'Riya');
    const arjun = await shopperWith([[lastOne, 1]], 'Arjun');

    const [a, b] = await Promise.all([riya.place(), arjun.place()]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    expect(await stockOf(prisma, lastOne)).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it('refuses when the price changed since the shopper looked (expectedTotal)', async () => {
    const tee = await variantOf(prisma, 'classic-tee', { price: 49900 });
    const riya = await shopperWith([[tee, 1]]);
    await prisma.productVariant.update({ where: { id: tee }, data: { price: 59900 } });
    const res = await riya.place(undefined, { expectedTotal: 54800 }).expect(409);
    expect(problemSchema.parse(res.body).detail).toMatch(/Prices have changed/);
    expect(await stockOf(prisma, tee)).toBe(5);
  });

  it('refuses an empty cart, and someone else\'s address', async () => {
    const riya = await shopperWith([]);
    await riya.place().expect(409);
    const arjun = await shopperWith([[await variantOf(prisma, 'classic-tee'), 1]], 'Arjun');
    await arjun.as('post', '/orders', { addressId: riya.address.id }, { 'Idempotency-Key': randomUUID() }).expect(404);
  });

  describe('Idempotency-Key', () => {
    it('is required', async () => {
      const riya = await shopperWith([[await variantOf(prisma, 'classic-tee'), 1]]);
      const res = await riya.as('post', '/orders', { addressId: riya.address.id }).expect(400);
      expect(problemSchema.parse(res.body).detail).toMatch(/Idempotency-Key/);
      await riya.place('short').expect(400);
    });

    it('the same key again: the SAME order back (200), nothing new', async () => {
      const tee = await variantOf(prisma, 'classic-tee', { stock: 5 });
      const riya = await shopperWith([[tee, 2]]);
      const key = randomUUID();
      const first = orderSchema.parse((await riya.place(key).expect(201)).body);
      const retry = await riya.place(key).expect(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(orderSchema.parse(retry.body).id).toBe(first.id);
      expect(await prisma.order.count()).toBe(1);
      expect(await stockOf(prisma, tee)).toBe(3);
    });

    it('two identical requests at the same moment (a double click): one order', async () => {
      const tee = await variantOf(prisma, 'classic-tee', { stock: 5 });
      const riya = await shopperWith([[tee, 2]]);
      const key = randomUUID();
      const [a, b] = await Promise.all([riya.place(key), riya.place(key)]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 201]);
      expect(orderSchema.parse(a.body).id).toBe(orderSchema.parse(b.body).id);
      expect(await prisma.order.count()).toBe(1);
      expect(await stockOf(prisma, tee)).toBe(3);
    });

    it('the same key for a different request is refused', async () => {
      const riya = await shopperWith([[await variantOf(prisma, 'classic-tee'), 1]]);
      const key = randomUUID();
      await riya.place(key).expect(201);
      const other = await riya.addAddress();
      await riya.as('post', '/orders', { addressId: other.id }, { 'Idempotency-Key': key }).expect(422);
    });

    it('keys are per user: two users may (by chance) use the same one', async () => {
      const tee = await variantOf(prisma, 'classic-tee');
      const riya = await shopperWith([[tee, 1]], 'Riya');
      const arjun = await shopperWith([[tee, 1]], 'Arjun');
      await riya.place('same-key-123').expect(201);
      await arjun.place('same-key-123').expect(201);
    });
  });

  describe('after placing', () => {
    it('lists my orders newest first, with paging; others see none of them', async () => {
      const tee = await variantOf(prisma, 'classic-tee', { stock: 10 });
      const riya = await shopperWith([[tee, 1]]);
      const numbers: string[] = [];
      for (let i = 0; i < 3; i++) {
        if (i > 0) await riya.as('post', '/cart/items', { variantId: tee, quantity: i + 1 }).expect(200);
        numbers.push(orderSchema.parse((await riya.place().expect(201)).body).number);
      }
      const page1 = pageSchema(orderSummarySchema).parse((await riya.as('get', '/orders?limit=2').expect(200)).body);
      expect(page1.data.map((o) => o.number)).toEqual([numbers[2], numbers[1]]);
      expect(page1.data[0]).toMatchObject({ itemCount: 3, firstItem: { productName: 'Classic Tee' } });
      const page2 = pageSchema(orderSummarySchema).parse((await riya.as('get', `/orders?limit=2&cursor=${page1.nextCursor}`)).body);
      expect(page2).toEqual({ data: [expect.objectContaining({ number: numbers[0] })], nextCursor: null });

      const arjun = await signUp(app, 'Arjun');
      expect(pageSchema(orderSummarySchema).parse((await arjun.as('get', '/orders')).body).data).toEqual([]);
      await arjun.as('get', `/orders/${numbers[0]}`).expect(404);
    });

    it('cancelling before paying puts the stock back; twice is refused', async () => {
      const tee = await variantOf(prisma, 'classic-tee', { stock: 5 });
      const riya = await shopperWith([[tee, 2]]);
      const order = orderSchema.parse((await riya.place().expect(201)).body);
      const cancelled = orderSchema.parse((await riya.as('post', `/orders/${order.number}/cancel`).expect(200)).body);
      expect(cancelled).toMatchObject({ status: 'CANCELLED', expiresAt: null });
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(await stockOf(prisma, tee)).toBe(5);
      await riya.as('post', `/orders/${order.number}/cancel`).expect(409);
      expect(await stockOf(prisma, tee)).toBe(5);
    });

    it('unpaid orders expire: stock goes back, only once', async () => {
      const tee = await variantOf(prisma, 'classic-tee', { stock: 5 });
      const riya = await shopperWith([[tee, 2]]);
      const order = orderSchema.parse((await riya.place().expect(201)).body);
      const orders = app.get(OrdersService);

      expect(await orders.expireOverdue()).toBe(0);   // not yet due
      const later = new Date(Date.now() + 31 * 60_000);
      // Two expiry runs at once (e.g. two servers): the stock still comes back exactly once
      const [a, b] = await Promise.all([orders.expireOverdue(later), orders.expireOverdue(later)]);
      expect(a + b).toBe(1);
      expect(await stockOf(prisma, tee)).toBe(5);
      expect(orderSchema.parse((await riya.as('get', `/orders/${order.number}`)).body).status).toBe('EXPIRED');
    });

    it('the database refuses totals that don\'t add up', async () => {
      const tee = await variantOf(prisma, 'classic-tee');
      const riya = await shopperWith([[tee, 1]]);
      const order = orderSchema.parse((await riya.place().expect(201)).body);
      await expect(prisma.order.update({ where: { id: order.id }, data: { total: 1 } })).rejects.toThrow(/orders_total_adds_up/);
    });
  });
});
