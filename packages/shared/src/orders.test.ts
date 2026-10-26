import { describe, expect, it } from "vitest";
import { computeTotals, couponCodeSchema, idempotencyKeySchema, orderNumberSchema } from "./orders.js";

describe("computeTotals", () => {
  it("charges ₹49 delivery below ₹999", () => {
    expect(computeTotals(49_900)).toEqual({ subtotal: 49_900, discount: 0, shippingFee: 4_900, total: 54_800 });
  });

  it("delivers free from ₹999", () => {
    expect(computeTotals(99_900)).toEqual({ subtotal: 99_900, discount: 0, shippingFee: 0, total: 99_900 });
  });

  it("judges free delivery AFTER the discount", () => {
    expect(computeTotals(100_000, 10_000)).toEqual({ subtotal: 100_000, discount: 10_000, shippingFee: 4_900, total: 94_900 });
  });

  it("never discounts more than the subtotal", () => {
    expect(computeTotals(30_000, 50_000)).toEqual({ subtotal: 30_000, discount: 30_000, shippingFee: 4_900, total: 4_900 });
  });

  it("an empty cart costs nothing", () => {
    expect(computeTotals(0)).toEqual({ subtotal: 0, discount: 0, shippingFee: 0, total: 0 });
  });
});

describe("small formats", () => {
  it("coupon codes are capitals", () => expect(couponCodeSchema.parse(" diwali10 ")).toBe("DIWALI10"));
  it("idempotency keys are url-safe", () => {
    expect(idempotencyKeySchema.safeParse("3f2c9a1e-7b4d-4c1a-9e8f-2b6d5a4c3e1f").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("has spaces in it").success).toBe(false);
  });
  it("order numbers", () => {
    expect(orderNumberSchema.safeParse("SN000123").success).toBe(true);
    expect(orderNumberSchema.safeParse("SN12").success).toBe(false);
  });
});
