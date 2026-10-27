import { Body, Controller, Get, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import { moderateReviewSchema, type AdminReview, type ModerateReview, type Page } from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toReview } from '../reviews/reviews.service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

const INCLUDE = { user: { select: { name: true } }, product: { select: { name: true, slug: true } } } as const;

// Moderation: every review, newest first; hiding one removes it from the shop and its stars
@Auth('ADMIN')
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>): Promise<Page<AdminReview>> {
    const rows = await this.prisma.review.findMany({
      where: query.cursor ? { id: { lt: query.cursor } } : {},
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      include: INCLUDE,
    });
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((r) => ({ ...toReview(r), hidden: r.hidden, product: r.product })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  @Patch(':id')
  async moderate(@Param('id', { schema: z.uuid() }) id: string, @Body({ schema: moderateReviewSchema }) body: ModerateReview): Promise<AdminReview> {
    const exists = await this.prisma.review.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('No such review');
    const r = await this.prisma.review.update({ where: { id }, data: { hidden: body.hidden }, include: INCLUDE });
    return { ...toReview(r), hidden: r.hidden, product: r.product };
  }
}
