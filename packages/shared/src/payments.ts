import { z } from "zod";

// POST /api/orders/:number/payment → what the browser needs to open Razorpay Checkout
export const startPaymentSchema = z.object({
  keyId: z.string(),              // the PUBLIC key id (never the secret)
  razorpayOrderId: z.string(),    // "order_N8xR..."
  amount: z.number().int(),       // paise
  currency: z.literal("INR"),
  orderNumber: z.string(),
  prefill: z.object({ name: z.string(), email: z.string(), contact: z.string() }),
});

// What Checkout hands the browser after a successful payment, sent on to
// POST /api/orders/:number/payment/verify. The signature proves Razorpay produced it.
export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().regex(/^order_\w+$/, "is not a Razorpay order id"),
  razorpayPaymentId: z.string().regex(/^pay_\w+$/, "is not a Razorpay payment id"),
  razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/, "is not a valid signature"),
});

export type StartPayment = z.infer<typeof startPaymentSchema>;
export type VerifyPayment = z.infer<typeof verifyPaymentSchema>;

// ---------- Refunds (admin) ----------

// POST /api/admin/orders/:number/refunds
export const createRefundSchema = z.object({
  // Paise. Left out = everything not yet refunded
  amount: z.number().int().min(100, "must be at least ₹1 (100 paise)").optional(),
  reason: z.string().trim().min(1, "is required").max(200),
  // Put the items back on sale (returned goods). Only with a full refund.
  restock: z.boolean().default(false),
  // Cash-on-delivery orders only, and required for them: the shop pays these back itself (UPI,
  // bank transfer) and records how, e.g. the UPI reference number
  reference: z.string().trim().min(1, "is required").max(100).optional(),
});

export const refundStatusSchema = z.enum(["PENDING", "PROCESSED", "FAILED"]);

export const refundSchema = z.object({
  id: z.uuid(),
  amount: z.number().int(),
  status: refundStatusSchema,
  reason: z.string(),
  // Cash on delivery: how the shop paid it back. null = an online refund, through Razorpay
  reference: z.string().nullable(),
  createdAt: z.string(),
});

export type CreateRefund = z.infer<typeof createRefundSchema>;
export type Refund = z.infer<typeof refundSchema>;
