import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StockAlertsController } from './stock-alerts.controller.js';
import { StockAlertsService } from './stock-alerts.service.js';

@Module({
  imports: [AuthModule],   // for its guards
  controllers: [StockAlertsController],
  providers: [StockAlertsService],
  exports: [StockAlertsService],   // the scheduled job sends the emails
})
export class StockAlertsModule {}
