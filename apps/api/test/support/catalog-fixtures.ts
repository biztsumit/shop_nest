import type { PrismaClient, ProductStatus } from '../../src/generated/prisma/client.js';
import { normaliseOptions, optionsKey } from '../../src/catalog/variant-options.js';

type VariantInput = { price: number; stock?: number; compareAtPrice?: number; options?: Record<string, string>; sku?: string };

// Builds catalog rows for a test, with only the details that test cares about
export const catalogFixtures = (prisma: PrismaClient) => ({
  category: (slug: string, parentId: string | null = null) =>
    prisma.category.create({ data: { name: slug.replace(/-/g, ' '), slug, parentId } }),

  product: async (
    slug: string,
    { status = 'ACTIVE', categoryId = null, variants = [{ price: 49900, stock: 5 }], images = [] }: {
      status?: ProductStatus;
      categoryId?: string | null;
      variants?: VariantInput[];
      images?: string[];
    } = {},
  ) => {
    const product = await prisma.product.create({
      data: {
        name: slug.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' '),   // "classic-tee" → "Classic Tee"
        slug,
        status,
        categoryId,
        images: { create: images.map((url, position) => ({ url, alt: `${slug} photo ${position + 1}`, position })) },
      },
    });
    // Created one by one, AFTER the product: the database trigger fills in its price and stock
    for (const [position, v] of variants.entries()) {
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          price: v.price,
          stock: v.stock ?? 5,
          compareAtPrice: v.compareAtPrice ?? null,
          options: normaliseOptions(v.options ?? {}),
          optionsKey: optionsKey(v.options ?? {}),
          sku: v.sku ?? null,
          position,
        },
      });
    }
    return product;
  },
});
