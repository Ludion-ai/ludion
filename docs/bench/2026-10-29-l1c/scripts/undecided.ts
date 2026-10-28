// L1c, step 1 (lane L1c, 2026-10-29): of the 938 vulnerable packages the noise rerun counts as production
// (docs/bench/2026-10-28-noise-v2/result/noise.json), how many are production only because the split could not decide,
// by the reading that was missing. For each reading, the split (production.ts at the version given) is recomputed with
// that one fallback turned off, and the packages that stop being production are the ones that fallback alone made
// production. A variant is a probe, not a definition: none of them is the judge.
// The vulnerable versions are the rerun's own OSV results. Nothing is queried and no project code runs.
//
// Usage, in Docker only (read-only root, non-root, no network, no forwarded environment):
//   docker run --rm --read-only --network none --user 1000:1000 --tmpfs /tmp -e HOME=/tmp -v <worktree>:/w:ro \
//     -v ludion-l1b-src:/src:ro -v <out>:/out node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 \
//     node /w/docs/bench/2026-10-29-l1c/scripts/undecided.ts /w /out/undecided.json
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, outFile] = process.argv.slice(2);
if (!root || !outFile) throw new Error("Usage: node undecided.ts <split root> <out file>");
const security = join(root, "packages/cli/src/security");
const original = readFileSync(join(security, "production.ts"), "utf8");

/** One probe per fallback: the text in production.ts it replaces. Each must match exactly once. */
const VARIANTS: Record<string, { what: string; patch: [string, string][] }> = {
  image: {
    what: "D1 only because a production Dockerfile's final stage holds devDependencies (D2 not used)",
    patch: [["const ruleB = !!source && incomplete === null && !imagesWithDev.length;", "const ruleB = !!source && incomplete === null;"]],
  },
  incomplete: {
    what: "D1 only because the source tree is incomplete (D2 not used)",
    patch: [["const ruleB = !!source && incomplete === null && !imagesWithDev.length;", "const ruleB = !!source && !imagesWithDev.length;"]],
  },
  any_copy: {
    what: "an import that no node_modules up the file's path resolves seeds every installed copy of that name",
    patch: [["    for (const e of byName.get(name) ?? []) seed(e, why);\n", "    void 0;\n"]],
  },
  nested_declared: {
    what: "a file in a folder with its own package.json that is not a lockfile folder (not the root or a workspace), importing a name that package.json declares",
    patch: [["    if (!name) return;\n", "    if (!name) return;\n    if ((globalThis as any).__nested?.(file, name, false)) return;\n"]],
  },
  nested_locked: {
    what: "as nested_declared, and that folder's own package-lock.json installs the name at its own node_modules",
    patch: [["    if (!name) return;\n", "    if (!name) return;\n    if ((globalThis as any).__nested?.(file, name, true)) return;\n"]],
  },
  bin_nested: {
    what: "a command's bin name seeds copies nested inside another package's node_modules, which are not on the script's PATH",
    patch: [["bins.set(b, [...(bins.get(b) ?? []), e]);", "{ if (e.path.split(\"node_modules/\").length === 2) bins.set(b, [...(bins.get(b) ?? []), e]); }"]],
  },
  peer: {
    what: "following peerDependencies from a production copy",
    patch: [["      for (const group of [\"dependencies\", \"optionalDependencies\", \"peerDependencies\"]) for (const name of Object.keys(item[group]", "      for (const group of [\"dependencies\", \"optionalDependencies\"]) for (const name of Object.keys(item[group]"]],
  },
  optional: {
    what: "following optionalDependencies from a production copy",
    patch: [["      for (const group of [\"dependencies\", \"optionalDependencies\", \"peerDependencies\"]) for (const name of Object.keys(item[group]", "      for (const group of [\"dependencies\", \"peerDependencies\"]) for (const name of Object.keys(item[group]"]],
  },
};

/** Each variant gets its own copy of the security folder, so production.ts's relative imports still resolve. */
const splits: Record<string, any> = { base: await import(join(security, "production.ts")) };
for (const [key, v] of Object.entries(VARIANTS)) {
  let text = original;
  for (const [from, to] of v.patch) {
    if (text.split(from).length !== 2) throw new Error(`${key}: the patch text does not occur exactly once`);
    text = text.replace(from, to);
  }
  const dir = `/tmp/variant-${key}/security`;
  mkdirSync(dir, { recursive: true });
  cpSync(security, dir, { recursive: true });
  writeFileSync(join(dir, "production.ts"), text);
  // judge.ts imports semver: the copy resolves it from the split root's node_modules.
  symlinkSync(join(root, "node_modules"), `/tmp/variant-${key}/node_modules`);
  splits[key] = await import(join(dir, "production.ts"));
}
const { readLock } = await import(join(security, "judge.ts"));

const bench = new URL("../../", import.meta.url);
const rerun = JSON.parse(readFileSync(new URL("2026-10-28-noise-v2/result/noise.json", bench), "utf8"));

/** For the nested probes: the nearest folder above `file` with a package.json, when it is not a lockfile folder. */
function nestedProbe(source: any, folders: Set<string>, lockOf: (dir: string) => Record<string, any> | null) {
  const manifests = new Map<string, any>();
  for (const f of source.files) if (f === "package.json" || f.endsWith("/package.json")) {
    try { manifests.set(f.slice(0, -"package.json".length), JSON.parse(source.read(f) ?? "null")); } catch { /* not JSON */ }
  }
  return (file: string, name: string, locked: boolean) => {
    const parts = file.split("/").slice(0, -1);
    for (let i = parts.length; i >= 1; i--) {
      const dir = parts.slice(0, i).map(p => `${p}/`).join("");
      if (folders.has(dir)) return false;
      const pkg = manifests.get(dir);
      if (pkg === undefined) continue;
      const declared = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].some(g => pkg?.[g] && typeof pkg[g] === "object" && Object.hasOwn(pkg[g], name));
      if (!declared) return false;
      if (!locked) return true;
      const lock = lockOf(dir);
      return !!lock && Object.hasOwn(lock, `node_modules/${name}`);
    }
    return false;
  };
}

const counts: Record<string, number> = Object.fromEntries(["base", ...Object.keys(VARIANTS)].map(k => [k, 0]));
const dropped: Record<string, { repo: string; name: string }[]> = Object.fromEntries(Object.keys(VARIANTS).map(k => [k, []]));
const bundledOnly: { repo: string; name: string }[] = [];
/** The base split against the rerun's own production flags, per (repository, package). */
const changed: { repo: string; name: string; now: string }[] = [];
const repos: any[] = [];
for (const r of rerun.rows) {
  const dir = `/src/${r.repo.replace("/", "__")}`;
  if (!existsSync(join(dir, ".ludion-sha")) || readFileSync(join(dir, ".ludion-sha"), "utf8") !== r.sha) throw new Error(`${r.repo}: no source tree at the recorded SHA`);
  const lockText = readFileSync(join(dir, "package-lock.json"), "utf8"), manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const lock = readLock(lockText);
  const folders = new Set(Object.keys(lock).filter(p => !p.includes("node_modules/")).map(p => (p ? `${p}/` : "")));
  const vulnerable: { name: string; versions: string[] }[] = [...r.ludion.production, ...r.ludion.dev_only];
  const row: any = { repo: r.repo, rerun: r.ludion.count };
  for (const key of ["base", ...Object.keys(VARIANTS)]) {
    const tree = splits[key].readSourceTree(dir);
    const source = { ...tree, files: tree.files.filter((f: string) => f !== ".ludion-sha") };
    (globalThis as any).__nested = nestedProbe(source, folders, d => { try { return readLock(source.read(`${d}package-lock.json`) ?? ""); } catch { return null; } });
    const split = splits[key].productionSplit(lockText, source, manifest);
    const prod = vulnerable.filter(v => [...split.copies.values()].some((c: any) => c.name === v.name && v.versions.includes(c.version) && c.production)).map(v => v.name);
    row[key] = prod.length;
    counts[key] += prod.length;
    if (key === "base") {
      row.base_names = prod;
      // At the rerun's code this is 0 everywhere; at a fixed version, it is what the fix changes.
      const was = new Set(r.ludion.production.map((v: any) => v.name));
      for (const name of was) if (!prod.includes(name)) changed.push({ repo: r.repo, name, now: "left out" });
      for (const name of prod) if (!was.has(name)) changed.push({ repo: r.repo, name, now: "counted" });
      for (const name of prod) {
        const copies = [...split.copies.values()].filter((c: any) => c.name === name && c.production && vulnerable.find(v => v.name === name)!.versions.includes(c.version));
        if (copies.every((c: any) => lock[c.path]?.inBundle === true)) bundledOnly.push({ repo: r.repo, name });
      }
    } else for (const name of row.base_names) if (!prod.includes(name)) dropped[key]!.push({ repo: r.repo, name });
  }
  delete row.base_names;
  repos.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(outFile, JSON.stringify({
  note: "Probes, not definitions: each variant turns one fallback off; 'dropped' is what that fallback alone makes production.",
  rerun_total: rerun.totals.judge_production, counts, changed_from_rerun: changed,
  variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, { what: v.what, dropped: dropped[k]!.length, pairs: dropped[k] }])),
  bundled_only: { what: "counted packages whose every vulnerable production copy is inBundle", pairs: bundledOnly },
  repos,
}, null, 1));
console.log(JSON.stringify(counts));
