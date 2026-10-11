import { describe, test, expect } from 'vitest';
import { tax } from './tax.js';
import { cases } from './tax-cases.js';

describe('tax', () => {
  for (const c of cases) {
    test(`${c.region} on ${c.cents} cents is ${c.expected}`, () => {
      expect(tax(c.cents, c.region)).toBe(c.expected);
    });
  }

  test('unknown regions throw', () => {
    expect(() => tax(100, 'ZZ')).toThrow('No tax rate for ZZ');
  });
});
