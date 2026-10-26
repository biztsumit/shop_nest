import { z } from "zod";

// One shopper can't empty the shelves: at most this many of one item, and this many lines
export const MAX_QUANTITY = 10;
export const MAX_CART_LINES = 50;

const quantitySchema = z.number().int("must be a whole number").min(1, "must be at least 1").max(MAX_QUANTITY, `at most ${MAX_QUANTITY} of one item`);

// POST /api/cart/items: "add 2 of this" (added to what's already in the cart)
export const addCartItemSchema = z.object({ variantId: z.uuid(), quantity: quantitySchema.default(1) });

// PUT /api/cart/items/:variantId: "make it exactly 3" (0 removes it)
export const setCartItemSchema = z.object({ quantity: z.number().int().min(0).max(MAX_QUANTITY, `at most ${MAX_QUANTITY} of one item`) });

// POST /api/cart/merge: the cart someone filled before logging in (kept in their browser)
export const mergeCartSchema = z.object({
  items: z.array(z.object({ variantId: z.uuid(), quantity: quantitySchema })).max(MAX_CART_LINES),
});

// Why a line can't be bought as it is. The cart is checked against the shelves every time it's
// read: products sell out and get taken off sale while sitting in carts.
export const cartProblemSchema = z.enum([
  "UNAVAILABLE",       // the product isn't on sale any more
  "OUT_OF_STOCK",      // none left
  "NOT_ENOUGH_STOCK",  // fewer left than the quantity: see `available`
]);

export const cartLineSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  options: z.record(z.string(), z.string()),
  sku: z.string().nullable(),
  image: z.object({ url: z.string(), alt: z.string() }).nullable(),
  unitPrice: z.number().int(),               // paise, TODAY's price (not the price when added)
  compareAtPrice: z.number().int().nullable(),
  quantity: z.number().int(),
  lineTotal: z.number().int(),               // unitPrice × quantity
  available: z.number().int(),               // how many are in stock
  problem: cartProblemSchema.nullable(),
});

export const cartSchema = z.object({
  lines: z.array(cartLineSchema),
  itemCount: z.number().int(),     // total quantity: the badge on the cart icon
  subtotal: z.number().int(),      // paise: the lines that CAN be bought
  canCheckout: z.boolean(),        // not empty, and no line has a problem
});

export type AddCartItem = z.infer<typeof addCartItemSchema>;
export type SetCartItem = z.infer<typeof setCartItemSchema>;
export type MergeCart = z.infer<typeof mergeCartSchema>;
export type CartProblem = z.infer<typeof cartProblemSchema>;
export type CartLine = z.infer<typeof cartLineSchema>;
export type Cart = z.infer<typeof cartSchema>;
