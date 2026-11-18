import { z } from "zod";
import { imageSchema, productSummarySchema } from "./catalog.js";

// ---------- Typo-tolerant search ----------
//
// Search matches words as plain text (fast, with the trigram index on product names). Typos are
// handled BEFORE that: each word of the query that appears nowhere in the shop is corrected to
// the closest word that does ("hoddie" → "hoodie", "shrit" → "shirt", "tshirt" → "t-shirt").
// The shop's words (product and category names) are few, so comparing against all of them is
// quick, and the result is predictable: the page says what it searched for instead.

// "Zip-up Hoodie, Navy!" → ["zip-up", "hoodie", "navy"]. Lower case, accents removed
// ("Café" → "cafe"), split on anything but letters, digits and inner hyphens. Single letters
// are dropped (in "t_e" or "a mug" they'd match nearly everything). At most 8 words.
export const searchWords = (text: string): string[] => {
  const plain = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const words = plain.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
  return [...new Set(words)].filter((w) => w.length > 1).slice(0, 8);
};

// How many single-letter edits turn `a` into `b`: a letter added, removed, changed, or two
// neighbours swapped ("shrit" → "shirt" is 1). Stops early (returns max + 1) once it's over `max`.
export const editDistance = (a: string, b: string, max = Infinity): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  // Three rows of the classic table: the one before last (for swaps), the last, and this one
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2]! + 1);
      current.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    before = previous;
    previous = current;
  }
  return previous[b.length]!;
};

// How many typos a word of this length may have: none for short words (too many near misses:
// "tee", "tea", "toe"), one up to 6 letters, two for longer ones
const allowedTypos = (length: number): number => (length <= 3 ? 0 : length <= 6 ? 1 : 2);

// The shop's words, each with how many names it appears in (the more common wins a tie) and how
// it should be searched for. Hyphenated words also count joined up: "t-shirt" is found by "tshirt".
export type Vocabulary = Map<string, { term: string; count: number }>;

export const buildVocabulary = (names: string[]): Vocabulary => {
  const vocabulary: Vocabulary = new Map();
  const add = (key: string, term: string) => {
    const entry = vocabulary.get(key);
    if (entry) entry.count += 1;
    else vocabulary.set(key, { term, count: 1 });
  };
  for (const name of names) {
    for (const word of searchWords(name)) {
      add(word, word);
      if (word.includes("-")) {
        add(word.replaceAll("-", ""), word);
        for (const part of word.split("-")) if (part.length > 1) add(part, part);
      }
    }
  }
  return vocabulary;
};

export type CorrectedQuery = {
  terms: string[];          // what to look for, each as plain text (all of them must match)
  correctedTo: string | null; // the corrected query, if any word was corrected ("blue hoodie")
};

// Corrects each word that appears nowhere in the shop. With `typing`, the LAST word is still
// being typed (autocomplete): it only has to be the START of a word ("hoo" is fine).
export const correctQuery = (query: string, vocabulary: Vocabulary, { typing = false } = {}): CorrectedQuery => {
  const words = searchWords(query);
  let corrected = false;
  const terms = words.map((word, i) => {
    const partial = typing && i === words.length - 1;
    const term = correctWord(word, vocabulary, partial);
    if (term !== word) corrected = true;
    return term;
  });
  return { terms, correctedTo: corrected ? terms.join(" ") : null };
};

const correctWord = (word: string, vocabulary: Vocabulary, partial: boolean): string => {
  // One of the shop's words ("tshirt" is searched as "t-shirt"), or part of one ("hood" in
  // "hoodie"): nothing to correct
  const exact = vocabulary.get(word);
  if (exact) return exact.term;
  for (const [key, { term }] of vocabulary) if (term === key && key.includes(word)) return word;
  // Inside a joined-up form only ("tshirt" in "tshirts", from "T-shirts"): names have the
  // hyphen, so search for that part of the hyphenated word, "t-shirt"
  for (const [key, { term }] of vocabulary) {
    const at = key.indexOf(word);
    if (term !== key && at !== -1) return hyphenatedPart(term, at, word.length);
  }

  const max = allowedTypos(word.length);
  if (max === 0) return word;
  let best: { term: string; distance: number; count: number } | null = null;
  for (const [key, { term, count }] of vocabulary) {
    // While typing, compare with the START of each real word: "hodi" is 1 typo from "hoodi(e)",
    // and the search is for that start, "hoodi". (Joined-up forms like "tshirt" aren't in
    // product names as such, so they're skipped here.)
    // Starts one letter shorter or longer too: a letter left out ("hodi" → "hoodi") shifts it.
    if (partial && term !== key) continue;
    const candidates = partial
      ? [word.length - 1, word.length, word.length + 1].filter((n) => n > 0 && n <= key.length).map((n) => key.slice(0, n))
      : [term];
    for (const candidate of candidates) {
      const distance = editDistance(word, partial ? candidate : key, max);
      if (distance > max) continue;
      if (!best || distance < best.distance || (distance === best.distance && (count > best.count || (count === best.count && candidate < best.term)))) {
        best = { term: candidate, distance, count };
      }
    }
  }
  return best?.term ?? word;
};

// The letters from..from+length of the joined-up word, taken from the hyphenated one, hyphens
// included: ("t-shirts", 0, 6) → "t-shirt"
const hyphenatedPart = (hyphenated: string, from: number, length: number): string => {
  const letters = [...hyphenated].flatMap((char, i) => (char === "-" ? [] : [i]));   // each letter's position
  return hyphenated.slice(letters[from], letters[from + length - 1]! + 1);
};

// ---------- GET /api/products: the page says what it actually searched for ----------

export const productPageSchema = z.object({
  data: z.array(productSummarySchema),
  nextCursor: z.string().nullable(),
  // "hoodie" when the search was "hoddie" (null: searched as typed, or no search)
  searchedFor: z.string().nullable(),
});

// ---------- GET /api/products/suggest?q=hoo: the search box's suggestions ----------

export const productSuggestQuerySchema = z.object({
  q: z.string().trim().min(1, "is required").max(100),
});

export const productSuggestionsSchema = z.object({
  searchedFor: z.string().nullable(),
  products: z.array(z.object({
    slug: z.string(),
    name: z.string(),
    price: z.number().int(),
    category: z.string().nullable(),
    image: imageSchema.nullable(),
  })),
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
});

export type ProductPage = z.infer<typeof productPageSchema>;
export type ProductSuggestQuery = z.infer<typeof productSuggestQuerySchema>;
export type ProductSuggestions = z.infer<typeof productSuggestionsSchema>;
