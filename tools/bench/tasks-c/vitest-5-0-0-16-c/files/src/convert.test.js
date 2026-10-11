import { describe, test, expect, vi } from 'vitest';
import { convert } from './convert.js';

describe('convert', () => {
  vi.mock('./rates.js', () => ({
    fetchRates: async () => ({ EUR: 0.9, JPY: 150 }),
  }));

  test('converts with the current rate', async () => {
    await expect(convert(10, 'EUR')).resolves.toBe(9);
  });

  test('rejects unknown currencies', async () => {
    await expect(convert(10, 'XYZ')).rejects.toThrow('Unknown currency: XYZ');
  });
});
