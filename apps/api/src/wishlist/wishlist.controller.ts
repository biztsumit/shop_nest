import { Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import type { ProductSummary } from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { WishlistService } from './wishlist.service.js';

@Auth()
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ProductSummary[]> {
    return this.wishlist.list(user.id);
  }

  @Get('ids')
  ids(@CurrentUser() user: AuthUser): Promise<string[]> {
    return this.wishlist.ids(user.id);
  }

  // PUT /api/wishlist/:productId (the heart on), DELETE (the heart off). Both idempotent.
  @Put(':productId')
  @HttpCode(204)
  add(@CurrentUser() user: AuthUser, @Param('productId', { schema: z.uuid() }) productId: string): Promise<void> {
    return this.wishlist.add(user.id, productId);
  }

  @Delete(':productId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('productId', { schema: z.uuid() }) productId: string): Promise<void> {
    return this.wishlist.remove(user.id, productId);
  }
}
