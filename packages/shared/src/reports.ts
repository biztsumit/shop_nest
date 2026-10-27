import { z } from "zod";
import { orderStatusSchema } from "./orders.js";

// GET /api/admin/reports/sales?days=30 (and /orders.csv?days=30)
export const REPORT_RANGES = [7, 30, 90] as const;
export const reportQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((d) => (REPORT_RANGES as readonly number[]).includes(d), "must be 7, 30 or 90")
    .default(30),
});

// The headline numbers for a period. Money in paise.
//   revenue: the totals of orders PAID in the period (including ones refunded later)
//   refunds: money given back in the period
//   net:     revenue − refunds
export const salesTotalsSchema = z.object({
  revenue: z.number().int(),
  refunds: z.number().int(),
  net: z.number().int(),
  orders: z.number().int(),
  averageOrder: z.number().int(),   // revenue ÷ orders (0 when there are none)
  units: z.number().int(),          // items sold
  newCustomers: z.number().int(),
});

export const salesReportSchema = z.object({
  days: z.number().int(),
  from: z.string(),                 // first day, "2026-10-01" (India time)
  to: z.string(),                   // last day, inclusive
  totals: salesTotalsSchema,
  previous: salesTotalsSchema,      // the same number of days just before, for comparison
  daily: z.array(z.object({ day: z.string(), net: z.number().int(), orders: z.number().int() })),
  topProducts: z.array(z.object({ name: z.string(), slug: z.string(), units: z.number().int(), revenue: z.number().int() })),
  ordersByStatus: z.array(z.object({ status: orderStatusSchema, count: z.number().int() })),   // all orders, right now
  lowStock: z.array(z.object({ productName: z.string(), slug: z.string(), options: z.record(z.string(), z.string()), stock: z.number().int() })),
});

// Change from one period to the next, in percent. null when there's nothing to compare with.
export const percentChange = (now: number, before: number): number | null =>
  before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10;

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type SalesTotals = z.infer<typeof salesTotalsSchema>;
export type SalesReport = z.infer<typeof salesReportSchema>;
