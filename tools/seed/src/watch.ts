#!/usr/bin/env node
// Nightly: which covered packages published a stable release since a given time?
//   node tools/seed/src/watch.ts [--since <ISO time>] [--json <out>]
// "Covered" means a format 1 lesson on main names the package. Prints one line per release and, with --json, writes
// [{package, version, date, range}] for the pipeline (range is exactly that version).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

/** npm packages that format 1 lessons in `lessonsDir` are about. */
export function coveredPackages(lessonsDir: string): string[] {
  const names = new Set<string>();
  for (const subject of readdirSync(lessonsDir, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    for (const f of readdirSync(join(lessonsDir, subject.name))) {
      if (!f.endsWith(".json")) continue;
      try {
        const l = JSON.parse(readFileSync(join(lessonsDir, subject.name, f), "utf8")) as { format?: number; package?: { ecosystem: string; name: string } };
        if (l.format === 1 && l.package?.ecosystem === "npm") names.add(l.package.name);
      } catch {
        // Not a lesson.
      }
    }
  }
  return [...names].sort();
}

export interface NewRelease {
  package: string;
  version: string;
  date: string;
  range: string;
}

/** Stable versions published at or after `since`, from the registry's `time` field. */
export function newReleases(pkg: string, time: Record<string, string>, since: string): NewRelease[] {
  return Object.entries(time)
    .filter(([v, t]) => semver.valid(v) && !semver.prerelease(v) && t >= since)
    .sort(([a], [b]) => semver.compare(a, b))
    .map(([version, date]) => ({ package: pkg, version, date, range: version }));
}

async function main() {
  const { values } = parseArgs({ options: { since: { type: "string" }, json: { type: "string" } } });
  // Default: the last 26 hours, so a nightly run overlaps the one before and a late publish isn't missed.
  const since = values.since ?? new Date(Date.now() - 26 * 3600_000).toISOString();
  const found: NewRelease[] = [];
  for (const pkg of coveredPackages(join(REPO_ROOT, "lessons"))) {
    const res = await fetch(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`npm registry answered ${res.status} for ${pkg}.`);
    found.push(...newReleases(pkg, ((await res.json()) as { time: Record<string, string> }).time, since));
  }
  for (const r of found) console.log(`${r.package} ${r.version} (${r.date})`);
  if (!found.length) console.log(`No new stable release of a covered package since ${since}.`);
  if (values.json) writeFileSync(values.json, JSON.stringify(found, null, 2) + "\n");
}

if (import.meta.main) await main();
