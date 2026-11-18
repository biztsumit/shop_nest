import { describe, expect, it } from "vitest";
import { allocate, amountInWords, buildInvoiceLines, financialYear, gstinCheckChar, invoiceNumber, isValidGstin, stateOfGstin } from "./invoices.js";

describe("GSTIN", () => {
  it("accepts a real-format GSTIN and knows its state", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(stateOfGstin("27AAPFU0939F1ZV")).toBe("Maharashtra");
    expect(stateOfGstin("29AAPFU0939F1ZV")).toBe("Karnataka");
  });

  it("catches a typo through the check character, and bad shapes", () => {
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);   // wrong check character
    expect(isValidGstin("27AAPFU9039F1ZV")).toBe(false);   // two digits swapped
    expect(isValidGstin("27aapfu0939f1zv")).toBe(false);   // lowercase
    expect(isValidGstin("99AAPFU0939F1Z" + gstinCheckChar("99AAPFU0939F1Z"))).toBe(false);   // no such state
  });
});

describe("numbers and dates", () => {
  it("financial years run April to March, in Indian time", () => {
    expect(financialYear(new Date("2026-11-17T10:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T18:00:00Z"))).toBe("2026-27");   // 23:30 IST, 31 Mar
    expect(financialYear(new Date("2027-03-31T18:30:00Z"))).toBe("2027-28");   // 00:00 IST, 1 Apr
    expect(financialYear(new Date("2099-06-01T00:00:00Z"))).toBe("2099-00");
  });

  it("invoice numbers fit GST's 16 characters", () => {
    expect(invoiceNumber("INV", "2026-27", 1)).toBe("INV2627-000001");
    expect(invoiceNumber("SHOP", "2026-27", 123456).length).toBeLessThanOrEqual(16);
  });

  it("writes amounts in words the Indian way", () => {
    expect(amountInWords(104700)).toBe("Rupees One Thousand Forty Seven Only");
    expect(amountInWords(59750)).toBe("Rupees Five Hundred Ninety Seven and Fifty Paise Only");
    expect(amountInWords(12_34_567_00)).toBe("Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only");
    expect(amountInWords(2_00_00_000_00)).toBe("Rupees Two Crore Only");
    expect(amountInWords(5)).toBe("Rupees Zero and Five Paise Only");
  });
});

describe("allocate", () => {
  it("splits exactly, in proportion", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [3000, 1000])).toEqual([750, 250]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });
});

describe("buildInvoiceLines", () => {
  const tee = { description: "Classic Tee (M)", hsn: "6109", quantity: 2, unitPrice: 49900, lineTotal: 99800, gstRate: 5 };
  const earbuds = { description: "Wireless Earbuds", hsn: "8518", quantity: 1, unitPrice: 199900, lineTotal: 199900, gstRate: 18 };

  it("within the state: CGST and SGST, equal halves; the total is what was paid", () => {
    const { lines, totals } = buildInvoiceLines({ items: [tee], discount: 0, shippingFee: 0, codFee: 0, interState: false });
    // 998.00 incl. 5% → taxable 950.48, tax 47.52 = 23.76 + 23.76
    expect(lines[0]).toMatchObject({ taxable: 95048, cgst: 2376, sgst: 2376, igst: 0, total: 99800 });
    expect(totals.total).toBe(99800);
  });

  it("to another state: IGST", () => {
    const { lines } = buildInvoiceLines({ items: [tee], discount: 0, shippingFee: 0, codFee: 0, interState: true });
    expect(lines[0]).toMatchObject({ taxable: 95048, cgst: 0, sgst: 0, igst: 4752 });
  });

  it("shares the coupon between items, and taxes the fees at the highest rate", () => {
    const { lines, totals } = buildInvoiceLines({ items: [tee, earbuds], discount: 30000, shippingFee: 4900, codFee: 4900, interState: false });
    expect(lines.map((l) => l.discount)).toEqual([9990, 20010, 0, 0]);
    expect(lines.slice(2).map((l) => [l.description, l.rate, l.hsn])).toEqual([["Delivery charges", 18, "996812"], ["Cash on delivery fee", 18, "996812"]]);
    expect(totals.total).toBe(99800 + 199900 - 30000 + 4900 + 4900);
    expect(totals.taxable + totals.cgst + totals.sgst + totals.igst).toBe(totals.total);
    for (const l of lines) expect(l.taxable + l.cgst + l.sgst + l.igst).toBe(l.total);
  });

  it("a 0% item has no tax", () => {
    const { lines } = buildInvoiceLines({ items: [{ ...tee, gstRate: 0 }], discount: 0, shippingFee: 0, codFee: 0, interState: false });
    expect(lines[0]).toMatchObject({ taxable: 99800, cgst: 0, sgst: 0 });
  });
});
