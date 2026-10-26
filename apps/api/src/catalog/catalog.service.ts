import { Injectable, NotFoundException } from '@nestjs/common';
import type { Category, Page, ProductDetail, ProductListQuery, ProductSummary } from '@shop/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { afterCursor, encodeCursor, productOrderBy } from './product-cursor.js';

// The public catalog: everything a visitor may see. Only ACTIVE products, ever.
@Injectable()
export class CatalogService {
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
    return categories.map(({ _count, ...category }) => ({ ...category, productCount: _count.products }));
  }

  async listProducts(query: ProductListQuery): Promise<Page<ProductSummary>> {
    const { search, category, minPrice, maxPrice, inStock, sort, limit, cursor } = query;

    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      // ILIKE '%term%', case-insensitive: fast thanks to the trigram index on name
      ...(search && { name: { contains: escapeLike(search), mode: 'insensitive' } }),
      ...(category && { categoryId: { in: await this.categoryWithDescendants(category) } }),
      ...((minPrice !== undefined || maxPrice !== undefined) && { price: { gte: minPrice, lte: maxPrice } }),
      ...(inStock && { stock: { gt: 0 } }),
      ...(cursor && { AND: [afterCursor(sort, cursor)] }),
    };

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
    };
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
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

// What a product card needs, and nothing more
const summarySelect = {
  id: true,
  slug: true,
  name: true,
  price: true,
  stock: true,
  category: { select: { id: true, name: true, slug: true } },
  // The main picture, and the cheapest variant (for its "was" price)
  images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1, select: { url: true, alt: true } },
  variants: { orderBy: [{ price: 'asc' }, { id: 'asc' }], take: 1, select: { compareAtPrice: true } },
  _count: { select: { variants: true } },
} satisfies Prisma.ProductSelect;

type SummaryRow = Prisma.ProductGetPayload<{ select: typeof summarySelect }>;

const toSummary = (p: SummaryRow): ProductSummary => ({
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
