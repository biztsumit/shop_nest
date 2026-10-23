import type { PrismaClient } from '../src/generated/prisma/client.js';
import { optionsKey } from '../src/catalog/variant-options.js';
import { createTestPrisma, resetDatabase } from './support/database.js';

// The catalog's rules, checked at the DATABASE level: these hold whatever code writes the data.
describe('Catalog schema (database rules)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrisma();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const product = (slug = 'classic-tee') =>
    prisma.product.create({ data: { name: 'Classic Tee', slug, status: 'ACTIVE' } });

  const variant = (productId: string, data: { price?: number; stock?: number; compareAtPrice?: number | null; options?: Record<string, string> } = {}) =>
    prisma.productVariant.create({
      data: {
        productId,
        price: data.price ?? 49900,
        stock: data.stock ?? 10,
        compareAtPrice: data.compareAtPrice ?? null,
        options: data.options ?? {},
        optionsKey: optionsKey(data.options ?? {}),
      },
    });

  describe('money and stock', () => {
    it('stores prices as whole paise', async () => {
      const p = await product();
      const v = await variant(p.id, { price: 49950 });
      expect(v.price).toBe(49950);        // ₹499.50, exact: no floating-point rounding
    });

    it('refuses negative stock', async () => {
      const p = await product();
      await expect(variant(p.id, { stock: -1 })).rejects.toThrow(/product_variants_stock_not_negative/);
    });

    it('refuses a negative price', async () => {
      const p = await product();
      await expect(variant(p.id, { price: -100 })).rejects.toThrow(/product_variants_price_not_negative/);
    });

    it('refuses a "was" price that is not higher than the price', async () => {
      const p = await product();
      await expect(variant(p.id, { price: 69900, compareAtPrice: 69900 })).rejects.toThrow(/compare_at_above_price/);
      await expect(variant(p.id, { price: 69900, compareAtPrice: 99900 })).resolves.toBeDefined();
    });

    it('refuses even a direct UPDATE that would make stock negative', async () => {
      const p = await product();
      const v = await variant(p.id, { stock: 2 });
      await expect(prisma.$executeRaw`UPDATE product_variants SET stock = stock - 3 WHERE id = ${v.id}::uuid`)
        .rejects.toThrow(/product_variants_stock_not_negative/);
    });
  });

  describe('variants', () => {
    it('a product cannot have two variants with the same options (in any order)', async () => {
      const p = await product();
      await variant(p.id, { options: { size: 'M', colour: 'Black' } });
      await expect(variant(p.id, { options: { colour: 'Black', size: 'M' } })).rejects.toThrow();
    });

    it('different products may have the same options', async () => {
      const [a, b] = await Promise.all([product('tee-a'), product('tee-b')]);
      await variant(a.id, { options: { size: 'M' } });
      await expect(variant(b.id, { options: { size: 'M' } })).resolves.toBeDefined();
    });

    it('options must be a JSON object', async () => {
      const p = await product();
      await expect(
        prisma.productVariant.create({ data: { productId: p.id, price: 100, options: ['M'], optionsKey: 'x' } }),
      ).rejects.toThrow(/options_is_object/);
    });

    it('SKUs are unique across the shop', async () => {
      const [a, b] = await Promise.all([product('tee-a'), product('tee-b')]);
      await prisma.productVariant.create({ data: { productId: a.id, price: 100, sku: 'TEE-M' } });
      await expect(prisma.productVariant.create({ data: { productId: b.id, price: 100, sku: 'TEE-M', optionsKey: 'size=L' } })).rejects.toThrow();
    });
  });

  describe('slugs', () => {
    it('must be lowercase words joined by hyphens', async () => {
      await expect(product('Classic Tee')).rejects.toThrow(/products_slug_format/);
      await expect(product('classic--tee')).rejects.toThrow(/products_slug_format/);
      await expect(product('classic-tee-2')).resolves.toBeDefined();
    });

    it('are unique', async () => {
      await product('classic-tee');
      await expect(product('classic-tee')).rejects.toThrow();
    });
  });

  describe('categories', () => {
    it('can be nested, but not inside themselves', async () => {
      const clothing = await prisma.category.create({ data: { name: 'Clothing', slug: 'clothing' } });
      const tees = await prisma.category.create({ data: { name: 'T-shirts', slug: 't-shirts', parentId: clothing.id } });
      expect(tees.parentId).toBe(clothing.id);
      await expect(prisma.category.update({ where: { id: clothing.id }, data: { parentId: clothing.id } }))
        .rejects.toThrow(/categories_not_own_parent/);
    });

    it('deleting a category keeps its products and sub-categories', async () => {
      const clothing = await prisma.category.create({ data: { name: 'Clothing', slug: 'clothing' } });
      const tees = await prisma.category.create({ data: { name: 'T-shirts', slug: 't-shirts', parentId: clothing.id } });
      const p = await prisma.product.create({ data: { name: 'Tee', slug: 'tee', categoryId: clothing.id } });

      await prisma.category.delete({ where: { id: clothing.id } });

      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).categoryId).toBeNull();
      expect((await prisma.category.findUniqueOrThrow({ where: { id: tees.id } })).parentId).toBeNull();
    });
  });

  it('deleting a product deletes its variants and images with it', async () => {
    const p = await product();
    await variant(p.id);
    await prisma.productImage.create({ data: { productId: p.id, url: 'https://example.com/tee.jpg' } });

    await prisma.product.delete({ where: { id: p.id } });

    expect(await prisma.productVariant.count()).toBe(0);
    expect(await prisma.productImage.count()).toBe(0);
  });

  it('refuses image addresses that are not http(s)', async () => {
    const p = await product();
    await expect(prisma.productImage.create({ data: { productId: p.id, url: 'javascript:alert(1)' } }))
      .rejects.toThrow(/product_images_url_is_http/);
  });

  it('new products start as DRAFT (hidden until an admin activates them)', async () => {
    const p = await prisma.product.create({ data: { name: 'New', slug: 'new' } });
    expect(p.status).toBe('DRAFT');
  });

  it('ids are UUID v7: later rows sort after earlier ones', async () => {
    const first = await product('first');
    const second = await product('second');
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(first.id < second.id).toBe(true);
  });
});
