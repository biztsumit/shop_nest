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
  productFacetsSchema,
  productSummarySchema,
  reviewSchema,
  type Category,
  type Page,
  type ProductDetail,
  type ProductFacets,
  type ProductSummary,
  type Review,
} from "@shop/shared";
import { cacheLife, cacheTag } from "next/cache";
import { apiUrl } from "./api-url";

const API_URL = apiUrl();

// On a host that puts idle services to sleep (Render's free plan), the API takes up to a
// minute to wake, and its proxy answers 502/503/504 meanwhile. So keep asking, a few seconds
// apart, for up to ~90 s: the first visitor waits longer, instead of getting an error page.
const WAKE_STATUSES = new Set([502, 503, 504]);
const WAKE_DEADLINE_MS = 90_000;
const WAKE_RETRY_MS = 3_000;

const fetchWaking = async (url: string): Promise<Response> => {
  const deadline = Date.now() + WAKE_DEADLINE_MS;
  for (;;) {
    try {
      const res = await fetch(url);
      if (!WAKE_STATUSES.has(res.status) || Date.now() > deadline) return res;
    } catch (err) {
      // Not reachable at all (e.g. the API restarting): retry too, then give up
      if (Date.now() > deadline) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_MS));
  }
};

const getJson = async <T>(path: string, schema: { parse: (value: unknown) => T }): Promise<T | null> => {
  const res = await fetchWaking(`${API_URL}/api${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} answered ${res.status}`);
  return schema.parse(await res.json());
};

export type ProductFilterQuery = {
  search?: string;
  category?: string;    // a category slug
  minPrice?: number;    // paise
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
  minRating?: number;   // 1-5 stars
  colour?: string;      // "Black,Navy": any of them
  size?: string;
};

export type ProductQuery = ProductFilterQuery & { sort?: string; cursor?: string; limit?: number };

// { search: "tee", inStock: false } → "search=tee" (empty and false values are left out)
const toParams = (query: ProductQuery): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
  }
  return params;
};

export const getProducts = async (query: ProductQuery): Promise<Page<ProductSummary>> => {
  "use cache";
  cacheLife("minutes");
  cacheTag("products");
  return (await getJson(`/products?${toParams(query)}`, pageSchema(productSummarySchema))) ?? { data: [], nextCursor: null };
};

// The colour and size choices (with counts) for these filters
export const getFacets = async (query: ProductFilterQuery): Promise<ProductFacets> => {
  "use cache";
  cacheLife("minutes");
  cacheTag("products");
  return (await getJson(`/products/facets?${toParams(query)}`, productFacetsSchema)) ?? { colours: [], sizes: [] };
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
