// Installed package versions from a lockfile: package-lock.json (v1–v3), pnpm-lock.yaml, yarn.lock (classic and berry).
// The security inventory (security/inventory.ts) reads npm projects through these.

const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

/**
 * Record one installed version. Lockfiles may come from anyone, and versions end up in reports,
 * so only a clean semver version is kept (no spaces, quotes, or anything else).
 */
function add(map: Map<string, Set<string>>, name: string, version: string): void {
  const v = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/.exec(version.trim())?.[0];
  if (!name || !v || !PACKAGE_NAME.test(name)) return;
  let set = map.get(name);
  if (!set) map.set(name, (set = new Set()));
  set.add(v);
}

/** package-lock.json v2/v3: "packages": {"node_modules/a/node_modules/@s/b": {"version": "1.2.3"}}. */
export function fromPackageLock(text: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  type V1 = { version?: string; dependencies?: Record<string, V1> };
  const lock = JSON.parse(text) as { packages?: Record<string, { version?: string; link?: boolean; name?: string }>; dependencies?: Record<string, V1> };
  if (lock.packages) {
    for (const [path, info] of Object.entries(lock.packages)) {
      // Only installed packages: workspace folders (packages/x) have no node_modules/ in their path.
      const at = path.lastIndexOf("node_modules/");
      if (at < 0 || info.link || !info.version) continue;
      // An alias ("my-vitest": "npm:vitest@5") records the real package in "name".
      add(map, info.name ?? path.slice(at + "node_modules/".length), info.version);
    }
    return map;
  }
  // lockfileVersion 1: a nested "dependencies" tree.
  const walk = (deps: Record<string, V1> | undefined) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      const alias = /^npm:((?:@[^@/]+\/)?[^@]+)@/.exec(info.version ?? "");
      add(map, alias ? alias[1]! : name, alias ? info.version!.slice(alias[0].length) : (info.version ?? ""));
      walk(info.dependencies);
    }
  };
  walk(lock.dependencies);
  return map;
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

/** yarn.lock: an entry line naming the package, then `version "1.2.3"` (classic) or `version: 1.2.3` (berry). */
export function fromYarnLock(text: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  let names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line) && line.trimEnd().endsWith(":")) {
      names = line
        .slice(0, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .map((spec) => /^((?:@[^@/]+\/)?[^@]+)@/.exec(spec)?.[1] ?? "")
        .filter(Boolean);
      continue;
    }
    const v = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line);
    if (v && names.length) for (const n of new Set(names)) add(map, n, v[1]!);
  }
  return map;
}
