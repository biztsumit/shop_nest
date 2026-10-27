"use client";

// The shopping cart, for every Client Component: const cart = useCart()
//
// - Logged in: the cart lives on the server (/api/cart). Every change sends one request and
//   shows the cart the API answers with (today's prices, stock problems included).
// - Guest: the cart lives in this browser (localStorage), with a snapshot of each line so the
//   drawer can show it. When the guest logs in, it's MERGED into their account's cart.
import {
  cartSchema,
  MAX_CART_LINES,
  MAX_QUANTITY,
  type Cart,
  type CartLine,
  type ProductDetail,
  type ProductVariant,
} from "@shop/shared";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiRequestError } from "@/lib/client-api";
import { useAuth } from "./auth-provider";

const STORAGE_KEY = "guest-cart";

type GuestLine = Omit<CartLine, "lineTotal" | "problem">;

const readGuest = (): GuestLine[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as GuestLine[]) : [];
  } catch {
    return [];
  }
};

const writeGuest = (lines: GuestLine[]) => {
  try {
    if (lines.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Storage blocked (private mode): the cart still works until the page closes
  }
};

// A guest cart in the same shape as the server's, so the drawer shows both the same way.
// Prices and stock are as they were when added; the server checks them at login.
const guestCart = (lines: GuestLine[]): Cart => ({
  lines: lines.map((l) => ({ ...l, lineTotal: l.unitPrice * l.quantity, problem: null })),
  itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
  subtotal: lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
  canCheckout: lines.length > 0,
});

// A friendly error for the guest cart's own limits (the server enforces the same ones)
const limitError = (detail: string) => new ApiRequestError(409, { type: "about:blank", title: "Conflict", status: 409, detail, instance: "", requestId: "" });

type CartContextValue = {
  cart: Cart | null;   // null while loading
  isOpen: boolean;
  open: () => void;
  close: () => void;
  add: (product: ProductDetail, variant: ProductVariant, quantity?: number) => Promise<void>;
  setQuantity: (variantId: string, quantity: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  reload: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [cart, setCart] = useState<Cart | null>(null);
  const [isOpen, setOpen] = useState(false);

  const fromServer = (body: unknown) => setCart(cartSchema.parse(body));

  // Who's shopping decides where the cart is. On login, the guest cart joins the account's.
  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    void (async () => {
      if (status === "guest") {
        setCart(guestCart(readGuest()));
        return;
      }
      const guest = readGuest();
      const body = guest.length > 0
        ? await api("/cart/merge", { method: "POST", body: { items: guest.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) } })
        : await api("/cart");
      if (guest.length > 0) writeGuest([]);
      if (!cancelled) fromServer(body);
    })().catch(() => !cancelled && setCart({ lines: [], itemCount: 0, subtotal: 0, canCheckout: false }));
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Another tab changed the guest cart: show the same here
  useEffect(() => {
    if (status !== "guest") return;
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && setCart(guestCart(readGuest()));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [status]);

  const changeGuest = useCallback((change: (lines: GuestLine[]) => GuestLine[]) => {
    const next = change(readGuest());
    writeGuest(next);
    setCart(guestCart(next));
  }, []);

  const add = useCallback(async (product: ProductDetail, variant: ProductVariant, quantity = 1) => {
    if (status === "signed-in") {
      fromServer(await api("/cart/items", { method: "POST", body: { variantId: variant.id, quantity } }));
      return;
    }
    const lines = readGuest();
    const existing = lines.find((l) => l.variantId === variant.id);
    const wanted = (existing?.quantity ?? 0) + quantity;
    if (variant.stock === 0) throw limitError("Sorry, this is sold out.");
    if (wanted > variant.stock) throw limitError(`Sorry, only ${variant.stock} left in stock.`);
    if (wanted > MAX_QUANTITY) throw limitError(`You can have at most ${MAX_QUANTITY} of one item in your cart.`);
    if (!existing && lines.length >= MAX_CART_LINES) throw limitError("Your cart is full. Remove something first.");
    changeGuest((all) => existing
      ? all.map((l) => (l.variantId === variant.id ? { ...l, quantity: wanted } : l))
      : [...all, {
          variantId: variant.id,
          productId: product.id,
          slug: product.slug,
          name: product.name,
          options: variant.options,
          sku: variant.sku,
          image: product.images[0] ?? null,
          unitPrice: variant.price,
          compareAtPrice: variant.compareAtPrice,
          quantity,
          available: variant.stock,
        }]);
  }, [status, changeGuest]);

  const setQuantity = useCallback(async (variantId: string, quantity: number) => {
    if (status === "signed-in") {
      fromServer(await api(`/cart/items/${variantId}`, { method: "PUT", body: { quantity } }));
      return;
    }
    const line = readGuest().find((l) => l.variantId === variantId);
    if (line && quantity > Math.min(line.available, MAX_QUANTITY)) {
      throw limitError(quantity > MAX_QUANTITY ? `At most ${MAX_QUANTITY} of one item.` : `Sorry, only ${line.available} left in stock.`);
    }
    changeGuest((all) => (quantity === 0 ? all.filter((l) => l.variantId !== variantId) : all.map((l) => (l.variantId === variantId ? { ...l, quantity } : l))));
  }, [status, changeGuest]);

  const remove = useCallback((variantId: string) => setQuantity(variantId, 0), [setQuantity]);

  const reload = useCallback(async () => {
    if (status === "signed-in") fromServer(await api("/cart"));
    else if (status === "guest") setCart(guestCart(readGuest()));
  }, [status]);

  const value = useMemo(
    () => ({ cart, isOpen, open: () => setOpen(true), close: () => setOpen(false), add, setQuantity, remove, reload }),
    [cart, isOpen, add, setQuantity, remove, reload],
  );
  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartContextValue {
  const value = use(CartContext);
  if (!value) throw new Error("useCart must be used inside <CartProvider>");
  return value;
}
