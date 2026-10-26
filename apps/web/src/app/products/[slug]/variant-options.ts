import type { ProductVariant } from "@shop/shared";

// Turning a product's variants into option pickers:
//   variants: {colour: Black, size: S}, {colour: Black, size: M}, {colour: White, size: M}
//   → Colour: [Black, White]   Size: [S, M]
// Plain functions (no React), so they're easy to reason about and test.

// Option names in the order they first appear ("colour" before "size", as the shop wrote them)
export const optionNames = (variants: ProductVariant[]): string[] => [...new Set(variants.flatMap((v) => Object.keys(v.options)))];

export const valuesOf = (variants: ProductVariant[], name: string): string[] =>
  [...new Set(variants.map((v) => v.options[name]).filter((v): v is string => v !== undefined))];

// The variant matching every chosen option, if there is one
export const findVariant = (variants: ProductVariant[], chosen: Record<string, string>): ProductVariant | undefined =>
  variants.find((v) => Object.entries(v.options).every(([name, value]) => chosen[name] === value));

// Choosing "White" when "S" only exists in Black: keep the new choice, and change the OTHER
// options to the closest variant that exists (preferring one in stock)
export const choose = (variants: ProductVariant[], chosen: Record<string, string>, name: string, value: string): Record<string, string> => {
  const next = { ...chosen, [name]: value };
  if (findVariant(variants, next)) return next;
  const candidates = variants.filter((v) => v.options[name] === value);
  const best = candidates.find((v) => v.stock > 0) ?? candidates[0];
  return best ? { ...best.options } : next;
};

// Can this value be bought, with the other options as chosen? (Greyed out if not)
export const isAvailable = (variants: ProductVariant[], chosen: Record<string, string>, name: string, value: string): boolean => {
  const match = findVariant(variants, { ...chosen, [name]: value });
  return match !== undefined && match.stock > 0;
};

// What's selected when the page opens: the first variant in stock, else simply the first
export const initialChoice = (variants: ProductVariant[]): Record<string, string> =>
  ({ ...(variants.find((v) => v.stock > 0) ?? variants[0])?.options });
