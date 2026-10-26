import { z } from "zod";
import { paiseSchema } from "./money.js";
import { ratingSummarySchema } from "./reviews.js";

// The catalog's input rules. The SAME rules as the database's CHECK constraints
// (apps/api/prisma/migrations/*_catalog), so bad input is stopped with a clear message in the
// form or at the API, long before the database would refuse it.

// "t-shirts", "classic-tee-2": lowercase words joined by single hyphens
export const slugSchema = z
  .string()
  .trim()
  .min(1, "is required")
  .max(120, "must be at most 120 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, digits and single hyphens (e.g. classic-tee)");

// "Classic Tee!" → "classic-tee" (accents and symbols dropped)
export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

export const productStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
export type ProductStatus = z.infer<typeof productStatusSchema>;

// {"size": "M", "colour": "Black"}: at most 3 options, short names and values
export const variantOptionsSchema = z
  .record(
    z.string().trim().min(1, "option names can't be empty").max(30),
    z.string().trim().min(1, "option values can't be empty").max(50),
  )
  .refine((options) => Object.keys(options).length <= 3, "a variant can have at most 3 options");

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "is required").max(100),
  slug: slugSchema,
  description: z.string().trim().max(2000).default(""),
  parentId: z.uuid().nullable().default(null),
});

export const createVariantSchema = z
  .object({
    options: variantOptionsSchema.default({}),
    sku: z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/, "letters, digits, . _ - (up to 64)").nullable().default(null),
    price: paiseSchema,
    compareAtPrice: paiseSchema.nullable().default(null),
    stock: z.number().int().min(0, "can't be negative").default(0),
  })
  // A rule about TWO fields: checked on the whole object, reported on the field to fix
  .refine((v) => v.compareAtPrice === null || v.compareAtPrice > v.price, {
    message: "the 'was' price must be higher than the price",
    path: ["compareAtPrice"],
  });

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "is required").max(200),
  slug: slugSchema,
  description: z.string().trim().max(10_000).default(""),
  status: productStatusSchema.default("DRAFT"),
  categoryId: z.uuid().nullable().default(null),
  // Every product needs at least one variant: it's what is actually bought
  variants: z.array(createVariantSchema).min(1, "add at least one variant").max(100),
  images: z
    .array(z.object({ url: z.url({ protocol: /^https?$/ }), alt: z.string().trim().max(300).default("") }))
    .max(20)
    .default([]),
});

export type CreateCategory = z.infer<typeof createCategorySchema>;
export type CreateVariant = z.infer<typeof createVariantSchema>;
export type CreateProduct = z.infer<typeof createProductSchema>;

// ---------- What the public catalog endpoints return ----------

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  parentId: z.uuid().nullable(),
  productCount: z.number().int(),   // ACTIVE products in this category and all categories below it
});

const imageSchema = z.object({ url: z.string(), alt: z.string() });

// One card in a product list
export const productSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  category: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }).nullable(),
  price: z.number().int(),                    // paise: the cheapest variant
  compareAtPrice: z.number().int().nullable(), // the cheapest variant's "was" price, if on sale
  inStock: z.boolean(),
  variantCount: z.number().int(),
  image: imageSchema.nullable(),              // the main picture
});

export const productVariantSchema = z.object({
  id: z.uuid(),
  sku: z.string().nullable(),
  options: z.record(z.string(), z.string()),
  price: z.number().int(),
  compareAtPrice: z.number().int().nullable(),
  stock: z.number().int(),
});

// The product page
export const productDetailSchema = productSummarySchema.omit({ image: true }).extend({
  description: z.string(),
  images: z.array(imageSchema),
  variants: z.array(productVariantSchema),
  rating: ratingSummarySchema,
});

// A page of results, and the cursor to ask for the next one (null = this was the last page)
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });

export type Category = z.infer<typeof categorySchema>;
export type ProductSummary = z.infer<typeof productSummarySchema>;
export type ProductVariant = z.infer<typeof productVariantSchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;
export type Page<T> = { data: T[]; nextCursor: string | null };

// ---------- GET /api/products query string ----------

export const productSortSchema = z.enum(["newest", "price_asc", "price_desc", "name_asc"]);
export type ProductSort = z.infer<typeof productSortSchema>;

// Everything in a query string is text: z.coerce turns "49900" into 49900
const optionalPaise = z.coerce.number().int("must be a whole number of paise").min(0).optional();

export const productListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional().transform((s) => s || undefined),
    category: slugSchema.optional(),                  // includes its sub-categories
    minPrice: optionalPaise,
    maxPrice: optionalPaise,
    // NOT z.coerce.boolean(): that turns the text "false" into true
    inStock: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    sort: productSortSchema.default("newest"),
    limit: z.coerce.number().int().min(1).max(48).default(24),
    cursor: z.string().max(300).optional(),           // from the previous page's nextCursor
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: "can't be more than maxPrice",
    path: ["minPrice"],
  });

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
