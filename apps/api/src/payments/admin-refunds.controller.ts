import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { createRefundSchema, orderNumberSchema, type CreateRefund, type Refund } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RefundsService } from './refunds.service.js';

@Auth('ADMIN')
@Controller('admin/orders/:number/refunds')
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  list(@Param('number', { schema: orderNumberSchema }) number: string): Promise<Refund[]> {
    return this.refunds.list(number);
  }

  // POST /api/admin/orders/SN000123/refunds  { amount?, reason, restock? }
  @Post()
  refund(
    @CurrentUser() admin: AuthUser,
    @Param('number', { schema: orderNumberSchema }) number: string,
    @Body({ schema: createRefundSchema }) body: CreateRefund,
  ): Promise<Refund> {
    return this.refunds.refund(number, body, admin.id);
  }
}
