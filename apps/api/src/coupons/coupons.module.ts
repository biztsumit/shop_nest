import { Module } from '@nestjs/common';
import { CouponsService } from './coupons.service.js';

@Module({
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
