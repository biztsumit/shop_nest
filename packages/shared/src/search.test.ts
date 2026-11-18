import { describe, expect, it } from "vitest";
import { buildVocabulary, correctQuery, editDistance, searchWords } from "./search.js";

const shop = buildVocabulary([
  "Classic T-shirt", "Graphic T-shirt", "Zip Hoodie", "Pullover Hoodie", "Denim Jacket", "Ceramic Mug", "Café Apron",
  "Clothing", "Hoodies", "Accessories",
]);

describe("searchWords", () => {
  it("lower-cases, drops accents and punctuation, keeps inner hyphens", () => {
    expect(searchWords("  Zip-up HOODIE, Café! ")).toEqual(["zip-up", "hoodie", "cafe"]);
    expect(searchWords("--")).toEqual([]);
    expect(searchWords("t_e a mug")).toEqual(["mug"]);
  });
});

describe("editDistance", () => {
  it("counts added, removed, changed and swapped letters", () => {
    expect(editDistance("hoodie", "hoodie")).toBe(0);
    expect(editDistance("hoddie", "hoodie")).toBe(1);   // changed
    expect(editDistance("shrit", "shirt")).toBe(1);     // swapped
    expect(editDistance("jaket", "jacket")).toBe(1);    // added
    expect(editDistance("mugg", "mug")).toBe(1);        // removed
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("gives up early past the limit", () => {
    expect(editDistance("abcdef", "uvwxyz", 1)).toBe(2);
    expect(editDistance("a", "abcdef", 2)).toBe(3);
  });
});

describe("correctQuery", () => {
  it("leaves words the shop has (or parts of them) alone", () => {
    expect(correctQuery("hoodie", shop)).toEqual({ terms: ["hoodie"], correctedTo: null });
    expect(correctQuery("hood", shop)).toEqual({ terms: ["hood"], correctedTo: null });
    expect(correctQuery("t-shirt", shop)).toEqual({ terms: ["t-shirt"], correctedTo: null });
  });

  it("corrects typos to the closest word", () => {
    expect(correctQuery("hoddie", shop)).toEqual({ terms: ["hoodie"], correctedTo: "hoodie" });
    expect(correctQuery("denim jaket", shop)).toEqual({ terms: ["denim", "jacket"], correctedTo: "denim jacket" });
    expect(correctQuery("ceramc mugs", shop).terms).toEqual(["ceramic", "mug"]);
    expect(correctQuery("cafe", shop).terms).toEqual(["cafe"]);   // "Café" in the shop
  });

  it("finds hyphenated words written joined up", () => {
    expect(correctQuery("tshirt", shop)).toEqual({ terms: ["t-shirt"], correctedTo: "t-shirt" });
    expect(correctQuery("tshrit", shop).terms).toEqual(["t-shirt"]);
    // Part of a joined-up word only: the same part, hyphen put back
    const plural = buildVocabulary(["T-shirts", "Organic Crew Neck"]);
    expect(correctQuery("tshirt", plural)).toEqual({ terms: ["t-shirt"], correctedTo: "t-shirt" });
    expect(correctQuery("shirt", plural)).toEqual({ terms: ["shirt"], correctedTo: null });
  });

  it("doesn't guess at short words or far-off ones", () => {
    expect(correctQuery("mog", shop).terms).toEqual(["mog"]);       // 3 letters: no typos allowed
    expect(correctQuery("bicycle", shop).terms).toEqual(["bicycle"]);
  });

  it("while typing, the last word only has to start a word", () => {
    expect(correctQuery("hoo", shop, { typing: true })).toEqual({ terms: ["hoo"], correctedTo: null });
    expect(correctQuery("hodi", shop, { typing: true })).toEqual({ terms: ["hoodi"], correctedTo: "hoodi" });
    expect(correctQuery("jaket den", shop, { typing: true }).terms).toEqual(["jacket", "den"]);
  });
});
