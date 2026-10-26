import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AddressesController } from './addresses.controller.js';
import { AddressesService } from './addresses.service.js';

@Module({
  imports: [AuthModule],   // for its guards
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [AddressesService],   // orders copy the delivery address
})
export class AddressesModule {}
