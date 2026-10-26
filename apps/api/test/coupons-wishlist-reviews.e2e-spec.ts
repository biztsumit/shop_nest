import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  orderSchema,
  pageSchema,
  problemSchema,
  productDetailSchema,
  productSummarySchema,
  quoteResultSchema,
  reviewSchema,
} from '@shop/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { ValidationFailedException } from '../src/common/validation.js';
import { CouponsService } from '../src/coupons/coupons.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { signUp, variantOf } from './support/shopper.js';

describe('Coupons, wishlist and reviews (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const coupon = (data: Partial<Prisma.CouponCreateInput> & { code: string }) =>
    prisma.coupon.create({ data: { type: 'PERCENT', value: 10, ...data } });

  const shopperWith = async (items: Array<[string, number]>, name = 'Riya') => {
    const shopper = await signUp(app, name);
    const address = await shopper.addAddress();
    for (const [variantId, quantity] of items) await shopper.as('post', '/cart/items', { variantId, quantity }).expect(200);
    const place = (body: object = {}) => shopper.as('post', '/orders', { addressId: address.id, ...body }, { 'Idempotency-Key': randomUUID() });
    const quote = (couponCode: string | null) => shopper.as('post', '/orders/quote', { couponCode });
    return { ...shopper, place, quote };
  };

  const couponError = (res: { body: unknown }) => problemSchema.parse(res.body).errors?.find((e) => e.path === 'couponCode')?.message;

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

  describe('coupons', () => {
    it('a percentage coupon in the quote and the order; any case works', async () => {
      await coupon({ code: 'DIWALI10', type: 'PERCENT', value: 10, maxDiscount: 30000 });
      const riya = await shopperWith([[await variantOf(prisma, 'classic-tee', { price: 99900 }), 2]]);

      const quote = quoteResultSchema.parse((await riya.quote('diwali10').expect(200)).body);
      expect(quote).toEqual({ subtotal: 199800, discount: 19980, shippingFee: 0, total: 179820, couponCode: 'DIWALI10' });

      const order = orderSchema.parse((await riya.place({ couponCode: 'diwali10', expectedTotal: 179820 }).expect(201)).body);
      expect(order).toMatchObject({ discount: 19980, total: 179820, couponCode: 'DIWALI10' });
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'DIWALI10' } })).usedCount).toBe(1);
    });

    it('a discount can bring the order under free delivery', async () => {
      await coupon({ code: 'FLAT200', type: 'FIXED', value: 20000 });
      const riya = await shopperWith([[await variantOf(prisma, 'classic-tee', { price: 109900 }), 1]]);
      expect(quoteResultSchema.parse((await riya.quote('FLAT200')).body)).toMatchObject({ discount: 20000, shippingFee: 4900, total: 94800 });
    });

    it('explains each reason a coupon can\'t be used, on the couponCode field', async () => {
      const day = 24 * 60 * 60 * 1000;
      await coupon({ code: 'OLDSALE', endsAt: new Date(Date.now() - day) });
      await coupon({ code: 'SOON', startsAt: new Date(Date.now() + day) });
      await coupon({ code: 'PAUSED', active: false });
      await coupon({ code: 'BIGBUY', minSubtotal: 200000 });
      await coupon({ code: 'GONE', usageLimit: 1, usedCount: 1 });
      const riya = await shopperWith([[await variantOf(prisma, 'classic-tee', { price: 49900 }), 1]]);

      expect(couponError(await riya.quote('NOPE').expect(422))).toBe("This coupon code isn't valid.");
      expect(couponError(await riya.quote('OLDSALE').expect(422))).toBe('This coupon has expired.');
      expect(couponError(await riya.quote('SOON').expect(422))).toBe("This coupon isn't active yet.");
      expect(couponError(await riya.quote('PAUSED').expect(422))).toBe("This coupon code isn't valid.");
      expect(couponError(await riya.quote('BIGBUY').expect(422))).toBe('Add ₹1,501 more to use this coupon (minimum ₹2,000).');
      expect(couponError(await riya.quote('GONE').expect(422))).toBe('This coupon has been fully used.');
      // ...and placing the order with one fails the same way, taking no stock
      await riya.place({ couponCode: 'OLDSALE' }).expect(422);
      expect(await prisma.order.count()).toBe(0);
    });

    it('once per shopper by default; cancelling the order gives the use back', async () => {
      await coupon({ code: 'WELCOME10' });
      const tee = await variantOf(prisma, 'classic-tee', { stock: 10 });
      const riya = await shopperWith([[tee, 1]]);
      const first = orderSchema.parse((await riya.place({ couponCode: 'WELCOME10' }).expect(201)).body);

      await riya.as('post', '/cart/items', { variantId: tee }).expect(200);
      expect(couponError(await riya.place({ couponCode: 'WELCOME10' }).expect(422))).toBe("You've already used this coupon.");

      await riya.as('post', `/orders/${first.number}/cancel`).expect(200);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'WELCOME10' } })).usedCount).toBe(0);
      await riya.place({ couponCode: 'WELCOME10' }).expect(201);
    });

    it('an expired order gives its coupon use back too', async () => {
      await coupon({ code: 'ONCEONLY', usageLimit: 1 });
      const riya = await shopperWith([[await variantOf(prisma, 'classic-tee'), 1]]);
      await riya.place({ couponCode: 'ONCEONLY' }).expect(201);
      await app.get(OrdersService).expireOverdue(new Date(Date.now() + 31 * 60_000));
      expect(await prisma.coupon.findUniqueOrThrow({ where: { code: 'ONCEONLY' } })).toMatchObject({ usedCount: 0 });
      expect(await prisma.couponRedemption.count()).toBe(0);
    });

    it('the last use: two shoppers at once, only one gets it', async () => {
      await coupon({ code: 'LASTONE', usageLimit: 1 });
      // DIFFERENT products: with the same one, the stock row's lock would already make the two
      // orders wait for each other, and this test couldn't tell whether the coupon is locked
      const riya = await shopperWith([[await variantOf(prisma, 'classic-tee'), 1]], 'Riya');
      const arjun = await shopperWith([[await variantOf(prisma, 'steel-mug'), 1]], 'Arjun');
      const [a, b] = await Promise.all([riya.place({ couponCode: 'LASTONE' }), arjun.place({ couponCode: 'LASTONE' })]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 422]);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'LASTONE' } })).usedCount).toBe(1);
    });

    // The test above depends on timing (the first order may simply finish first). This one
    // doesn't: transaction 1 redeems the coupon and is HELD OPEN, then transaction 2 tries.
    // With the row lock, 2 waits, then sees the use and gets the friendly message. Without it,
    // 2 would read "0 used", pass the checks, and crash into the database's CHECK instead.
    it('the last use, made deterministic: the second redeem waits for the first', async () => {
      await coupon({ code: 'LASTONE', usageLimit: 1 });
      const coupons = app.get(CouponsService);
      const orderFor = async (name: string) => {
        const { user } = await signUp(app, name);
        return prisma.order.create({
          data: { userId: user.id, idempotencyKey: randomUUID(), requestHash: '0'.repeat(64), shippingAddress: {}, subtotal: 0, shippingFee: 0, total: 0 },
        });
      };
      const [first, second] = [await orderFor('Riya'), await orderFor('Arjun')];

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let firstRedeemed = false;
      const t1 = prisma.$transaction(async (tx) => {
        await coupons.redeem(tx, first.userId, 'LASTONE', 50000, first.id);
        firstRedeemed = true;
        await held;   // keep the transaction (and its lock) open
      }, { timeout: 20_000 });
      while (!firstRedeemed) await new Promise((r) => setTimeout(r, 10));

      const t2 = prisma.$transaction((tx) => coupons.redeem(tx, second.userId, 'LASTONE', 50000, second.id), { timeout: 20_000 });
      t2.catch(() => undefined);   // checked below; this stops an "unhandled rejection" meanwhile
      await new Promise((r) => setTimeout(r, 300));   // t2 is now waiting (or, without the lock, done checking)
      release();
      await t1;
      await expect(t2).rejects.toBeInstanceOf(ValidationFailedException);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'LASTONE' } })).usedCount).toBe(1);
    });
  });

  describe('wishlist', () => {
    it('heart on, heart off; idempotent; only products on sale are listed', async () => {
      const riya = await signUp(app);
      await variantOf(prisma, 'classic-tee');
      await variantOf(prisma, 'steel-mug');
      const [tee, mug] = await Promise.all(['classic-tee', 'steel-mug'].map((slug) => prisma.product.findUniqueOrThrow({ where: { slug } })));

      await riya.as('put', `/wishlist/${tee!.id}`).expect(204);
      await riya.as('put', `/wishlist/${tee!.id}`).expect(204);   // again: no error, no duplicate
      await riya.as('put', `/wishlist/${mug!.id}`).expect(204);
      expect(productSummarySchema.array().parse((await riya.as('get', '/wishlist').expect(200)).body).map((p) => p.slug)).toEqual(['steel-mug', 'classic-tee']);
      expect(((await riya.as('get', '/wishlist/ids')).body as string[]).sort()).toEqual([tee!.id, mug!.id].sort());

      await prisma.product.update({ where: { id: mug!.id }, data: { status: 'ARCHIVED' } });
      expect(productSummarySchema.array().parse((await riya.as('get', '/wishlist')).body).map((p) => p.slug)).toEqual(['classic-tee']);

      await riya.as('delete', `/wishlist/${tee!.id}`).expect(204);
      await riya.as('delete', `/wishlist/${tee!.id}`).expect(204);
      await riya.as('put', `/wishlist/${mug!.id}`).expect(404);   // archived: can't be saved
      await request(app.getHttpServer()).get('/api/wishlist').expect(401);
    });
  });

  describe('reviews', () => {
    it('write, edit, read; the product page shows the stars', async () => {
      await variantOf(prisma, 'classic-tee');
      const riya = await signUp(app, 'Riya');
      const arjun = await signUp(app, 'Arjun');

      const written = reviewSchema.parse((await riya.as('put', '/products/classic-tee/reviews/mine', { rating: 4, title: 'Soft cotton' }).expect(200)).body);
      expect(written).toMatchObject({ rating: 4, authorName: 'Riya', verifiedPurchase: false, body: '' });
      // Writing again edits the same review
      const edited = reviewSchema.parse((await riya.as('put', '/products/classic-tee/reviews/mine', { rating: 5, title: 'Even better after washing' }).expect(200)).body);
      expect(edited.id).toBe(written.id);
      await arjun.as('put', '/products/classic-tee/reviews/mine', { rating: 2, title: 'Runs small', body: 'Order a size up.' }).expect(200);

      const list = pageSchema(reviewSchema).parse((await request(app.getHttpServer()).get('/api/products/classic-tee/reviews').expect(200)).body);
      expect(list.data.map((r) => [r.authorName, r.rating])).toEqual([['Arjun', 2], ['Riya', 5]]);

      const product = productDetailSchema.parse((await request(app.getHttpServer()).get('/api/products/classic-tee').expect(200)).body);
      expect(product.rating).toEqual({ average: 3.5, count: 2, distribution: [1, 0, 0, 1, 0] });

      // Hidden by an admin: not shown, not counted
      await prisma.review.updateMany({ where: { rating: 2 }, data: { hidden: true } });
      expect(productDetailSchema.parse((await request(app.getHttpServer()).get('/api/products/classic-tee')).body).rating).toMatchObject({ average: 5, count: 1 });

      await riya.as('delete', '/products/classic-tee/reviews/mine').expect(204);
      await riya.as('get', '/products/classic-tee/reviews/mine').expect(404);
    });

    it('"verified purchase" once they have PAID for it, not just ordered', async () => {
      const tee = await variantOf(prisma, 'classic-tee');
      const riya = await shopperWith([[tee, 1]]);
      const order = orderSchema.parse((await riya.place().expect(201)).body);
      const write = async () => reviewSchema.parse((await riya.as('put', '/products/classic-tee/reviews/mine', { rating: 5, title: 'Great' }).expect(200)).body);

      expect((await write()).verifiedPurchase).toBe(false);
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });
      expect((await write()).verifiedPurchase).toBe(true);
    });

    it('checks the rating, needs a login to write, and only for products on sale', async () => {
      await variantOf(prisma, 'classic-tee');
      const riya = await signUp(app);
      await riya.as('put', '/products/classic-tee/reviews/mine', { rating: 6, title: 'Wow' }).expect(422);
      await request(app.getHttpServer()).put('/api/products/classic-tee/reviews/mine').send({ rating: 5, title: 'x' }).expect(401);
      await riya.as('put', '/products/no-such-thing/reviews/mine', { rating: 5, title: 'x' }).expect(404);
      expect(productDetailSchema.parse((await request(app.getHttpServer()).get('/api/products/classic-tee')).body).rating).toEqual({ average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
    });
  });
});
