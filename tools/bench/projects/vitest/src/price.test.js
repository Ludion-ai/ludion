import { test, expect } from 'vitest';
import { total } from './price.js';

test('adds prices', () => {
  expect(total([{ price: 2, qty: 3 }, { price: 1, qty: 1 }])).toBe(7);
});
