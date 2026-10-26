// The catalog's sort options. A plain module (no server code) so both the server page and the
// client dropdown can import it.
export const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name_asc", label: "Name: A to Z" },
] as const;
