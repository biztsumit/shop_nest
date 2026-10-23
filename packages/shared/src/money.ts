import { z } from "zod";

// Money is always a whole number of PAISE (1 rupee = 100 paise): ₹499.50 is 49950.
// Never a decimal number: 0.1 + 0.2 is 0.30000000000000004 in JavaScript, and money must add up.
export const paiseSchema = z.number().int("must be a whole number of paise").min(0, "can't be negative").max(1_000_000_000_00);

// ₹1,499 or ₹1,499.50 (Indian digit grouping; paise shown only when there are some)
export const formatPrice = (paise: number): string => {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

// What an admin types ("499.5", "1,499") → paise. Returns null for anything that isn't a price.
export const parseRupees = (text: string): number | null => {
  const cleaned = text.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};
