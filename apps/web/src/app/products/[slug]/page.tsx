import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Stars } from "@/components/ui/stars";
import { getProduct, getReviews } from "@/lib/catalog";
import { plural } from "@/lib/format";
import { Gallery } from "./gallery";
import { PurchasePanel } from "./purchase-panel";
import { ReviewsSection } from "./reviews-section";

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  return product ? { title: product.name, description: product.description.slice(0, 160) } : { title: "Not found" };
}

export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductView params={params} />
    </Suspense>
  );
}

async function ProductView({ params }: Pick<PageProps<"/products/[slug]">, "params">) {
  const { slug } = await params;
  const [product, reviews] = await Promise.all([getProduct(slug), getReviews(slug)]);
  if (!product) notFound();

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link href="/" className="hover:text-fg">Home</Link> <span aria-hidden>/</span>{" "}
          <Link href="/products" className="hover:text-fg">Shop all</Link>
          {product.category && (
            <>
              {" "}<span aria-hidden>/</span>{" "}
              <Link href={`/products?category=${product.category.slug}`} className="hover:text-fg">{product.category.name}</Link>
            </>
          )}
        </nav>

        <div className="grid gap-8 md:grid-cols-2 md:gap-12">
          <Gallery images={product.images} name={product.name} />

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
              {product.rating.count > 0 ? (
                <a href="#reviews" className="flex w-fit items-center gap-2 text-sm text-muted hover:text-fg">
                  <Stars rating={product.rating.average ?? 0} />
                  <span>{product.rating.average?.toFixed(1)} · {plural(product.rating.count, "review")}</span>
                </a>
              ) : (
                <a href="#reviews" className="w-fit text-sm text-muted hover:text-fg">No reviews yet</a>
              )}
            </div>

            <PurchasePanel product={product} />

            {product.description && (
              <section className="flex flex-col gap-2 border-t border-line pt-5">
                <h2 className="font-semibold">About this product</h2>
                <p className="leading-relaxed whitespace-pre-line text-muted">{product.description}</p>
              </section>
            )}
          </div>
        </div>
      </div>

      <ReviewsSection slug={product.slug} rating={product.rating} firstPage={reviews} />
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="grid gap-8 md:grid-cols-2 md:gap-12" aria-busy>
      <div className="aspect-square animate-pulse rounded-2xl bg-subtle" />
      <div className="flex flex-col gap-4">
        <div className="h-9 w-3/4 animate-pulse rounded-lg bg-subtle" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-subtle" />
        <div className="h-8 w-1/4 animate-pulse rounded bg-subtle" />
        <div className="h-24 animate-pulse rounded-lg bg-subtle" />
      </div>
    </div>
  );
}
