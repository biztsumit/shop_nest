import { describe, expect, it } from "vitest";
import { couponDiscount, createCouponSchema, updateCouponSchema } from "./coupons.js";
import { publicName } from "./reviews.js";

describe("couponDiscount", () => {
  const percent = { type: "PERCENT" as const, value: 10, minSubtotal: 0, maxDiscount: null };
  const fixed = { type: "FIXED" as const, value: 20_000, minSubtotal: 100_000, maxDiscount: null };

  it("percent off, rounded down to whole paise", () => {
    expect(couponDiscount(percent, 49_999)).toBe(4_999);
  });
  it("percent off, capped", () => {
    expect(couponDiscount({ ...percent, maxDiscount: 15_000 }, 500_000)).toBe(15_000);
  });
  it("fixed off, only from the minimum", () => {
    expect(couponDiscount(fixed, 99_999)).toBe(0);
    expect(couponDiscount(fixed, 100_000)).toBe(20_000);
  });
  it("never more than the subtotal", () => {
    expect(couponDiscount({ ...fixed, minSubtotal: 0 }, 5_000)).toBe(5_000);
  });
});

describe("coupon admin schemas", () => {
  const valid = { code: "diwali10", type: "PERCENT", value: 10 };

  it("fills defaults and capitalises the code", () => {
    expect(createCouponSchema.parse(valid)).toMatchObject({ code: "DIWALI10", perUserLimit: 1, minSubtotal: 0, active: true });
  });
  it("at most 90% off", () => {
    expect(createCouponSchema.safeParse({ ...valid, value: 95 }).success).toBe(false);
    expect(createCouponSchema.safeParse({ ...valid, type: "FIXED", value: 95_000 }).success).toBe(true);
  });
  it("ends after it starts", () => {
    const r = createCouponSchema.safeParse({ ...valid, startsAt: "2026-11-01T00:00:00+05:30", endsAt: "2026-10-01T00:00:00+05:30" });
    expect(r.success).toBe(false);
  });
  it("updates are partial and can't change the code", () => {
    expect(updateCouponSchema.parse({ active: false })).toEqual({ active: false });
    expect(updateCouponSchema.parse({ code: "NEW", active: false })).toEqual({ active: false });
  });
});

describe("publicName", () => {
  it.each([["Riya Sharma", "Riya S."], ["Riya", "Riya"], ["  arjun  kumar mehta ", "arjun M."]])("%j → %j", (input, output) => {
    expect(publicName(input)).toBe(output);
  });
});
