import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { createCouponSchema, updateCouponSchema, type Coupon, type CreateCoupon, type UpdateCoupon } from '@shop/shared';
import { z } from 'zod';
import { Auth } from '../auth/auth.decorator.js';
import { AdminCouponsService } from './admin-coupons.service.js';

@Auth('ADMIN')
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: AdminCouponsService) {}

  @Get()
  list(): Promise<Coupon[]> {
    return this.coupons.list();
  }

  @Post()
  create(@Body({ schema: createCouponSchema }) body: CreateCoupon): Promise<Coupon> {
    return this.coupons.create(body);
  }

  // Coupons aren't deleted (past orders name them): turn one off with { active: false }
  @Patch(':id')
  update(@Param('id', { schema: z.uuid() }) id: string, @Body({ schema: updateCouponSchema }) body: UpdateCoupon): Promise<Coupon> {
    return this.coupons.update(id, body);
  }
}
