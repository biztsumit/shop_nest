import { BadRequestException, Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { PaymentsService } from './payments.service.js';

// Called by Razorpay's servers, not by browsers or users: no login. Trust comes from the
// signature instead (only Razorpay knows the webhook secret). Not rate limited: during a sale,
// Razorpay may legitimately send many events from the same few addresses.
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  // POST /api/webhooks/razorpay. 200 = "got it" (Razorpay stops sending this event);
  // anything else = Razorpay tries again later, for up to 24 hours.
  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing body or signature');
    }
    // Older webhooks have no event id: the body's fingerprint identifies the event instead
    const id = eventId ?? createHash('sha256').update(req.rawBody).digest('hex').slice(0, 64);
    await this.payments.handleWebhook(id, req.rawBody, signature);
    return { received: true };
  }
}
