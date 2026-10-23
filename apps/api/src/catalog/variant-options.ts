// A variant's options ({"size": "M", "colour": "Black"}) as one text key in a fixed order:
// "colour=Black;size=M". The database has UNIQUE(product_id, options_key), so a product can't
// get two variants with the same options, whatever order or capitalisation the names came in.
//
// Option NAMES are case-insensitive ("Size" = "size"); option VALUES keep their case ("M", "Black").
export type VariantOptions = Record<string, string>;

export const normaliseOptions = (options: VariantOptions): VariantOptions =>
  Object.fromEntries(
    Object.entries(options)
      .map(([name, value]) => [name.trim().toLowerCase(), value.trim()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

export const optionsKey = (options: VariantOptions): string =>
  Object.entries(normaliseOptions(options))
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
