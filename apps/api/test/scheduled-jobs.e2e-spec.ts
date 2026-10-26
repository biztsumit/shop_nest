import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { QueueService } from '../src/jobs/queue.service.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';
import { signUp } from './support/shopper.js';

describe('Scheduled jobs and clean-up (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const DAY = 24 * 60 * 60 * 1000;

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

  it('the timetable: expire every minute, reconcile every 5, clean up nightly', () => {
    expect(app.get(QueueService).schedules).toEqual([
      { name: 'orders.expire', cron: '* * * * *' },
      { name: 'payments.reconcile', cron: '*/5 * * * *' },
      { name: 'maintenance.clean-up', cron: '30 3 * * *' },
    ]);
  });

  it('with schedules turned off (tests), nothing is scheduled in the database', async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM pgboss.schedule`;
    expect(rows).toEqual([]);
  });

  it('clean-up removes only what has expired long enough ago', async () => {
    const { user } = await signUp(app);
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const hash = () => randomUUID().replace(/-/g, '').padEnd(64, '0');

    await prisma.refreshToken.createMany({
      data: [
        { userId: user.id, familyId: randomUUID(), tokenHash: hash(), expiresAt: ago(2) },        // old: goes
        { userId: user.id, familyId: randomUUID(), tokenHash: hash(), expiresAt: ago(0.5) },      // expired just now: stays a day
      ],
    });
    await prisma.emailToken.createMany({
      data: [
        { userId: user.id, purpose: 'RESET_PASSWORD', tokenHash: hash(), expiresAt: ago(3) },     // goes
        { userId: user.id, purpose: 'VERIFY_EMAIL', tokenHash: hash(), expiresAt: ago(-1) },      // still valid: stays
      ],
    });
    await prisma.webhookEvent.createMany({
      data: [
        { id: 'evt_old', type: 'payment.captured', processedAt: ago(31) },   // goes
        { id: 'evt_new', type: 'payment.captured', processedAt: ago(1) },
        { id: 'evt_unprocessed', type: 'payment.captured', receivedAt: ago(40) },   // never processed: kept for a look
      ],
    });
    const before = { refresh: await prisma.refreshToken.count(), email: await prisma.emailToken.count() };

    const removed = await app.get(MaintenanceService).cleanUp(now);
    expect(removed).toEqual({ refreshTokens: 1, emailTokens: 1, webhookEvents: 1 });
    expect(await prisma.refreshToken.count()).toBe(before.refresh - 1);
    expect(await prisma.emailToken.count()).toBe(before.email - 1);
    expect((await prisma.webhookEvent.findMany({ orderBy: { id: 'asc' } })).map((e) => e.id)).toEqual(['evt_new', 'evt_unprocessed']);
  });
});
