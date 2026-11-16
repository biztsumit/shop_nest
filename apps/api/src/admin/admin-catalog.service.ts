import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  formatPrice,
  type AdminProduct,
  type AdminProductDetail,
  type AdminProductListQuery,
  type Category,
  type CreateCategory,
  type CreateProduct,
  type CreateVariant,
  type Page,
  type UpdateProduct,
  type UpdateVariant,
} from '@shop/shared';
import { AuditService } from '../audit/audit.service.js';
import { describeChanges, diffChanges, type Changes } from '../audit/changes.js';
import { normaliseOptions, optionsKey } from '../catalog/variant-options.js';
import type { Prisma, ProductVariant } from '../generated/prisma/client.js';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async create(input: CreateProduct, actorId: string): Promise<AdminProductDetail> {
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
        const count = input.variants.length;
        await this.audit.record(tx, {
          actorId,
          action: 'product.create',
          entityType: 'product',
          entityId: created.id,
          summary: `Created "${created.name}" (${created.status.toLowerCase()}, ${count} ${count === 1 ? 'variant' : 'variants'})`,
        });
        return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: DETAIL_INCLUDE });
      });
      this.logger.log({ productId: product.id, slug: product.slug }, 'Product created');
      return toDetail(product);
    } catch (err) {
      return rethrowUnique(err, UNIQUE);
    }
  }

  async update(id: string, { images, ...fields }: UpdateProduct, actorId: string): Promise<AdminProductDetail> {
    const before = await this.get(id);
    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (images) {
          await tx.productImage.deleteMany({ where: { productId: id } });
          await tx.productImage.createMany({ data: images.map((img, position) => ({ ...img, position, productId: id })) });
        }
        const updated = await tx.product.update({ where: { id }, data: fields, include: DETAIL_INCLUDE });
        const changes = diffChanges(before, { ...fields, ...(images ? { images } : {}) });
        if (Object.keys(changes).length > 0) {
          await this.audit.record(tx, {
            actorId,
            action: 'product.update',
            entityType: 'product',
            entityId: id,
            summary: `${updated.name}: ${describeChanges(changes, PRODUCT_LABELS)}`,
            changes,
          });
        }
        return updated;
      });
      return toDetail(product);
    } catch (err) {
      return rethrowUnique(err, UNIQUE);
    }
  }

  async addVariant(productId: string, input: CreateVariant, actorId: string): Promise<AdminProductDetail> {
    const product = await this.get(productId);
    const position = await this.prisma.productVariant.count({ where: { productId } });
    try {
      await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({ data: { ...variantData(input), productId, position } });
        await this.variantEvent(tx, actorId, 'variant.create', product.name, variant,
          `added ${formatPrice(variant.price)}, ${variant.stock} in stock`, { variantId: { from: null, to: variant.id } });
      });
    } catch (err) {
      rethrowUnique(err, UNIQUE);
    }
    return this.get(productId);
  }

  async updateVariant(id: string, input: UpdateVariant, actorId: string): Promise<AdminProductDetail> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
    if (!variant) throw new NotFoundException('No such variant');
    // The "was" price rule involves two fields, one of which may not be in this request:
    // check it on the values the variant WILL have
    const price = input.price ?? variant.price;
    const compareAt = input.compareAtPrice === undefined ? variant.compareAtPrice : input.compareAtPrice;
    if (compareAt !== null && compareAt <= price) {
      throw new UnprocessableEntityException("The 'was' price must be higher than the price.");
    }
    const { product, ...current } = variant;
    const data = { ...input, ...(input.options ? { options: normaliseOptions(input.options) } : {}) };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productVariant.update({ where: { id }, data: { ...data, ...(input.options ? { optionsKey: optionsKey(input.options) } : {}) } });
        const changes = diffChanges(current, data);
        if (Object.keys(changes).length > 0) {
          await this.variantEvent(tx, actorId, 'variant.update', product.name, current, describeChanges(changes, VARIANT_LABELS), changes);
        }
      });
    } catch (err) {
      rethrowUnique(err, UNIQUE);
    }
    return this.get(variant.productId);
  }

  // A product always keeps at least one variant (it's what is bought). Past orders keep their
  // copies of the variant's details; carts simply lose it.
  async deleteVariant(id: string, actorId: string): Promise<AdminProductDetail> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
    if (!variant) throw new NotFoundException('No such variant');
    if ((await this.prisma.productVariant.count({ where: { productId: variant.productId } })) <= 1) {
      throw new ConflictException('A product needs at least one variant. Archive the product instead.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.delete({ where: { id } });
      await this.variantEvent(tx, actorId, 'variant.delete', variant.product.name, variant,
        `deleted (was ${formatPrice(variant.price)}, ${variant.stock} in stock)`, { variantId: { from: variant.id, to: null } });
    });
    return this.get(variant.productId);
  }

  async createCategory(input: CreateCategory, actorId: string): Promise<Category> {
    try {
      const c = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({ data: input });
        await this.audit.record(tx, { actorId, action: 'category.create', entityType: 'category', entityId: created.id, summary: `Created the category "${created.name}"` });
        return created;
      });
      return { id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, productCount: 0 };
    } catch (err) {
      return rethrowUnique(err, { slug: 'Another category already uses this slug.' });
    }
  }

  // Variant events are filed under their PRODUCT, so the product's history shows them:
  // "Linen Kurta (size M): price ₹1,299 → ₹1,199"
  private variantEvent(tx: Prisma.TransactionClient, actorId: string, action: 'variant.create' | 'variant.update' | 'variant.delete',
    productName: string, variant: Pick<ProductVariant, 'productId' | 'options'>, what: string, changes: Changes): Promise<void> {
    return this.audit.record(tx, {
      actorId,
      action,
      entityType: 'product',
      entityId: variant.productId,
      summary: `${productName} (${variantLabel(variant.options)}): ${what}`,
      changes,
    });
  }
}

// How audit summaries name the fields that changed
const money = (value: unknown) => (value === null ? '(none)' : formatPrice(Number(value)));
const PRODUCT_LABELS = {
  name: 'name',
  slug: 'slug',
  status: ['status', (v: unknown) => String(v).toLowerCase()],
  images: ['photos', (v: unknown) => String(Array.isArray(v) ? v.length : 0)],
} satisfies Parameters<typeof describeChanges>[1];
const VARIANT_LABELS = {
  price: ['price', money],
  compareAtPrice: ["'was' price", money],
  stock: 'stock',
  sku: 'SKU',
  options: ['options', (v: unknown) => variantLabel(v)],
} satisfies Parameters<typeof describeChanges>[1];

// {"size": "M", "colour": "Black"} → "size M, colour Black"; no options → "the only variant"
const variantLabel = (options: unknown): string =>
  Object.entries((options ?? {}) as Record<string, string>).map(([name, value]) => `${name} ${value}`).join(', ') || 'the only variant';

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
