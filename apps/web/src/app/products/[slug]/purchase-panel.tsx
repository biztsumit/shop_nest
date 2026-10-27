"use client";

import type { ProductDetail } from "@shop/shared";
import { Check, Truck } from "lucide-react";
import { useState } from "react";
import { Price } from "@/components/ui/price";
import { WishlistButton } from "@/components/wishlist-button";
import { cn } from "@/lib/cn";
import { AddToCart } from "./add-to-cart";
import { choose, findVariant, initialChoice, isAvailable, optionNames, valuesOf } from "./variant-options";

// "Only 3 left" is honest urgency: shown only when it's true
const LOW_STOCK = 5;

// Price, option pickers, stock and the add-to-cart button: everything that changes when the
// shopper picks a size or colour
export function PurchasePanel({ product }: { product: ProductDetail }) {
  const [chosen, setChosen] = useState(() => initialChoice(product.variants));
  const variant = findVariant(product.variants, chosen);
  const names = optionNames(product.variants);

  return (
    <div className="flex flex-col gap-5">
      <Price amount={variant?.price ?? product.price} compareAt={variant?.compareAtPrice ?? product.compareAtPrice} size="lg" />

      {names.map((name) => (
        <fieldset key={name} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm">
            <span className="font-medium capitalize">{name}</span>
            {chosen[name] && <span className="text-muted">: {chosen[name]}</span>}
          </legend>
          <div className="flex flex-wrap gap-2">
            {valuesOf(product.variants, name).map((value) => {
              const selected = chosen[name] === value;
              const available = isAvailable(product.variants, chosen, name, value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChosen(choose(product.variants, chosen, name, value))}
                  aria-pressed={selected}
                  aria-label={available ? value : `${value} (out of stock)`}
                  className={cn(
                    "min-w-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    selected ? "border-brand bg-brand-soft text-brand-text" : "border-line-strong hover:border-fg",
                    !available && "text-faint line-through decoration-1",
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <p className="text-sm" aria-live="polite">
        {!variant ? (
          <span className="text-muted">This combination isn&apos;t available.</span>
        ) : variant.stock === 0 ? (
          <span className="font-medium text-danger">Out of stock</span>
        ) : variant.stock <= LOW_STOCK ? (
          <span className="font-medium text-warning">Only {variant.stock} left</span>
        ) : (
          <span className="flex items-center gap-1.5 text-success"><Check className="size-4" aria-hidden /> In stock</span>
        )}
      </p>

      <div className="flex gap-3">
        <div className="flex-1"><AddToCart product={product} variant={variant} /></div>
        <WishlistButton productId={product.id} name={product.name} withLabel />
      </div>

      <p className="flex items-center gap-2 text-sm text-muted">
        <Truck className="size-4" aria-hidden /> Free delivery across India on orders from ₹999
      </p>
    </div>
  );
}
