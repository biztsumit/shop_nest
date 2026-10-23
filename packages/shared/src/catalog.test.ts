import { describe, expect, it } from "vitest";
import { createProductSchema, createVariantSchema, slugify, slugSchema } from "./catalog.js";

describe("catalog input rules", () => {
  it("slugs: the same rule as the database's CHECK constraint", () => {
    expect(slugSchema.safeParse("classic-tee-2").success).toBe(true);
    for (const bad of ["Classic Tee", "classic--tee", "-tee", "tee-", "", "tee_shirt"]) {
      expect(slugSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("slugify turns any name into a valid slug", () => {
    expect(slugify("Classic Tee!")).toBe("classic-tee");
    expect(slugify("  Café   Crème  ")).toBe("cafe-creme");
    expect(slugSchema.safeParse(slugify("Home & Kitchen")).success).toBe(true);
  });

  it("a 'was' price must be higher, and the error points at that field", () => {
    const result = createVariantSchema.safeParse({ price: 69900, compareAtPrice: 50000 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["compareAtPrice"]);
  });

  it("fills in sensible defaults", () => {
    const variant = createVariantSchema.parse({ price: 49900 });
    expect(variant).toEqual({ options: {}, sku: null, price: 49900, compareAtPrice: null, stock: 0 });
  });

  it("a product needs at least one variant, and starts as a draft", () => {
    expect(createProductSchema.safeParse({ name: "Tee", slug: "tee", variants: [] }).success).toBe(false);
    const product = createProductSchema.parse({ name: " Tee ", slug: "tee", variants: [{ price: 100 }] });
    expect(product).toMatchObject({ name: "Tee", status: "DRAFT", categoryId: null, images: [] });
  });

  it("at most 3 options per variant", () => {
    const options = { size: "M", colour: "Black", fit: "Slim", sleeve: "Long" };
    expect(createVariantSchema.safeParse({ price: 100, options }).success).toBe(false);
  });
});
