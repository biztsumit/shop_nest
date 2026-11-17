import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { CartRemindersModule } from '../cart-reminders/cart-reminders.module.js';
import { StockAlertsModule } from '../stock-alerts/stock-alerts.module.js';
import { MaintenanceService } from './maintenance.service.js';
import { ScheduledJobs } from './scheduled-jobs.js';

@Module({
  imports: [OrdersModule, PaymentsModule, StockAlertsModule, CartRemindersModule],
  providers: [MaintenanceService, ScheduledJobs],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
