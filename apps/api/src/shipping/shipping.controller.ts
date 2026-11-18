import { Body, Controller, Delete, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { bookShipmentSchema, orderNumberSchema, type AdminOrder, type BookShipment } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ShippingService } from './shipping.service.js';

// Booking a parcel with Shiprocket from the admin order page, and calling it off
@Auth('ADMIN')
@Controller('admin/orders/:number/shipment')
export class AdminShipmentsController {
  constructor(private readonly shipping: ShippingService) {}

  // POST /api/admin/orders/SN000123/shipment  { weightGrams, lengthCm, breadthCm, heightCm }
  // Again after a partial failure: carries on where it stopped (label, pickup)
  @Post()
  @HttpCode(200)
  book(
    @CurrentUser() admin: AuthUser,
    @Param('number', { schema: orderNumberSchema }) number: string,
    @Body({ schema: bookShipmentSchema }) pkg: BookShipment,
  ): Promise<AdminOrder> {
    return this.shipping.book(number, pkg, admin.id);
  }

  // DELETE /api/admin/orders/SN000123/shipment: only before the courier picks it up
  @Delete()
  cancel(@CurrentUser() admin: AuthUser, @Param('number', { schema: orderNumberSchema }) number: string): Promise<AdminOrder> {
    return this.shipping.cancel(number, admin.id);
  }
}

// Called by Shiprocket's servers whenever a parcel moves. No login: trust comes from the token
// we chose in Shiprocket's panel, sent as x-api-key. Not rate limited (one courier, many parcels).
// The path doesn't say "shiprocket": Shiprocket refuses webhook URLs containing its own name.
@SkipThrottle()
@Controller('webhooks')
export class CourierWebhookController {
  constructor(private readonly shipping: ShippingService) {}

  // POST /api/webhooks/courier. 200 = got it; anything else = Shiprocket tries again.
  @Post('courier')
  @HttpCode(200)
  async courier(@Headers('x-api-key') token: string | undefined, @Body() body: unknown): Promise<{ received: true }> {
    await this.shipping.handleWebhook(token, (body ?? {}) as Parameters<ShippingService['handleWebhook']>[1]);
    return { received: true };
  }
}
