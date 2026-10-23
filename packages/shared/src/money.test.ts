import { describe, expect, it } from "vitest";
import { formatPrice, paiseSchema, parseRupees } from "./money.js";

describe("money", () => {
  it("formats paise as rupees, with Indian digit grouping", () => {
    expect(formatPrice(49900)).toBe("₹499");
    expect(formatPrice(49950)).toBe("₹499.50");
    expect(formatPrice(12345600)).toBe("₹1,23,456");
    expect(formatPrice(0)).toBe("₹0");
  });

  it("reads what an admin types into paise, exactly", () => {
    expect(parseRupees("499")).toBe(49900);
    expect(parseRupees("499.5")).toBe(49950);
    expect(parseRupees("₹1,499.99")).toBe(149999);
    // 0.1 + 0.2 trouble avoided: no floating-point maths involved
    expect(parseRupees("0.29")).toBe(29);
  });

  it("refuses anything that isn't a price", () => {
    for (const text of ["", "abc", "-5", "4.999", "1.2.3"]) {
      expect(parseRupees(text)).toBeNull();
    }
  });

  it("accepts only whole, non-negative paise", () => {
    expect(paiseSchema.safeParse(49900).success).toBe(true);
    expect(paiseSchema.safeParse(499.5).success).toBe(false);
    expect(paiseSchema.safeParse(-1).success).toBe(false);
  });
});
