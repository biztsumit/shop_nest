"use client";

import { formatPrice, orderSummarySchema, pageSchema, type OrderSummary } from "@shop/shared";
import { ChevronRight, ImageOff, Package } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { OrderStatusBadge } from "@/components/order-status";
import { Button, buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/client-api";
import { formatDate, plural } from "@/lib/format";

const ordersPage = pageSchema(orderSummarySchema);

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void api("/orders?limit=10").then((body) => {
      const page = ordersPage.parse(body);
      setOrders(page.data);
      setCursor(page.nextCursor);
    });
  }, []);

  const more = async () => {
    setLoadingMore(true);
    const page = ordersPage.parse(await api(`/orders?limit=10&cursor=${cursor}`));
    setOrders((list) => [...(list ?? []), ...page.data]);
    setCursor(page.nextCursor);
    setLoadingMore(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">My orders</h1>
      {orders === null ? (
        <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-subtle" />)}</div>
      ) : orders.length === 0 ? (
        <EmptyState icon={Package} title="No orders yet" text="When you place an order, you can follow it here.">
          <Link href="/products" className={buttonStyles()}>Start shopping</Link>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`/account/orders/${order.number}`} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong hover:shadow-card">
                <span className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-subtle">
                  {order.firstItem.imageUrl ? <Image src={order.firstItem.imageUrl} alt="" fill sizes="64px" className="object-cover" /> : <ImageOff className="m-auto mt-5 size-5 text-faint" aria-hidden />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{order.number}</span>
                    <OrderStatusBadge status={order.status} />
                  </span>
                  <span className="truncate text-sm text-muted">
                    {order.firstItem.productName}{order.itemCount > 1 && ` and ${plural(order.itemCount - 1, "more item")}`}
                  </span>
                  <span className="text-xs text-muted">Placed {formatDate(order.createdAt)}</span>
                </span>
                <span className="font-semibold tabular-nums">{formatPrice(order.total)}</span>
                <ChevronRight className="size-4 text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && <Button variant="secondary" className="w-fit self-center" loading={loadingMore} onClick={more}>Show older orders</Button>}
    </div>
  );
}
