import { ConflictException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { addressSchema, authResponseSchema, cartSchema, problemSchema, type Cart } from '@shop/shared';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { CartService } from '../src/cart/cart.service.js';
import { catalogFixtures } from './support/catalog-fixtures.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';

describe('Cart and addresses (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let visitor = 0;
  const http = () => request(app.getHttpServer());

  const signUp = async (name = 'Riya') => {
    const res = await http().post('/api/auth/register').set('X-Forwarded-For', `203.0.113.${++visitor % 250}`)
      .send({ name, email: `${name.toLowerCase()}@example.com`, password: 'correct horse battery' }).expect(201);
    const { accessToken, user } = authResponseSchema.parse(res.body);
    const as = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) =>
      http()[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
    return { user, as };
  };

  // A product with one variant; returns the variant id
  const variant = async (slug: string, opts: { stock?: number; price?: number; status?: 'ACTIVE' | 'DRAFT' } = {}) => {
    const product = await catalogFixtures(prisma).product(slug, {
      status: opts.status ?? 'ACTIVE',
      variants: [{ price: opts.price ?? 49900, stock: opts.stock ?? 5 }],
      images: [`https://img.example.com/${slug}.jpg`],
    });
    return (await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } })).id;
  };

  const cartOf = (res: { body: unknown }): Cart => cartSchema.parse(res.body);

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

  describe('cart', () => {
    it('needs a login', async () => {
      await http().get('/api/cart').expect(401);
    });

    it('starts empty', async () => {
      const { as } = await signUp();
      expect(cartOf(await as('get', '/cart').expect(200))).toEqual({ lines: [], itemCount: 0, subtotal: 0, canCheckout: false });
    });

    it('adding twice adds up; the totals follow', async () => {
      const { as } = await signUp();
      const tee = await variant('classic-tee', { price: 49900 });
      const mug = await variant('steel-mug', { price: 29900 });
      await as('post', '/cart/items', { variantId: tee }).expect(200);
      await as('post', '/cart/items', { variantId: tee, quantity: 2 }).expect(200);
      const cart = cartOf(await as('post', '/cart/items', { variantId: mug }).expect(200));

      expect(cart.lines.map((l) => [l.slug, l.quantity, l.lineTotal])).toEqual([['classic-tee', 3, 149700], ['steel-mug', 1, 29900]]);
      expect(cart).toMatchObject({ itemCount: 4, subtotal: 179600, canCheckout: true });
      expect(cart.lines[0]).toMatchObject({ name: 'Classic Tee', image: { url: 'https://img.example.com/classic-tee.jpg' }, problem: null });
    });

    it('set changes the quantity; 0 and DELETE remove; DELETE /cart empties', async () => {
      const { as } = await signUp();
      const tee = await variant('classic-tee');
      const mug = await variant('steel-mug');
      await as('post', '/cart/items', { variantId: tee }).expect(200);
      await as('post', '/cart/items', { variantId: mug }).expect(200);
      expect(cartOf(await as('put', `/cart/items/${tee}`, { quantity: 4 }).expect(200)).lines[0]!.quantity).toBe(4);
      expect(cartOf(await as('put', `/cart/items/${tee}`, { quantity: 0 }).expect(200)).lines.map((l) => l.slug)).toEqual(['steel-mug']);
      expect(cartOf(await as('delete', `/cart/items/${mug}`).expect(200)).lines).toEqual([]);
      await as('post', '/cart/items', { variantId: mug }).expect(200);
      await as('delete', '/cart').expect(204);
      expect(cartOf(await as('get', '/cart')).lines).toEqual([]);
    });

    it('refuses more than in stock, more than 10, sold-out and unavailable items', async () => {
      const { as } = await signUp();
      const few = await variant('last-few', { stock: 3 });
      const many = await variant('plenty', { stock: 100 });
      const soldOut = await variant('sold-out', { stock: 0 });
      const draft = await variant('coming-soon', { status: 'DRAFT' });

      expect(problemSchema.parse((await as('post', '/cart/items', { variantId: few, quantity: 4 }).expect(409)).body).detail).toBe('Sorry, only 3 left in stock.');
      await as('post', '/cart/items', { variantId: many, quantity: 10 }).expect(200);
      const tooMany = await as('post', '/cart/items', { variantId: many }).expect(409);
      expect(problemSchema.parse(tooMany.body).detail).toMatch(/at most 10/);
      await as('put', `/cart/items/${many}`, { quantity: 11 }).expect(422);
      await as('post', '/cart/items', { variantId: soldOut }).expect(409);
      await as('post', '/cart/items', { variantId: draft }).expect(404);
      await as('post', '/cart/items', { variantId: '019a0000-0000-7000-8000-000000000000' }).expect(404);
    });

    it('two "add" taps at the same moment can never pass the limit', async () => {
      const { user } = await signUp();
      const tee = await variant('classic-tee', { stock: 100 });
      const cart = app.get(CartService);
      await cart.add(user.id, tee, 6);
      // Both pass the JavaScript check (6 + 4 = 10), but only ONE fits in the database
      const results = await Promise.allSettled([cart.add(user.id, tee, 4), cart.add(user.id, tee, 4)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      // ...and the other gets the friendly 409, not a database error (the CHECK constraint is
      // only the last line of defence)
      const failed = results.find((r) => r.status === 'rejected');
      expect(failed?.reason).toBeInstanceOf(ConflictException);
      expect((await prisma.cartItem.findFirstOrThrow()).quantity).toBe(10);
    });

    it('shows problems when the shelves change after adding', async () => {
      const { as } = await signUp();
      const tee = await variant('classic-tee', { stock: 5, price: 49900 });
      const mug = await variant('steel-mug', { stock: 5 });
      const cap = await variant('red-cap', { stock: 5 });
      await as('post', '/cart/items', { variantId: tee, quantity: 3 }).expect(200);
      await as('post', '/cart/items', { variantId: mug }).expect(200);
      await as('post', '/cart/items', { variantId: cap }).expect(200);

      // Sold elsewhere, taken off sale, and a price drop
      await prisma.productVariant.update({ where: { id: tee }, data: { stock: 2, price: 39900 } });
      await prisma.productVariant.update({ where: { id: mug }, data: { stock: 0 } });
      await prisma.product.updateMany({ where: { slug: 'red-cap' }, data: { status: 'ARCHIVED' } });

      const cart = cartOf(await as('get', '/cart').expect(200));
      expect(cart.lines.map((l) => [l.slug, l.problem, l.available])).toEqual([
        ['classic-tee', 'NOT_ENOUGH_STOCK', 2],
        ['steel-mug', 'OUT_OF_STOCK', 0],
        ['red-cap', 'UNAVAILABLE', 5],
      ]);
      expect(cart.lines[0]!.unitPrice).toBe(39900);   // today's price, not the price when added
      expect(cart.canCheckout).toBe(false);
      expect(cart.subtotal).toBe(0);                  // only lines that can be bought count
    });

    it('merge: the larger quantity wins, capped by stock; unbuyable items are skipped', async () => {
      const { as } = await signUp();
      const tee = await variant('classic-tee', { stock: 5 });
      const mug = await variant('steel-mug', { stock: 2 });
      const soldOut = await variant('sold-out', { stock: 0 });
      await as('post', '/cart/items', { variantId: tee, quantity: 2 }).expect(200);

      const guestCart = { items: [{ variantId: tee, quantity: 1 }, { variantId: mug, quantity: 4 }, { variantId: soldOut, quantity: 1 }] };
      const merged = cartOf(await as('post', '/cart/merge', guestCart).expect(200));
      expect(merged.lines.map((l) => [l.slug, l.quantity])).toEqual([['classic-tee', 2], ['steel-mug', 2]]);
      // Merging the same browser cart again changes nothing
      expect(cartOf(await as('post', '/cart/merge', guestCart).expect(200))).toEqual(merged);
    });

    it("each user sees only their own cart", async () => {
      const riya = await signUp('Riya');
      const arjun = await signUp('Arjun');
      await riya.as('post', '/cart/items', { variantId: await variant('classic-tee') }).expect(200);
      expect(cartOf(await arjun.as('get', '/cart')).lines).toEqual([]);
    });
  });

  describe('addresses', () => {
    const home = { fullName: 'Riya Sharma', phone: '+91 98765 43210', line1: 'Flat 4B, Lotus Apartments', line2: 'Near City Mall', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
    const office = { ...home, line1: '5th floor, Tech Park', line2: '', pincode: '411014' };

    it('create, list, update, delete', async () => {
      const { as } = await signUp();
      const created = addressSchema.parse((await as('post', '/addresses', home).expect(201)).body);
      expect(created).toMatchObject({ phone: '9876543210', isDefault: true });   // stored normalised; the first is the default

      const updated = await as('patch', `/addresses/${created.id}`, { city: 'Mumbai', pincode: '400001' }).expect(200);
      expect(addressSchema.parse(updated.body)).toMatchObject({ city: 'Mumbai', pincode: '400001', line1: home.line1 });

      await as('delete', `/addresses/${created.id}`).expect(204);
      expect((await as('get', '/addresses').expect(200)).body).toEqual([]);
    });

    it('only one default: choosing another moves it; deleting the default promotes the newest', async () => {
      const { as } = await signUp();
      const a = addressSchema.parse((await as('post', '/addresses', home)).body);
      const b = addressSchema.parse((await as('post', '/addresses', office)).body);
      expect(b.isDefault).toBe(false);
      const c = addressSchema.parse((await as('post', '/addresses', { ...office, line1: 'Parents', isDefault: true })).body);
      const defaults = async () => addressSchema.array().parse((await as('get', '/addresses')).body).filter((x) => x.isDefault).map((x) => x.id);
      expect(await defaults()).toEqual([c.id]);

      await as('patch', `/addresses/${a.id}`, { isDefault: true }).expect(200);
      expect(await defaults()).toEqual([a.id]);
      await as('delete', `/addresses/${a.id}`).expect(204);
      expect(await defaults()).toEqual([c.id]);   // the newest remaining
      expect(b.id).toBeDefined();
    });

    it('the database itself refuses a second default', async () => {
      const { user, as } = await signUp();
      await as('post', '/addresses', home).expect(201);
      await expect(
        prisma.address.create({ data: { ...office, phone: '9876543210', userId: user.id, isDefault: true } }),
      ).rejects.toThrow();
    });

    it('checks Indian phone numbers, PIN codes and states', async () => {
      const { as } = await signUp();
      const res = await as('post', '/addresses', { ...home, phone: '12345', pincode: '011001', state: 'Atlantis' }).expect(422);
      const fields = (problemSchema.parse(res.body).errors ?? []).map((e) => e.path).sort();
      expect(fields).toEqual(['phone', 'pincode', 'state']);
    });

    it('at most 10', async () => {
      const { as } = await signUp();
      for (let i = 0; i < 10; i++) await as('post', '/addresses', { ...home, line1: `House ${i}` }).expect(201);
      await as('post', '/addresses', home).expect(409);
    });

    it("someone else's address is 'not found'", async () => {
      const riya = await signUp('Riya');
      const arjun = await signUp('Arjun');
      const address = addressSchema.parse((await riya.as('post', '/addresses', home)).body);
      await arjun.as('get', `/addresses/${address.id}`).expect(404);
      await arjun.as('patch', `/addresses/${address.id}`, { city: 'Delhi' }).expect(404);
      await arjun.as('delete', `/addresses/${address.id}`).expect(404);
      await riya.as('get', `/addresses/${address.id}`).expect(200);
    });
  });
});
