import { test, expect } from 'vitest';
import { applyCoupon } from './coupon.js';

test('SAVE10 takes 10% off', () => {
  expect(applyCoupon(200, 'SAVE10')).resolves.toBe(180);
});

test('codes are case-insensitive', () => {
  expect(applyCoupon(200, 'save10')).resolves.toBe(180);
});

test('unknown codes are rejected', () => {
  expect(applyCoupon(200, 'NOPE')).rejects.toThrow('Unknown coupon');
});
