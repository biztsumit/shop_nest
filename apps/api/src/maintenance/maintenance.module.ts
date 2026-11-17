import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { StockAlertsModule } from '../stock-alerts/stock-alerts.module.js';
import { MaintenanceService } from './maintenance.service.js';
import { ScheduledJobs } from './scheduled-jobs.js';

@Module({
  imports: [OrdersModule, PaymentsModule, StockAlertsModule],
  providers: [MaintenanceService, ScheduledJobs],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
