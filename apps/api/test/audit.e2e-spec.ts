import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminProductDetailSchema, auditEventSchema, couponSchema, orderSchema, pageSchema, type AuditEvent } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import { makeAdmin } from '../scripts/make-admin.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { signUp, variantOf } from './support/shopper.js';

describe('Audit log (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const auditPage = pageSchema(auditEventSchema);

  const admin = async (name = 'Meera') => {
    const a = await signUp(app, name);
    await prisma.user.update({ where: { id: a.user.id }, data: { role: 'ADMIN' } });
    return a;
  };
  type Admin = Awaited<ReturnType<typeof admin>>;
  const events = async (boss: Admin, query = ''): Promise<AuditEvent[]> =>
    auditPage.parse((await boss.as('get', `/admin/audit?${query}`).expect(200)).body).data;

  const newProduct = {
    name: 'Linen Kurta',
    slug: 'linen-kurta',
    variants: [{ options: { size: 'M' }, price: 129900, stock: 4, sku: 'KURTA-M' }],
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

  it('records who changed which product field, from what to what (variants filed under their product)', async () => {
    const boss = await admin();
    const product = adminProductDetailSchema.parse((await boss.as('post', '/admin/products', newProduct).expect(201)).body);
    await boss.as('patch', `/admin/products/${product.id}`, { name: 'Linen Kurta', status: 'ACTIVE' }).expect(200);   // name unchanged
    await boss.as('patch', `/admin/variants/${product.variants[0]!.id}`, { price: 119900, stock: 10 }).expect(200);

    const history = await events(boss, `entityType=product&entityId=${product.id}`);
    expect(history.map((e) => [e.action, e.summary])).toEqual([   // newest first
      ['variant.update', 'Linen Kurta (size M): price ₹1,299 → ₹1,199; stock 4 → 10'],
      ['product.update', 'Linen Kurta: status draft → active'],
      ['product.create', 'Created "Linen Kurta" (draft, 1 variant)'],
    ]);
    expect(history[0]!.changes).toEqual({ price: { from: 129900, to: 119900 }, stock: { from: 4, to: 10 } });
    expect(history[1]!.changes).toEqual({ status: { from: 'DRAFT', to: 'ACTIVE' } });   // only what really changed
    expect(history.every((e) => e.actor?.email === 'meera@example.com')).toBe(true);
  });

  it('a save that changes nothing, or that fails, leaves no record', async () => {
    const boss = await admin();
    const product = adminProductDetailSchema.parse((await boss.as('post', '/admin/products', newProduct).expect(201)).body);
    await boss.as('post', '/admin/products', { ...newProduct, slug: 'other-kurta', variants: [{ ...newProduct.variants[0]!, sku: 'OTHER-M' }] }).expect(201);
    await boss.as('patch', `/admin/products/${product.id}`, { name: 'Linen Kurta' }).expect(200);
    // A slug that's taken: the update rolls back, and its record with it
    await boss.as('patch', `/admin/products/${product.id}`, { name: 'Renamed', slug: 'other-kurta' }).expect(409);

    expect((await events(boss, `entityType=product&entityId=${product.id}`)).map((e) => e.action)).toEqual(['product.create']);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe('Linen Kurta');
  });

  it('orders: shipping is recorded under the order number', async () => {
    const riya = await signUp(app, 'Riya');
    const address = await riya.addAddress();
    const variantId = await variantOf(prisma, 'classic-tee', { stock: 5 });
    await riya.as('post', '/cart/items', { variantId, quantity: 1 }).expect(200);
    const order = orderSchema.parse((await riya.as('post', '/orders', { addressId: address.id }, { 'Idempotency-Key': randomUUID() }).expect(201)).body);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });

    const boss = await admin();
    await boss.as('post', `/admin/orders/${order.number}/ship`).expect(200);
    await boss.as('post', `/admin/orders/${order.number}/ship`).expect(409);   // refused: nothing recorded

    const history = await events(boss, `entityType=order&entityId=${order.number}`);
    expect(history.map((e) => [e.action, e.summary])).toEqual([['order.ship', `${order.number}: paid → shipped`]]);
  });

  it('coupons, reviews and roles are recorded too', async () => {
    const boss = await admin();
    const coupon = couponSchema.parse((await boss.as('post', '/admin/coupons', { code: 'MONSOON20', type: 'PERCENT', value: 20 }).expect(201)).body);
    await boss.as('patch', `/admin/coupons/${coupon.id}`, { active: false }).expect(200);

    const arjun = await signUp(app, 'Arjun');
    await boss.as('patch', `/admin/users/${arjun.user.id}/role`, { role: 'ADMIN' }).expect(200);
    await boss.as('patch', `/admin/users/${arjun.user.id}/role`, { role: 'ADMIN' }).expect(200);   // already: no record

    expect((await events(boss)).map((e) => e.summary)).toEqual([
      'Arjun (arjun@example.com): customer → admin',
      'MONSOON20: status live → paused',
      'Created MONSOON20 (20% off)',
    ]);
    // Filtering by who did it
    expect(await events(boss, `actorId=${arjun.user.id}`)).toEqual([]);
  });

  it('the make-admin script is recorded as done by the shop itself (no admin)', async () => {
    await signUp(app, 'Riya');
    await makeAdmin(prisma, 'riya@example.com');
    const [event] = await prisma.auditEvent.findMany();
    expect(event).toMatchObject({ action: 'user.role_change', actorId: null, summary: 'Riya (riya@example.com): customer → admin' });
  });

  it('the database refuses to change or delete history', async () => {
    await signUp(app, 'Riya');
    await makeAdmin(prisma, 'riya@example.com');
    const [event] = await prisma.auditEvent.findMany();
    await expect(prisma.auditEvent.update({ where: { id: event!.id }, data: { summary: 'nothing happened' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: event!.id } })).rejects.toThrow(/append-only/);
  });

  it('only admins can read it', async () => {
    const customer = await signUp(app, 'Arjun');
    await customer.as('get', '/admin/audit').expect(403);
  });
});
