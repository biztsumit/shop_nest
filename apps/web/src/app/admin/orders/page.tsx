"use client";

import { adminOrderSummarySchema, formatPrice, pageSchema, type AdminOrderSummary, type OrderStatus } from "@shop/shared";
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { OrderStatusBadge } from "@/components/order-status";
import { Button } from "@/components/ui/button";
import { inputStyles } from "@/components/ui/input-styles";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../admin-shell";

const ordersPage = pageSchema(adminOrderSummarySchema);
const STATUSES: Array<[OrderStatus | "", string]> = [
  ["", "All"], ["PAID", "To ship"], ["SHIPPED", "Shipped"], ["PENDING_PAYMENT", "Awaiting payment"], ["DELIVERED", "Delivered"], ["REFUNDED", "Refunded"], ["CANCELLED", "Cancelled"], ["EXPIRED", "Expired"],
];

export default function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | "">("PAID");
  const [search, setSearch] = useState("");
  const query = new URLSearchParams({ limit: "25", ...(status && { status }), ...(search && { search }) });
  const { data, error } = useLoad(`/admin/orders?${query}`, ordersPage);
  const [more, setMore] = useState<{ rows: AdminOrderSummary[]; cursor: string | null } | null>(null);
  const rows = [...(data?.data ?? []), ...(more?.rows ?? [])];
  const cursor = more ? more.cursor : (data?.nextCursor ?? null);

  return (
    <div>
      <AdminHeader title="Orders" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Order status" className="flex flex-wrap gap-1">
          {STATUSES.map(([value, label]) => (
            <button key={label} type="button" role="tab" aria-selected={status === value} onClick={() => { setStatus(value); setMore(null); }}
              className={cn("rounded-full px-3 py-1.5 text-sm", status === value ? "bg-brand text-brand-fg" : "bg-subtle text-muted hover:text-fg")}>
              {label}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full max-w-xs">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setMore(null); }} placeholder="SN000123 or customer email" className={cn(inputStyles, "h-10 pl-9")} />
        </label>
      </div>

      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Order</th>
              <th scope="col" className="px-4 py-3 font-medium">Customer</th>
              <th scope="col" className="px-4 py-3 font-medium">Placed</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data === null && !error && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Loading…</td></tr>}
            {data && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No orders here.</td></tr>}
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-subtle">
                <td className="px-4 py-3"><Link href={`/admin/orders/${o.number}`} className="font-medium text-brand-text hover:underline">{o.number}</Link><span className="block text-xs text-muted">{o.itemCount} {o.itemCount === 1 ? "item" : "items"}</span></td>
                <td className="px-4 py-3">{o.customer.name}<span className="block text-xs text-muted">{o.customer.email}</span></td>
                <td className="px-4 py-3 text-muted">{formatDateTime(o.createdAt)}</td>
                <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{formatPrice(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <Button variant="secondary" className="mt-4" onClick={async () => {
          const page = ordersPage.parse(await api(`/admin/orders?${query}&cursor=${cursor}`));
          setMore({ rows: [...(more?.rows ?? []), ...page.data], cursor: page.nextCursor });
        }}>Load more</Button>
      )}
    </div>
  );
}
