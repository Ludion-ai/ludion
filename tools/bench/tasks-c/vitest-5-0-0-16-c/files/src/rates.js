export async function fetchRates() {
  const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
  if (!res.ok) throw new Error(`Exchange-rate API answered ${res.status}`);
  return (await res.json()).rates;
}
