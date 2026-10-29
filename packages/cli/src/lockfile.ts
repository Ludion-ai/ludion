// Installed package versions from pnpm-lock.yaml, for `ludion judge` on a pnpm project (security/judge-cli.ts,
// pnpmChanges). package-lock.json is read by the judge itself (security/judge.ts, lockEntries).

const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

/**
 * Record one installed version. Lockfiles may come from anyone, and versions end up in comments,
 * so only a clean semver version is kept (no spaces, quotes, or anything else).
 */
function add(map: Map<string, Set<string>>, name: string, version: string): void {
  const v = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/.exec(version.trim())?.[0];
  if (!name || !v || !PACKAGE_NAME.test(name)) return;
  let set = map.get(name);
  if (!set) map.set(name, (set = new Set()));
  set.add(v);
}

/** pnpm-lock.yaml: package keys like "/vitest@5.0.3:", "vitest@5.0.3:", "'@scope/x@1.0.0(peer@2)':". */
export function fromPnpmLock(text: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^ {2}['"]?\/?((?:@[^@/\s'"]+\/)?[^@/\s'"]+)@(\d+\.\d+\.\d+[^:'"\s(]*)/.exec(line);
    if (m) add(map, m[1]!, m[2]!);
  }
  return map;
}
