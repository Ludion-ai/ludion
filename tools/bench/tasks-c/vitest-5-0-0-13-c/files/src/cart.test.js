import { describe, test, expect } from 'vitest';
import { checkout, moveToCart } from './cart.js';

describe('cart', () => {
  describe('checkout', () => {
    test('charges the total', () => {
      expect(checkout({ items: [{ price: 2, qty: 3 }] }).charged).toBe(6);
    });

    test('rejects an empty cart', () => {
      expect(() => checkout({ items: [] })).toThrow('Your cart is empty');
    });
  });

  describe('items', () => {
    test('counts every line', () => {
      expect(checkout({ items: [{ price: 1, qty: 1 }, { price: 1, qty: 2 }] }).items).toBe(2);
    });
  });
});

describe('wishlist', () => {
  describe('checkout', () => {
    test('moves items to the cart', () => {
      const result = moveToCart({ items: [{ price: 5, qty: 1 }] }, { items: [] });
      expect(result.cart.items).toHaveLength(1);
    });
  });
});
