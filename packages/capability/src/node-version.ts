/** Major from `vX.Y.Z` or `X.Y.Z`. The guard and receipt reuse compare this and ignore the patch. */
export function nodeMajor(version: string): string | null {
  const m = /^v?(\d+)\.\d+\.\d+$/.exec(version.trim());
  return m?.[1] ?? null;
}
