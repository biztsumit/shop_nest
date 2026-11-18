"use client";

import { formatPrice, productSuggestionsSchema, type ProductSuggestions } from "@shop/shared";
import { ImageOff, LayoutGrid, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

type Option = { href: string; key: string };

// The header's search box. Still a plain GET form (works before JavaScript loads; Enter goes to
// /products?search=...), plus suggestions while typing: a few products and categories, typos
// forgiven ("hoddie" shows hoodies). Follows the ARIA "combobox" pattern: ↑/↓ move through the
// suggestions (the input keeps focus, a screen reader announces the highlighted one), Enter
// opens it, Escape closes the list.
export function SearchBox() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ProductSuggestions | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapper = useRef<HTMLDivElement>(null);

  // Asks for suggestions 150 ms after the last key press; a newer query cancels the older request
  const typed = query.trim();
  useEffect(() => {
    if (typed.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/suggest?q=${encodeURIComponent(typed)}`, { signal: controller.signal });
        if (!res.ok) return;
        setSuggestions(productSuggestionsSchema.parse(await res.json()));
        setActive(-1);
      } catch {
        // Aborted, offline, or an odd answer: no suggestions, and the form still works
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [typed]);

  const shown = typed.length >= 2 ? suggestions : null;
  const options: Option[] = shown
    ? [
        ...shown.products.map((p) => ({ key: `p-${p.slug}`, href: `/products/${p.slug}` })),
        ...shown.categories.map((c) => ({ key: `c-${c.slug}`, href: `/products?category=${c.slug}` })),
      ]
    : [];
  const expanded = open && shown !== null;
  const optionId = (i: number) => `${listId}-${i}`;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Wraps around, through "nothing highlighted" (-1) = back in the text
      setActive((i) => ((i + step + 1 + options.length + 1) % (options.length + 1)) - 1);
    } else if (e.key === "Enter" && expanded && active >= 0) {
      e.preventDefault();
      close();
      router.push(options[active]!.href);
    } else if (e.key === "Escape") {
      close();
    }
  };

  let index = -1;   // each option's position in `options`, counted while rendering
  return (
    <div
      ref={wrapper}
      className="relative ml-auto w-full max-w-xs"
      // Focus left the box and its list (a click elsewhere, Tab): close
      onBlur={(e) => !wrapper.current?.contains(e.relatedTarget as Node | null) && close()}
    >
      <form action="/products" role="search" onSubmit={close}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          type="search"
          name="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search products"
          aria-label="Search products"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          maxLength={100}
          className="h-10 w-full rounded-lg border border-line bg-subtle pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-brand focus:bg-surface focus:ring-3 focus:ring-brand/15"
        />
      </form>

      {expanded && (
        <div className="absolute inset-x-0 top-12 z-40 overflow-hidden rounded-xl border border-line bg-surface shadow-lg sm:-right-16">
          {shown.searchedFor && <p className="border-b border-line px-3 py-2 text-xs text-muted">Showing results for “{shown.searchedFor}”</p>}
          <ul id={listId} role="listbox" aria-label="Suggestions" className="max-h-[70dvh] overflow-y-auto py-1">
            {shown.products.map((p) => {
              const i = ++index;
              return (
                <li key={`p-${p.slug}`} id={optionId(i)} role="option" aria-selected={i === active}>
                  <Link
                    href={`/products/${p.slug}`}
                    tabIndex={-1}
                    onClick={close}
                    onMouseEnter={() => setActive(i)}
                    className={cn("flex items-center gap-3 px-3 py-2 text-sm", i === active && "bg-subtle")}
                  >
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-subtle">
                      {p.image ? <Image src={p.image.url} alt="" fill sizes="40px" className="object-cover" /> : <ImageOff className="m-auto mt-3 size-4 text-faint" aria-hidden />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.category && <span className="truncate text-xs text-muted">{p.category}</span>}
                    </span>
                    <span className="tabular-nums text-muted">{formatPrice(p.price)}</span>
                  </Link>
                </li>
              );
            })}
            {shown.categories.map((c) => {
              const i = ++index;
              return (
                <li key={`c-${c.slug}`} id={optionId(i)} role="option" aria-selected={i === active}>
                  <Link
                    href={`/products?category=${c.slug}`}
                    tabIndex={-1}
                    onClick={close}
                    onMouseEnter={() => setActive(i)}
                    className={cn("flex items-center gap-3 px-3 py-2 text-sm", i === active && "bg-subtle")}
                  >
                    <LayoutGrid className="size-4 text-muted" aria-hidden />
                    <span>All in <span className="font-medium">{c.name}</span></span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {options.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">No suggestions for “{typed}”.</p>
          ) : (
            <Link href={`/products?search=${encodeURIComponent(typed)}`} tabIndex={-1} onClick={close} className="block border-t border-line px-3 py-2 text-sm text-brand-text hover:bg-subtle">
              See all results for “{typed}”
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
