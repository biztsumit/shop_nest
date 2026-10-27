"use client";

import { productSummarySchema, type ProductSummary } from "@shop/shared";
import { Heart } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
// ProductCard uses nothing server-only, so this client page can render it too
import { ProductCard, ProductGrid } from "@/components/product-card";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useWishlist } from "@/components/wishlist-provider";
import { api } from "@/lib/client-api";

export default function WishlistPage() {
  const wishlist = useWishlist();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api("/wishlist").then((body) => !cancelled && setProducts(productSummarySchema.array().parse(body)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Un-hearting a product here removes it from the page at once
  const shown = products?.filter((p) => wishlist.has(p.id)) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Wishlist</h1>
      {shown === null ? (
        <div className="h-64 animate-pulse rounded-xl bg-subtle" />
      ) : shown.length === 0 ? (
        <EmptyState icon={Heart} title="Nothing saved yet" text="Tap the heart on anything you like, and it waits for you here.">
          <Link href="/products" className={buttonStyles()}>Browse the shop</Link>
        </EmptyState>
      ) : (
        <ProductGrid narrow>
          {shown.map((product) => <ProductCard key={product.id} product={product} />)}
        </ProductGrid>
      )}
    </div>
  );
}
