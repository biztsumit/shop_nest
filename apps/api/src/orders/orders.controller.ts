import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  orderListQuerySchema,
  orderNumberSchema,
  placeOrderSchema,
  quoteSchema,
  type Order,
  type OrderListQuery,
  type OrderSummary,
  type Page,
  type PlaceOrder,
  type Quote,
  type QuoteResult,
} from '@shop/shared';
import type { Response } from 'express';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { IdempotencyKey } from './idempotency-key.decorator.js';
import { OrdersService } from './orders.service.js';

@Auth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // POST /api/orders/quote  { couponCode }: the checkout's price summary
  @Post('quote')
  @HttpCode(200)
  quote(@CurrentUser() user: AuthUser, @Body({ schema: quoteSchema }) body: Quote): Promise<QuoteResult> {
    return this.orders.quote(user.id, body.couponCode);
  }

  // POST /api/orders  { addressId, couponCode?, expectedTotal? }  + header Idempotency-Key
  // 201 with the new order, or 200 with the SAME order when the key was used before
  @Post()
  async place(
    @CurrentUser() user: AuthUser,
    @IdempotencyKey() key: string,
    @Body({ schema: placeOrderSchema }) body: PlaceOrder,
    @Res({ passthrough: true }) res: Response,   // passthrough: we only set the status, Nest still sends the body
  ): Promise<Order> {
    const { order, replayed } = await this.orders.place(user.id, body, key);
    if (replayed) res.status(200).setHeader('Idempotent-Replayed', 'true');
    return order;
  }

  // GET /api/orders?limit=20&cursor=<last id>
  @Get()
  list(@CurrentUser() user: AuthUser, @Query({ schema: orderListQuerySchema }) query: OrderListQuery): Promise<Page<OrderSummary>> {
    return this.orders.list(user.id, query.limit, query.cursor);
  }

  // GET /api/orders/SN000123
  @Get(':number')
  get(@CurrentUser() user: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<Order> {
    return this.orders.get(user.id, number);
  }

  // POST /api/orders/SN000123/cancel: only before it's paid
  @Post(':number/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<Order> {
    return this.orders.cancel(user.id, number);
  }
}
