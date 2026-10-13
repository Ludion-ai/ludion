// Whole days between two dates, in UTC. No Node imports: the browser uses it too (components/Measured.astro).
export function daysBetween(from: string, to: Date): number {
  const start = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}
