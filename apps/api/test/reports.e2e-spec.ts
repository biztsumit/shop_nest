import type { NestExpressApplication } from '@nestjs/platform-express';
import { salesReportSchema } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import type { OrderStatus, PrismaClient } from '../src/generated/prisma/client.js';
import { AdminReportsService } from '../src/admin/admin-reports.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { signUp, variantOf } from './support/shopper.js';

describe('Sales reports (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  // "Now" is fixed: 27 Oct 2026, 12:00 noon in India (06:30 UTC)
  const NOW = new Date('2026-10-27T06:30:00Z');

  // An order straight into the database, paid (or not) at a chosen moment
  const order = async (userId: string, { total, paidAt, status = 'PAID', name = 'Classic Tee', quantity = 1 }: { total: number; paidAt: string | null; status?: OrderStatus; name?: string; quantity?: number }) =>
    prisma.order.create({
      data: {
        userId, idempotencyKey: randomUUID(), requestHash: '0'.repeat(64), shippingAddress: {}, status,
        subtotal: total, shippingFee: 0, total, paidAt: paidAt && new Date(paidAt),
        createdAt: paidAt ? new Date(paidAt) : NOW,
        items: { create: [{ productSlug: name.toLowerCase().replace(/ /g, '-'), productName: name, unitPrice: total / quantity, quantity, lineTotal: total }] },
      },
    });

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

  // A time written by Prisma must be the same instant the database's own clock would give.
  // (Without `TimeZone=UTC` on the connection, a server in India time stored them 5½ h early.)
  it("times written by the app agree with the database's clock", async () => {
    const { user } = await signUp(app);
    const written = await prisma.order.create({
      data: { userId: user.id, idempotencyKey: randomUUID(), requestHash: '0'.repeat(64), shippingAddress: {}, subtotal: 0, shippingFee: 0, total: 0, paidAt: new Date() },
    });
    const [row] = await prisma.$queryRaw<Array<{ seconds: number }>>`
      SELECT abs(extract(epoch FROM now() - paid_at))::float AS seconds FROM orders WHERE id = ${written.id}::uuid`;
    expect(row!.seconds).toBeLessThan(60);
  });

  it('counts by INDIA-time days, compares with the period before, and subtracts refunds', async () => {
    const { user } = await signUp(app);
    // 20:00 UTC on the 26th is 01:30 on the 27th in India: it belongs to the 27th
    const late = await order(user.id, { total: 120000, paidAt: '2026-10-26T20:00:00Z', name: 'Wool Beanie', quantity: 2 });
    await order(user.id, { total: 50000, paidAt: '2026-10-21T00:00:00Z' });           // 21 Oct, 05:30 IST: the first day
    await order(user.id, { total: 80000, paidAt: '2026-10-20T18:00:00Z' });           // 20 Oct, 23:30 IST: the period before
    await order(user.id, { total: 99999, paidAt: null, status: 'PENDING_PAYMENT' });  // never paid: not revenue
    await order(user.id, { total: 70000, paidAt: '2026-10-25T06:00:00Z', status: 'REFUNDED', name: 'Steel Mug' });   // paid, later refunded
    const payment = await prisma.payment.create({ data: { orderId: late.id, providerOrderId: 'order_x1', amount: 120000, status: 'PARTIALLY_REFUNDED', refundedAmount: 10000 } });
    await prisma.refund.create({ data: { paymentId: payment.id, amount: 10000, reason: 'Late', status: 'PROCESSED', createdAt: new Date('2026-10-27T05:00:00Z') } });

    const report = salesReportSchema.parse(await app.get(AdminReportsService).sales(7, NOW));
    expect(report).toMatchObject({ days: 7, from: '2026-10-21', to: '2026-10-27' });
    expect(report.totals).toMatchObject({ revenue: 240000, refunds: 10000, net: 230000, orders: 3, averageOrder: 80000, units: 4 });
    expect(report.previous).toMatchObject({ revenue: 80000, orders: 1 });
    expect(report.daily).toHaveLength(7);
    expect(report.daily.find((d) => d.day === '2026-10-27')).toEqual({ day: '2026-10-27', net: 110000, orders: 1 });
    expect(report.daily.find((d) => d.day === '2026-10-21')).toEqual({ day: '2026-10-21', net: 50000, orders: 1 });
    expect(report.daily.find((d) => d.day === '2026-10-23')).toEqual({ day: '2026-10-23', net: 0, orders: 0 });   // gaps filled
    expect(report.topProducts[0]).toEqual({ name: 'Wool Beanie', slug: 'wool-beanie', units: 2, revenue: 120000 });
    expect(report.ordersByStatus).toEqual(expect.arrayContaining([{ status: 'PAID', count: 3 }, { status: 'PENDING_PAYMENT', count: 1 }]));
  });

  it('low stock lists on-sale variants with 5 or fewer left, fewest first', async () => {
    await variantOf(prisma, 'last-few', { stock: 2 });
    await variantOf(prisma, 'plenty', { stock: 50 });
    await variantOf(prisma, 'sold-out', { stock: 0 });
    const report = await app.get(AdminReportsService).sales(30, NOW);
    expect(report.lowStock.map((v) => [v.slug, v.stock])).toEqual([['sold-out', 0], ['last-few', 2]]);
  });

  it('over HTTP: admins only; the range must be 7, 30 or 90; CSV download', async () => {
    const riya = await signUp(app, 'Riya');
    await riya.as('get', '/admin/reports/sales').expect(403);
    const boss = await signUp(app, 'Meera');
    await prisma.user.update({ where: { id: boss.user.id }, data: { role: 'ADMIN', name: '=HYPERLINK("http://evil.example")' } });
    await boss.as('get', '/admin/reports/sales?days=8').expect(422);
    salesReportSchema.parse((await boss.as('get', '/admin/reports/sales?days=90').expect(200)).body);

    await order(boss.user.id, { total: 59900, paidAt: new Date().toISOString() });
    const csv = await boss.as('get', '/admin/reports/orders.csv?days=7').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toBe('attachment; filename="orders-last-7-days.csv"');
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('order,placed_ist,paid_ist,status,customer,email,items,subtotal,discount,delivery,total,refunded,coupon');
    // The formula-looking name is made plain text (leading ') and quoted (it holds quotes)
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(lines[1]).toContain(',599.00,0.00,');
  });
});
