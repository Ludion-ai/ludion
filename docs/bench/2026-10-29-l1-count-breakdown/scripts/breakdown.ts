// The noise rerun's count, broken down by package (lane L1, 2026-10-29): why the judge's production count went from
// 560 (first run, docs/bench/2026-10-28-noise) to 938 (rerun, docs/bench/2026-10-28-noise-v2/result). It reads the two
// committed noise.json files and changes neither. For the reasons, it recomputes the split (production.ts, at the
// version given) over each repository's lockfile and source tree at the recorded SHA, and checks that the recomputed
// production flags equal the rerun's for every vulnerable package. Nothing here runs project code or queries anything:
// the vulnerable versions are the rerun's own OSV results.
//
// Usage, in Docker only (read-only root, non-root, no network, no forwarded environment):
//   docker run --rm --read-only --network none --user 1000:1000 --tmpfs /tmp -e HOME=/tmp -v ludion-l1b-wt:/w:ro \
//     -v ludion-l1b-src:/src:ro -v <out>:/out node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 \
//     node /w/docs/bench/2026-10-29-l1-count-breakdown/scripts/breakdown.ts <split root> /out/<name>.json
// <split root> is a folder holding packages/cli/src/security at the version whose reasons are read.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, outFile] = process.argv.slice(2);
if (!root || !outFile) throw new Error("Usage: node breakdown.ts <split root> <out file>");
const { productionSplit, readSourceTree } = await import(join(root, "packages/cli/src/security/production.ts"));
const { lockEntries, readLock, resolveFrom } = await import(join(root, "packages/cli/src/security/judge.ts"));

const bench = new URL("../../", import.meta.url);
const first = JSON.parse(readFileSync(new URL("2026-10-28-noise/noise.json", bench), "utf8"));
const rerun = JSON.parse(readFileSync(new URL("2026-10-28-noise-v2/result/noise.json", bench), "utf8"));
/** The first run's review: verdict and criterion for every package it left out. */
const verdicts = new Map<string, { production_relevant: string; criterion: string }>();
for (let i = 1; i <= 5; i++) for (const r of JSON.parse(readFileSync(new URL(`2026-10-28-noise/review/verdicts-${i}.json`, bench), "utf8"))) for (const p of r.packages) verdicts.set(`${r.repo}\0${p.name}`, p);

/** The rule a seed's reason names (production.ts's own wording). */
function rule(why: string): string {
  if (why.startsWith("not dev in the lockfile")) return "P0";
  if (why.startsWith("a runtime shipped with the app")) return "P4";
  if (why.startsWith("a bundler helper library")) return "P3";
  if (why.startsWith("imported by ") || why.startsWith("named by a node_modules path in ")) return "P1";
  if (why.startsWith("named by ") || why.startsWith("jsxImportSource in ")) return "P2";
  if (why.startsWith("the build runs it")) return "P6";
  if (why.endsWith(" runs it")) return "P5";
  if (why.startsWith("declared by ") || why.startsWith("reached from no declared dependency")) return "D1 only";
  return `unknown: ${why}`;
}
/** For P1: what kind of file imports it, by its path (a description, not a rule). */
function fileKind(file: string): string {
  const f = file.toLowerCase(), base = f.split("/").at(-1)!;
  if (/(^|\/)\.storybook\//.test(f) || /\.stories\./.test(base) || /\.story\./.test(base)) return "story or storybook";
  if (/(^|[./-])(vite|vitest|webpack|rollup|astro|next|nuxt|svelte|tailwind|postcss|babel|tsup|electron|playwright|jest|eslint)[^/]*\.config\./.test(base) || /\.config\.[^/]+$/.test(base)) return "a tool's configuration file";
  if (/(^|\/)(scripts?|tools?|bin|build|tasks?)\//.test(f)) return "a script or tool folder";
  if (/(test|mock|fixture|spec)/.test(f)) return "test-like name, not excluded";
  if (/(^|\/)(examples?|demos?|docs?|playground|sandbox)\//.test(f)) return "example, demo or docs";
  return "other source";
}

type Copy = { path: string; name: string; version: string; production: boolean; why: string };
const rows: any[] = [], mismatches: any[] = [];
for (const r of rerun.rows) {
  const dir = `/src/${r.repo.replace("/", "__")}`;
  if (!existsSync(join(dir, ".ludion-sha")) || readFileSync(join(dir, ".ludion-sha"), "utf8") !== r.sha) { mismatches.push({ repo: r.repo, error: "no source tree at the recorded SHA" }); continue; }
  const tree = readSourceTree(dir);
  const source = { ...tree, files: tree.files.filter((f: string) => f !== ".ludion-sha") };
  const lockText = readFileSync(join(dir, "package-lock.json"), "utf8"), manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const split = productionSplit(lockText, source, manifest);
  const copies: Map<string, Copy> = split.copies;
  const lock = readLock(lockText), entries = lockEntries(lockText), byPath = new Map(entries.map((e: any) => [e.path, e]));
  // Reverse edges among installed copies (dependencies, optionalDependencies, peerDependencies), as production.ts follows them.
  const parents = new Map<string, string[]>();
  for (const e of entries) for (const group of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = lock[e.path]?.[group];
    for (const name of Object.keys(deps && typeof deps === "object" ? deps : {})) {
      const dep = resolveFrom(byPath, `${e.path}/`, name);
      if (dep) parents.set(dep.path, [...(parents.get(dep.path) ?? []), e.path]);
    }
  }
  const isSeed = (c: Copy) => c.production && !c.why.startsWith("a dependency of ");
  /** The chain production.ts recorded, from the copy up to its seed. */
  const chain = (c: Copy) => {
    const out: string[] = [];
    for (let at: Copy | undefined = c, n = 0; at && n < 10_000; n++) {
      out.push(`${at.path}@${at.version}`);
      if (isSeed(at)) return { seed: at, path: out };
      const m = / at (\S+), which is production$/.exec(at.why);
      at = m ? copies.get(m[1]!) : undefined;
    }
    return { seed: null, path: out };
  };
  /** Every seed that reaches the copy through production copies, with its rule. */
  const seedsOf = (start: Copy) => {
    const seen = new Set([start.path]), queue = [start.path], found: { path: string; rule: string; why: string }[] = [];
    while (queue.length) {
      const c = copies.get(queue.shift()!)!;
      if (isSeed(c)) found.push({ path: c.path, rule: rule(c.why), why: c.why });
      for (const p of parents.get(c.path) ?? []) if (!seen.has(p) && copies.get(p)?.production) { seen.add(p); queue.push(p); }
    }
    return found;
  };

  const firstRow = first.rows.find((x: any) => x.repo === r.repo);
  const firstProduction = new Set(firstRow.ludion.production.map((v: any) => v.name));
  const counted: any[] = [];
  for (const v of [...r.ludion.production, ...r.ludion.dev_only]) {
    const prod = [...copies.values()].filter(c => c.name === v.name && v.versions.includes(c.version) && c.production);
    if ((prod.length > 0) !== v.production) mismatches.push({ repo: r.repo, name: v.name, rerun: v.production, recomputed: prod.length > 0 });
    if (!prod.length) continue;
    const item: any = { name: v.name, in_first_run: firstProduction.has(v.name) };
    if (!item.in_first_run) {
      const verdict = verdicts.get(`${r.repo}\0${v.name}`);
      item.first_run_verdict = verdict ? `${verdict.production_relevant}${verdict.criterion && verdict.criterion !== "none" ? ` (${verdict.criterion})` : ""}` : "not on the first run's left-out list";
      const c = chain(prod[0]!);
      item.recorded = { copy: prod[0]!.path, seed_rule: c.seed ? rule(c.seed.why) : "unknown", seed: c.seed?.path ?? null, seed_why: c.seed?.why ?? null, path: c.path };
      if (c.seed && rule(c.seed.why) === "P1") item.recorded.file_kind = fileKind(c.seed.why.replace(/^imported by |^named by a node_modules path in |'s scripts$/g, ""));
      const all = prod.flatMap(seedsOf);
      item.rules_reaching = [...new Set(all.map(s => s.rule))].sort();
      item.seeds_reaching = all.length;
    }
    counted.push(item);
  }
  rows.push({ repo: r.repo, split: r.split.source, images_with_dev: r.split.images_with_dev, first_run: firstRow.ludion.count, rerun: r.ludion.count, recomputed: counted.length, counted });
}

// Per package: in how many repositories it is counted, first run and rerun, and why each added one is production.
const perPackage = new Map<string, any>();
for (const row of rows) for (const c of row.counted) {
  const p = perPackage.get(c.name) ?? { name: c.name, first_run: 0, rerun: 0, added: 0, recorded_rule: {}, first_run_verdict: {}, repositories_added: [] };
  p.rerun++;
  if (c.in_first_run) p.first_run++;
  else {
    p.added++;
    p.recorded_rule[c.recorded.seed_rule] = (p.recorded_rule[c.recorded.seed_rule] ?? 0) + 1;
    p.first_run_verdict[c.first_run_verdict] = (p.first_run_verdict[c.first_run_verdict] ?? 0) + 1;
    p.repositories_added.push({ repo: row.repo, seed: c.recorded.seed, seed_why: c.recorded.seed_why, rules_reaching: c.rules_reaching });
  }
  perPackage.set(c.name, p);
}
const tally = (f: (c: any, row: any) => string | string[]) => {
  const out: Record<string, number> = {};
  for (const row of rows) for (const c of row.counted) if (!c.in_first_run) for (const k of [f(c, row)].flat()) out[k] = (out[k] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};
const sum = (k: string) => rows.reduce((s, r) => s + r[k], 0);
writeFileSync(outFile, JSON.stringify({
  split_root: root,
  repositories: rows.length,
  totals: { first_run: sum("first_run"), rerun: sum("rerun"), recomputed: sum("recomputed"), added: rows.reduce((s, r) => s + r.counted.filter((c: any) => !c.in_first_run).length, 0) },
  mismatches,
  added_by_recorded_rule: tally(c => c.recorded.seed_rule),
  added_by_recorded_rule_and_split: tally((c, row) => `${c.recorded.seed_rule} / split ${row.images_with_dev.length ? "D1 only (image holds devDependencies)" : row.split === "read" ? "D1 and D2" : `D1 only (${row.split})`}`),
  added_p1_by_file_kind: tally(c => c.recorded.seed_rule === "P1" ? c.recorded.file_kind : "not P1"),
  added_by_rules_reaching: tally(c => c.rules_reaching.join(" + ")),
  added_with_only_one_rule: tally(c => c.rules_reaching.length === 1 ? c.rules_reaching[0] : "more than one rule"),
  added_by_first_run_verdict: tally(c => c.first_run_verdict),
  packages: [...perPackage.values()].sort((a, b) => b.added - a.added || b.rerun - a.rerun || a.name.localeCompare(b.name)),
  rows,
}, null, 1));
console.log(JSON.stringify({ totals: { first_run: sum("first_run"), rerun: sum("rerun"), recomputed: sum("recomputed") }, mismatches: mismatches.length }));
