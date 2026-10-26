import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_CART_LINES, MAX_QUANTITY, type Cart, type CartLine, type CartProblem, type MergeCart } from '@shop/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const NOT_AVAILABLE = "This product isn't available.";

// What a cart line needs from the catalog, in one query
const LINE_INCLUDE = {
  variant: {
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1, select: { url: true, alt: true } },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  // The cart, checked against the shelves NOW: today's prices, today's stock
  async get(userId: string): Promise<Cart> {
    const rows = await this.prisma.cartItem.findMany({ where: { userId }, orderBy: { id: 'asc' }, include: LINE_INCLUDE });
    const lines = rows.map((row): CartLine => {
      const { variant } = row;
      const { product } = variant;
      return {
        variantId: variant.id,
        productId: product.id,
        slug: product.slug,
        name: product.name,
        options: variant.options as Record<string, string>,
        sku: variant.sku,
        image: product.images[0] ?? null,
        unitPrice: variant.price,
        compareAtPrice: variant.compareAtPrice,
        quantity: row.quantity,
        lineTotal: variant.price * row.quantity,
        available: variant.stock,
        problem: problemOf(product.status, variant.stock, row.quantity),
      };
    });
    return {
      lines,
      itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotal: lines.filter((l) => l.problem === null).reduce((sum, l) => sum + l.lineTotal, 0),
      canCheckout: lines.length > 0 && lines.every((l) => l.problem === null),
    };
  }

  // "Add 2 more of this"
  async add(userId: string, variantId: string, quantity: number): Promise<Cart> {
    const variant = await this.buyableVariant(variantId);
    const existing = await this.prisma.cartItem.findUnique({ where: { userId_variantId: { userId, variantId } } });
    const wanted = (existing?.quantity ?? 0) + quantity;
    checkStock(variant.stock, wanted);
    if (!existing) await this.checkLineLimit(userId);

    // ONE statement: insert the line, or add to it, but only while the total stays within
    // the limit. Two quick taps on "Add" are two of these, and the database runs them one after
    // the other on that row, so the second sees the first one's total. (Reading the quantity,
    // adding in JavaScript and writing it back could lose one of the taps.)
    const saved = await this.prisma.$queryRaw<Array<{ quantity: number }>>`
      INSERT INTO cart_items (id, user_id, variant_id, quantity, updated_at)
      VALUES (uuidv7(), ${userId}::uuid, ${variantId}::uuid, ${quantity}, now())
      ON CONFLICT (user_id, variant_id) DO UPDATE
        SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()
        WHERE cart_items.quantity + EXCLUDED.quantity <= ${MAX_QUANTITY}
      RETURNING quantity`;
    if (saved.length === 0) {
      throw new ConflictException(`You can have at most ${MAX_QUANTITY} of one item in your cart.`);
    }
    return this.get(userId);
  }

  // "Make it exactly 3" (0 = remove)
  async set(userId: string, variantId: string, quantity: number): Promise<Cart> {
    if (quantity === 0) {
      return this.remove(userId, variantId);
    }
    const variant = await this.buyableVariant(variantId);
    checkStock(variant.stock, quantity);
    const existing = await this.prisma.cartItem.findUnique({ where: { userId_variantId: { userId, variantId } } });
    if (!existing) await this.checkLineLimit(userId);
    await this.prisma.cartItem.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId, quantity },
      update: { quantity },
    });
    return this.get(userId);
  }

  async remove(userId: string, variantId: string): Promise<Cart> {
    await this.prisma.cartItem.deleteMany({ where: { userId, variantId } });
    return this.get(userId);
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
  }

  // The cart someone filled before logging in joins their account's cart. For an item in both,
  // the LARGER quantity wins (not the sum): merging the same browser cart twice changes nothing.
  // Items that can't be bought are skipped quietly, and quantities are cut to what's in stock:
  // the shopper sees the result, so nothing here is worth failing the login for.
  async merge(userId: string, { items }: MergeCart): Promise<Cart> {
    const incoming = new Map<string, number>();
    for (const item of items) {
      incoming.set(item.variantId, Math.max(incoming.get(item.variantId) ?? 0, item.quantity));
    }
    await this.prisma.$transaction(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: [...incoming.keys()] }, product: { status: 'ACTIVE' }, stock: { gt: 0 } },
        select: { id: true, stock: true },
      });
      const existing = new Map(
        (await tx.cartItem.findMany({ where: { userId }, select: { variantId: true, quantity: true } })).map((i) => [i.variantId, i.quantity]),
      );
      let lines = existing.size;
      for (const variant of variants) {
        const current = existing.get(variant.id);
        if (current === undefined && lines >= MAX_CART_LINES) continue;
        const quantity = Math.min(Math.max(current ?? 0, incoming.get(variant.id) ?? 0), variant.stock, MAX_QUANTITY);
        if (current === undefined) lines++;
        await tx.cartItem.upsert({
          where: { userId_variantId: { userId, variantId: variant.id } },
          create: { userId, variantId: variant.id, quantity },
          update: { quantity },
        });
      }
    });
    return this.get(userId);
  }

  private async buyableVariant(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId }, include: { product: { select: { status: true } } } });
    if (!variant || variant.product.status !== 'ACTIVE') {
      throw new NotFoundException(NOT_AVAILABLE);
    }
    return variant;
  }

  private async checkLineLimit(userId: string): Promise<void> {
    if ((await this.prisma.cartItem.count({ where: { userId } })) >= MAX_CART_LINES) {
      throw new ConflictException(`Your cart is full (${MAX_CART_LINES} different items). Remove something first.`);
    }
  }
}

const checkStock = (stock: number, wanted: number): void => {
  if (stock === 0) throw new ConflictException('Sorry, this is sold out.');
  if (wanted > stock) throw new ConflictException(`Sorry, only ${stock} left in stock.`);
};

export const problemOf = (status: string, stock: number, quantity: number): CartProblem | null => {
  if (status !== 'ACTIVE') return 'UNAVAILABLE';
  if (stock === 0) return 'OUT_OF_STOCK';
  if (stock < quantity) return 'NOT_ENOUGH_STOCK';
  return null;
};
