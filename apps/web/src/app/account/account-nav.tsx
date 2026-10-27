"use client";

import { Package, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/account/orders", label: "Orders", Icon: Package },
  { href: "/account", label: "Account", Icon: User },
];

export function AccountNav() {
  const path = usePathname();
  // The longest matching link is the current one ("/account/orders/SN1" → Orders, not Account)
  const current = LINKS.filter((l) => path === l.href || path.startsWith(`${l.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label="Account" className="flex gap-1 overflow-x-auto md:flex-col">
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
  );
}
