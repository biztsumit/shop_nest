import { normaliseOptions, optionsKey } from './variant-options.js';

describe('variant options', () => {
  it('gives the same key whatever the order of the options', () => {
    expect(optionsKey({ size: 'M', colour: 'Black' })).toBe('colour=Black;size=M');
    expect(optionsKey({ colour: 'Black', size: 'M' })).toBe('colour=Black;size=M');
  });

  it('treats option names case-insensitively, but keeps value case', () => {
    expect(optionsKey({ ' Size ': ' M ', Colour: 'Black' })).toBe('colour=Black;size=M');
    expect(optionsKey({ size: 'm' })).not.toBe(optionsKey({ size: 'M' }));
  });

  it('a product without options has the empty key', () => {
    expect(optionsKey({})).toBe('');
  });

  it('normalises the options that are stored, the same way as the key', () => {
    expect(normaliseOptions({ Size: ' XL ' })).toEqual({ size: 'XL' });
  });
});
