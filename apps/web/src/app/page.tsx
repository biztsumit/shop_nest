import { ArrowRight, BadgePercent, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductCard, ProductGrid, ProductGridSkeleton } from "@/components/product-card";
import { buttonStyles } from "@/components/ui/button";
import { getCategories, getProducts } from "@/lib/catalog";
import { site } from "@/lib/site";

// The home page. The hero is static (prerendered at build time); the categories and the
// newest products come from the API and stream in, each inside its own <Suspense>.
export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="relative overflow-hidden rounded-3xl bg-brand px-6 py-14 text-brand-fg sm:px-12 sm:py-20">
        <div className="relative flex max-w-xl flex-col gap-5">
          <p className="text-sm font-medium tracking-wider uppercase opacity-80">New season</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{site.tagline}.</h1>
          <p className="text-lg opacity-90">Clothing, home and kitchen goods, chosen to last. Free delivery from ₹999.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/products" className={buttonStyles({ variant: "inverse", size: "lg" })}>
              Shop all <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <p className="flex items-center gap-2 text-sm opacity-90">
            <BadgePercent className="size-4" aria-hidden /> 10% off your first order with code <strong>WELCOME10</strong>
          </p>
        </div>
        {/* Decoration only */}
        <div aria-hidden className="absolute -top-24 -right-24 size-96 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -right-10 -bottom-32 size-72 rounded-full bg-white/10" />
      </section>

      <ul className="grid gap-4 sm:grid-cols-3">
        {[
          { Icon: Truck, title: "Free delivery from ₹999", text: "Across India, usually in 3–5 days" },
          { Icon: RotateCcw, title: "Easy returns", text: "Changed your mind? Tell us within 7 days" },
          { Icon: ShieldCheck, title: "Secure payment", text: "UPI, cards and netbanking via Razorpay" },
        ].map(({ Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
            <Icon className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden />
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-5">
        <h2 className="text-2xl font-semibold tracking-tight">Shop by category</h2>
        <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-subtle" />}>
          <Categories />
        </Suspense>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">New arrivals</h2>
          <Link href="/products?sort=newest" className="text-sm font-medium text-brand-text hover:underline">See all</Link>
        </div>
        <Suspense fallback={<ProductGridSkeleton count={8} />}>
          <NewArrivals />
        </Suspense>
      </section>
    </div>
  );
}

// connection(): render at REQUEST time, not at build time (builds run without the API).
// The data is still cached by getCategories/getProducts ("use cache"), so this stays fast.
async function Categories() {
  await connection();
  const categories = (await getCategories()).filter((c) => c.parentId === null);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {categories.map((c) => (
        <li key={c.id}>
          <Link href={`/products?category=${c.slug}`} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-5 transition hover:border-brand hover:shadow-card">
            <span className="font-medium">{c.name}</span>
            <span className="text-sm text-muted">{c.productCount} products</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function NewArrivals() {
  await connection();
  const { data } = await getProducts({ sort: "newest", limit: 8 });
  return (
    <ProductGrid>
      {data.map((product) => <ProductCard key={product.id} product={product} />)}
    </ProductGrid>
  );
}
