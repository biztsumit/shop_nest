// What an admin's change actually changed, for the audit log: { price: { from: 129900, to: 119900 } }

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Changes = Record<string, { from: Json; to: Json }>;

// Dates become ISO text, undefined becomes null: what's stored is plain JSON
const toJson = (value: unknown): Json => (value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json));

// Only the fields present in `after` (a PATCH sends only what it changes), and of those only
// the ones that really are different. Objects and lists are compared by content.
export const diffChanges = <T extends object>(before: T, after: Partial<T>): Changes => {
  const changes: Changes = {};
  for (const field of Object.keys(after) as Array<keyof T & string>) {
    const from = toJson(before[field]);
    const to = toJson(after[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
};

// The changes in words: "price ₹1,299 → ₹1,199; stock 4 → 10". `labels` names (and formats)
// the fields worth spelling out; others are just named ("description changed").
export const describeChanges = (changes: Changes, labels: Record<string, string | [string, (value: Json) => string]> = {}): string =>
  Object.entries(changes)
    .map(([field, { from, to }]) => {
      const label = labels[field];
      if (label === undefined) return `${field} changed`;
      const [name, format] = typeof label === 'string' ? [label, show] : label;
      return `${name} ${format(from)} → ${format(to)}`;
    })
    .join('; ');

const show = (value: Json): string => (value === null || value === '' ? '(none)' : typeof value === 'object' ? JSON.stringify(value) : String(value));
