import { Injectable } from '@nestjs/common';
import type { OrderStatus, SalesReport, SalesTotals } from '@shop/shared';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 24 * 60 * 60 * 1000;
// India has one time zone and no daylight saving: always UTC+05:30
const IST = 5.5 * 60 * 60 * 1000;
// Orders that were really paid for (cancelled/expired unpaid ones never were)
const PAID = ['PAID', 'SHIPPED', 'DELIVERED', 'REFUNDED'] as const;

// "2026-10-27" for the India-time calendar day a moment falls on
const istDay = (at: Date): string => new Date(at.getTime() + IST).toISOString().slice(0, 10);

// The UTC moment India's day `day` begins (00:00 IST = 18:30 UTC the evening before)
const istDayStart = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) - IST);

type Window = { from: Date; to: Date };   // [from, to)

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(days: number, now = new Date()): Promise<SalesReport> {
    // The last `days` India-time days, today included; and the same length just before
    const end = new Date(istDayStart(istDay(now)).getTime() + DAY);
    const current: Window = { from: new Date(end.getTime() - days * DAY), to: end };
    const previous: Window = { from: new Date(current.from.getTime() - days * DAY), to: current.from };

    const [totals, before, daily, topProducts, byStatus, lowStock] = await Promise.all([
      this.totals(current),
      this.totals(previous),
      this.daily(current, days),
      this.topProducts(current),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.lowStock(),
    ]);

    return {
      days,
      from: istDay(current.from),
      to: istDay(new Date(end.getTime() - 1)),
      totals,
      previous: before,
      daily,
      topProducts,
      ordersByStatus: byStatus
        .map((s) => ({ status: s.status as OrderStatus, count: s._count._all }))
        .sort((a, b) => b.count - a.count),
      lowStock,
    };
  }

  private async totals({ from, to }: Window): Promise<SalesTotals> {
    const paidIn = { status: { in: [...PAID] }, paidAt: { gte: from, lt: to } };
    const [orders, units, refunds, newCustomers] = await Promise.all([
      this.prisma.order.aggregate({ where: paidIn, _sum: { total: true }, _count: { _all: true } }),
      this.prisma.orderItem.aggregate({ where: { order: paidIn }, _sum: { quantity: true } }),
      this.prisma.refund.aggregate({ where: { status: { not: 'FAILED' }, createdAt: { gte: from, lt: to } }, _sum: { amount: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: from, lt: to } } }),
    ]);
    const revenue = orders._sum.total ?? 0;
    const refunded = refunds._sum.amount ?? 0;
    const count = orders._count._all;
    return {
      revenue,
      refunds: refunded,
      net: revenue - refunded,
      orders: count,
      averageOrder: count === 0 ? 0 : Math.round(revenue / count),
      units: units._sum.quantity ?? 0,
      newCustomers,
    };
  }

  // Net revenue and orders per India-time day. The database groups by day (in Asia/Kolkata);
  // days without sales are filled in with zeros here, so the chart has no gaps.
  private async daily({ from, to }: Window, days: number): Promise<SalesReport['daily']> {
    const sales = await this.prisma.$queryRaw<Array<{ day: string; revenue: number; orders: number }>>`
      SELECT to_char(paid_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
             sum(total)::int AS revenue, count(*)::int AS orders
      FROM orders
      WHERE status::text IN ('PAID', 'SHIPPED', 'DELIVERED', 'REFUNDED') AND paid_at >= ${from} AND paid_at < ${to}
      GROUP BY 1`;
    const refunds = await this.prisma.$queryRaw<Array<{ day: string; amount: number }>>`
      SELECT to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, sum(amount)::int AS amount
      FROM refunds
      WHERE status <> 'FAILED' AND created_at >= ${from} AND created_at < ${to}
      GROUP BY 1`;
    const salesBy = new Map(sales.map((s) => [s.day, s]));
    const refundsBy = new Map(refunds.map((r) => [r.day, r.amount]));
    return Array.from({ length: days }, (_, i) => {
      const day = istDay(new Date(from.getTime() + i * DAY));
      return { day, net: (salesBy.get(day)?.revenue ?? 0) - (refundsBy.get(day) ?? 0), orders: salesBy.get(day)?.orders ?? 0 };
    });
  }

  private async topProducts({ from, to }: Window): Promise<SalesReport['topProducts']> {
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productSlug', 'productName'],
      where: { order: { status: { in: [...PAID] }, paidAt: { gte: from, lt: to } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: 5,
    });
    return rows.map((r) => ({ name: r.productName, slug: r.productSlug, units: r._sum.quantity ?? 0, revenue: r._sum.lineTotal ?? 0 }));
  }

  // What's about to sell out (on-sale products only)
  private async lowStock(): Promise<SalesReport['lowStock']> {
    const variants = await this.prisma.productVariant.findMany({
      where: { stock: { lte: 5 }, product: { status: 'ACTIVE' } },
      orderBy: [{ stock: 'asc' }, { id: 'asc' }],
      take: 10,
      include: { product: { select: { name: true, slug: true } } },
    });
    return variants.map((v) => ({ productName: v.product.name, slug: v.product.slug, options: v.options as Record<string, string>, stock: v.stock }));
  }

  // Every order PLACED in the last `days` days as a spreadsheet (CSV), for accounts and tax
  async ordersCsv(days: number, now = new Date()): Promise<string> {
    const end = new Date(istDayStart(istDay(now)).getTime() + DAY);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: new Date(end.getTime() - days * DAY), lt: end } },
      orderBy: { id: 'asc' },
      include: { user: { select: { name: true, email: true } }, items: { select: { quantity: true } }, payment: { select: { refundedAmount: true } } },
    });
    const rupees = (paise: number) => (paise / 100).toFixed(2);
    const header = ['order', 'placed_ist', 'paid_ist', 'status', 'customer', 'email', 'items', 'subtotal', 'discount', 'delivery', 'total', 'refunded', 'coupon'];
    const lines = orders.map((o) => [
      o.number,
      istDateTime(o.createdAt),
      o.paidAt ? istDateTime(o.paidAt) : '',
      o.status,
      o.user.name,
      o.user.email,
      String(o.items.reduce((sum, i) => sum + i.quantity, 0)),
      rupees(o.subtotal),
      rupees(o.discount),
      rupees(o.shippingFee),
      rupees(o.total),
      rupees(o.payment?.refundedAmount ?? 0),
      o.couponCode ?? '',
    ]);
    return [header, ...lines].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}

const istDateTime = (at: Date): string => new Date(at.getTime() + IST).toISOString().slice(0, 16).replace('T', ' ');

// One CSV cell, safely:
// - quoted when it holds a comma, a quote or a line break (quotes inside are doubled)
// - "formula injection": a spreadsheet RUNS a cell that starts with = + - @ (a customer named
//   "=HYPERLINK(...)" would become a live link in the accountant's Excel). A leading ' makes
//   it plain text.
export const csvCell = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
