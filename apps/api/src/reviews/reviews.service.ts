import { Injectable, NotFoundException } from '@nestjs/common';
import { publicName, type Page, type Review, type WriteReview } from '@shop/shared';
import type { Review as ReviewRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type ReviewWithAuthor = ReviewRow & { user: { name: string } };

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // Visible reviews, newest first (ids are UUID v7: time-ordered)
  async list(slug: string, limit: number, cursor?: string): Promise<Page<Review>> {
    const product = await this.product(slug);
    const rows = await this.prisma.review.findMany({
      where: { productId: product.id, hidden: false, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { user: { select: { name: true } } },
    });
    const page = rows.slice(0, limit);
    return { data: page.map(toReview), nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
  }

  async mine(userId: string, slug: string): Promise<Review> {
    const product = await this.product(slug);
    const review = await this.prisma.review.findUnique({
      where: { productId_userId: { productId: product.id, userId } },
      include: { user: { select: { name: true } } },
    });
    if (!review) throw new NotFoundException("You haven't reviewed this product yet");
    return toReview(review);
  }

  // Writing again EDITS the shopper's review: one per shopper per product
  async write(userId: string, slug: string, input: WriteReview): Promise<Review> {
    const product = await this.product(slug);
    // "Verified purchase": a paid order (not just placed) with this product in it
    const bought = await this.prisma.orderItem.count({
      where: {
        order: { userId, status: { in: ['PAID', 'SHIPPED', 'DELIVERED'] } },
        OR: [{ variant: { productId: product.id } }, { productSlug: product.slug }],
      },
    });
    const review = await this.prisma.review.upsert({
      where: { productId_userId: { productId: product.id, userId } },
      create: { ...input, productId: product.id, userId, verifiedPurchase: bought > 0 },
      update: { ...input, verifiedPurchase: bought > 0 },
      include: { user: { select: { name: true } } },
    });
    return toReview(review);
  }

  async remove(userId: string, slug: string): Promise<void> {
    const product = await this.product(slug);
    await this.prisma.review.deleteMany({ where: { productId: product.id, userId } });
  }

  // Reviews belong to products on sale; others are "not found", like on the product page
  private async product(slug: string) {
    const product = await this.prisma.product.findFirst({ where: { slug, status: 'ACTIVE' }, select: { id: true, slug: true } });
    if (!product) throw new NotFoundException('That product is not available');
    return product;
  }
}

export const toReview = (r: ReviewWithAuthor): Review => ({
  id: r.id,
  rating: r.rating,
  title: r.title,
  body: r.body,
  authorName: publicName(r.user.name),
  verifiedPurchase: r.verifiedPurchase,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
