import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { reviewListQuerySchema, slugSchema, writeReviewSchema, type Page, type Review, type ReviewListQuery, type WriteReview } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ReviewsService } from './reviews.service.js';

// Reviews live under their product: /api/products/:slug/reviews
// Reading is public; writing needs a login (the decorator is on those routes only)
@Controller('products/:slug/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Param('slug', { schema: slugSchema }) slug: string, @Query({ schema: reviewListQuerySchema }) query: ReviewListQuery): Promise<Page<Review>> {
    return this.reviews.list(slug, query.limit, query.cursor);
  }

  @Get('mine')
  @Auth()
  mine(@CurrentUser() user: AuthUser, @Param('slug', { schema: slugSchema }) slug: string): Promise<Review> {
    return this.reviews.mine(user.id, slug);
  }

  // PUT: "my review of this product is this" (creates it, or replaces it)
  @Put('mine')
  @Auth()
  write(
    @CurrentUser() user: AuthUser,
    @Param('slug', { schema: slugSchema }) slug: string,
    @Body({ schema: writeReviewSchema }) body: WriteReview,
  ): Promise<Review> {
    return this.reviews.write(user.id, slug, body);
  }

  @Delete('mine')
  @Auth()
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('slug', { schema: slugSchema }) slug: string): Promise<void> {
    return this.reviews.remove(user.id, slug);
  }
}
