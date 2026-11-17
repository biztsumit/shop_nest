import { Injectable } from '@nestjs/common';
import { QueueService } from '../jobs/queue.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { RazorpayClient } from '../payments/razorpay.client.js';
import { CartRemindersService } from '../cart-reminders/cart-reminders.service.js';
import { StockAlertsService } from '../stock-alerts/stock-alerts.service.js';
import { MaintenanceService } from './maintenance.service.js';

// The shop's timetable, in one place. Each job just calls a service method, the same one the
// tests call directly.
@Injectable()
export class ScheduledJobs {
  constructor(
    queue: QueueService,
    orders: OrdersService,
    payments: PaymentsService,
    razorpay: RazorpayClient,
    maintenance: MaintenanceService,
    stockAlerts: StockAlertsService,
    cartReminders: CartRemindersService,
  ) {
    // Every minute: unpaid orders past their time give their stock back
    queue.every('orders.expire', '* * * * *', async () => {
      await orders.expireOverdue();
    });
    // Every 5 minutes: payments that neither the browser nor the webhook reported
    queue.every('payments.reconcile', '*/5 * * * *', async () => {
      if (razorpay.enabled) await payments.reconcile();
    });
    // Every 5 minutes: shoppers waiting for a sold-out size that's back get their email
    queue.every('stock-alerts.notify', '*/5 * * * *', async () => {
      await stockAlerts.notifyRestocked();
    });
    // Hourly from 09:15 to 21:15 (India time): reminders about abandoned carts. Daytime only:
    // a reminder at 3 a.m. is just an annoying notification
    queue.every('cart-reminders.send', '15 9-21 * * *', async () => {
      await cartReminders.sendReminders();
    });
    // Every night at 03:30 (India time): delete what's no longer needed
    queue.every('maintenance.clean-up', '30 3 * * *', async () => {
      await maintenance.cleanUp();
    });
  }
}
