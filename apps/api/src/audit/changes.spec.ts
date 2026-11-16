import { formatPrice } from '@shop/shared';
import { describeChanges, diffChanges } from './changes.js';

describe('diffChanges', () => {
  const before: { price: number; stock: number; sku: string | null; options: object; endsAt: Date | null } =
    { price: 129900, stock: 4, sku: 'KURTA-M', options: { size: 'M' }, endsAt: new Date('2026-12-31T18:29:59.000Z') };

  it('keeps only the fields that were sent AND are different', () => {
    expect(diffChanges(before, { price: 119900, stock: 4 })).toEqual({ price: { from: 129900, to: 119900 } });
  });

  it('compares objects by content, not by identity', () => {
    expect(diffChanges(before, { options: { size: 'M' } })).toEqual({});
    expect(diffChanges(before, { options: { size: 'L' } })).toEqual({ options: { from: { size: 'M' }, to: { size: 'L' } } });
  });

  it('stores plain JSON: dates as ISO text, a cleared value as null', () => {
    expect(diffChanges(before, { endsAt: null, sku: null })).toEqual({
      endsAt: { from: '2026-12-31T18:29:59.000Z', to: null },
      sku: { from: 'KURTA-M', to: null },
    });
  });
});

describe('describeChanges', () => {
  it('spells out labelled fields, formatted, and just names the rest', () => {
    const changes = { price: { from: 129900, to: 119900 }, stock: { from: 4, to: 10 }, description: { from: 'a', to: 'b' }, sku: { from: null, to: 'X' } };
    expect(describeChanges(changes, { price: ['price', (v) => formatPrice(Number(v))], stock: 'stock', sku: 'SKU' }))
      .toBe('price ₹1,299 → ₹1,199; stock 4 → 10; description changed; SKU (none) → X');
  });
});
