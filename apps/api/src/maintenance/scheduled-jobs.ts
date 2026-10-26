import { Injectable } from '@nestjs/common';
import { QueueService } from '../jobs/queue.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RazorpayClient } from '../payments/razorpay.client.js';
import { MaintenanceService } from './maintenance.service.js';

// The shop's timetable, in one place. Each job just calls a service method, the same one the
// tests call directly.
@Injectable()
export class ScheduledJobs {
  constructor(queue: QueueService, orders: OrdersService, payments: PaymentsService, razorpay: RazorpayClient, maintenance: MaintenanceService) {
    // Every minute: unpaid orders past their time give their stock back
    queue.every('orders.expire', '* * * * *', async () => {
      await orders.expireOverdue();
    });
    // Every 5 minutes: payments that neither the browser nor the webhook reported
    queue.every('payments.reconcile', '*/5 * * * *', async () => {
      if (razorpay.enabled) await payments.reconcile();
    });
    // Every night at 03:30 (India time): delete what's no longer needed
    queue.every('maintenance.clean-up', '30 3 * * *', async () => {
      await maintenance.cleanUp();
    });
  }
}
