import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  imports: [AuthModule],   // for its guards
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],   // orders read (and empty) the cart
})
export class CartModule {}
