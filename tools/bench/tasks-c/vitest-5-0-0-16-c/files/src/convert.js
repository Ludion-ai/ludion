import { fetchRates } from './rates.js';

export async function convert(amount, to) {
  let rates;
  try {
    rates = await fetchRates();
  } catch (cause) {
    throw new Error('Exchange rates are unavailable, try again later', { cause });
  }
  if (!(to in rates)) throw new Error(`Unknown currency: ${to}`);
  return Math.round(amount * rates[to] * 100) / 100;
}
