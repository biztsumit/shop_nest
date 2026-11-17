import { Body, Controller, Get, Patch } from '@nestjs/common';
import { emailPreferencesSchema, type EmailPreferences } from '@shop/shared';
import { Auth } from '../auth/auth.decorator.js';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CartRemindersService } from './cart-reminders.service.js';

// The logged-in shopper's email choices (the account page)
@Auth()
@Controller('account/preferences')
export class AccountPreferencesController {
  constructor(private readonly reminders: CartRemindersService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<EmailPreferences> {
    return this.reminders.preferences(user.id);
  }

  // PATCH /api/account/preferences  { cartReminders: false }
  @Patch()
  set(@CurrentUser() user: AuthUser, @Body({ schema: emailPreferencesSchema }) body: EmailPreferences): Promise<EmailPreferences> {
    return this.reminders.setPreferences(user.id, body);
  }
}
