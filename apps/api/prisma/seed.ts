// Demo data: a believable shop to click around in, and for the storefront to show.
//
//   npm run db:seed -w @shop/api      (also runs after `prisma migrate reset`)
//
// - Safe to run again and again: everything is found by its slug and created or updated
//   ("upsert"), never duplicated. Products it doesn't know about are left alone.
// - Checked against the SAME shared schemas the API uses for admin input: invalid demo data
//   (a sale price below the price, a bad slug...) fails here, loudly.
// - Refuses to run in production.
import { PrismaPg } from '@prisma/adapter-pg';
import { createCategorySchema, createProductSchema, slugify, type ProductStatus } from '@shop/shared';
import { pathToFileURL } from 'node:url';
import { optionsKey, normaliseOptions } from '../src/catalog/variant-options.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

type Options = Record<string, string>;
type DemoProduct = {
  name: string;
  code: string;                       // the shop's product code: the start of every SKU
  category: string;                   // category slug
  description: string;
  price: number;                      // paise
  compareAtPrice?: number;            // on sale: the "was" price
  status?: ProductStatus;
  // Each option and its values: every combination becomes a variant
  options?: Record<string, string[]>;
  soldOut?: Options[];                // combinations with no stock
  priceBySize?: Record<string, number>; // bigger sizes can cost more
};

const CATEGORIES: Array<{ name: string; slug: string; parent?: string; description: string }> = [
  { name: 'Clothing', slug: 'clothing', description: 'Everyday clothes in natural fabrics.' },
  { name: 'T-shirts', slug: 't-shirts', parent: 'clothing', description: 'Soft cotton tees, plain and printed.' },
  { name: 'Hoodies', slug: 'hoodies', parent: 'clothing', description: 'Warm layers for cool evenings.' },
  { name: 'Jeans', slug: 'jeans', parent: 'clothing', description: 'Denim that lasts.' },
  { name: 'Footwear', slug: 'footwear', description: 'Shoes for walking, running and everything between.' },
  { name: 'Home & Kitchen', slug: 'home-kitchen', description: 'Small things that make a home.' },
  { name: 'Accessories', slug: 'accessories', description: 'Bags, wallets, hats and watches.' },
  { name: 'Electronics', slug: 'electronics', description: 'Audio and gadgets.' },
];

const SIZES = ['S', 'M', 'L', 'XL'];

const PRODUCTS: DemoProduct[] = [
  {
    name: 'Classic Cotton Tee', code: 'CCT', category: 't-shirts', price: 59900,
    description: 'A heavyweight 100% cotton T-shirt with a relaxed fit. Pre-shrunk, so it keeps its shape wash after wash.',
    options: { size: SIZES, colour: ['Black', 'White', 'Navy'] },
    soldOut: [{ size: 'XL', colour: 'Navy' }, { size: 'S', colour: 'White' }],
  },
  {
    name: 'Graphic Print Tee', code: 'GPT', category: 't-shirts', price: 59900, compareAtPrice: 79900,
    description: 'Soft cotton tee with a hand-drawn mountain print. Printed with water-based inks.',
    options: { size: ['S', 'M', 'L'], colour: ['Black'] },
  },
  {
    name: 'Organic Crew Neck', code: 'OCN', category: 't-shirts', price: 89900,
    description: 'Made from certified organic cotton, with a slightly longer cut and a ribbed collar.',
    options: { size: SIZES, colour: ['Olive', 'Cream'] },
  },
  {
    name: 'Fleece Pullover Hoodie', code: 'FPH', category: 'hoodies', price: 189900,
    description: 'Brushed fleece inside, a roomy hood and a kangaroo pocket. Ideal for winter mornings.',
    options: { size: SIZES, colour: ['Grey', 'Black'] },
    priceBySize: { XL: 199900 },
  },
  {
    name: 'Zip-Up Hoodie', code: 'ZUH', category: 'hoodies', price: 199900, compareAtPrice: 249900,
    description: 'A full-zip hoodie with metal hardware and side pockets.',
    options: { size: ['M', 'L'], colour: ['Navy'] },
  },
  {
    name: 'Slim Fit Jeans', code: 'SFJ', category: 'jeans', price: 249900,
    description: 'Stretch denim in a deep indigo wash. Slim through the thigh, tapered at the ankle.',
    options: { waist: ['28', '30', '32', '34'] },
    soldOut: [{ waist: '28' }],
  },
  {
    name: 'Everyday Running Shoes', code: 'ERS', category: 'footwear', price: 299900,
    description: 'Lightweight mesh upper and a cushioned sole for daily runs and long walks.',
    options: { size: ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10'], colour: ['Black', 'White'] },
  },
  {
    name: 'Canvas Sneakers', code: 'CSN', category: 'footwear', price: 149900,
    description: 'Classic low-top canvas sneakers with a vulcanised rubber sole.',
    options: { size: ['UK 6', 'UK 7', 'UK 8', 'UK 9'], colour: ['White', 'Red'] },
  },
  {
    name: 'Leather Sandals', code: 'LSD', category: 'footwear', price: 129900,
    description: 'Handmade leather sandals with an adjustable strap. Back soon.',
    options: { size: ['UK 7', 'UK 8', 'UK 9'] },
    soldOut: [{ size: 'UK 7' }, { size: 'UK 8' }, { size: 'UK 9' }],   // the whole product is sold out
  },
  {
    name: 'Ceramic Coffee Mug', code: 'CCM', category: 'home-kitchen', price: 34900,
    description: 'A 350 ml stoneware mug, glazed by hand. Microwave and dishwasher safe.',
    options: { colour: ['White', 'Sage'] },
  },
  {
    name: 'LED Desk Lamp', code: 'LDL', category: 'home-kitchen', price: 129900,
    description: 'Adjustable arm, three colour temperatures and a USB charging port in the base.',
  },
  {
    name: 'Cotton Throw Blanket', code: 'CTB', category: 'home-kitchen', price: 149900, compareAtPrice: 199900,
    description: 'A woven cotton throw, 130 × 170 cm, with tasselled edges.',
  },
  {
    name: 'Glass Water Bottle', code: 'GWB', category: 'home-kitchen', price: 79900,
    description: 'Borosilicate glass with a silicone sleeve and a bamboo lid. 750 ml.',
  },
  {
    name: 'Cast Iron Skillet', code: 'CIS', category: 'home-kitchen', price: 249900,
    description: 'Pre-seasoned 26 cm cast iron pan. Works on gas, induction and in the oven.',
  },
  {
    name: 'Canvas Tote Bag', code: 'TOTE', category: 'accessories', price: 49900,
    description: 'Sturdy 12 oz canvas tote with an inside pocket.',
  },
  {
    name: 'Leather Wallet', code: 'LWL', category: 'accessories', price: 99900,
    description: 'Slim bifold wallet in full-grain leather, with six card slots.',
    options: { colour: ['Brown', 'Black'] },
  },
  {
    name: 'Wool Beanie', code: 'WBN', category: 'accessories', price: 59900,
    description: 'A ribbed merino wool beanie. Warm without being itchy.',
    options: { colour: ['Grey', 'Navy', 'Mustard'] },
  },
  {
    name: 'Analog Wrist Watch', code: 'AWW', category: 'accessories', price: 499900,
    description: 'Minimal steel watch with a sapphire-coated glass and a leather strap.',
  },
  {
    name: 'Wireless Earbuds', code: 'WEB', category: 'electronics', price: 199900, compareAtPrice: 249900,
    description: 'Bluetooth 5.3 earbuds with noise reduction and up to 24 hours with the case.',
    options: { colour: ['Black', 'White'] },
  },
  {
    name: 'Portable Bluetooth Speaker', code: 'PBS', category: 'electronics', price: 349900,
    description: 'Water-resistant speaker with 12 hours of play time.',
  },
  // Not visible in the shop: being prepared, or no longer sold
  { name: 'Winter Parka', code: 'WPK', category: 'clothing', price: 549900, status: 'DRAFT', description: 'Coming this winter.', options: { size: SIZES } },
  { name: 'Silk Scarf', code: 'SSC', category: 'accessories', price: 129900, status: 'DRAFT', description: 'Coming soon.' },
  { name: 'Retro Phone Case', code: 'RPC', category: 'electronics', price: 39900, status: 'ARCHIVED', description: 'No longer sold.' },
];

// Every combination of the options: {size: [S, M], colour: [Black]} → [{size: S, colour: Black}, {size: M, colour: Black}]
const combinations = (options: Record<string, string[]> = {}): Options[] =>
  Object.entries(options).reduce<Options[]>(
    (combos, [name, values]) => combos.flatMap((combo) => values.map((value) => ({ ...combo, [name]: value }))),
    [{}],
  );

// The same "random" stock on every run (computed from the text), so re-seeding changes nothing
const stableNumber = (text: string, max: number): number => {
  let hash = 7;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;   // >>> 0 keeps it a positive 32-bit number
  }
  return hash % max;
};

// Code "CCT" + {size: M, colour: Black} → "CCT-BLACK-M" (option values in option-name order)
const skuOf = (code: string, options: Options): string =>
  [code, ...Object.values(normaliseOptions(options)).map((v) => v.replace(/\s+/g, ''))].join('-').toUpperCase();

const sameOptions = (a: Options, b: Options) => optionsKey(a) === optionsKey(b);

// Every demo product, built and checked against the shared input schema (categoryId comes later)
const buildProducts = () =>
  PRODUCTS.map((p) => {
    const slug = slugify(p.name);
    return createProductSchema.parse({
      name: p.name,
      slug,
      description: p.description,
      status: p.status ?? 'ACTIVE',
      variants: combinations(p.options).map((options) => {
        const soldOut = p.soldOut?.some((o) => sameOptions(o, options)) ?? false;
        return {
          options,
          sku: skuOf(p.code, options),
          price: (options.size && p.priceBySize?.[options.size]) || p.price,
          compareAtPrice: p.compareAtPrice ?? null,
          stock: soldOut ? 0 : 3 + stableNumber(`${slug}${optionsKey(options)}`, 25),
        };
      }),
      images: [1, 2].map((n) => ({ url: `https://picsum.photos/seed/${slug}-${n}/800/800`, alt: `${p.name}, photo ${n}` })),
    });
  });

export async function seedCatalog(prisma: PrismaClient): Promise<{ categories: number; products: number; variants: number }> {
  // Build and check EVERYTHING before writing anything: a mistake in the demo data stops the
  // seed with a clear message instead of leaving the database half-seeded
  const products = buildProducts();
  const skus = products.flatMap((p) => p.variants.map((v) => v.sku));
  const repeated = [...new Set(skus.filter((sku, i) => sku !== null && skus.indexOf(sku) !== i))];
  if (repeated.length > 0) {
    throw new Error(`SKUs must be unique across the shop. Repeated: ${repeated.join(', ')}`);
  }

  // Categories, parents first so children can point at them
  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const data = createCategorySchema.parse({ ...c, parentId: c.parent ? categoryIds.get(c.parent) : null });
    const row = await prisma.category.upsert({ where: { slug: data.slug }, create: data, update: data });
    categoryIds.set(row.slug, row.id);
  }

  let variantCount = 0;
  for (const [index, input] of products.entries()) {
    const slug = input.slug;
    const categoryId = categoryIds.get(PRODUCTS[index]!.category) ?? null;

    // One product = one transaction: it's never left half-written
    await prisma.$transaction(async (tx) => {
      const { variants, images, ...rest } = input;
      const fields = { ...rest, categoryId };
      const product = await tx.product.upsert({ where: { slug }, create: fields, update: fields });

      // Variants: update those that exist, add new ones, remove ones no longer in the demo data
      const keys = variants.map((v) => optionsKey(v.options));
      await tx.productVariant.deleteMany({ where: { productId: product.id, optionsKey: { notIn: keys } } });
      for (const [position, v] of variants.entries()) {
        const data = { ...v, options: normaliseOptions(v.options), optionsKey: optionsKey(v.options), position };
        await tx.productVariant.upsert({
          where: { productId_optionsKey: { productId: product.id, optionsKey: data.optionsKey } },
          create: { ...data, productId: product.id },
          update: data,
        });
      }

      // Images: simply replaced
      await tx.productImage.deleteMany({ where: { productId: product.id } });
      await tx.productImage.createMany({ data: images.map((image, position) => ({ ...image, position, productId: product.id })) });
    });
    variantCount += input.variants.length;
  }

  return { categories: CATEGORIES.length, products: PRODUCTS.length, variants: variantCount };
}

// Run directly (not when a test imports seedCatalog)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo data into a production database.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (see apps/api/.env.example).');
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const database = new URL(url).pathname.slice(1);
    const counts = await seedCatalog(prisma);
    console.log(`Seeded "${database}": ${counts.categories} categories, ${counts.products} products, ${counts.variants} variants.`);
  } finally {
    await prisma.$disconnect();
  }
}
