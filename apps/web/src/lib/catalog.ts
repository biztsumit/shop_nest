// Reading the public catalog ON THE SERVER (Server Components call these).
//
// 'use cache' keeps each result, so pages don't ask the API on every visit, and cacheLife says
// for how long. The arguments are part of the cache key: "?search=mug" and "?search=lamp" are
// cached separately. Every answer is checked with the SAME zod schema the API uses
// (@shop/shared): if the two apps ever disagree about a shape, it fails loudly here.
import {
  categorySchema,
  pageSchema,
  productDetailSchema,
  productSummarySchema,
  reviewSchema,
  type Category,
  type Page,
  type ProductDetail,
  type ProductSummary,
  type Review,
} from "@shop/shared";
import { cacheLife, cacheTag } from "next/cache";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const getJson = async <T>(path: string, schema: { parse: (value: unknown) => T }): Promise<T | null> => {
  const res = await fetch(`${API_URL}/api${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} answered ${res.status}`);
  return schema.parse(await res.json());
};

export type ProductQuery = {
  search?: string;
  category?: string;    // a category slug
  sort?: string;
  minPrice?: number;    // paise
  maxPrice?: number;
  inStock?: boolean;
  cursor?: string;
  limit?: number;
};

export const getProducts = async (query: ProductQuery): Promise<Page<ProductSummary>> => {
  "use cache";
  cacheLife("minutes");
  cacheTag("products");

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  return (await getJson(`/products?${params}`, pageSchema(productSummarySchema))) ?? { data: [], nextCursor: null };
};

export const getProduct = async (slug: string): Promise<ProductDetail | null> => {
  "use cache";
  cacheLife("minutes");
  cacheTag("products", `product:${slug}`);
  return getJson(`/products/${encodeURIComponent(slug)}`, productDetailSchema);
};

export const getCategories = async (): Promise<Category[]> => {
  "use cache";
  cacheLife("hours");
  cacheTag("categories");
  return (await getJson("/categories", categorySchema.array())) ?? [];
};

// The first page of a product's reviews (more are loaded in the browser)
export const getReviews = async (slug: string): Promise<Page<Review>> => {
  "use cache";
  cacheLife("minutes");
  cacheTag(`reviews:${slug}`);
  return (await getJson(`/products/${encodeURIComponent(slug)}/reviews?limit=5`, pageSchema(reviewSchema))) ?? { data: [], nextCursor: null };
};
