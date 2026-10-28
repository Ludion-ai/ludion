// Builds the shadow's frozen watched list (docs/decisions/2026-10-29-shadow-counting.md, section 1): every package name
// and version in this repository's root lockfile and in the noise measurement's 100 root lockfiles at their recorded
// SHAs, read with the judge's own lockfile reader. Reads public lockfiles only. Run in Docker from the repository root:
//   node tools/shadow/src/watched.ts <sha of this repository's lockfile> > tools/shadow/watched.json
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lockEntries } from "../../../packages/cli/src/security/judge.ts";

export type Watched = { made_at: string; sources: { source: string; sha: string; entries: number; sha256: string }[]; names: Record<string, string[]> };

/** Name -> sorted distinct versions, over every lockfile given. */
export function watchedFrom(lockfiles: { source: string; sha: string; text: string }[], madeAt: string): Watched {
  const names = new Map<string, Set<string>>();
  const sources = lockfiles.map(l => {
    const entries = lockEntries(l.text);
    for (const e of entries) { const set = names.get(e.name) ?? new Set<string>(); set.add(e.version); names.set(e.name, set); }
    return { source: l.source, sha: l.sha, entries: entries.length, sha256: createHash("sha256").update(l.text).digest("hex") };
  });
  const sorted = Object.fromEntries([...names].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([n, v]) => [n, [...v].sort()]));
  return { made_at: madeAt, sources, names: sorted };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dogfoodSha = process.argv[2];
  if (!dogfoodSha) throw new Error("usage: watched.ts <sha of this repository's package-lock.json>");
  const noise = JSON.parse(readFileSync("docs/bench/2026-10-28-noise/noise.json", "utf8")) as { rows: { repo: string; sha: string }[] };
  const lockfiles = [{ source: "Ludion-ai/ludion", sha: dogfoodSha, text: readFileSync("package-lock.json", "utf8") }];
  for (const row of noise.rows) {
    const res = await fetch(`https://raw.githubusercontent.com/${row.repo}/${row.sha}/package-lock.json`, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${row.repo}@${row.sha}: HTTP ${res.status}`);
    lockfiles.push({ source: row.repo, sha: row.sha, text: await res.text() });
  }
  process.stdout.write(JSON.stringify(watchedFrom(lockfiles, new Date().toISOString())) + "\n");
}
