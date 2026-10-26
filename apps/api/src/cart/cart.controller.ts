import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  addCartItemSchema,
  mergeCartSchema,
  setCartItemSchema,
  type AddCartItem,
  type Cart,
  type MergeCart,
  type SetCartItem,
} from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CartService } from './cart.service.js';

// The logged-in user's own cart. Every answer is the whole updated cart, so the web app just
// shows what it gets back.
@Auth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  // GET /api/cart
  @Get()
  get(@CurrentUser() user: AuthUser): Promise<Cart> {
    return this.cart.get(user.id);
  }

  // POST /api/cart/items  { variantId, quantity }: adds to what's there
  @Post('items')
  @HttpCode(200)
  add(@CurrentUser() user: AuthUser, @Body({ schema: addCartItemSchema }) body: AddCartItem): Promise<Cart> {
    return this.cart.add(user.id, body.variantId, body.quantity);
  }

  // PUT /api/cart/items/:variantId  { quantity }: sets it (0 removes)
  @Put('items/:variantId')
  set(
    @CurrentUser() user: AuthUser,
    @Param('variantId', { schema: z.uuid() }) variantId: string,
    @Body({ schema: setCartItemSchema }) body: SetCartItem,
  ): Promise<Cart> {
    return this.cart.set(user.id, variantId, body.quantity);
  }

  // DELETE /api/cart/items/:variantId
  @Delete('items/:variantId')
  remove(@CurrentUser() user: AuthUser, @Param('variantId', { schema: z.uuid() }) variantId: string): Promise<Cart> {
    return this.cart.remove(user.id, variantId);
  }

  // DELETE /api/cart: empty it
  @Delete()
  @HttpCode(204)
  clear(@CurrentUser() user: AuthUser): Promise<void> {
    return this.cart.clear(user.id);
  }

  // POST /api/cart/merge  { items: [...] }: the browser's guest cart, after logging in
  @Post('merge')
  @HttpCode(200)
  merge(@CurrentUser() user: AuthUser, @Body({ schema: mergeCartSchema }) body: MergeCart): Promise<Cart> {
    return this.cart.merge(user.id, body);
  }
}
