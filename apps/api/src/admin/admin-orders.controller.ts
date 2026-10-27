import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { adminOrderListQuerySchema, orderNumberSchema, type AdminOrder, type AdminOrderListQuery, type AdminOrderSummary, type Page } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AdminOrdersService } from './admin-orders.service.js';

@Auth('ADMIN')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  // GET /api/admin/orders?status=PAID&search=SN000123 (or part of an email)
  @Get()
  list(@Query({ schema: adminOrderListQuerySchema }) query: AdminOrderListQuery): Promise<Page<AdminOrderSummary>> {
    return this.orders.list(query);
  }

  @Get(':number')
  get(@Param('number', { schema: orderNumberSchema }) number: string): Promise<AdminOrder> {
    return this.orders.get(number);
  }

  @Post(':number/ship')
  @HttpCode(200)
  ship(@CurrentUser() admin: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<AdminOrder> {
    return this.orders.move(number, 'ship', admin.id);
  }

  @Post(':number/deliver')
  @HttpCode(200)
  deliver(@CurrentUser() admin: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<AdminOrder> {
    return this.orders.move(number, 'deliver', admin.id);
  }

  @Post(':number/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() admin: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<AdminOrder> {
    return this.orders.cancel(number, admin.id);
  }
}
