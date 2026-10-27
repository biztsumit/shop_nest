// Demo SALES: about 75 days of paid orders from a handful of demo customers, so the admin
// dashboard has a believable history to show.
//
//   npm run db:seed-sales -w @shop/api      (run db:seed first: it uses the demo catalog)
//
// - Opt-in: it is NOT part of db:seed (real shops don't want invented orders)
// - Idempotent: every order it makes has an Idempotency-Key starting "demo-sales-"; if any
//   exist, it does nothing
// - Deterministic: the same run every time (a seeded random number generator, not Math.random)
// - Refuses to run in production
import { hash } from '@node-rs/argon2';
import { computeTotals } from '@shop/shared';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { pgAdapter } from '../src/prisma/adapter.js';

const CUSTOMERS = [
  ['Ananya Rao', 'Bengaluru', 'Karnataka', '560034'],
  ['Vikram Singh', 'Jaipur', 'Rajasthan', '302001'],
  ['Fatima Sheikh', 'Hyderabad', 'Telangana', '500034'],
  ['Arjun Nair', 'Kochi', 'Kerala', '682016'],
  ['Priya Patel', 'Ahmedabad', 'Gujarat', '380009'],
  ['Siddharth Bose', 'Kolkata', 'West Bengal', '700019'],
] as const;

const DAYS = 75;
const DAY = 24 * 60 * 60 * 1000;

// A tiny seeded random generator ("mulberry32"): the same numbers on every run
const random = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export async function seedSales(prisma: PrismaClient, now = new Date()): Promise<number> {
  if ((await prisma.order.count({ where: { idempotencyKey: { startsWith: 'demo-sales-' } } })) > 0) return 0;
  const variants = await prisma.productVariant.findMany({
    where: { product: { status: 'ACTIVE' } },
    include: { product: { select: { name: true, slug: true, images: { take: 1, orderBy: { position: 'asc' } } } } },
  });
  if (variants.length === 0) throw new Error('No products: run `npm run db:seed -w @shop/api` first.');

  const passwordHash = await hash('demo customer password');   // nobody logs in as these
  const users = [];
  for (const [name, city, state, pincode] of CUSTOMERS) {
    const email = `${name.toLowerCase().replace(/ /g, '.')}@example.com`;
    const user = await prisma.user.upsert({ where: { email }, create: { email, name, passwordHash, emailVerifiedAt: now }, update: {} });
    users.push({ user, address: { fullName: name, phone: '9876500000', line1: '12 Demo Street', line2: '', city, state, pincode } });
  }

  const next = random(2026);
  let made = 0;
  for (let d = DAYS - 1; d >= 0; d--) {
    // Busier at weekends, and growing a little over time
    const day = new Date(now.getTime() - d * DAY);
    const weekend = [0, 6].includes(day.getUTCDay());
    const count = Math.floor(next() * (weekend ? 5 : 3) + (DAYS - d) / 40);
    for (let o = 0; o < count; o++) {
      const { user, address } = users[Math.floor(next() * users.length)]!;
      const picks = Array.from({ length: 1 + Math.floor(next() * 3) }, () => variants[Math.floor(next() * variants.length)]!);
      const lines = [...new Map(picks.map((v) => [v.id, v])).values()].map((v) => ({ v, quantity: 1 + Math.floor(next() * 2) }));
      const subtotal = lines.reduce((sum, l) => sum + l.v.price * l.quantity, 0);
      const totals = computeTotals(subtotal);
      const paidAt = new Date(day.getTime() - Math.floor(next() * 10 * 60 * 60 * 1000));
      // Older orders have been delivered by now; recent ones are on their way, or waiting to ship
      const status = d > 6 ? 'DELIVERED' : d > 2 ? 'SHIPPED' : 'PAID';
      await prisma.order.create({
        data: {
          userId: user.id,
          idempotencyKey: `demo-sales-${d}-${o}`,
          requestHash: '0'.repeat(64),
          shippingAddress: address,
          ...totals,
          status,
          createdAt: new Date(paidAt.getTime() - 5 * 60 * 1000),
          paidAt,
          shippedAt: status === 'PAID' ? null : new Date(paidAt.getTime() + DAY),
          deliveredAt: status === 'DELIVERED' ? new Date(paidAt.getTime() + 4 * DAY) : null,
          items: {
            create: lines.map(({ v, quantity }, position) => ({
              variantId: v.id,
              productSlug: v.product.slug,
              productName: v.product.name,
              options: v.options ?? {},
              sku: v.sku,
              imageUrl: v.product.images[0]?.url ?? null,
              unitPrice: v.price,
              quantity,
              lineTotal: v.price * quantity,
              position,
            })),
          },
        },
      });
      made++;
    }
  }
  return made;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to invent sales in a production database.');
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: pgAdapter(process.env.DATABASE_URL) });
  try {
    const made = await seedSales(prisma);
    console.log(made > 0 ? `Created ${made} demo orders over the last ${DAYS} days.` : 'Demo sales already exist: nothing to do.');
  } finally {
    await prisma.$disconnect();
  }
}
