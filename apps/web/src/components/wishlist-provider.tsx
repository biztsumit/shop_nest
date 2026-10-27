"use client";

// Which products the shopper has saved (the hearts), for every Client Component.
// Only the ids are loaded: enough to fill in the hearts on any page of product cards.
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/client-api";
import { useAuth } from "./auth-provider";

type WishlistContextValue = {
  has: (productId: string) => boolean;
  toggle: (productId: string) => Promise<boolean>;   // resolves with "now saved?"
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status !== "signed-in") return;
    let cancelled = false;
    void api<string[]>("/wishlist/ids").then((list) => !cancelled && setIds(new Set(list)));
    return () => {
      cancelled = true;
      setIds(new Set());   // logging out empties the hearts
    };
  }, [status]);

  const toggle = useCallback(async (productId: string) => {
    if (status !== "signed-in") {
      // Saving needs an account: log in, then come back to this page
      router.push(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return false;
    }
    const saved = ids.has(productId);
    // Show the change at once ("optimistic"), and undo it if the API says no
    const flip = (on: boolean) => setIds((current) => {
      const next = new Set(current);
      if (on) next.add(productId); else next.delete(productId);
      return next;
    });
    flip(!saved);
    try {
      await api(`/wishlist/${productId}`, { method: saved ? "DELETE" : "PUT" });
      return !saved;
    } catch (err) {
      flip(saved);
      throw err;
    }
  }, [status, ids, router]);

  const value = useMemo(() => ({ has: (id: string) => ids.has(id), toggle }), [ids, toggle]);
  return <WishlistContext value={value}>{children}</WishlistContext>;
}

export function useWishlist(): WishlistContextValue {
  const value = use(WishlistContext);
  if (!value) throw new Error("useWishlist must be used inside <WishlistProvider>");
  return value;
}
