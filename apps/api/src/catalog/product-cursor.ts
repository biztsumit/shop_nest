import type { ProductSort } from '@shop/shared';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { ValidationFailedException } from '../common/validation.js';

// KEYSET (cursor) pagination: "give me the products AFTER this one" instead of "skip 48 rows".
// The cursor remembers the last product's sort value and id. Unlike page numbers it stays
// correct while products are added (nothing shifts between pages), and it stays fast on page
// 1000 (the index jumps straight there instead of counting past every earlier row).
//
// To the client it's an opaque string (base64url JSON). It comes back from the client, so it
// is checked as strictly as any other input.

type Cursor = { id: string; v?: number | string };

const cursorSchemas: Record<ProductSort, z.ZodType<Cursor>> = {
  newest: z.object({ id: z.uuid() }),
  price_asc: z.object({ id: z.uuid(), v: z.number().int() }),
  price_desc: z.object({ id: z.uuid(), v: z.number().int() }),
  name_asc: z.object({ id: z.uuid(), v: z.string().max(200) }),
};

// Each sort, as Prisma's orderBy. The id at the end breaks ties (two products with the same
// price), so the order is always complete and no product is skipped or shown twice.
export const productOrderBy: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ id: 'desc' }],            // ids are UUID v7: a later id = a newer product
  price_asc: [{ price: 'asc' }, { id: 'asc' }],
  price_desc: [{ price: 'desc' }, { id: 'desc' }],
  name_asc: [{ name: 'asc' }, { id: 'asc' }],
};

export const encodeCursor = (sort: ProductSort, last: { id: string; price: number; name: string }): string => {
  const cursor: Cursor =
    sort === 'newest' ? { id: last.id } : { id: last.id, v: sort === 'name_asc' ? last.name : last.price };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
};

// The condition "comes after the cursor" for this sort:
//   price_asc: price > v, OR (price = v AND id > last id)
export const afterCursor = (sort: ProductSort, encoded: string): Prisma.ProductWhereInput => {
  const cursor = decode(sort, encoded);
  switch (sort) {
    case 'newest':
      return { id: { lt: cursor.id } };
    case 'price_asc':
      return { OR: [{ price: { gt: cursor.v as number } }, { price: cursor.v as number, id: { gt: cursor.id } }] };
    case 'price_desc':
      return { OR: [{ price: { lt: cursor.v as number } }, { price: cursor.v as number, id: { lt: cursor.id } }] };
    case 'name_asc':
      return { OR: [{ name: { gt: cursor.v as string } }, { name: cursor.v as string, id: { gt: cursor.id } }] };
  }
};

const decode = (sort: ProductSort, encoded: string): Cursor => {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    raw = undefined;
  }
  const result = cursorSchemas[sort].safeParse(raw);
  if (!result.success) {
    // Typically a cursor from a different sort order, or one that was edited by hand
    throw new ValidationFailedException([{ path: 'cursor', message: 'is not a valid cursor for this sort order' }]);
  }
  return result.data;
};
