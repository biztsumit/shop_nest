import type { Order, OrderStatus } from "@shop/shared";
import { Check, CircleX, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "./ui/badge";

const STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  SHIPPED: { label: "Shipped", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

// The status as words (the colour is only a helper, never the only signal)
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

// Placed → Paid → Shipped → Delivered, with the time of each step done so far.
// An order that ended early (cancelled, expired, refunded) shows where it stopped.
export function OrderTimeline({ order }: { order: Order }) {
  const steps = [
    { label: "Order placed", at: order.createdAt },
    { label: "Payment received", at: order.paidAt },
    { label: "Shipped", at: order.shippedAt },
    { label: "Delivered", at: order.deliveredAt },
  ];
  const ended = order.status === "CANCELLED" || order.status === "EXPIRED" || order.status === "REFUNDED";

  return (
    <ol className="flex flex-col gap-0">
      {steps.map((step, i) => {
        const done = step.at !== null;
        const current = !done && (i === 0 || steps[i - 1]!.at !== null) && !ended;
        return (
          <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden className={cn("absolute top-7 left-3.5 h-[calc(100%-1.75rem)] w-px", done ? "bg-success" : "bg-line")} />}
            <span className={cn("z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2", done ? "border-success bg-success text-white" : current ? "border-brand bg-surface text-brand-text" : "border-line bg-surface text-faint")}>
              {done ? <Check className="size-4" aria-hidden /> : current ? <Clock className="size-3.5" aria-hidden /> : null}
            </span>
            <div className="flex flex-col pt-0.5">
              <span className={cn("text-sm font-medium", !done && !current && "text-muted")}>{step.label}{done ? "" : current ? " (next)" : ""}</span>
              {step.at && <span className="text-xs text-muted">{formatDateTime(step.at)}</span>}
            </div>
          </li>
        );
      })}
      {ended && (
        <li className="flex gap-3 pt-5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-muted"><CircleX className="size-4" aria-hidden /></span>
          <div className="flex flex-col pt-0.5">
            <span className="text-sm font-medium">{STATUS[order.status].label}</span>
            {order.cancelledAt && <span className="text-xs text-muted">{formatDateTime(order.cancelledAt)}</span>}
          </div>
        </li>
      )}
    </ol>
  );
}
