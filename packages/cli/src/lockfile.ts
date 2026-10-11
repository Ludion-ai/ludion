// What a project actually installed: package versions from its lockfile, and the Node version it runs on.
// Supported: package-lock.json (v2, v3), pnpm-lock.yaml, yarn.lock (classic and berry), and, with no lockfile,
// node_modules/<name>/package.json for the dependencies package.json names.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Installed {
  /** npm package name → every version installed (nested copies can differ). */
  npm: Map<string, Set<string>>;
  /** The Node version the project runs on, e.g. 24.3.0 or 24 (from .node-version or .nvmrc, else this Node). */
  node: string;
  /** Which file the versions came from. */
  source: string;
}

function add(map: Map<string, Set<string>>, name: string, version: string): void {
  if (!name || !/^\d+\.\d+\.\d+/.test(version)) return;
  const v = version.replace(/\(.*$/, "").trim();
  let set = map.get(name);
  if (!set) map.set(name, (set = new Set()));
  set.add(v);
}

/** package-lock.json v2/v3: "packages": {"node_modules/a/node_modules/@s/b": {"version": "1.2.3"}}. */
export function fromPackageLock(text: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const lock = JSON.parse(text) as { packages?: Record<string, { version?: string; link?: boolean }> };
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path || info.link || !info.version) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    add(map, name, info.version);
  }
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

/** No lockfile: the installed copies of the dependencies package.json names. */
function fromNodeModules(dir: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return map;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, Record<string, string> | undefined>;
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const p = join(dir, "node_modules", name, "package.json");
    if (existsSync(p)) add(map, name, (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? "");
  }
  return map;
}

function nodeVersion(dir: string): string {
  for (const file of [".node-version", ".nvmrc"]) {
    const p = join(dir, file);
    if (existsSync(p)) {
      const v = readFileSync(p, "utf8").trim().replace(/^v/, "");
      if (/^\d+(\.\d+){0,2}$/.test(v)) return v;
    }
  }
  return process.versions.node;
}

export function readInstalled(dir: string): Installed {
  const node = nodeVersion(dir);
  const readers: [string, (text: string) => Map<string, Set<string>>][] = [
    ["package-lock.json", fromPackageLock],
    ["pnpm-lock.yaml", fromPnpmLock],
    ["yarn.lock", fromYarnLock],
  ];
  for (const [file, read] of readers) {
    const p = join(dir, file);
    if (existsSync(p)) return { npm: read(readFileSync(p, "utf8")), node, source: file };
  }
  return { npm: fromNodeModules(dir), node, source: "node_modules" };
}
