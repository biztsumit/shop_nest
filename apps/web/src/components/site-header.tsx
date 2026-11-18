import { Store } from "lucide-react";
import Link from "next/link";
import { site } from "@/lib/site";
import { HeaderActions } from "./header-actions";
import { SearchBox } from "./search-box";

// The bar on every page. The search box is a plain GET form: it works before any JavaScript
// has loaded, and the results page is a normal, shareable URL (/products?search=mug). Once
// JavaScript runs, it also suggests products as you type (search-box.tsx).
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-fg">
            <Store className="size-4.5" aria-hidden />
          </span>
          <span className="hidden sm:inline">{site.name}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
          <Link href="/products" className="rounded-lg px-3 py-2 text-muted hover:bg-subtle hover:text-fg">Shop all</Link>
        </nav>

        <SearchBox />

        <HeaderActions />
      </div>
    </header>
  );
}
