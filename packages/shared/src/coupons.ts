import { z } from "zod";
import { paiseSchema } from "./money.js";
import { couponCodeSchema } from "./orders.js";

export const couponTypeSchema = z.enum([
  "PERCENT", // value = percent off (1-90), optionally capped by maxDiscount
  "FIXED",   // value = paise off
]);

// The rules for using a coupon, checked in this order (the first one that fails is the message)
export type CouponRules = {
  type: z.infer<typeof couponTypeSchema>;
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
};

// How much a coupon takes off this subtotal. Rounded DOWN to whole paise: the shop never
// gives away a fraction of a paisa it can't charge.
export const couponDiscount = (coupon: CouponRules, subtotal: number): number => {
  if (subtotal < coupon.minSubtotal) return 0;
  const raw = coupon.type === "PERCENT" ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;
  return Math.min(raw, coupon.maxDiscount ?? raw, subtotal);
};

// ---------- Admin: creating and editing coupons ----------

// The fields WITHOUT defaults. Careful: `.partial()` keeps `.default()`s, so an update schema
// built from fields with defaults would quietly reset every field the admin didn't send.
const couponFields = z.object({
  code: couponCodeSchema,
  description: z.string().trim().max(200),
  type: couponTypeSchema,
  value: z.number().int().min(1, "must be at least 1"),
  minSubtotal: paiseSchema,
  maxDiscount: paiseSchema.nullable(),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  usageLimit: z.number().int().min(1).nullable(),   // null = unlimited
  perUserLimit: z.number().int().min(1),
  active: z.boolean(),
});

type CouponFields = z.infer<typeof couponFields>;

// Creating: the same fields, with defaults for the optional ones
const couponWithDefaults = couponFields.extend({
  description: couponFields.shape.description.default(""),
  minSubtotal: couponFields.shape.minSubtotal.default(0),
  maxDiscount: couponFields.shape.maxDiscount.default(null),
  startsAt: couponFields.shape.startsAt.default(null),
  endsAt: couponFields.shape.endsAt.default(null),
  usageLimit: couponFields.shape.usageLimit.default(null),
  perUserLimit: couponFields.shape.perUserLimit.default(1),
  active: couponFields.shape.active.default(true),
});

const couponRefinements = <T extends z.ZodType<Partial<CouponFields>>>(schema: T) =>
  schema
    .refine((c) => c.type !== "PERCENT" || c.value === undefined || c.value <= 90, {
      message: "a percentage can be at most 90",
      path: ["value"],
    })
    .refine((c) => !c.startsAt || !c.endsAt || new Date(c.startsAt) < new Date(c.endsAt), {
      message: "must be after the start",
      path: ["endsAt"],
    });

export const createCouponSchema = couponRefinements(couponWithDefaults);
// The code can't change once shoppers may have it
export const updateCouponSchema = couponRefinements(couponFields.omit({ code: true }).partial());

export const couponSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  description: z.string(),
  type: couponTypeSchema,
  value: z.number().int(),
  minSubtotal: z.number().int(),
  maxDiscount: z.number().int().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  usageLimit: z.number().int().nullable(),
  perUserLimit: z.number().int(),
  usedCount: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

export type CouponType = z.infer<typeof couponTypeSchema>;
export type CreateCoupon = z.infer<typeof createCouponSchema>;
export type UpdateCoupon = z.infer<typeof updateCouponSchema>;
export type Coupon = z.infer<typeof couponSchema>;
