"use client";

import { adminOrderSchema, formatPrice, parseRupees, type AdminOrder } from "@shop/shared";
import { CheckCheck, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AddressLines } from "@/components/address-form";
import { OrderStatusBadge, OrderTimeline } from "@/components/order-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/client-api";
import { formatDateTime, formatOptions } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { AdminHeader } from "../../admin-shell";

export function AdminOrderView({ number }: { number: string }) {
  const { data: order, error, setData, reload } = useLoad(`/admin/orders/${number}`, adminOrderSchema);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!order) return <div className="h-64 animate-pulse rounded-xl bg-subtle" aria-busy />;

  const act = async (action: "ship" | "deliver" | "cancel", done: string) => {
    if (action === "cancel" && !confirm("Cancel this unpaid order? Its items go back on sale.")) return;
    setBusy(action);
    try {
      setData(adminOrderSchema.parse(await api(`/admin/orders/${number}/${action}`, { method: "POST" })));
      toast.show(done);
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/orders" className="text-sm text-muted hover:text-fg">← Orders</Link>
      <AdminHeader title={`Order ${order.number}`}>
        <OrderStatusBadge status={order.status} />
        {order.status === "PAID" && <Button loading={busy === "ship"} onClick={() => act("ship", "Marked as shipped; the customer was emailed")}><Truck className="size-4" aria-hidden /> Mark shipped</Button>}
        {order.status === "SHIPPED" && <Button loading={busy === "deliver"} onClick={() => act("deliver", "Marked as delivered")}><CheckCheck className="size-4" aria-hidden /> Mark delivered</Button>}
        {order.status === "PENDING_PAYMENT" && <Button variant="danger" loading={busy === "cancel"} onClick={() => act("cancel", "Order cancelled")}><XCircle className="size-4" aria-hidden /> Cancel</Button>}
      </AdminHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Items</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {order.items.map((item, i) => (
                  <tr key={i}>
                    <td className="py-2">{item.productName}<span className="block text-xs text-muted">{[formatOptions(item.options), item.sku].filter(Boolean).join(" · ")}</span></td>
                    <td className="py-2 text-right text-muted tabular-nums">{item.quantity} × {formatPrice(item.unitPrice)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatPrice(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatPrice(order.subtotal)}</dd></div>
              {order.discount > 0 && <div className="flex justify-between"><dt className="text-muted">Coupon {order.couponCode}</dt><dd className="tabular-nums">−{formatPrice(order.discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="tabular-nums">{formatPrice(order.shippingFee)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatPrice(order.total)}</dd></div>
            </dl>
          </Card>
          <Payment order={order} onRefunded={reload} />
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-1 p-5 text-sm">
            <h2 className="mb-1 font-semibold">Customer</h2>
            <span className="font-medium">{order.customer.name}</span>
            <a href={`mailto:${order.customer.email}`} className="text-brand-text hover:underline">{order.customer.email}</a>
          </Card>
          <Card className="flex flex-col gap-2 p-5">
            <h2 className="font-semibold">Ship to</h2>
            <AddressLines address={order.shippingAddress} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Progress</h2>
            <OrderTimeline order={order} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Payment({ order, onRefunded }: { order: AdminOrder; onRefunded: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const payment = order.payment;
  const refundable = payment ? payment.amount - payment.refundedAmount : 0;
  const canRefund = payment !== null && refundable > 0 && ["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status);

  const refund = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const amount = f.amount ? parseRupees(f.amount) : null;
    if (f.amount && amount === null) {
      toast.show("Enter an amount like 250 or 1,299.50 (or leave it empty for everything)", "error");
      return;
    }
    const label = formatPrice(amount ?? refundable);
    if (!confirm(`Refund ${label} to the customer? This sends real money back and can't be undone.`)) return;
    setBusy(true);
    try {
      await api(`/admin/orders/${order.number}/refunds`, { method: "POST", body: { ...(amount !== null && { amount }), reason: f.reason, restock: f.restock === "on" } });
      toast.show(`Refunded ${label}`);
      onRefunded();
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="font-semibold">Payment</h2>
      {!payment ? (
        <p className="text-sm text-muted">No payment started.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Status</dt><dd><Badge tone={payment.status === "CAPTURED" ? "success" : "neutral"}>{payment.status.toLowerCase().replace("_", " ")}</Badge></dd></div>
          <div><dt className="text-muted">Method</dt><dd className="capitalize">{payment.method ?? "—"}</dd></div>
          <div><dt className="text-muted">Paid</dt><dd className="tabular-nums">{formatPrice(payment.amount)}</dd></div>
          <div><dt className="text-muted">Refunded</dt><dd className="tabular-nums">{formatPrice(payment.refundedAmount)}</dd></div>
        </dl>
      )}
      {order.refunds.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {order.refunds.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 rounded-lg bg-subtle px-3 py-2">
              <span>{formatPrice(r.amount)} · {r.reason}</span>
              <span className="text-muted">{r.status.toLowerCase()} · {formatDateTime(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {canRefund && (
        <form onSubmit={refund} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <TextField label="Amount (₹)" name="amount" inputMode="decimal" placeholder={`Everything left: ${formatPrice(refundable)}`} />
          <TextField label="Reason" name="reason" required placeholder="Damaged in transit" />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="restock" className="size-4 accent-brand" /> Put the items back on sale (full refunds only)
          </label>
          <Button type="submit" variant="danger" className="w-fit" loading={busy}>Refund</Button>
        </form>
      )}
    </Card>
  );
}
