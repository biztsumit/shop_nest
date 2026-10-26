import type { RatingSummary } from '@shop/shared';
import type { PrismaClient } from '../generated/prisma/client.js';

// The stars for one product, from ONE grouped query: "how many reviews of each rating"
// (hidden reviews don't count). Everything else (count, average) is arithmetic on those 5 numbers.
export const ratingSummary = async (prisma: PrismaClient, productId: string): Promise<RatingSummary> => {
  const groups = await prisma.review.groupBy({ by: ['rating'], where: { productId, hidden: false }, _count: { _all: true } });
  const countOf = (stars: number) => groups.find((g) => g.rating === stars)?._count._all ?? 0;
  const distribution: RatingSummary['distribution'] = [countOf(5), countOf(4), countOf(3), countOf(2), countOf(1)];
  const count = distribution.reduce((a, b) => a + b, 0);
  const total = groups.reduce((sum, g) => sum + g.rating * g._count._all, 0);
  return { average: count === 0 ? null : Math.round((total / count) * 10) / 10, count, distribution };
};
