import { z } from "zod";
import { productStatusSchema, slugSchema, variantOptionsSchema } from "./catalog.js";
import { paiseSchema } from "./money.js";
import { orderSchema, orderStatusSchema, orderSummarySchema } from "./orders.js";
import { refundSchema } from "./payments.js";
import { reviewSchema } from "./reviews.js";

// What admins send and get back. Update schemas are built from fields WITHOUT defaults:
// zod's .partial() keeps .default(), which would quietly reset every field not sent.

// ---------- Products ----------

const imageInput = z.object({ url: z.url({ protocol: /^https?$/ }), alt: z.string().trim().max(300).default("") });

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, "is required").max(200),
    slug: slugSchema,
    description: z.string().trim().max(10_000),
    status: productStatusSchema,
    categoryId: z.uuid().nullable(),
    // The whole list, in order (the first is the main photo): replaces what's there
    images: z.array(imageInput).max(20),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "send at least one field to change");

export const updateVariantSchema = z
  .object({
    options: variantOptionsSchema,
    sku: z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/, "letters, digits, . _ - (up to 64)").nullable(),
    price: paiseSchema,
    compareAtPrice: paiseSchema.nullable(),
    stock: z.number().int().min(0, "can't be negative"),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "send at least one field to change");

export const adminProductListQuerySchema = z.object({
  search: z.string().trim().max(100).optional().transform((s) => s || undefined),
  status: productStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

// One row in the admin product table
export const adminProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: productStatusSchema,
  category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  price: z.number().int(),   // the cheapest variant
  stock: z.number().int(),   // all variants together
  variantCount: z.number().int(),
  imageUrl: z.string().nullable(),
  updatedAt: z.string(),
});

export const adminVariantSchema = z.object({
  id: z.uuid(),
  options: z.record(z.string(), z.string()),
  sku: z.string().nullable(),
  price: z.number().int(),
  compareAtPrice: z.number().int().nullable(),
  stock: z.number().int(),
});

// The product editor
export const adminProductDetailSchema = adminProductSchema.omit({ category: true, imageUrl: true }).extend({
  description: z.string(),
  categoryId: z.uuid().nullable(),
  images: z.array(z.object({ url: z.string(), alt: z.string() })),
  variants: z.array(adminVariantSchema),
});

// ---------- Orders ----------

export const adminOrderListQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  // An order number ("SN000123") or part of the customer's email
  search: z.string().trim().max(100).optional().transform((s) => s || undefined),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

const customerSchema = z.object({ id: z.uuid(), name: z.string(), email: z.string() });

export const adminOrderSummarySchema = orderSummarySchema.extend({ customer: customerSchema });

export const adminOrderSchema = orderSchema.extend({
  customer: customerSchema,
  payment: z
    .object({
      status: z.string(),
      method: z.string().nullable(),
      amount: z.number().int(),
      refundedAmount: z.number().int(),
      providerPaymentId: z.string().nullable(),
    })
    .nullable(),
  refunds: z.array(refundSchema),
});

// ---------- Reviews ----------

export const moderateReviewSchema = z.object({ hidden: z.boolean() });

// A review as moderators see it: hidden ones too, and which product it is about
export const adminReviewSchema = reviewSchema.extend({ hidden: z.boolean(), product: z.object({ name: z.string(), slug: z.string() }) });

export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type UpdateVariant = z.infer<typeof updateVariantSchema>;
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;
export type AdminProduct = z.infer<typeof adminProductSchema>;
export type AdminVariant = z.infer<typeof adminVariantSchema>;
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
export type AdminOrderSummary = z.infer<typeof adminOrderSummarySchema>;
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export type ModerateReview = z.infer<typeof moderateReviewSchema>;
export type AdminReview = z.infer<typeof adminReviewSchema>;
