"use client";

import type { ProductDetail, ProductVariant } from "@shop/shared";
import { ShoppingBag } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/components/cart-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/client-api";

export function AddToCart({ product, variant }: { product: ProductDetail; variant: ProductVariant | undefined }) {
  const cart = useCart();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!variant) return;
    setBusy(true);
    try {
      await cart.add(product, variant);
      cart.open();   // show what was added, and the way to checkout
    } catch (err) {
      toast.show(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const soldOut = !variant || variant.stock === 0;
  return (
    <Button size="lg" loading={busy} disabled={soldOut} onClick={add}>
      {!busy && <ShoppingBag className="size-5" aria-hidden />}
      {soldOut ? "Out of stock" : "Add to cart"}
    </Button>
  );
}
