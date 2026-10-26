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
