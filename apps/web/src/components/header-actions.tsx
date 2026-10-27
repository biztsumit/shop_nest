"use client";

import { ChevronDown, LogOut, Package, ShoppingBag, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import { useCart } from "./cart-provider";
import { ThemeSwitch } from "./theme-switch";

// The right side of the header: theme, account, cart
export function HeaderActions() {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <ThemeSwitch className="hidden lg:inline-flex" />
      <AccountMenu />
      <CartButton />
    </div>
  );
}

function CartButton() {
  const { cart, open } = useCart();
  const count = cart?.itemCount ?? 0;
  return (
    <button type="button" onClick={open} aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`} className="relative flex size-10 items-center justify-center rounded-lg hover:bg-subtle">
      <ShoppingBag className="size-5" aria-hidden />
      {count > 0 && (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-semibold text-brand-fg tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

function AccountMenu() {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // A click anywhere else, or Esc, closes the menu
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "loading") return <span className="size-10" aria-hidden />;
  if (status === "guest") {
    return (
      <Link href="/login" className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-subtle">
        <User className="size-5" aria-hidden /> <span className="hidden sm:inline">Log in</span>
      </Link>
    );
  }

  const first = user.name.split(/\s+/)[0];
  const item = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-subtle";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium hover:bg-subtle sm:px-3">
        <User className="size-5" aria-hidden /> <span className="hidden max-w-24 truncate sm:inline">{first}</span>
        <ChevronDown className="size-4 text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 flex w-56 flex-col rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          <p className="truncate px-3 py-2 text-xs text-muted">{user.email}</p>
          <Link role="menuitem" href="/account/orders" onClick={() => setOpen(false)} className={item}><Package className="size-4" aria-hidden /> My orders</Link>
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)} className={item}><User className="size-4" aria-hidden /> Account</Link>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              setOpen(false);
              await logout();
              router.push("/");
            }}
            className={`${item} text-left`}
          >
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
