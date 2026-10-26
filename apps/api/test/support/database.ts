import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

// A Prisma client for tests that talk to the database directly (not through HTTP).
// DATABASE_URL here is the TEST database: vitest.config.e2e.ts checked that its name ends in _test.
export const createTestPrisma = (): PrismaClient =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// Empties every table (children first is unnecessary: CASCADE follows the foreign keys), so
// each test starts from a known, empty state instead of depending on what earlier tests left.
// The list is read from the database, so new tables are included automatically.
export const resetDatabase = async (prisma: PrismaClient): Promise<void> => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  }
  // Queued jobs too (emails from earlier tests would otherwise queue up ahead of this test's),
  // but not pg-boss's own bookkeeping tables
  const [jobs] = await prisma.$queryRaw<Array<{ exists: boolean }>>`SELECT to_regclass('pgboss.job') IS NOT NULL AS exists`;
  if (jobs?.exists) {
    await prisma.$executeRawUnsafe('DELETE FROM pgboss.job');
  }
};
