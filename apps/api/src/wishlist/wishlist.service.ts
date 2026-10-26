import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProductSummary } from '@shop/shared';
import { summarySelect, toSummary } from '../catalog/catalog.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const MAX_WISHLIST = 100;

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  // Product cards, most recently saved first. Products taken off sale drop out of the list
  // (and come back if they return).
  async list(userId: string): Promise<ProductSummary[]> {
    const items = await this.prisma.wishlistItem.findMany({
      where: { userId, product: { status: 'ACTIVE' } },
      orderBy: { id: 'desc' },
      select: { product: { select: summarySelect } },
    });
    return items.map((i) => toSummary(i.product));
  }

  // Just the ids: enough to fill in the hearts on a page of product cards
  async ids(userId: string): Promise<string[]> {
    const items = await this.prisma.wishlistItem.findMany({ where: { userId }, select: { productId: true } });
    return items.map((i) => i.productId);
  }

  // Saving twice is fine (PUT is idempotent): the second time changes nothing
  async add(userId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, status: 'ACTIVE' }, select: { id: true } });
    if (!product) throw new NotFoundException('That product is not available');
    const exists = await this.prisma.wishlistItem.findUnique({ where: { userId_productId: { userId, productId } } });
    if (exists) return;
    if ((await this.prisma.wishlistItem.count({ where: { userId } })) >= MAX_WISHLIST) {
      throw new ConflictException(`Your wishlist is full (${MAX_WISHLIST} products). Remove something first.`);
    }
    // createMany + skipDuplicates: "insert unless it's there" in one statement, so two quick
    // taps on the heart can't fail on the unique rule
    await this.prisma.wishlistItem.createMany({ data: [{ userId, productId }], skipDuplicates: true });
  }

  async remove(userId: string, productId: string): Promise<void> {
    await this.prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  }
}
