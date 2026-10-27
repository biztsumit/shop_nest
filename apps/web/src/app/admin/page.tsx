"use client";

import { formatPrice, percentChange, REPORT_RANGES, salesReportSchema, type OrderStatus, type SalesReport } from "@shop/shared";
import { ArrowDownRight, ArrowUpRight, Download, Minus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AreaChart } from "@/components/charts/area-chart";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { downloadFile } from "@/lib/download";
import { errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { formatOptions } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "./admin-shell";

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment", PAID: "To ship", SHIPPED: "Shipped", DELIVERED: "Delivered",
  CANCELLED: "Cancelled", EXPIRED: "Expired", REFUNDED: "Refunded",
};

// "27 Oct" for a day like "2026-10-27"
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export default function Dashboard() {
  const [days, setDays] = useState<number>(30);
  const { data: report, error, loading } = useLoad(`/admin/reports/sales?days=${days}`, salesReportSchema);
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/admin/reports/orders.csv?days=${days}`, `orders-last-${days}-days.csv`);
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <AdminHeader title="Dashboard" />

      {/* One filter row, above everything it scopes: every number below uses this range */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
          {REPORT_RANGES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
              className={cn("rounded-md px-3 py-1.5 text-sm", days === d ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-fg")}>
              Last {d} days
            </button>
          ))}
        </div>
        {report && <span className="text-sm text-muted">{dayLabel(report.from)} – {dayLabel(report.to)}, India time</span>}
        <Button variant="secondary" size="sm" className="ml-auto" loading={downloading} onClick={download}><Download className="size-4" aria-hidden /> Orders CSV</Button>
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      {!report ? (
        <div className="h-96 animate-pulse rounded-xl bg-subtle" aria-busy />
      ) : (
        // While another range loads, the current numbers stay, dimmed (no flash, no jump)
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-50")} aria-busy={loading}>
          <Kpis report={report} />

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-0.5">
              <h2 className="font-semibold">Net revenue per day</h2>
              <p className="text-sm text-muted">Paid orders minus refunds</p>
            </div>
            <AreaChart
              label="Net revenue"
              format={formatPrice}
              points={report.daily.map((d) => ({ label: dayLabel(d.day), value: d.net, detail: `${d.orders} ${d.orders === 1 ? "order" : "orders"}` }))}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col gap-4 p-5">
              <h2 className="font-semibold">Orders by status <span className="text-sm font-normal text-muted">(all time)</span></h2>
              <StatusBars rows={report.ordersByStatus} />
            </Card>
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="font-semibold">Best sellers</h2>
              {report.topProducts.length === 0 ? <p className="text-sm text-muted">No sales in this period yet.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted uppercase"><tr><th scope="col" className="py-1.5 font-medium">Product</th><th scope="col" className="py-1.5 text-right font-medium">Sold</th><th scope="col" className="py-1.5 text-right font-medium">Revenue</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {report.topProducts.map((p) => (
                      <tr key={p.slug}><td className="py-2"><Link href={`/products/${p.slug}`} className="hover:underline">{p.name}</Link></td><td className="py-2 text-right tabular-nums">{p.units}</td><td className="py-2 text-right tabular-nums">{formatPrice(p.revenue)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-semibold">Running low <span className="text-sm font-normal text-muted">(5 or fewer left)</span></h2>
            {report.lowStock.length === 0 ? <p className="text-sm text-muted">Everything is well stocked.</p> : (
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                {report.lowStock.map((v, i) => (
                  <li key={i} className="flex justify-between gap-3 rounded-lg bg-subtle px-3 py-2">
                    <span>{v.productName}{Object.keys(v.options).length > 0 && <span className="text-muted"> · {formatOptions(v.options)}</span>}</span>
                    <span className={cn("font-medium tabular-nums", v.stock === 0 ? "text-danger" : "text-warning")}>{v.stock === 0 ? "Sold out" : `${v.stock} left`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// The headline numbers, each with its change against the period just before.
// Colour says "good or bad" (more refunds is bad); the arrow and sign say the direction,
// so the meaning never rests on colour alone.
function Kpis({ report }: { report: SalesReport }) {
  const { totals: now, previous: before } = report;
  const tiles = [
    { label: "Net revenue", value: formatPrice(now.net), change: percentChange(now.net, before.net), upIsGood: true, hero: true },
    { label: "Orders", value: now.orders.toLocaleString("en-IN"), change: percentChange(now.orders, before.orders), upIsGood: true },
    { label: "Average order", value: formatPrice(Math.round(now.averageOrder / 100) * 100), change: percentChange(now.averageOrder, before.averageOrder), upIsGood: true },
    { label: "Items sold", value: now.units.toLocaleString("en-IN"), change: percentChange(now.units, before.units), upIsGood: true },
    { label: "Refunds", value: formatPrice(now.refunds), change: percentChange(now.refunds, before.refunds), upIsGood: false },
    { label: "New customers", value: now.newCustomers.toLocaleString("en-IN"), change: percentChange(now.newCustomers, before.newCustomers), upIsGood: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {tiles.map((t) => (
        <Card key={t.label} className={cn("flex flex-col gap-1 p-4", t.hero && "col-span-2 lg:col-span-1")}>
          <span className="text-sm text-muted">{t.label}</span>
          <span className={cn("font-semibold tracking-tight", t.hero ? "text-4xl" : "text-2xl")}>{t.value}</span>
          <Delta change={t.change} upIsGood={t.upIsGood} days={report.days} />
        </Card>
      ))}
    </div>
  );
}

function Delta({ change, upIsGood, days }: { change: number | null; upIsGood: boolean; days: number }) {
  if (change === null) return <span className="text-xs text-muted">No earlier data to compare</span>;
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const good = change === 0 ? null : (change > 0) === upIsGood;
  return (
    <span className="flex flex-col text-xs">
      <span className={cn("flex items-center gap-0.5 font-medium", good === null ? "text-muted" : good ? "text-success" : "text-danger")}>
        <Icon className="size-3.5" aria-hidden />
        {change > 0 ? "+" : ""}{change}%
      </span>
      <span className="text-muted">vs previous {days} days</span>
    </span>
  );
}

// Horizontal bars, one colour (statuses are categories, not good/bad signals here), the value
// at the tip of each bar. Bars are 16px thick with 4px rounded ends at the data side only.
function StatusBars({ rows }: { rows: SalesReport["ordersByStatus"] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No orders yet.</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.status} className="grid grid-cols-[8.5rem_1fr] items-center gap-3 text-sm">
          <span className="text-muted">{STATUS_LABEL[r.status]}</span>
          <span className="flex items-center gap-2">
            <span className="h-4 rounded-r bg-chart" style={{ width: `${Math.max(2, (r.count / max) * 85)}%` }} aria-hidden />
            <span className="tabular-nums">{r.count}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
