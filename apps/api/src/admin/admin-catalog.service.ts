import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  AdminProduct,
  AdminProductDetail,
  AdminProductListQuery,
  Category,
  CreateCategory,
  CreateProduct,
  CreateVariant,
  Page,
  UpdateProduct,
  UpdateVariant,
} from '@shop/shared';
import { normaliseOptions, optionsKey } from '../catalog/variant-options.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { rethrowUnique } from './prisma-errors.js';

const UNIQUE = {
  slug: 'Another product already uses this slug. Choose a different one.',
  sku: 'Another variant already uses this SKU.',
  options_key: 'This product already has a variant with exactly these options.',
};

const DETAIL_INCLUDE = {
  images: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  variants: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  _count: { select: { variants: true } },
} satisfies Prisma.ProductInclude;

type DetailRow = Prisma.ProductGetPayload<{ include: typeof DETAIL_INCLUDE }>;

// The admin side of the catalog: every product whatever its status (the public catalog shows
// only ACTIVE ones). Products are never deleted: ARCHIVED keeps them out of the shop while
// past orders still point at them.
@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list({ search, status, limit, cursor }: AdminProductListQuery): Promise<Page<AdminProduct>> {
    const rows = await this.prisma.product.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search.toLowerCase() } }] } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1 },
        _count: { select: { variants: true } },
      },
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        category: p.category,
        price: p.price,
        stock: p.stock,
        variantCount: p._count.variants,
        imageUrl: p.images[0]?.url ?? null,
        updatedAt: p.updatedAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(id: string): Promise<AdminProductDetail> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!product) throw new NotFoundException('No such product');
    return toDetail(product);
  }

  async create(input: CreateProduct): Promise<AdminProductDetail> {
    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            name: input.name,
            slug: input.slug,
            description: input.description,
            status: input.status,
            categoryId: input.categoryId,
            images: { create: input.images.map((img, position) => ({ ...img, position })) },
          },
        });
        // One by one, after the product: the database trigger keeps its price/stock summary
        for (const [position, v] of input.variants.entries()) {
          await tx.productVariant.create({ data: { ...variantData(v), productId: created.id, position } });
        }
        return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: DETAIL_INCLUDE });
      });
      this.logger.log({ productId: product.id, slug: product.slug }, 'Product created');
      return toDetail(product);
    } catch (err) {
      return rethrowUnique(err, UNIQUE);
    }
  }

  async update(id: string, { images, ...fields }: UpdateProduct): Promise<AdminProductDetail> {
    await this.get(id);
    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (images) {
          await tx.productImage.deleteMany({ where: { productId: id } });
          await tx.productImage.createMany({ data: images.map((img, position) => ({ ...img, position, productId: id })) });
        }
        return tx.product.update({ where: { id }, data: fields, include: DETAIL_INCLUDE });
      });
      return toDetail(product);
    } catch (err) {
      return rethrowUnique(err, UNIQUE);
    }
  }

  async addVariant(productId: string, input: CreateVariant): Promise<AdminProductDetail> {
    await this.get(productId);
    const position = await this.prisma.productVariant.count({ where: { productId } });
    try {
      await this.prisma.productVariant.create({ data: { ...variantData(input), productId, position } });
    } catch (err) {
      rethrowUnique(err, UNIQUE);
    }
    return this.get(productId);
  }

  async updateVariant(id: string, input: UpdateVariant): Promise<AdminProductDetail> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id } });
    if (!variant) throw new NotFoundException('No such variant');
    // The "was" price rule involves two fields, one of which may not be in this request:
    // check it on the values the variant WILL have
    const price = input.price ?? variant.price;
    const compareAt = input.compareAtPrice === undefined ? variant.compareAtPrice : input.compareAtPrice;
    if (compareAt !== null && compareAt <= price) {
      throw new UnprocessableEntityException("The 'was' price must be higher than the price.");
    }
    try {
      await this.prisma.productVariant.update({
        where: { id },
        data: {
          ...input,
          ...(input.options ? { options: normaliseOptions(input.options), optionsKey: optionsKey(input.options) } : {}),
        },
      });
    } catch (err) {
      rethrowUnique(err, UNIQUE);
    }
    return this.get(variant.productId);
  }

  // A product always keeps at least one variant (it's what is bought). Past orders keep their
  // copies of the variant's details; carts simply lose it.
  async deleteVariant(id: string): Promise<AdminProductDetail> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id } });
    if (!variant) throw new NotFoundException('No such variant');
    if ((await this.prisma.productVariant.count({ where: { productId: variant.productId } })) <= 1) {
      throw new ConflictException('A product needs at least one variant. Archive the product instead.');
    }
    await this.prisma.productVariant.delete({ where: { id } });
    return this.get(variant.productId);
  }

  async createCategory(input: CreateCategory): Promise<Category> {
    try {
      const c = await this.prisma.category.create({ data: input });
      return { id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, productCount: 0 };
    } catch (err) {
      return rethrowUnique(err, { slug: 'Another category already uses this slug.' });
    }
  }
}

const variantData = (v: CreateVariant) => ({
  sku: v.sku,
  price: v.price,
  compareAtPrice: v.compareAtPrice,
  stock: v.stock,
  options: normaliseOptions(v.options),
  optionsKey: optionsKey(v.options),
});

const toDetail = (p: DetailRow): AdminProductDetail => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  status: p.status,
  description: p.description,
  categoryId: p.categoryId,
  price: p.price,
  stock: p.stock,
  variantCount: p._count.variants,
  updatedAt: p.updatedAt.toISOString(),
  images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
  variants: p.variants.map((v) => ({
    id: v.id,
    options: v.options as Record<string, string>,
    sku: v.sku,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    stock: v.stock,
  })),
});
