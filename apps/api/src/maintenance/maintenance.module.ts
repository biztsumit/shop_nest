import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { MaintenanceService } from './maintenance.service.js';
import { ScheduledJobs } from './scheduled-jobs.js';

@Module({
  imports: [OrdersModule, PaymentsModule],
  providers: [MaintenanceService, ScheduledJobs],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
