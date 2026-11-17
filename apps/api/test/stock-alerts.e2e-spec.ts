import type { NestExpressApplication } from '@nestjs/platform-express';
import { stockAlertIdsSchema } from '@shop/shared';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { StockAlertsService } from '../src/stock-alerts/stock-alerts.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { clearOutbox, waitForEmail } from './support/emails.js';
import { signUp, variantOf } from './support/shopper.js';

describe('Back-in-stock alerts (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  // The scheduled job's work, run when the test says so (schedules are off in tests)
  const runJob = () => app.get(StockAlertsService).notifyRestocked();
  const restock = (variantId: string, stock = 3) => prisma.productVariant.update({ where: { id: variantId }, data: { stock } });

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

  it('a shopper waits for a sold-out variant and gets ONE email when it comes back', async () => {
    const riya = await signUp(app, 'Riya');
    const variantId = await variantOf(prisma, 'classic-tee', { stock: 0, price: 49900 });
    await riya.as('put', `/stock-alerts/${variantId}`).expect(204);
    await riya.as('put', `/stock-alerts/${variantId}`).expect(204);   // twice: still one alert
    expect(stockAlertIdsSchema.parse((await riya.as('get', '/stock-alerts/ids').expect(200)).body)).toEqual([variantId]);

    expect(await runJob()).toBe(0);   // still sold out: nothing to send
    await restock(variantId);
    expect(await runJob()).toBe(1);
    // (Riya also has her sign-up email in the outbox: find this one by its subject)
    const email = await waitForEmail(app, (m) => m.to === 'riya@example.com' && m.subject.startsWith('Back in stock'));
    expect(email.subject).toBe('Back in stock: Classic Tee');
    expect(email.text).toContain('₹499');
    expect(email.text).toContain('/products/classic-tee');

    // Sent once: the next run sends nothing, and the shopper is no longer waiting
    expect(await runJob()).toBe(0);
    expect(stockAlertIdsSchema.parse((await riya.as('get', '/stock-alerts/ids').expect(200)).body)).toEqual([]);
  });

  it('sold out again: asking again starts a new wait', async () => {
    const riya = await signUp(app, 'Riya');
    const variantId = await variantOf(prisma, 'classic-tee', { stock: 0 });
    await riya.as('put', `/stock-alerts/${variantId}`).expect(204);
    await restock(variantId);
    expect(await runJob()).toBe(1);

    await restock(variantId, 0);
    await riya.as('put', `/stock-alerts/${variantId}`).expect(204);
    await restock(variantId);
    expect(await runJob()).toBe(1);
  });

  it('a product taken off sale sends nothing, even with stock', async () => {
    const riya = await signUp(app, 'Riya');
    const variantId = await variantOf(prisma, 'classic-tee', { stock: 0 });
    await riya.as('put', `/stock-alerts/${variantId}`).expect(204);
    const { productId } = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    await prisma.product.update({ where: { id: productId }, data: { status: 'ARCHIVED' } });
    await restock(variantId);
    expect(await runJob()).toBe(0);
  });

  it('stop waiting; and the rules for starting', async () => {
    const riya = await signUp(app, 'Riya');
    const soldOut = await variantOf(prisma, 'classic-tee', { stock: 0 });
    const inStock = await variantOf(prisma, 'linen-shirt', { stock: 4 });

    await riya.as('put', `/stock-alerts/${soldOut}`).expect(204);
    await riya.as('delete', `/stock-alerts/${soldOut}`).expect(204);
    await restock(soldOut);
    expect(await runJob()).toBe(0);

    await riya.as('put', `/stock-alerts/${inStock}`).expect(409);   // just buy it
    await riya.as('put', '/stock-alerts/0199d1c0-0000-7000-8000-000000000000').expect(404);
    await riya.as('put', '/stock-alerts/not-a-uuid').expect(422);
    await request(app.getHttpServer()).put(`/api/stock-alerts/${soldOut}`).expect(401);   // needs an account
  });
});
