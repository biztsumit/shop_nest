import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  categorySchema,
  pageSchema,
  problemSchema,
  productDetailSchema,
  productSummarySchema,
  type ProductSummary,
} from '@shop/shared';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { catalogFixtures } from './support/catalog-fixtures.js';
import { createTestApp } from './support/create-app.js';
import { createTestPrisma, resetDatabase } from './support/database.js';

const productPage = pageSchema(productSummarySchema);

describe('Public catalog (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let make: ReturnType<typeof catalogFixtures>;
  const http = () => request(app.getHttpServer());

  // GET /api/products, checked against the shared response schema
  const list = async (query = ''): Promise<{ data: ProductSummary[]; nextCursor: string | null }> => {
    const res = await http().get(`/api/products${query}`).expect(200);
    return productPage.parse(res.body);
  };
  const slugs = (page: { data: ProductSummary[] }) => page.data.map((p) => p.slug);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    make = catalogFixtures(prisma);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('visibility', () => {
    it('lists only ACTIVE products', async () => {
      await make.product('on-sale');
      await make.product('being-prepared', { status: 'DRAFT' });
      await make.product('discontinued', { status: 'ARCHIVED' });
      expect(slugs(await list())).toEqual(['on-sale']);
    });

    it('a draft or archived product page is "not found", like one that never existed', async () => {
      await make.product('being-prepared', { status: 'DRAFT' });
      const res = await http().get('/api/products/being-prepared').expect(404);
      expect(problemSchema.parse(res.body).detail).toBe('That product is not available');
      await http().get('/api/products/never-existed').expect(404);
    });
  });

  describe('price and stock summary (database trigger)', () => {
    it('a product shows its cheapest variant, and the total stock', async () => {
      await make.product('tee', {
        variants: [
          { price: 79900, stock: 0, options: { size: 'L' } },
          { price: 59900, stock: 3, compareAtPrice: 89900, options: { size: 'S' } },
          { price: 69900, stock: 4, options: { size: 'M' } },
        ],
      });
      const [tee] = (await list()).data;
      expect(tee).toMatchObject({ price: 59900, compareAtPrice: 89900, inStock: true, variantCount: 3 });
      expect((await prisma.product.findUniqueOrThrow({ where: { slug: 'tee' } })).stock).toBe(7);
    });

    it('follows changes to the variants', async () => {
      const tee = await make.product('tee', { variants: [{ price: 50000, stock: 2 }] });
      await prisma.productVariant.updateMany({ where: { productId: tee.id }, data: { stock: 0 } });
      expect((await list()).data[0]?.inStock).toBe(false);

      await prisma.productVariant.create({ data: { productId: tee.id, price: 30000, stock: 1, optionsKey: 'size=XS' } });
      expect((await list()).data[0]).toMatchObject({ price: 30000, inStock: true });

      await prisma.productVariant.deleteMany({ where: { productId: tee.id, price: 30000 } });
      expect((await list()).data[0]).toMatchObject({ price: 50000, inStock: false });
    });
  });

  describe('sorting and cursor pages', () => {
    beforeEach(async () => {
      // Created in this order; two share a price to test the tie-break
      await make.product('mug', { variants: [{ price: 34900 }] });
      await make.product('lamp', { variants: [{ price: 129900 }] });
      await make.product('tee', { variants: [{ price: 79900 }] });
      await make.product('cap', { variants: [{ price: 34900 }] });
      await make.product('bag', { variants: [{ price: 199900 }] });
    });

    // Follows nextCursor until the end, 2 at a time
    const walk = async (sort: string): Promise<string[]> => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < 10; pages++) {
        const page = await list(`?sort=${sort}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        seen.push(...slugs(page));
        cursor = page.nextCursor;
        if (!cursor) return seen;
      }
      throw new Error('too many pages');
    };

    it.each([
      ['newest', ['bag', 'cap', 'tee', 'lamp', 'mug']],
      ['price_asc', ['mug', 'cap', 'tee', 'lamp', 'bag']],      // mug and cap tie: id breaks it
      ['price_desc', ['bag', 'lamp', 'tee', 'cap', 'mug']],
      ['name_asc', ['bag', 'cap', 'lamp', 'mug', 'tee']],
    ])('%s: every product exactly once, across pages', async (sort, expected) => {
      expect(await walk(sort)).toEqual(expected);
    });

    it('the last page says so (nextCursor null)', async () => {
      const page = await list('?limit=5');
      expect(page.data).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
    });

    it('a product added while paging does not shift the pages', async () => {
      const first = await list('?sort=price_asc&limit=2');
      await make.product('cheap-pen', { variants: [{ price: 1000 }] });   // would be first in the list
      const second = await list(`?sort=price_asc&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(slugs(second)).toEqual(['tee', 'lamp']);   // nothing repeated, nothing skipped
    });

    it('a forged cursor, or one from another sort order, is a 422', async () => {
      const page = await list('?sort=price_asc&limit=2');
      for (const query of [`?sort=name_asc&cursor=${page.nextCursor}`, '?cursor=not-a-cursor', `?cursor=${Buffer.from('{"id":1}').toString('base64url')}`]) {
        const res = await http().get(`/api/products${query}`).expect(422);
        expect(problemSchema.parse(res.body).errors).toEqual([{ path: 'cursor', message: 'is not a valid cursor for this sort order' }]);
      }
    });
  });

  describe('filters', () => {
    it('category includes its sub-categories, at any depth', async () => {
      const clothing = await make.category('clothing');
      const tees = await make.category('t-shirts', clothing.id);
      const graphic = await make.category('graphic-tees', tees.id);
      const home = await make.category('home');
      await make.product('jacket', { categoryId: clothing.id });
      await make.product('plain-tee', { categoryId: tees.id });
      await make.product('logo-tee', { categoryId: graphic.id });
      await make.product('lamp', { categoryId: home.id });

      expect(slugs(await list('?category=clothing&sort=name_asc'))).toEqual(['jacket', 'logo-tee', 'plain-tee']);
      expect(slugs(await list('?category=t-shirts&sort=name_asc'))).toEqual(['logo-tee', 'plain-tee']);
      expect(slugs(await list('?category=no-such-category'))).toEqual([]);
    });

    it('price range (in paise, both ends included) and in-stock only', async () => {
      await make.product('mug', { variants: [{ price: 34900, stock: 0 }] });
      await make.product('tee', { variants: [{ price: 79900 }] });
      await make.product('bag', { variants: [{ price: 199900 }] });
      expect(slugs(await list('?minPrice=34900&maxPrice=79900&sort=price_asc'))).toEqual(['mug', 'tee']);
      expect(slugs(await list('?minPrice=34900&maxPrice=79900&inStock=true'))).toEqual(['tee']);
      expect(slugs(await list('?inStock=false&sort=name_asc'))).toEqual(['bag', 'mug', 'tee']);   // "false" = no filter, not "only sold out"
    });

    it('search: part of the name, any case; wildcards are literal', async () => {
      await make.product('classic-tee');
      await make.product('tee-shirt-pack');
      await make.product('lamp');
      expect(slugs(await list('?search=TEE&sort=name_asc'))).toEqual(['classic-tee', 'tee-shirt-pack']);
      expect(slugs(await list('?search=%25'))).toEqual([]);   // "%" must not mean "anything"
      expect(slugs(await list('?search=t_e'))).toEqual([]);   // nor "_" "any one character"
      expect(slugs(await list('?search=%20%20'))).toHaveLength(3);   // only spaces = no search
    });

    it('rejects nonsense with one clear 422 listing every problem', async () => {
      const res = await http().get('/api/products?limit=500&minPrice=9000&maxPrice=100&sort=random&inStock=yes').expect(422);
      const paths = problemSchema.parse(res.body).errors?.map((e) => e.path).sort();
      expect(paths).toEqual(['inStock', 'limit', 'sort']);
      // (minPrice > maxPrice is reported once the fields themselves are valid)
      const range = await http().get('/api/products?minPrice=9000&maxPrice=100').expect(422);
      expect(problemSchema.parse(range.body).errors).toEqual([{ path: 'minPrice', message: "can't be more than maxPrice" }]);
    });
  });

  describe('product page', () => {
    it('returns the product with its images and variants, in display order', async () => {
      const clothing = await make.category('clothing');
      await make.product('classic-tee', {
        categoryId: clothing.id,
        images: ['https://img.example.com/front.jpg', 'https://img.example.com/back.jpg'],
        variants: [
          { price: 79900, options: { Size: 'M', Colour: 'Black' }, sku: 'TEE-M-BLK' },
          { price: 74900, options: { Size: 'S', Colour: 'Black' }, stock: 0 },
        ],
      });
      const res = await http().get('/api/products/classic-tee').expect(200);
      const product = productDetailSchema.parse(res.body);

      expect(product).toMatchObject({ name: 'Classic Tee', price: 74900, inStock: true, category: { slug: 'clothing' } });
      expect(product.images.map((i) => i.url)).toEqual(['https://img.example.com/front.jpg', 'https://img.example.com/back.jpg']);
      expect(product.variants.map((v) => v.sku)).toEqual(['TEE-M-BLK', null]);
      expect(product.variants[0]?.options).toEqual({ colour: 'Black', size: 'M' });   // names normalised
    });

    it('rejects a malformed slug before touching the database', async () => {
      const res = await http().get('/api/products/Not%20A%20Slug').expect(422);
      expect(problemSchema.parse(res.body).type).toBe('/problems/validation');
    });
  });

  it('categories: how many ACTIVE products each has, counting everything below it', async () => {
    const clothing = await make.category('clothing');
    const tees = await make.category('t-shirts', clothing.id);
    const graphic = await make.category('graphic-tees', tees.id);
    await make.category('socks', clothing.id);
    await make.product('jacket', { categoryId: clothing.id });
    await make.product('plain-tee', { categoryId: tees.id });
    await make.product('logo-tee', { categoryId: graphic.id });
    await make.product('draft-tee', { categoryId: tees.id, status: 'DRAFT' });   // not counted

    const res = await http().get('/api/categories').expect(200);
    const counts = Object.fromEntries(categorySchema.array().parse(res.body).map((c) => [c.slug, c.productCount]));
    // The same numbers the product filter gives: ?category=clothing lists 3 products
    expect(counts).toEqual({ clothing: 3, 't-shirts': 2, 'graphic-tees': 1, socks: 0 });
  });

  it('public responses may be cached for a minute', async () => {
    const res = await http().get('/api/products');
    expect(res.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
  });
});
