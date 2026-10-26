"use client";

import type { ProductDetail, ProductVariant } from "@shop/shared";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

// Placeholder until the cart arrives (step 6.3)
export function AddToCart({ variant }: { product: ProductDetail; variant: ProductVariant | undefined }) {
  const toast = useToast();
  return (
    <Button size="lg" disabled={!variant || variant.stock === 0} onClick={() => toast.show("The cart arrives in the next step")}>
      <ShoppingBag className="size-5" aria-hidden /> Add to cart
    </Button>
  );
}
