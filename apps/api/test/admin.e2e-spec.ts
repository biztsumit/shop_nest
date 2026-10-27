import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  adminOrderSchema,
  adminOrderSummarySchema,
  adminProductDetailSchema,
  adminProductSchema,
  couponSchema,
  orderSchema,
  pageSchema,
  problemSchema,
  productDetailSchema,
} from '@shop/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, waitForEmail } from './support/emails.js';
import { signUp, stockOf, variantOf } from './support/shopper.js';

describe('Admin back office (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const publicGet = (path: string) => request(app.getHttpServer()).get(`/api${path}`);

  const admin = async () => {
    const a = await signUp(app, 'Meera');
    await prisma.user.update({ where: { id: a.user.id }, data: { role: 'ADMIN' } });
    return a;
  };

  const newProduct = {
    name: 'Linen Kurta',
    slug: 'linen-kurta',
    description: 'Breathable linen for summer afternoons.',
    variants: [
      { options: { size: 'M' }, price: 129900, stock: 4, sku: 'KURTA-M' },
      { options: { size: 'L' }, price: 139900, stock: 2, sku: 'KURTA-L' },
    ],
    images: [{ url: 'https://img.example.com/kurta-1.jpg', alt: 'Front' }],
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

  it('customers get 403 on every admin route', async () => {
    const riya = await signUp(app);
    for (const [method, path] of [['get', '/admin/products'], ['post', '/admin/products'], ['get', '/admin/orders'], ['get', '/admin/coupons'], ['get', '/admin/reviews']] as const) {
      await riya.as(method, path, {}).expect(403);
    }
  });

  describe('products and variants', () => {
    it('a new product starts as a DRAFT (hidden from the shop) until it is made ACTIVE', async () => {
      const boss = await admin();
      const created = adminProductDetailSchema.parse((await boss.as('post', '/admin/products', newProduct).expect(201)).body);
      expect(created).toMatchObject({ status: 'DRAFT', price: 129900, stock: 6, variantCount: 2 });
      await publicGet('/products/linen-kurta').expect(404);

      const listed = pageSchema(adminProductSchema).parse((await boss.as('get', '/admin/products?search=kurta').expect(200)).body);
      expect(listed.data.map((p) => p.slug)).toEqual(['linen-kurta']);

      await boss.as('patch', `/admin/products/${created.id}`, { status: 'ACTIVE' }).expect(200);
      const shop = productDetailSchema.parse((await publicGet('/products/linen-kurta').expect(200)).body);
      expect(shop.variants.map((v) => v.options)).toEqual([{ size: 'M' }, { size: 'L' }]);
    });

    it('slugs are unique; photos are replaced as a list; a partial update changes only what is sent', async () => {
      const boss = await admin();
      const created = adminProductDetailSchema.parse((await boss.as('post', '/admin/products', newProduct).expect(201)).body);
      const dup = await boss.as('post', '/admin/products', { ...newProduct, variants: [{ price: 100 }] }).expect(409);
      expect(problemSchema.parse(dup.body).detail).toMatch(/slug/);

      const updated = adminProductDetailSchema.parse((await boss.as('patch', `/admin/products/${created.id}`, {
        images: [{ url: 'https://img.example.com/kurta-2.jpg', alt: 'Back' }, { url: 'https://img.example.com/kurta-1.jpg', alt: 'Front' }],
      }).expect(200)).body);
      expect(updated.images.map((i) => i.alt)).toEqual(['Back', 'Front']);
      expect(updated).toMatchObject({ name: 'Linen Kurta', description: newProduct.description, status: 'DRAFT' });
      await boss.as('patch', `/admin/products/${created.id}`, {}).expect(422);
    });

    it('variants: add, duplicate options refused, the "was" price rule, never the last one deleted', async () => {
      const boss = await admin();
      const p = adminProductDetailSchema.parse((await boss.as('post', '/admin/products', newProduct).expect(201)).body);
      const added = adminProductDetailSchema.parse((await boss.as('post', `/admin/products/${p.id}/variants`, { options: { Size: 'XL' }, price: 149900, stock: 1 }).expect(201)).body);
      expect(added.variants).toHaveLength(3);
      await boss.as('post', `/admin/products/${p.id}/variants`, { options: { size: 'M' }, price: 1 }).expect(409);

      const m = added.variants.find((v) => v.options.size === 'M')!;
      // 'was' price below the CURRENT price, though only compareAtPrice is sent: refused
      await boss.as('patch', `/admin/variants/${m.id}`, { compareAtPrice: 99900 }).expect(422);
      const onSale = adminProductDetailSchema.parse((await boss.as('patch', `/admin/variants/${m.id}`, { price: 99900, compareAtPrice: 129900 }).expect(200)).body);
      expect(onSale.price).toBe(99900);   // the product's "from" price follows (database trigger)

      for (const v of added.variants.slice(1)) await boss.as('delete', `/admin/variants/${v.id}`).expect(200);
      const last = await boss.as('delete', `/admin/variants/${added.variants[0]!.id}`).expect(409);
      expect(problemSchema.parse(last.body).detail).toMatch(/at least one variant/);
    });

    it('categories', async () => {
      const boss = await admin();
      await boss.as('post', '/admin/categories', { name: 'Ethnic wear', slug: 'ethnic-wear' }).expect(201);
      await boss.as('post', '/admin/categories', { name: 'Again', slug: 'ethnic-wear' }).expect(409);
    });
  });

  describe('orders', () => {
    const placed = async () => {
      const riya = await signUp(app, 'Riya');
      const address = await riya.addAddress();
      const variantId = await variantOf(prisma, 'classic-tee', { stock: 5 });
      await riya.as('post', '/cart/items', { variantId, quantity: 2 }).expect(200);
      const order = orderSchema.parse((await riya.as('post', '/orders', { addressId: address.id }, { 'Idempotency-Key': randomUUID() }).expect(201)).body);
      return { riya, order, variantId };
    };

    it('list and search by number or customer email', async () => {
      const { order } = await placed();
      const boss = await admin();
      const byNumber = pageSchema(adminOrderSummarySchema).parse((await boss.as('get', `/admin/orders?search=${order.number.toLowerCase()}`).expect(200)).body);
      expect(byNumber.data.map((o) => o.number)).toEqual([order.number]);
      const byEmail = pageSchema(adminOrderSummarySchema).parse((await boss.as('get', '/admin/orders?search=RIYA@').expect(200)).body);
      expect(byEmail.data[0]?.customer.email).toBe('riya@example.com');
      expect(pageSchema(adminOrderSummarySchema).parse((await boss.as('get', '/admin/orders?status=PAID')).body).data).toEqual([]);
    });

    it('paid → shipped (shopper emailed) → delivered; each move only from the right status', async () => {
      const { order } = await placed();
      const boss = await admin();
      await boss.as('post', `/admin/orders/${order.number}/ship`).expect(409);   // not paid yet
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });

      const shipped = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/ship`).expect(200)).body);
      expect(shipped.status).toBe('SHIPPED');
      expect(shipped.shippedAt).not.toBeNull();
      await waitForEmail(app, (m) => m.to === 'riya@example.com' && m.subject === `Order ${order.number} is on its way`);
      await boss.as('post', `/admin/orders/${order.number}/ship`).expect(409);   // twice: no

      const delivered = adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/deliver`).expect(200)).body);
      expect(delivered).toMatchObject({ status: 'DELIVERED', customer: { name: 'Riya' }, refunds: [], payment: null });
    });

    it('cancelling an unpaid order restocks; a paid one must be refunded instead', async () => {
      const { order, variantId } = await placed();
      const boss = await admin();
      expect(await stockOf(prisma, variantId)).toBe(3);
      expect(adminOrderSchema.parse((await boss.as('post', `/admin/orders/${order.number}/cancel`).expect(200)).body).status).toBe('CANCELLED');
      expect(await stockOf(prisma, variantId)).toBe(5);
    });

    it('a paid order cannot be cancelled here', async () => {
      const { order } = await placed();
      const boss = await admin();
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });
      const res = await boss.as('post', `/admin/orders/${order.number}/cancel`).expect(409);
      expect(problemSchema.parse(res.body).detail).toMatch(/refund/);
    });
  });

  describe('coupons', () => {
    it('create, duplicate code refused, and a partial update keeps everything else', async () => {
      const boss = await admin();
      const created = couponSchema.parse((await boss.as('post', '/admin/coupons', { code: 'monsoon20', type: 'PERCENT', value: 20, maxDiscount: 40000, minSubtotal: 150000, description: 'Monsoon sale' }).expect(201)).body);
      expect(created).toMatchObject({ code: 'MONSOON20', active: true, perUserLimit: 1 });
      await boss.as('post', '/admin/coupons', { code: 'MONSOON20', type: 'FIXED', value: 100 }).expect(409);

      const paused = couponSchema.parse((await boss.as('patch', `/admin/coupons/${created.id}`, { active: false }).expect(200)).body);
      // Only `active` changed: the zod .partial()-keeps-defaults trap would have reset these
      expect(paused).toMatchObject({ active: false, value: 20, maxDiscount: 40000, minSubtotal: 150000, description: 'Monsoon sale' });

      await boss.as('patch', `/admin/coupons/${created.id}`, { value: 95 }).expect(422);
      await prisma.coupon.update({ where: { id: created.id }, data: { usedCount: 3 } });
      await boss.as('patch', `/admin/coupons/${created.id}`, { usageLimit: 2 }).expect(422);
      expect(couponSchema.array().parse((await boss.as('get', '/admin/coupons').expect(200)).body)).toHaveLength(1);
    });
  });

  describe('reviews', () => {
    it('hiding a review removes it from the shop and from the stars', async () => {
      await variantOf(prisma, 'classic-tee');
      const riya = await signUp(app, 'Riya');
      await riya.as('put', '/products/classic-tee/reviews/mine', { rating: 1, title: 'Buy my product at spam.example' }).expect(200);
      const boss = await admin();
      const list = (await boss.as('get', '/admin/reviews').expect(200)).body as { data: Array<{ id: string; product: { slug: string } }> };
      expect(list.data[0]?.product.slug).toBe('classic-tee');
      await boss.as('patch', `/admin/reviews/${list.data[0]!.id}`, { hidden: true }).expect(200);
      expect(productDetailSchema.parse((await publicGet('/products/classic-tee')).body).rating.count).toBe(0);
      expect((await publicGet('/products/classic-tee/reviews')).body).toEqual({ data: [], nextCursor: null });
    });
  });
});
