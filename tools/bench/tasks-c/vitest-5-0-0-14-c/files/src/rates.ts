export interface Rates { base: string; date: string; rates: Record<string, number> }

export async function latestRates(base = "USD"): Promise<Rates> {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`);
  if (!res.ok) throw new Error(`Exchange-rate API answered ${res.status}`);
  return (await res.json()) as Rates;
}
