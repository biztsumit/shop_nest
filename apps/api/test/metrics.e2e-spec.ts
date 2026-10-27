import type { NestExpressApplication } from '@nestjs/platform-express';
import { orderSchema } from '@shop/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { waitForEmail } from './support/emails.js';
import { signUp, variantOf } from './support/shopper.js';

const TOKEN = 'test-only-metrics-token-0123456789';

describe('Metrics (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer());
  const metrics = async () => (await http().get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(200)).text;
  // The value of one series in the Prometheus text format: `name{labels} 3`
  const value = (text: string, series: string): number => {
    const line = text.split('\n').find((l) => l.startsWith(series));
    return line ? Number(line.slice(line.lastIndexOf(' ') + 1)) : 0;
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

  it('needs the metrics token', async () => {
    await http().get('/api/metrics').expect(401);
    await http().get('/api/metrics').set('Authorization', 'Bearer wrong-token-but-long-enough').expect(401);
    const res = await http().get('/api/metrics').set('Authorization', `Bearer ${TOKEN}`).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('process_cpu_user_seconds_total');   // Node's own health, too
  });

  it('counts requests by route PATTERN (not the raw URL) and status', async () => {
    await variantOf(prisma, 'classic-tee');
    const before = await metrics();
    await http().get('/api/products/classic-tee').expect(200);
    await http().get('/api/products/no-such-thing').expect(404);
    await http().get('/api/nowhere-at-all').expect(404);
    const after = await metrics();

    const route = 'http_requests_total{method="GET",route="/api/products/:slug",status=';
    expect(value(after, `${route}"200"}`) - value(before, `${route}"200"}`)).toBe(1);
    expect(value(after, `${route}"404"}`) - value(before, `${route}"404"}`)).toBe(1);
    // An unknown URL shares ONE label, so random URLs can't create endless series
    expect(after).toContain('route="unmatched",status="404"');
    expect(after).not.toContain('nowhere-at-all');
    expect(after).not.toContain('classic-tee');
    expect(after).toContain('http_request_duration_seconds_bucket{le="0.1",method="GET",route="/api/products/:slug",status="200"}');
  });

  it('counts the business: orders placed and emails sent', async () => {
    const before = await metrics();
    const riya = await signUp(app);
    await waitForEmail(app, (m) => m.to === 'riya@example.com');
    const address = await riya.addAddress();
    await riya.as('post', '/cart/items', { variantId: await variantOf(prisma, 'classic-tee'), quantity: 1 }).expect(200);
    orderSchema.parse((await riya.as('post', '/orders', { addressId: address.id }, { 'Idempotency-Key': randomUUID() }).expect(201)).body);
    const after = await metrics();

    expect(value(after, 'shop_orders_placed_total') - value(before, 'shop_orders_placed_total')).toBe(1);
    expect(value(after, 'shop_emails_total{result="sent"}') - value(before, 'shop_emails_total{result="sent"}')).toBeGreaterThanOrEqual(1);
  });
});
