import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

// Global: payments (online orders) and admin orders (cash on delivery) issue invoices in the
// transaction that makes an order paid
@Global()
@Module({
  imports: [AuthModule],   // for its guards
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
