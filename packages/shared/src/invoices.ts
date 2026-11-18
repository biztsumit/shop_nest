import { z } from "zod";
import { INDIAN_STATES } from "./address.js";

// GST INVOICES. Prices in the shop INCLUDE GST (as Indian shoppers expect), so an invoice works
// backwards: out of what was paid for each line, how much was the item ("taxable value") and
// how much was tax.
//
// Which tax: if the parcel goes to the shop's own state, half CGST (central) + half SGST
// (state); to any other state, IGST (integrated) for the whole rate. The shop's state is
// in its GSTIN (the first two digits).

// ---------- Rates and codes ----------

// The GST rates in use (%). Most goods are 5 or 18; 3 is gold and silver, 40 luxury/"sin" goods.
// 12 and 28 are kept for older stock still priced at them.
export const GST_RATES = [0, 3, 5, 12, 18, 28, 40] as const;
export const gstRateSchema = z.number().refine((r) => (GST_RATES as readonly number[]).includes(r), `must be one of ${GST_RATES.join(", ")} (%)`);
export type GstRate = (typeof GST_RATES)[number];

// HSN: the tariff code that says what kind of goods it is (6109 = T-shirts). 4, 6 or 8 digits;
// empty = not set yet (shown blank on the invoice)
export const hsnCodeSchema = z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, "must be a 4, 6 or 8-digit HSN code");

// The two-digit GST code of each state and union territory (the start of every GSTIN)
export const GST_STATE_CODES: Record<(typeof INDIAN_STATES)[number], string> = {
  "Jammu and Kashmir": "01", "Himachal Pradesh": "02", Punjab: "03", Chandigarh: "04", Uttarakhand: "05",
  Haryana: "06", Delhi: "07", Rajasthan: "08", "Uttar Pradesh": "09", Bihar: "10", Sikkim: "11",
  "Arunachal Pradesh": "12", Nagaland: "13", Manipur: "14", Mizoram: "15", Tripura: "16", Meghalaya: "17",
  Assam: "18", "West Bengal": "19", Jharkhand: "20", Odisha: "21", Chhattisgarh: "22", "Madhya Pradesh": "23",
  Gujarat: "24", "Dadra and Nagar Haveli and Daman and Diu": "26", Maharashtra: "27", Karnataka: "29",
  Goa: "30", Lakshadweep: "31", Kerala: "32", "Tamil Nadu": "33", Puducherry: "34",
  "Andaman and Nicobar Islands": "35", Telangana: "36", "Andhra Pradesh": "37", Ladakh: "38",
};

// The state a GSTIN belongs to, or null for an unknown code
export const stateOfGstin = (gstin: string): string | null =>
  Object.entries(GST_STATE_CODES).find(([, code]) => code === gstin.slice(0, 2))?.[0] ?? null;

// ---------- GSTIN ----------

// A GSTIN: state code (2 digits) + the business's PAN (5 letters, 4 digits, 1 letter) + entity
// number + "Z" + a check character. The check character catches typos: it's computed from the
// other 14 (each character's value 0-35, every second one doubled, the "digits" in base 36 added).
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const gstinCheckChar = (first14: string): string => {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
};
export const isValidGstin = (gstin: string): boolean =>
  /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin) && stateOfGstin(gstin) !== null && gstinCheckChar(gstin.slice(0, 14)) === gstin[14];

// ---------- Numbers and dates ----------

const IST = 5.5 * 60 * 60 * 1000;

// India's financial year runs April to March: 17 Nov 2026 is in "2026-27", 10 Mar 2027 too
export const financialYear = (at: Date): string => {
  const ist = new Date(at.getTime() + IST);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

// "INV" + "2026-27" + 1 → "INV2627-000001". GST rules: at most 16 characters, numbered in one
// series per financial year, never reused.
export const invoiceNumber = (prefix: string, year: string, serial: number): string =>
  `${prefix}${year.slice(2, 4)}${year.slice(5, 7)}-${String(serial).padStart(6, "0")}`;

// 104750 paise → "Rupees One Thousand Forty Seven and Fifty Paise Only" (Indian grouping:
// thousand, lakh = 1,00,000, crore = 1,00,00,000), as invoices write the total
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const belowHundred = (n: number): string => (n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim());
const words = (n: number): string => {
  if (n === 0) return "";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  if (crore) parts.push(`${words(crore)} Crore`);
  const lakh = Math.floor(n / 1_00_000) % 100;
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000) % 100;
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  const hundred = Math.floor(n / 100) % 10;
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n % 100) parts.push(belowHundred(n % 100));
  return parts.join(" ");
};
export const amountInWords = (paise: number): string => {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const r = rupees ? `Rupees ${words(rupees)}` : "Rupees Zero";
  return `${r}${rest ? ` and ${belowHundred(rest)} Paise` : ""} Only`;
};

// ---------- The tax maths ----------

export type InvoiceLineInput = { description: string; hsn: string; quantity: number; unitPrice: number; lineTotal: number; gstRate: number };

export const invoiceLineSchema = z.object({
  description: z.string(),
  hsn: z.string(),          // HSN for goods, SAC for services (delivery)
  quantity: z.number().int(),
  unitPrice: z.number().int(),   // paise, GST included, before the coupon
  discount: z.number().int(),    // this line's share of the coupon
  taxable: z.number().int(),     // what's left once the tax is taken out
  rate: z.number(),
  cgst: z.number().int(),
  sgst: z.number().int(),
  igst: z.number().int(),
  total: z.number().int(),       // taxable + taxes = what was paid for this line
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const invoiceTotalsSchema = z.object({
  discount: z.number().int(),
  taxable: z.number().int(),
  cgst: z.number().int(),
  sgst: z.number().int(),
  igst: z.number().int(),
  total: z.number().int(),
});
export type InvoiceTotals = z.infer<typeof invoiceTotalsSchema>;

// Splits `amount` into parts proportional to `weights`, adding up EXACTLY (the paise lost to
// rounding go to the largest remainders)
export const allocate = (amount: number, weights: number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || amount === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / sum);
  const parts = raw.map(Math.floor);
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left === 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts;
};

// The tax inside a GST-inclusive `amount`. Within the state, CGST and SGST are each exactly half
// (computed once, then doubled), so they always match on the invoice.
const taxOf = (amount: number, rate: number, interState: boolean) => {
  if (interState) {
    const igst = Math.round((amount * rate) / (100 + rate));
    return { cgst: 0, sgst: 0, igst, taxable: amount - igst };
  }
  const half = Math.round((amount * rate) / (2 * (100 + rate)));
  return { cgst: half, sgst: half, igst: 0, taxable: amount - 2 * half };
};

// The invoice lines and totals for an order. The coupon is shared between the items in
// proportion to their prices (it lowers each item's taxable value). Delivery and the
// cash-on-delivery fee are part of the same sale, so they're taxed at the order's highest item
// rate. The total always equals what the shopper paid.
export const buildInvoiceLines = (input: {
  items: InvoiceLineInput[];
  discount: number;
  shippingFee: number;
  codFee: number;
  interState: boolean;
}): { lines: InvoiceLine[]; totals: InvoiceTotals } => {
  const shares = allocate(input.discount, input.items.map((i) => i.lineTotal));
  const lines: InvoiceLine[] = input.items.map((item, i) => {
    const discount = shares[i]!;
    const total = item.lineTotal - discount;
    return { description: item.description, hsn: item.hsn, quantity: item.quantity, unitPrice: item.unitPrice, discount, rate: item.gstRate, total, ...taxOf(total, item.gstRate, input.interState) };
  });
  const feeRate = Math.max(0, ...input.items.map((i) => i.gstRate));
  const fee = (description: string, amount: number): InvoiceLine =>
    ({ description, hsn: "996812", quantity: 1, unitPrice: amount, discount: 0, rate: feeRate, total: amount, ...taxOf(amount, feeRate, input.interState) });
  if (input.shippingFee > 0) lines.push(fee("Delivery charges", input.shippingFee));
  if (input.codFee > 0) lines.push(fee("Cash on delivery fee", input.codFee));

  const sum = (key: "discount" | "taxable" | "cgst" | "sgst" | "igst" | "total") => lines.reduce((s, l) => s + l[key], 0);
  return { lines, totals: { discount: sum("discount"), taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), total: sum("total") } };
};

// ---------- The invoice as issued ----------

// Saved once, when the invoice is issued, and never changed: the PDF is drawn from this, so it
// reads the same years later even if the shop's address or a product's rate changes
export const invoiceSchema = z.object({
  number: z.string(),
  issuedAt: z.string(),
  orderNumber: z.string(),
  orderDate: z.string(),
  paymentMethod: z.enum(["ONLINE", "COD"]),
  seller: z.object({ legalName: z.string(), gstin: z.string(), address: z.string(), state: z.string(), stateCode: z.string() }),
  buyer: z.object({ name: z.string(), address: z.array(z.string()), state: z.string(), stateCode: z.string() }),
  interState: z.boolean(),
  lines: z.array(invoiceLineSchema),
  totals: invoiceTotalsSchema,
  amountInWords: z.string(),
});
export type Invoice = z.infer<typeof invoiceSchema>;
