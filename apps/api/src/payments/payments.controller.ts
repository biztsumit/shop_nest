import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { orderNumberSchema, verifyPaymentSchema, type Order, type StartPayment, type VerifyPayment } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PaymentsService } from './payments.service.js';

@Auth()
@Controller('orders/:number/payment')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // POST /api/orders/SN000123/payment → what Razorpay Checkout needs to open
  @Post()
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<StartPayment> {
    return this.payments.start(user.id, number);
  }

  // POST /api/orders/SN000123/payment/verify  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
  @Post('verify')
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthUser,
    @Param('number', { schema: orderNumberSchema }) number: string,
    @Body({ schema: verifyPaymentSchema }) body: VerifyPayment,
  ): Promise<Order> {
    return this.payments.verify(user.id, number, body);
  }
}
