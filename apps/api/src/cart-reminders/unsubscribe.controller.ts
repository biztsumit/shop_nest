import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { unsubscribeSchema, type Unsubscribe } from '@shop/shared';
import { CartRemindersService } from './cart-reminders.service.js';

// The one-click "turn these off" link in reminder emails. No login: the signed token in the link
// is the permission, and all it can do is turn reminders OFF.
@Controller('email-preferences')
export class UnsubscribeController {
  constructor(private readonly reminders: CartRemindersService) {}

  // POST /api/email-preferences/unsubscribe  { token }  (the web app's /unsubscribe page sends it)
  @Post('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  unsubscribe(@Body({ schema: unsubscribeSchema }) body: Unsubscribe): Promise<void> {
    return this.reminders.unsubscribe(body.token);
  }
}
