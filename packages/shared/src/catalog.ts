import { z } from "zod";
import { paiseSchema } from "./money.js";

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
