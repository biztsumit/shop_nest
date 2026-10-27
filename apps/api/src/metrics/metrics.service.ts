import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

// METRICS: numbers about the running app, collected in memory and read every few seconds by a
// monitoring system (Prometheus, Grafana Cloud...), which keeps the history and draws graphs
// and alerts ("5xx errors went above 1% for 5 minutes").
//
// Labels split a number by kind (method="GET", status="500"). Each different label value is a
// separate series in the monitoring system, so labels must have FEW values: the route PATTERN
// ("/api/products/:slug"), never the real URL (one series per product would explode).
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests, by method, route pattern and status code',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'How long requests took, by method, route pattern and status code',
    labelNames: ['method', 'route', 'status'] as const,
    // Buckets in seconds: "how many requests took under 50 ms, under 100 ms..."
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  // What the business cares about
  readonly ordersPlaced = new Counter({ name: 'shop_orders_placed_total', help: 'Orders placed', registers: [this.registry] });
  readonly paymentsCaptured = new Counter({ name: 'shop_payments_captured_total', help: 'Payments that paid an order', registers: [this.registry] });
  readonly emails = new Counter({
    name: 'shop_emails_total',
    help: 'Emails handed to the email service, by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  constructor() {
    // Memory, CPU, event-loop lag, garbage collection: Node's own health
    collectDefaultMetrics({ register: this.registry });
  }
}
