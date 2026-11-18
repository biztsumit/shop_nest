import { Injectable, NotFoundException } from '@nestjs/common';
import {
  buildVocabulary,
  correctQuery,
  type Category,
  type CorrectedQuery,
  type ProductDetail,
  type ProductFacetQuery,
  type ProductFacets,
  type ProductListQuery,
  type ProductPage,
  type ProductSuggestions,
  type ProductSummary,
  type Vocabulary,
} from '@shop/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ratingSummary } from '../reviews/rating.js';
import { afterCursor, encodeCursor, productOrderBy } from './product-cursor.js';

// The public catalog: everything a visitor may see. Only ACTIVE products, ever.
@Injectable()
export class CatalogService {
  // The shop's words, for correcting typos in searches (see packages/shared/src/search.ts), and
  // a fingerprint of the catalog they were read from: rebuilt as soon as a product or category
  // is added, renamed or changes status, so never stale
  private words: { fingerprint: string; vocabulary: Vocabulary } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<Category[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        // A COUNT of related rows, computed by the database, with its own filter
        _count: { select: { products: { where: { status: 'ACTIVE' } } } },
      },
    });

    // Each category's count includes everything BELOW it, like the product filter does:
    // "Clothing (6)", not "Clothing (0)" when all its products sit in T-shirts and Hoodies.
    // Categories are few, so this is done here: each one's own count is added to every ancestor.
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    const totals = new Map(categories.map((c) => [c.id, 0]));
    for (const c of categories) {
      // Walk up the parents. The Set guards against a loop in the data (A → B → A), which would never end.
      const seen = new Set<string>();
      for (let id: string | null | undefined = c.id; id && !seen.has(id); id = parentOf.get(id)) {
        seen.add(id);
        totals.set(id, (totals.get(id) ?? 0) + c._count.products);
      }
    }

    return categories.map(({ _count, ...category }) => ({ ...category, productCount: totals.get(category.id) ?? 0 }));
  }

  async listProducts(query: ProductListQuery): Promise<ProductPage> {
    const { sort, limit, cursor, ...filters } = query;
    const search = await this.correct(filters.search);
    const where = await this.filterWhere(filters, search);
    if (cursor) where.AND.push(afterCursor(sort, cursor));

    // One row MORE than asked for: if it exists, there's a next page
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: productOrderBy[sort],
      take: limit + 1,
      select: summarySelect,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      data: page.map(toSummary),
      nextCursor: rows.length > limit && last ? encodeCursor(sort, last) : null,
      searchedFor: search?.correctedTo ?? null,
    };
  }

  // The search box's suggestions while typing: a few products, best first, and categories.
  // The last word is still being typed, so it only has to start a word ("hoo" → hoodies).
  async suggest(q: string): Promise<ProductSuggestions> {
    const search = correctQuery(q, await this.vocabulary(), { typing: true });
    if (search.terms.length === 0) return { searchedFor: null, products: [], categories: [] };
    const [rows, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'ACTIVE', AND: search.terms.map(termMatches) },
        // A few more than shown, to pick the best of them below
        take: 30,
        orderBy: { name: 'asc' },
        select: {
          slug: true,
          name: true,
          price: true,
          category: { select: { name: true } },
          images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1, select: { url: true, alt: true } },
        },
      }),
      this.prisma.category.findMany({
        where: {
          OR: search.terms.map((t) => ({ name: { contains: escapeLike(t), mode: 'insensitive' as const } })),
          products: { some: { status: 'ACTIVE' } },
        },
        orderBy: { name: 'asc' },
        take: 3,
        select: { slug: true, name: true },
      }),
    ]);
    // Best first: the name starts with the first word, then a word in it does, then shorter names
    const first = search.terms[0]!;
    const rank = (name: string): number => {
      const lower = name.toLowerCase();
      return lower.startsWith(first) ? 0 : lower.split(/[s-]+/).some((w) => w.startsWith(first)) ? 1 : 2;
    };
    const products = rows
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length || a.name.localeCompare(b.name))
      .slice(0, 6)
      .map((p) => ({ slug: p.slug, name: p.name, price: p.price, category: p.category?.name ?? null, image: p.images[0] ?? null }));
    return { searchedFor: search.correctedTo, products, categories };
  }

  async getProduct(slug: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: {
        ...summarySelect,
        description: true,
        images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { url: true, alt: true } },
        variants: {
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { id: true, sku: true, options: true, price: true, compareAtPrice: true, stock: true },
        },
      },
    });
    // A draft or archived product is "not found" for the public: its existence isn't revealed
    if (!product) {
      throw new NotFoundException('That product is not available');
    }
    const { image: _image, ...summary } = toSummary(product);
    return {
      ...summary,
      description: product.description,
      images: product.images,
      variants: product.variants.map((v) => ({ ...v, options: v.options as Record<string, string> })),
      rating: await ratingSummary(this.prisma, product.id),
    };
  }

  // The colours and sizes on offer, each with how many products would match if it were
  // ticked. Each list is counted with every filter EXCEPT its own: with "Black" ticked, the
  // colour list still shows Navy (5), so it can be added; the size list counts black items only.
  //
  // The counting happens here, over the variants of the matching products: fine for a shop of
  // a few thousand products. Far beyond that, a GROUP BY in SQL would do it in the database.
  async facets(filters: ProductFacetQuery): Promise<ProductFacets> {
    const search = await this.correct(filters.search);
    const [colours, sizes] = await Promise.all([this.facet(filters, search, 'colour'), this.facet(filters, search, 'size')]);
    return { colours, sizes };
  }

  private async facet(filters: ProductFacetQuery, search: CorrectedQuery | null, option: FacetOption): Promise<ProductFacets['colours']> {
    const other: FacetOption = option === 'colour' ? 'size' : 'colour';
    const rows = await this.prisma.product.findMany({
      where: await this.filterWhere({ ...filters, [option]: undefined }, search),
      select: { variants: { select: { options: true, stock: true } } },
    });

    const counts = new Map<string, number>();
    for (const product of rows) {
      // The values of the variants that satisfy the OTHER filters (a size filter, in stock):
      // the same "one variant matches everything" rule as the list
      const values = new Set<string>();
      for (const variant of product.variants) {
        const options = variant.options as Record<string, string>;
        const value = options[option];
        if (!value) continue;
        if (filters[other] && !filters[other].includes(options[other] ?? '')) continue;
        if (filters.inStock && variant.stock <= 0) continue;
        values.add(value);
      }
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => (option === 'size' ? compareSizes(a.value, b.value) : a.value.localeCompare(b.value)));
  }

  // The search, with typos corrected (null = no search)
  private async correct(search: string | undefined): Promise<CorrectedQuery | null> {
    return search ? correctQuery(search, await this.vocabulary()) : null;
  }

  private async vocabulary(): Promise<Vocabulary> {
    // One small query tells whether anything that feeds the word list changed
    const [stamp] = await this.prisma.$queryRaw<Array<{ fingerprint: string }>>`
      SELECT concat_ws('/',
        (SELECT count(*) FROM products WHERE status = 'ACTIVE'), (SELECT max(updated_at) FROM products),
        (SELECT count(*) FROM categories), (SELECT max(updated_at) FROM categories)) AS fingerprint`;
    const fingerprint = stamp?.fingerprint ?? '';
    if (this.words?.fingerprint !== fingerprint) {
      const [products, categories] = await Promise.all([
        this.prisma.product.findMany({ where: { status: 'ACTIVE' }, select: { name: true } }),
        this.prisma.category.findMany({ select: { name: true } }),
      ]);
      this.words = { fingerprint, vocabulary: buildVocabulary([...products, ...categories].map((r) => r.name)) };
    }
    return this.words.vocabulary;
  }

  // The filters as one Prisma condition (always with an AND list, so more can be added)
  private async filterWhere(filters: ProductFacetQuery, search: CorrectedQuery | null): Promise<Prisma.ProductWhereInput & { AND: Prisma.ProductWhereInput[] }> {
    const { category, minPrice, maxPrice, inStock, onSale, minRating, colour, size } = filters;

    // Colour and size must match on the SAME variant (and, with "in stock", that variant must
    // be in stock): a black tee that only comes in S is not a "black, L" tee
    const variant: Prisma.ProductVariantWhereInput[] = [
      ...(colour ? [{ OR: colour.map((value) => ({ options: { path: ['colour'], equals: value } })) }] : []),
      ...(size ? [{ OR: size.map((value) => ({ options: { path: ['size'], equals: value } })) }] : []),
    ];
    if (variant.length && inStock) variant.push({ stock: { gt: 0 } });

    return {
      status: 'ACTIVE',
      ...(category && { categoryId: { in: await this.categoryWithDescendants(category) } }),
      ...((minPrice !== undefined || maxPrice !== undefined) && { price: { gte: minPrice, lte: maxPrice } }),
      ...(inStock && !variant.length && { stock: { gt: 0 } }),
      ...(minRating && { ratingAvg: { gte: minRating } }),
      AND: [
        ...(variant.length ? [{ variants: { some: { AND: variant } } }] : []),
        // On sale: some variant has a "was" price (the database makes sure it's higher)
        ...(onSale ? [{ variants: { some: { compareAtPrice: { not: null } } } }] : []),
        // Every word of the search, in the name or the category's name. A search with no
        // usable words ("%", "-") matches nothing, rather than everything.
        ...(search ? (search.terms.length ? search.terms.map(termMatches) : [{ id: { in: [] } }]) : []),
      ],
    };
  }

  // The category and every category below it, at any depth ("Clothing" includes "T-shirts"
  // and "T-shirts › Graphic tees"), in ONE query: a RECURSIVE query keeps following parent_id
  // links until there are no more children
  private async categoryWithDescendants(slug: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE tree AS (
        SELECT id FROM categories WHERE slug = ${slug}
        UNION
        SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
      )
      SELECT id::text FROM tree`;
    // An unknown category simply matches nothing: an empty list, not an error
    return rows.map((r) => r.id);
  }
}

// In LIKE patterns "%" means "anything" and "_" means "any one character", and Prisma's
// `contains` passes them through. Without this, searching for "%" would match every product.
// A backslash in front makes them plain characters again (the backslash itself too).
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

// One search word: somewhere in the product's name or its category's name (ILIKE '%word%',
// any case; fast on names thanks to the trigram index)
const termMatches = (term: string): Prisma.ProductWhereInput => ({
  OR: [
    { name: { contains: escapeLike(term), mode: 'insensitive' } },
    { category: { name: { contains: escapeLike(term), mode: 'insensitive' } } },
  ],
});

type FacetOption = 'colour' | 'size';

// Clothing sizes in wearing order; anything else ("UK 8", "32") in natural order: UK 9 before UK 10
const CLOTHING_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const compareSizes = (a: string, b: string): number => {
  const [i, j] = [CLOTHING_SIZES.indexOf(a.toUpperCase()), CLOTHING_SIZES.indexOf(b.toUpperCase())];
  if (i !== -1 && j !== -1) return i - j;
  if (i !== -1 || j !== -1) return i !== -1 ? -1 : 1;   // letter sizes first
  return a.localeCompare(b, undefined, { numeric: true });
};

// What a product card needs, and nothing more
export const summarySelect = {
  id: true,
  slug: true,
  name: true,
  price: true,
  stock: true,
  ratingAvg: true,   // for the "Top rated" cursor
  category: { select: { id: true, name: true, slug: true } },
  // The main picture, and the cheapest variant (for its "was" price)
  images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1, select: { url: true, alt: true } },
  variants: { orderBy: [{ price: 'asc' }, { id: 'asc' }], take: 1, select: { compareAtPrice: true } },
  _count: { select: { variants: true } },
} satisfies Prisma.ProductSelect;

export type SummaryRow = Prisma.ProductGetPayload<{ select: typeof summarySelect }>;

export const toSummary = (p: SummaryRow): ProductSummary => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  category: p.category,
  price: p.price,
  compareAtPrice: p.variants[0]?.compareAtPrice ?? null,
  inStock: p.stock > 0,
  variantCount: p._count.variants,
  image: p.images[0] ?? null,
});
