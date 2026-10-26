import Link from "next/link";
import { site } from "@/lib/site";
import { ThemeSwitch } from "./theme-switch";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-fg">{site.name}</span>
          <span>{site.tagline}.</span>
          <span>Free delivery across India on orders from ₹999.</span>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-2">
          <Link href="/products" className="hover:text-fg">Shop all</Link>
          <Link href="/styleguide" className="hover:text-fg">Style guide</Link>
        </nav>
        <div className="flex flex-col gap-2">
          <span>Theme</span>
          <ThemeSwitch />
        </div>
      </div>
    </footer>
  );
}
