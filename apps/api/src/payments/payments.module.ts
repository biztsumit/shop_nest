import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminRefundsController } from './admin-refunds.controller.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { RazorpayClient } from './razorpay.client.js';
import { RefundsService } from './refunds.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [PaymentsController, WebhooksController, AdminRefundsController],
  providers: [PaymentsService, RefundsService, RazorpayClient],
  exports: [PaymentsService, RefundsService, RazorpayClient],
})
export class PaymentsModule {}
