"use client";

import { formatPrice, orderSchema, type Order } from "@shop/shared";
import { CircleCheck, Clock, ImageOff, Info, PackageX } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AddressLines } from "@/components/address-form";
import { OrderStatusBadge, OrderTimeline } from "@/components/order-status";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatOptions } from "@/lib/format";
import { payOrder } from "@/lib/pay-order";

// The order, or "missing" if there's no such order of this shopper's
const fetchOrder = async (number: string): Promise<Order | "missing"> => {
  try {
    return orderSchema.parse(await api(`/orders/${number}`));
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 404 || err.status === 422)) return "missing";
    throw err;
  }
};

export function OrderView({ number }: { number: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null | "missing">(null);
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [paymentUnavailable, setPaymentUnavailable] = useState(params.get("payment") === "unavailable");

  const load = useCallback(async () => setOrder(await fetchOrder(number)), [number]);

  useEffect(() => {
    let cancelled = false;
    void fetchOrder(number).then((o) => !cancelled && setOrder(o));
    return () => {
      cancelled = true;
    };
  }, [number]);

  if (order === "missing") {
    return (
      <EmptyState icon={PackageX} title="We couldn't find that order" text="Check the order number, or see all your orders.">
        <Link href="/account/orders" className={buttonStyles()}>My orders</Link>
      </EmptyState>
    );
  }
  if (!order) return <div className="h-64 animate-pulse rounded-xl bg-subtle" aria-busy />;

  const pay = async () => {
    setBusy("pay");
    try {
      const outcome = await payOrder(order.number);
      if (outcome === "unavailable") setPaymentUnavailable(true);
      if (outcome === "paid") router.replace(`/account/orders/${order.number}?paid=1`);
      await load();
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!confirm("Cancel this order? The items go back on sale.")) return;
    setBusy("cancel");
    try {
      setOrder(orderSchema.parse(await api(`/orders/${order.number}/cancel`, { method: "POST" })));
      toast.show("Order cancelled");
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/account/orders" className="text-sm text-muted hover:text-fg">← My orders</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Order {order.number}</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="text-sm text-muted">Placed {formatDateTime(order.createdAt)}</p>
      </div>

      {params.get("paid") === "1" && order.status === "PAID" && (
        <Banner tone="success" Icon={CircleCheck}>Thank you! Your payment went through, and a confirmation is on its way to your inbox.</Banner>
      )}
      {order.status === "PENDING_PAYMENT" && (
        paymentUnavailable ? (
          <Banner tone="info" Icon={Info}>Online payment isn&apos;t set up on this shop yet, so this order can&apos;t be paid here. It&apos;s held until {order.expiresAt && formatDateTime(order.expiresAt)}.</Banner>
        ) : (
          <Banner tone="warning" Icon={Clock}>
            <span className="flex flex-1 flex-wrap items-center justify-between gap-3">
              <span>Your items are held for you. Please pay {order.expiresAt && <>before <strong>{formatDateTime(order.expiresAt)}</strong></>}.</span>
              <span className="flex gap-2">
                <Button size="sm" loading={busy === "pay"} disabled={busy !== null} onClick={pay}>Pay {formatPrice(order.total)}</Button>
                <Button size="sm" variant="ghost" loading={busy === "cancel"} disabled={busy !== null} onClick={cancel}>Cancel order</Button>
              </span>
            </span>
          </Banner>
        )
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card className="flex flex-col p-5">
          <h2 className="mb-2 font-semibold">Items</h2>
          <ul className="flex flex-col divide-y divide-line">
            {order.items.map((item, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <span className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-subtle">
                  {item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="64px" className="object-cover" /> : <ImageOff className="m-auto mt-5 size-5 text-faint" aria-hidden />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/products/${item.productSlug}`} className="truncate text-sm font-medium hover:underline">{item.productName}</Link>
                  <span className="text-xs text-muted">{formatOptions(item.options)}{Object.keys(item.options).length > 0 && " · "}{item.quantity} × {formatPrice(item.unitPrice)}</span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatPrice(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 flex flex-col gap-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatPrice(order.subtotal)}</dd></div>
            {order.discount > 0 && <div className="flex justify-between"><dt className="text-muted">Coupon {order.couponCode}</dt><dd className="text-success tabular-nums">−{formatPrice(order.discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="tabular-nums">{order.shippingFee === 0 ? "Free" : formatPrice(order.shippingFee)}</dd></div>
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatPrice(order.total)}</dd></div>
          </dl>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Progress</h2>
            <OrderTimeline order={order} />
          </Card>
          <Card className="flex flex-col gap-2 p-5">
            <h2 className="font-semibold">Delivering to</h2>
            <AddressLines address={order.shippingAddress} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, Icon, children }: { tone: "success" | "warning" | "info"; Icon: typeof Info; children: React.ReactNode }) {
  const styles = { success: "border-success/40 bg-success-soft", warning: "border-warning/40 bg-warning-soft", info: "border-info/40 bg-info-soft" }[tone];
  const iconColour = { success: "text-success", warning: "text-warning", info: "text-info" }[tone];
  return (
    <div role="status" className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${styles}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${iconColour}`} aria-hidden />
      {children}
    </div>
  );
}
