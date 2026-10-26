import { describe, expect, it } from "vitest";
import { createAddressSchema, phoneSchema, pincodeSchema, updateAddressSchema } from "./address.js";

describe("phoneSchema", () => {
  it.each(["9876543210", "+91 98765 43210", "098765-43210", "+919876543210", " 98765 43210 "])("accepts %j as 9876543210", (input) => {
    expect(phoneSchema.parse(input.trim())).toBe("9876543210");
  });

  it.each(["5876543210", "987654321", "98765432101", "+44 7911 123456", "phone"])("refuses %j", (input) => {
    expect(phoneSchema.safeParse(input).success).toBe(false);
  });
});

describe("pincodeSchema", () => {
  it("accepts 6 digits", () => expect(pincodeSchema.parse(" 411001 ")).toBe("411001"));
  it.each(["011001", "41100", "4110011", "41 001"])("refuses %j", (input) => {
    expect(pincodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("createAddressSchema", () => {
  const valid = { fullName: "Riya Sharma", phone: "9876543210", line1: "12 MG Road", city: "Pune", state: "Maharashtra", pincode: "411001" };

  it("fills the defaults", () => {
    expect(createAddressSchema.parse(valid)).toEqual({ ...valid, line2: "", isDefault: false });
  });

  it("only knows real states", () => {
    expect(createAddressSchema.safeParse({ ...valid, state: "Maharastra" }).success).toBe(false);
  });
});

describe("updateAddressSchema", () => {
  it("needs at least one field", () => expect(updateAddressSchema.safeParse({}).success).toBe(false));
  it("can only make an address the default, not un-default it", () => {
    expect(updateAddressSchema.safeParse({ isDefault: false }).success).toBe(false);
    expect(updateAddressSchema.parse({ isDefault: true })).toEqual({ isDefault: true });
  });
});
