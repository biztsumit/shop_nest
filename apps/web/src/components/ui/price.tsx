import { formatPrice } from "@shop/shared";
import { cn } from "@/lib/cn";

// ₹699 ~~₹999~~ 30% off. The "was" price is struck through and announced as such.
export function Price({ amount, compareAt, size = "md", className }: { amount: number; compareAt?: number | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const onSale = compareAt != null && compareAt > amount;
  const off = onSale ? Math.round(((compareAt - amount) / compareAt) * 100) : 0;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={cn("font-semibold tabular-nums", { sm: "text-sm", md: "text-base", lg: "text-2xl" }[size])}>{formatPrice(amount)}</span>
      {onSale && (
        <>
          <s className="text-sm text-muted tabular-nums">
            <span className="sr-only">was </span>
            {formatPrice(compareAt)}
          </s>
          <span className="text-sm font-medium text-success">{off}% off</span>
        </>
      )}
    </span>
  );
}
