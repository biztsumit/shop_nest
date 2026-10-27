"use client";

import { addressSchema, formatPrice, orderSchema, quoteResultSchema, type Address, type QuoteResult } from "@shop/shared";
import { Check, ImageOff, Lock, Plus, ShoppingBag, Tag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddressForm, AddressLines } from "@/components/address-form";
import { useCart } from "@/components/cart-provider";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { inputStyles } from "@/components/ui/input-styles";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { formatOptions } from "@/lib/format";
import { payOrder } from "@/lib/pay-order";

const STEPS = ["Address", "Review", "Payment"] as const;

// Three steps: where to deliver → check the order (and add a coupon) → place it and pay.
export function Checkout() {
  const { cart, reload } = useCart();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One Idempotency-Key per checkout ATTEMPT (this address + coupon + total): pressing "Place
  // order" twice, or retrying after a network error, can never create two orders
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    void api("/addresses").then((body) => {
      const list = addressSchema.array().parse(body);
      setAddresses(list);
      setAddressId((current) => current ?? list.find((a) => a.isDefault)?.id ?? list[0]?.id ?? null);
      if (list.length === 0) setAdding(true);
    });
  }, []);

  const loadQuote = useCallback(async (code: string | null) => {
    setQuote(quoteResultSchema.parse(await api("/orders/quote", { method: "POST", body: { couponCode: code } })));
  }, []);

  // The price summary follows the cart (and the coupon)
  useEffect(() => {
    if (!cart?.canCheckout) return;
    let cancelled = false;
    api("/orders/quote", { method: "POST", body: { couponCode: coupon } })
      .then((body) => !cancelled && setQuote(quoteResultSchema.parse(body)))
      .catch(() => !cancelled && setCoupon(null));   // the coupon stopped working (e.g. cart changed)
    return () => {
      cancelled = true;
    };
  }, [cart, coupon]);

  if (cart && cart.lines.length === 0 && !placing) {
    return (
      <EmptyState icon={ShoppingBag} title="Your cart is empty" text="Add something you like, then come back here to check out.">
        <Link href="/products" className={buttonStyles()}>Browse the shop</Link>
      </EmptyState>
    );
  }

  const address = addresses?.find((a) => a.id === addressId);

  const place = async () => {
    if (!address || !quote) return;
    setPlacing(true);
    setError(null);
    const attempt = `${address.id}|${quote.couponCode ?? ""}|${quote.total}`;
    if (!keys.current.has(attempt)) keys.current.set(attempt, crypto.randomUUID());
    let number: string;
    try {
      const order = orderSchema.parse(await api("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": keys.current.get(attempt)! },
        body: { addressId: address.id, couponCode: quote.couponCode, expectedTotal: quote.total },
      }));
      number = order.number;
    } catch (err) {
      setPlacing(false);
      setError(errorMessage(err));
      // Stock or prices changed: show the updated cart and totals to review again
      if (err instanceof ApiRequestError && err.status === 409) {
        await reload();
        setStep(1);
      }
      return;
    }

    void reload();   // the ordered lines left the cart
    try {
      const outcome = await payOrder(number);
      if (outcome === "cancelled") toast.show("Payment not finished. You can pay from your order page.", "error");
      router.push(`/account/orders/${number}${outcome === "paid" ? "?paid=1" : outcome === "unavailable" ? "?payment=unavailable" : ""}`);
    } catch (err) {
      toast.show(errorMessage(err), "error");
      router.push(`/account/orders/${number}`);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Checkout</h1>
        <ol className="flex items-center gap-2 text-sm" aria-label="Checkout steps">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
              <span className={cn("flex size-7 items-center justify-center rounded-full text-xs font-semibold", i < step ? "bg-success text-white" : i === step ? "bg-brand text-brand-fg" : "bg-subtle text-muted")}>
                {i < step ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className={cn(i === step ? "font-medium" : "text-muted")}>{label}</span>
              {i < STEPS.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-line sm:w-12" />}
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          {step === 0 && (
            <Card className="flex flex-col gap-5 p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Where should we deliver?</h2>
              {addresses === null ? (
                <div className="h-24 animate-pulse rounded-lg bg-subtle" />
              ) : (
                <>
                  {addresses.length > 0 && (
                    <div role="radiogroup" aria-label="Saved addresses" className="grid gap-3 sm:grid-cols-2">
                      {addresses.map((a) => (
                        <label key={a.id} className={cn("flex cursor-pointer gap-3 rounded-xl border p-4", a.id === addressId ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong")}>
                          <input type="radio" name="address" checked={a.id === addressId} onChange={() => setAddressId(a.id)} className="mt-1 accent-brand" />
                          <AddressLines address={a} />
                        </label>
                      ))}
                    </div>
                  )}
                  {adding ? (
                    <div className="flex flex-col gap-3 border-t border-line pt-5">
                      <h3 className="font-medium">New address</h3>
                      <AddressForm
                        onSaved={(saved) => {
                          setAddresses((list) => [...(list ?? []).map((a) => (saved.isDefault ? { ...a, isDefault: false } : a)), saved]);
                          setAddressId(saved.id);
                          setAdding(false);
                        }}
                        onCancel={addresses.length > 0 ? () => setAdding(false) : undefined}
                      />
                    </div>
                  ) : (
                    <Button variant="secondary" className="w-fit" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add a new address</Button>
                  )}
                  <Button size="lg" className="w-full sm:w-fit" disabled={!address || adding} onClick={() => setStep(1)}>Continue</Button>
                </>
              )}
            </Card>
          )}

          {step === 1 && (
            <Card className="flex flex-col gap-5 p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Check your order</h2>
              <ul className="flex flex-col divide-y divide-line">
                {cart?.lines.map((line) => (
                  <li key={line.variantId} className="flex items-center gap-3 py-3">
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-subtle">
                      {line.image ? <Image src={line.image.url} alt="" fill sizes="56px" className="object-cover" /> : <ImageOff className="m-auto mt-4 size-5 text-faint" aria-hidden />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{line.name}</span>
                      <span className="text-xs text-muted">{formatOptions(line.options)}{Object.keys(line.options).length > 0 && " · "}Qty {line.quantity}</span>
                      {line.problem && <span className="text-xs font-medium text-danger">Can&apos;t be bought as it is: open the cart to fix it</span>}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{formatPrice(line.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              {address && (
                <div className="flex items-start justify-between gap-4 rounded-xl bg-subtle p-4">
                  <AddressLines address={address} />
                  <button type="button" onClick={() => setStep(0)} className="text-sm font-medium text-brand-text hover:underline">Change</button>
                </div>
              )}
              <CouponBox applied={quote?.couponCode ?? null} onApply={async (code) => { await loadQuote(code); setCoupon(code); }} onRemove={() => setCoupon(null)} />
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex gap-3">
                <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
                <Button size="lg" disabled={!cart?.canCheckout || !quote} onClick={() => { setError(null); setStep(2); }}>Continue to payment</Button>
              </div>
            </Card>
          )}

          {step === 2 && quote && (
            <Card className="flex flex-col gap-5 p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Payment</h2>
              <p className="text-muted">
                You&apos;ll pay <strong className="text-fg">{formatPrice(quote.total)}</strong> securely with Razorpay: UPI, cards, netbanking or wallets.
                Your items are set aside for 30 minutes while you pay.
              </p>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex gap-3">
                <Button variant="ghost" disabled={placing} onClick={() => setStep(1)}>Back</Button>
                <Button size="lg" loading={placing} onClick={place}>
                  {!placing && <Lock className="size-4" aria-hidden />} Place order and pay {formatPrice(quote.total)}
                </Button>
              </div>
            </Card>
          )}
        </div>

        <aside aria-label="Order summary">
          <Card className="sticky top-24 flex flex-col gap-3 p-5">
            <h2 className="font-semibold">Summary</h2>
            <Row label={`Items (${cart?.itemCount ?? 0})`} value={formatPrice(quote?.subtotal ?? cart?.subtotal ?? 0)} />
            {quote && quote.discount > 0 && <Row label={`Coupon ${quote.couponCode}`} value={`−${formatPrice(quote.discount)}`} tone="text-success" />}
            <Row label="Delivery" value={quote ? (quote.shippingFee === 0 ? "Free" : formatPrice(quote.shippingFee)) : "…"} />
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-semibold tabular-nums">{quote ? formatPrice(quote.total) : "…"}</span>
            </div>
            <p className="text-xs text-muted">Prices include GST.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className={cn("tabular-nums", tone)}>{value}</span>
    </div>
  );
}

function CouponBox({ applied, onApply, onRemove }: { applied: string | null; onApply: (code: string) => Promise<void>; onRemove: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (applied) {
    return (
      <p className="flex items-center justify-between rounded-xl border border-success/40 bg-success-soft px-4 py-3 text-sm">
        <span className="flex items-center gap-2 text-success"><Tag className="size-4" aria-hidden /> Coupon <strong>{applied}</strong> applied</span>
        <button type="button" onClick={onRemove} className="font-medium text-muted hover:text-fg">Remove</button>
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await onApply(code.trim().toUpperCase());
          setCode("");
        } catch (err) {
          setError(err instanceof ApiRequestError ? (err.fields.couponCode ?? err.message) : errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="coupon" className="text-sm font-medium">Coupon code</label>
      <div className="flex gap-2">
        <input id="coupon" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WELCOME10" aria-invalid={error ? true : undefined} aria-describedby={error ? "coupon-msg" : undefined} className={cn(inputStyles, "h-10 uppercase placeholder:normal-case")} />
        <Button type="submit" variant="secondary" loading={busy}>Apply</Button>
      </div>
      {error && <span id="coupon-msg" className="text-sm text-danger">{error}</span>}
    </form>
  );
}
