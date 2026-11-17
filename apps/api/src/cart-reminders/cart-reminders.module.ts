import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { AccountPreferencesController } from './account-preferences.controller.js';
import { CartRemindersService } from './cart-reminders.service.js';
import { UnsubscribeController } from './unsubscribe.controller.js';

// "You left something in your cart" emails, and the shopper's choice to get them or not
@Module({
  imports: [AuthModule, CartModule],   // guards + JwtService (unsubscribe links); the cart's lines
  controllers: [AccountPreferencesController, UnsubscribeController],
  providers: [CartRemindersService],
  exports: [CartRemindersService],   // the scheduled job sends the reminders
})
export class CartRemindersModule {}
