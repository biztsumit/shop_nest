"use client";

import { Heart } from "lucide-react";
import { errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { useToast } from "./ui/toast";
import { useWishlist } from "./wishlist-provider";

// The heart: a toggle button (aria-pressed says whether it's on)
export function WishlistButton({ productId, name, className, withLabel = false }: { productId: string; name: string; className?: string; withLabel?: boolean }) {
  const wishlist = useWishlist();
  const toast = useToast();
  const saved = wishlist.has(productId);

  const click = async () => {
    try {
      const now = await wishlist.toggle(productId);
      toast.show(now ? "Saved to your wishlist" : "Removed from your wishlist");
    } catch (err) {
      toast.show(errorMessage(err), "error");
    }
  };

  return (
    <button
      type="button"
      onClick={click}
      aria-pressed={saved}
      aria-label={withLabel ? undefined : `Save ${name} to wishlist`}
      className={cn(
        "flex items-center justify-center gap-2 rounded-full border border-line bg-surface/90 text-sm font-medium backdrop-blur transition hover:border-line-strong",
        withLabel ? "h-12 px-5" : "size-9",
        className,
      )}
    >
      <Heart className={cn("size-4.5", saved ? "fill-danger text-danger" : "text-muted")} aria-hidden />
      {withLabel && (saved ? "Saved" : "Save to wishlist")}
    </button>
  );
}
