"use client";

import { LayoutDashboard, MessageSquare, Package, ShieldAlert, ShoppingCart, Tag } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", Icon: ShoppingCart },
  { href: "/admin/products", label: "Products", Icon: Package },
  { href: "/admin/coupons", label: "Coupons", Icon: Tag },
  { href: "/admin/reviews", label: "Reviews", Icon: MessageSquare },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const path = usePathname();

  if (user?.role !== "ADMIN") {
    return (
      <EmptyState icon={ShieldAlert} title="Admins only" text="This part of the shop is for the people who run it.">
        <Link href="/" className={buttonStyles()}>Back to the shop</Link>
      </EmptyState>
    );
  }

  // The longest matching link is the current one ("/admin/orders/SN1" → Orders, not Dashboard)
  const current = LINKS.filter((l) => path === l.href || path.startsWith(`${l.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <div className="grid gap-8 md:grid-cols-[12rem_1fr]">
      <nav aria-label="Admin" className="flex gap-1 overflow-x-auto md:flex-col">
        <p className="hidden px-3 pb-2 text-xs font-semibold tracking-wider text-muted uppercase md:block">Back office</p>
        {LINKS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={current?.href === href ? "page" : undefined}
            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap", current?.href === href ? "bg-brand-soft font-medium text-brand-text" : "text-muted hover:bg-subtle hover:text-fg")}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// The title row every admin page starts with
export function AdminHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
