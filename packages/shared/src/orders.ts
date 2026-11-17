import { z } from "zod";
import { addressSchema } from "./address.js";

// ---------- Prices at checkout ----------

// Prices include GST (as Indian shops show them), so there's no separate tax line.
// Delivery is free from ₹999 (after discounts); below that it's ₹49.
export const FREE_SHIPPING_FROM = 99_900;
export const SHIPPING_FEE = 4_900;

// ---------- Cash on delivery ----------

// ONLINE: paid with Razorpay before the order ships. COD: paid in cash to the courier.
export const paymentMethodSchema = z.enum(["ONLINE", "COD"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

// The courier charges the shop for collecting cash; COD orders pass it on
export const COD_FEE = 4_900;
// A big COD order refused at the door costs the shop shipping both ways: COD only up to this
// total (fee included)
export const COD_MAX_TOTAL = 500_000;

export type Totals = { subtotal: number; discount: number; shippingFee: number; codFee: number; total: number };

// ONE function, used by the API to charge and by the web app to show the same numbers
export const computeTotals = (subtotal: number, discount = 0, paymentMethod: PaymentMethod = "ONLINE"): Totals => {
  const discounted = subtotal - Math.min(discount, subtotal);
  const shippingFee = subtotal === 0 || discounted >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
  const codFee = paymentMethod === "COD" && subtotal > 0 ? COD_FEE : 0;
  return { subtotal, discount: subtotal - discounted, shippingFee, codFee, total: discounted + shippingFee + codFee };
};

// Why this shopper can't pay on delivery for this total (null = they can). The API enforces it;
// checkout shows the reason next to the option.
export const codUnavailableReason = (totalWithFee: number, emailVerified: boolean): string | null =>
  !emailVerified
    ? "Confirm your email address to pay on delivery."
    : totalWithFee > COD_MAX_TOTAL
      ? `Pay on delivery is for orders up to ₹${(COD_MAX_TOTAL / 100).toLocaleString("en-IN")}. Please pay online.`
      : null;

export const totalsSchema = z.object({
  subtotal: z.number().int(),
  discount: z.number().int(),
  shippingFee: z.number().int(),
  codFee: z.number().int(),
  total: z.number().int(),
});

// ---------- Placing an order ----------

// The header that makes "Place order" safe to retry (double click, flaky network): the SAME key
// gets the SAME order back instead of a second one. The web app makes one random key per
// checkout attempt.
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const idempotencyKeySchema = z.string().regex(/^[\w-]{8,100}$/, "must be 8-100 letters, digits, - or _");

// Coupon codes: stored and compared in capitals ("diwali10" → "DIWALI10")
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,30}$/, "must be 3-30 letters, digits, - or _");

export const placeOrderSchema = z.object({
  addressId: z.uuid(),
  couponCode: couponCodeSchema.nullable().default(null),
  paymentMethod: paymentMethodSchema.default("ONLINE"),
  // The total the shopper saw. If prices changed since, the order is refused (409) instead of
  // charging a different amount than the one on their screen.
  expectedTotal: z.number().int().min(0).optional(),
});

// POST /api/orders/quote: what checkout would cost right now
export const quoteSchema = z.object({
  couponCode: couponCodeSchema.nullable().default(null),
  paymentMethod: paymentMethodSchema.default("ONLINE"),
});

export const quoteResultSchema = totalsSchema.extend({
  couponCode: z.string().nullable(),   // the coupon that was applied
  paymentMethod: paymentMethodSchema,
  // Whether this shopper may pay on delivery for this cart, and if not, why
  cod: z.object({ available: z.boolean(), reason: z.string().nullable() }),
});

// ---------- Orders ----------

export const orderStatusSchema = z.enum([
  "PENDING_PAYMENT", // placed, stock set aside, waiting for payment
  "CONFIRMED",       // cash on delivery: placed and ready to ship; paid when delivered
  "PAID",
  "SHIPPED",
  "DELIVERED",
  "RETURNED",        // cash on delivery: refused at the door (or undeliverable) and sent back
  "CANCELLED",       // by the shopper (before paying) or the shop
  "EXPIRED",         // not paid in time: the stock went back on the shelf
  "REFUNDED",        // paid, then the money was returned in full
]);

// The address as it was when the order was placed (a copy: editing the saved one later
// doesn't move a parcel that's already on its way)
export const orderAddressSchema = addressSchema.omit({ id: true, isDefault: true });

export const orderItemSchema = z.object({
  variantId: z.uuid().nullable(),   // null if the variant has since been deleted
  productSlug: z.string(),
  productName: z.string(),
  options: z.record(z.string(), z.string()),
  sku: z.string().nullable(),
  imageUrl: z.string().nullable(),
  unitPrice: z.number().int(),      // the price PAID, whatever the price is today
  quantity: z.number().int(),
  lineTotal: z.number().int(),
});

export const orderSchema = totalsSchema.extend({
  id: z.uuid(),
  number: z.string(),               // "SN000123": what the shopper quotes to support
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  items: z.array(orderItemSchema),
  shippingAddress: orderAddressSchema,
  couponCode: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(), // pay before this, or the order expires
  paidAt: z.string().nullable(),
  shippedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  returnedAt: z.string().nullable(),
});

// One row in "My orders"
export const orderSummarySchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: orderStatusSchema,
  total: z.number().int(),
  itemCount: z.number().int(),
  firstItem: z.object({ productName: z.string(), imageUrl: z.string().nullable() }),
  createdAt: z.string(),
});

export const orderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});

// The order number in URLs: /api/orders/SN000123
export const orderNumberSchema = z.string().regex(/^SN\d{6,}$/, "is not an order number");

export type PlaceOrder = z.infer<typeof placeOrderSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type QuoteResult = z.infer<typeof quoteResultSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderAddress = z.infer<typeof orderAddressSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
