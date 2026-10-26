import type { NestExpressApplication } from '@nestjs/platform-express';
import { pageSchema, productDetailSchema, productSummarySchema } from '@shop/shared';
import request from 'supertest';
import { seedCatalog } from '../prisma/seed.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';

describe('Demo data (seed)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  // Everything that matters about the database, to compare two runs
  const snapshot = async () => ({
    categories: await prisma.category.findMany({ orderBy: { slug: 'asc' }, select: { id: true, slug: true, parentId: true } }),
    products: await prisma.product.findMany({ orderBy: { slug: 'asc' }, select: { id: true, slug: true, status: true, price: true, stock: true } }),
    variants: await prisma.productVariant.findMany({ orderBy: { sku: 'asc' }, select: { id: true, sku: true, price: true, stock: true, optionsKey: true } }),
    images: await prisma.productImage.count(),
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    await seedCatalog(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('can run again without duplicating or changing anything', async () => {
    const before = await snapshot();
    await seedCatalog(prisma);
    const after = await snapshot();
    expect(after).toEqual(before);   // same rows, same ids, same stock
  });

  it('leaves alone products it does not know about', async () => {
    const mine = await prisma.product.create({ data: { name: 'My Own Product', slug: 'my-own-product' } });
    await seedCatalog(prisma);
    expect(await prisma.product.findUnique({ where: { id: mine.id } })).not.toBeNull();
    await prisma.product.delete({ where: { id: mine.id } });
  });

  it('the shop shows only the active demo products, with prices from their variants', async () => {
    const res = await request(app.getHttpServer()).get('/api/products?limit=48').expect(200);
    const page = pageSchema(productSummarySchema).parse(res.body);
    const slugs = page.data.map((p) => p.slug);

    expect(page.data).toHaveLength(20);
    expect(slugs).not.toContain('winter-parka');        // DRAFT
    expect(slugs).not.toContain('retro-phone-case');    // ARCHIVED
    expect(page.data.find((p) => p.slug === 'leather-sandals')?.inStock).toBe(false);   // every size sold out
    expect(page.data.find((p) => p.slug === 'graphic-print-tee')).toMatchObject({ price: 59900, compareAtPrice: 79900 });
  });

  it('a product page has every size/colour combination, some sold out', async () => {
    const res = await request(app.getHttpServer()).get('/api/products/classic-cotton-tee').expect(200);
    const tee = productDetailSchema.parse(res.body);
    expect(tee.variants).toHaveLength(12);   // 4 sizes × 3 colours
    expect(tee.variants.find((v) => v.sku === 'CCT-NAVY-XL')?.stock).toBe(0);
    expect(tee.images).toHaveLength(2);
    expect(tee.category?.slug).toBe('t-shirts');
  });

  it('category filters include sub-categories', async () => {
    const res = await request(app.getHttpServer()).get('/api/products?category=clothing&limit=48').expect(200);
    const page = pageSchema(productSummarySchema).parse(res.body);
    expect(page.data).toHaveLength(6);   // 3 tees + 2 hoodies + 1 jeans (the parka is a draft)
  });

  it('bigger sizes can cost more: the product shows its lowest price', async () => {
    const hoodie = await prisma.product.findUniqueOrThrow({ where: { slug: 'fleece-pullover-hoodie' }, include: { variants: true } });
    expect(hoodie.price).toBe(189900);
    expect(hoodie.variants.filter((v) => v.price === 199900).map((v) => (v.options as Record<string, string>).size)).toEqual(['XL', 'XL']);
  });
});
