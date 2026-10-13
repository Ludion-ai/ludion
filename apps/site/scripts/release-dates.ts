// The day each lesson's first version came out, for the knowledge dates on /bench. Reads every lesson on disk, takes
// the lowest version its range admits, asks the npm registry when that version was published (the package
// document's `time`), and writes docs/bench/release-dates.json. The build reads only that file, never the network;
// run this again after lessons for new versions land, and commit the file.
//   node apps/site/scripts/release-dates.ts
// The file's `cutoffs` (each model's published knowledge cutoff, with its source) are kept as they are.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import semver from "semver";

const root = resolve(import.meta.dirname, "../../..");
const out = join(root, "docs/bench/release-dates.json");

/** "<package>@<version>" for every npm lesson's lowest version. */
function wanted(): Map<string, Set<string>> {
  const byPackage = new Map<string, Set<string>>();
  const dir = join(root, "lessons");
  for (const subject of readdirSync(dir)) {
    if (!statSync(join(dir, subject)).isDirectory()) continue;
    for (const file of readdirSync(join(dir, subject)).filter((f) => f.endsWith(".json"))) {
      const l = JSON.parse(readFileSync(join(dir, subject, file), "utf8")) as { package?: { ecosystem: string; name: string }; versions?: string };
      if (l.package?.ecosystem !== "npm" || !l.versions) continue;
      const min = semver.minVersion(l.versions)?.version;
      if (!min) continue;
      if (!byPackage.has(l.package.name)) byPackage.set(l.package.name, new Set());
      byPackage.get(l.package.name)!.add(min);
    }
  }
  return byPackage;
}

const previous = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { cutoffs?: unknown }) : {};
const versions: Record<string, string> = {};
for (const [name, mins] of [...wanted()].sort(([a], [b]) => a.localeCompare(b))) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`, { headers: { "User-Agent": "ludion-site/release-dates" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`registry.npmjs.org/${name}: HTTP ${res.status}`);
  const time = ((await res.json()) as { time?: Record<string, string> }).time ?? {};
  for (const v of [...mins].sort(semver.compare)) {
    if (!time[v]) throw new Error(`${name}@${v} has no publish time in the npm registry.`);
    versions[`${name}@${v}`] = time[v];
  }
}
const file = {
  source: "https://registry.npmjs.org/<package>: the time each version was published",
  fetched_at: new Date().toISOString().slice(0, 10),
  versions,
  cutoffs: previous.cutoffs ?? {},
};
writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
console.log(`[ludion] ${Object.keys(versions).length} versions → ${out}`);
