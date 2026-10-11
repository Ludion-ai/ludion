const RATES = { CA: 0.0725, NY: 0.04, TX: 0.0625, OR: 0 };

export function tax(cents, region) {
  if (!(region in RATES)) throw new Error(`No tax rate for ${region}`);
  return Math.round(cents * RATES[region]);
}
