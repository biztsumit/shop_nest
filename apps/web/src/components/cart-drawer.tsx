"use client";

import { formatPrice, FREE_SHIPPING_FROM, type CartLine } from "@shop/shared";
import { ImageOff, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { errorMessage } from "@/lib/client-api";
import { formatOptions } from "@/lib/format";
import { useAuth } from "./auth-provider";
import { useCart } from "./cart-provider";
import { buttonStyles } from "./ui/button";
import { Drawer } from "./ui/drawer";
import { EmptyState } from "./ui/empty-state";
import { useToast } from "./ui/toast";

const PROBLEMS: Record<NonNullable<CartLine["problem"]>, (line: CartLine) => string> = {
  UNAVAILABLE: () => "No longer sold. Please remove it.",
  OUT_OF_STOCK: () => "Sold out. Please remove it.",
  NOT_ENOUGH_STOCK: (line) => `Only ${line.available} left. Please lower the quantity.`,
};

// The cart, sliding in from the right
export function CartDrawer() {
  const { cart, isOpen, close } = useCart();
  const { status } = useAuth();
  const lines = cart?.lines ?? [];
  const toFreeDelivery = FREE_SHIPPING_FROM - (cart?.subtotal ?? 0);

  return (
    <Drawer open={isOpen} onClose={close} title={`Your cart${cart?.itemCount ? ` (${cart.itemCount})` : ""}`} side="right">
      {lines.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={ShoppingBag} title="Your cart is empty" text="Have a look around: there's free delivery from ₹999.">
            <Link href="/products" onClick={close} className={buttonStyles()}>Start shopping</Link>
          </EmptyState>
        </div>
      ) : (
        <div className="flex min-h-full flex-col">
          <ul className="flex-1 divide-y divide-line px-4">
            {lines.map((line) => <Line key={line.variantId} line={line} />)}
          </ul>
          <div className="sticky bottom-0 flex flex-col gap-3 border-t border-line bg-surface p-4">
            <p className="text-sm text-muted" aria-live="polite">
              {toFreeDelivery > 0 ? <>Add <strong className="text-fg">{formatPrice(toFreeDelivery)}</strong> more for free delivery.</> : "You get free delivery."}
            </p>
            <div className="flex items-baseline justify-between">
              <span className="font-medium">Subtotal</span>
              <span className="text-lg font-semibold tabular-nums">{formatPrice(cart?.subtotal ?? 0)}</span>
            </div>
            {cart?.canCheckout ? (
              <Link
                href={status === "signed-in" ? "/checkout" : "/login?next=/checkout"}
                onClick={close}
                className={buttonStyles({ size: "lg" })}
              >
                {status === "signed-in" ? "Checkout" : "Log in to check out"}
              </Link>
            ) : (
              <p className="text-sm text-danger">Fix the items marked above to check out.</p>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Line({ line }: { line: CartLine }) {
  const { setQuantity, remove, close } = useCart();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const change = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex gap-3 py-4" aria-busy={busy}>
      <Link href={`/products/${line.slug}`} onClick={close} className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-subtle">
        {line.image ? <Image src={line.image.url} alt={line.image.alt || line.name} fill sizes="80px" className="object-cover" /> : <ImageOff className="m-auto mt-7 size-6 text-faint" aria-hidden />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex justify-between gap-2">
          <Link href={`/products/${line.slug}`} onClick={close} className="line-clamp-2 text-sm font-medium hover:underline">{line.name}</Link>
          <span className="text-sm font-semibold tabular-nums">{formatPrice(line.lineTotal)}</span>
        </div>
        {Object.keys(line.options).length > 0 && <p className="text-xs text-muted">{formatOptions(line.options)}</p>}
        {line.problem && <p className="text-xs font-medium text-danger">{PROBLEMS[line.problem](line)}</p>}
        <div className="mt-auto flex items-center justify-between pt-1">
          <div className="flex items-center rounded-lg border border-line-strong">
            <button type="button" aria-label={`One fewer ${line.name}`} disabled={busy || line.quantity <= 1} onClick={() => change(() => setQuantity(line.variantId, line.quantity - 1))} className="flex size-8 items-center justify-center rounded-l-lg hover:bg-subtle disabled:opacity-40">
              <Minus className="size-3.5" aria-hidden />
            </button>
            <span className="w-8 text-center text-sm tabular-nums" aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
            <button type="button" aria-label={`One more ${line.name}`} disabled={busy} onClick={() => change(() => setQuantity(line.variantId, line.quantity + 1))} className="flex size-8 items-center justify-center rounded-r-lg hover:bg-subtle disabled:opacity-40">
              <Plus className="size-3.5" aria-hidden />
            </button>
          </div>
          <button type="button" disabled={busy} onClick={() => change(() => remove(line.variantId))} className="flex items-center gap-1 rounded-lg p-1.5 text-xs text-muted hover:bg-subtle hover:text-danger">
            <Trash2 className="size-3.5" aria-hidden /> Remove
          </button>
        </div>
      </div>
    </li>
  );
}
