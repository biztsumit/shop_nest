import { z } from "zod";

// PUT /api/products/:slug/reviews/mine: one review per shopper per product, editable
export const writeReviewSchema = z.object({
  rating: z.number().int().min(1, "choose 1 to 5 stars").max(5, "choose 1 to 5 stars"),
  title: z.string().trim().min(1, "is required").max(120),
  body: z.string().trim().max(4000).default(""),
});

export const reviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  title: z.string(),
  body: z.string(),
  authorName: z.string(),          // "Riya S.": first name and initial, never the full name or email
  verifiedPurchase: z.boolean(),   // they bought it here (a paid order)
  createdAt: z.string(),
  updatedAt: z.string(),
});

// The stars on the product page: average (1 decimal), how many, and how many of each
export const ratingSummarySchema = z.object({
  average: z.number().nullable(),  // null = no reviews yet
  count: z.number().int(),
  // [5★ count, 4★, 3★, 2★, 1★]
  distribution: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
});

export const reviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.uuid().optional(),
});

// "Riya Sharma" → "Riya S.", "Riya" → "Riya"
export const publicName = (fullName: string): string => {
  const [first = "", ...rest] = fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first;
};

export type WriteReview = z.infer<typeof writeReviewSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type RatingSummary = z.infer<typeof ratingSummarySchema>;
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
