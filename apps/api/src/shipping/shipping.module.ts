import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminShipmentsController, CourierWebhookController } from './shipping.controller.js';
import { ShippingService } from './shipping.service.js';
import { ShiprocketClient } from './shiprocket.client.js';

// Parcels: booking with Shiprocket, and tracking (webhook + a scheduled check)
@Module({
  imports: [AuthModule, AdminModule],   // guards; AdminOrdersService moves orders on
  controllers: [AdminShipmentsController, CourierWebhookController],
  providers: [ShippingService, ShiprocketClient],
  exports: [ShippingService, ShiprocketClient],
})
export class ShippingModule {}
