// Lane LO runner (docs/decisions/2026-10-30-lo-tarball-source-definitions.md). One version at a time: its files
// (registry tarball or Software Heritage, as LD's row got them), its release in the GitHub repository (tag, else
// provenance commit), the source archive's file hashes, and the comparison. Runs only inside a credential-free
// container (run.sh). Nothing fetched is extracted to a disk or run.
// Usage: node run-lo.ts <delta-v1.json> <malicious-v5.json> <cache-dir> <out.json>
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, gunzipSync } from "node:zlib";
import { Archive, swhFiles, swhLocate, swhManifest } from "../../../../tools/backtest/src/archives-v5.ts";
import { registryTarball } from "../../../../packages/cli/src/security/judge.ts";
import { provenanceFrom } from "../../../../packages/cli/src/security/npm-facts.ts";
import { built, compare, githubOf, packageDir, readTar, releaseTag, repositoryOf, TarReader, tagsFromRefs, type Files, type Source } from "./lo.ts";

const [deltaFile, v5File, cacheDir, outFile] = process.argv.slice(2);
if (!deltaFile || !v5File || !cacheDir || !outFile) throw new Error("Usage: node run-lo.ts <delta-v1.json> <malicious-v5.json> <cache-dir> <out.json>");
const startedAt = new Date().toISOString();
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const archive = new Archive(cacheDir);
const counters: Record<string, { requests: number; failed: number }> = {};
const count = (k: string, failed = false) => { const c = (counters[k] ??= { requests: 0, failed: 0 }); if (failed) c.failed++; else c.requests++; };
const LIMIT = 2 ** 31;

type LdRow = { set: "genuine" | "malicious"; id: string; name: string; version: string; status: string; sources: { next: string } };
const ld = JSON.parse(readFileSync(deltaFile, "utf8")) as { rows: LdRow[] };
const rows = ld.rows.filter(r => r.status !== "not obtained");
const genuineCount = rows.filter(r => r.set === "genuine").length, maliciousCount = rows.filter(r => r.set === "malicious").length;
if (genuineCount !== 192 || maliciousCount !== 11) throw new Error(`expected 192 genuine and 11 malicious rows, got ${genuineCount} and ${maliciousCount}`);
const v5 = JSON.parse(readFileSync(v5File, "utf8")) as { rows: any[] };
const disputed = (name: string, version: string) => {
  const r = v5.rows.find(x => x?.name === name && x?.version === version);
  if (!r) throw new Error(`${name}@${version} is not a row of malicious-v5.json`);
  return r.disputed?.disputed === true;
};

const regPath = (name: string) => name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);

/** §2: the version's files and root package.json, from the source LD's row used. */
async function versionFiles(row: LdRow, doc: any): Promise<{ ok: true; files: Files; pkg: unknown } | { ok: false; why: string }> {
  if (row.sources.next === "registry") {
    const sri = typeof doc?.dist?.integrity === "string" ? doc.dist.integrity.split(/\s+/).find((s: string) => s.startsWith("sha512-")) : undefined;
    if (!sri) return { ok: false, why: "no sha512 integrity in the version document" };
    const res = await archive.bytes("registry-tarball", registryTarball(row.name, row.version));
    if (!res) return { ok: false, why: "tarball unreadable" };
    if (res.status !== 200 || !res.body) return { ok: false, why: `tarball HTTP ${res.status}` };
    if (`sha512-${createHash("sha512").update(res.body).digest("base64")}` !== sri) return { ok: false, why: "integrity mismatch" };
    let tar: TarReader;
    try { tar = readTar(gunzipSync(res.body, { maxOutputLength: 1 << 30 })); } catch (e) { return { ok: false, why: `tarball unreadable: ${String(e)}` }; }
    const text = tar.kept.get("package.json");
    let pkg: unknown = undefined;
    try { pkg = text === undefined ? undefined : JSON.parse(text); } catch { pkg = undefined; }
    return { ok: true, files: tar.files, pkg };
  }
  if (row.sources.next === "software-heritage") {
    const packument = await archive.get("registry", `https://registry.npmjs.org/${regPath(row.name)}`);
    const published = packument?.json?.time?.[row.version];
    if (typeof published !== "string") return { ok: false, why: "no publish time" };
    const hold = await swhLocate(archive, row.name, row.version, published);
    if (hold === "unreadable") return { ok: false, why: "Software Heritage unreadable" };
    if (!hold.held) return { ok: false, why: `Software Heritage: ${hold.why}` };
    const list = await swhFiles(archive, hold.packageRoot);
    if (list === "unreadable") return { ok: false, why: "Software Heritage unreadable" };
    const manifest = await swhManifest(archive, hold.packageRoot);
    if (manifest === "unreadable") return { ok: false, why: "Software Heritage unreadable" };
    const files: Files = new Map([...list].map(([p, f]) => [p, { sha256: f.sha256, eol: null, size: f.size }]));
    return { ok: true, files, pkg: manifest === "no package.json" ? undefined : manifest.pkg };
  }
  return { ok: false, why: `source ${row.sources.next}` };
}

/** §3: the source archive's files, streamed and hashed; the listing (paths, hashes, package.json texts) is cached. */
async function sourceArchive(owner: string, repo: string, commit: string): Promise<{ ok: true; source: Source } | { ok: false; why: string }> {
  const dir = join(cacheDir, "source");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${owner}__${repo}__${commit}.json`);
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return c.ok ? { ok: true, source: { files: new Map(c.files.map(([p, s, e, n]: [string, string, string, number]) => [p, { sha256: s, eol: e, size: n }])), kept: new Map(c.kept) } } : c;
  }
  let out: { ok: true; source: Source } | { ok: false; why: string } = { ok: false, why: "source archive not read: no attempt" };
  for (let attempt = 1; attempt <= 3; attempt++) {
    count("codeload");
    try {
      const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${commit}`, { headers: { "user-agent": "Ludion-Backtest (read-only)" }, signal: AbortSignal.timeout(900_000) });
      if (!res.ok || !res.body) {
        out = { ok: false, why: `source archive not read: HTTP ${res.status}` };
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        count("codeload", true);
        await new Promise(r => setTimeout(r, 5_000 * attempt));
        continue;
      }
      const reader = new TarReader(LIMIT);
      const sink = new Writable({ write(chunk: Buffer, _enc, cb) { try { reader.push(chunk); cb(); } catch (e) { cb(e as Error); } } });
      await pipeline(Readable.fromWeb(res.body as any), createGunzip(), sink);
      reader.end();
      out = { ok: true, source: { files: reader.files, kept: reader.kept } };
      break;
    } catch (e) {
      count("codeload", true);
      out = { ok: false, why: `source archive not read: ${String(e).slice(0, 200)}` };
      if (String(e).includes("over the size limit")) break;
      await new Promise(r => setTimeout(r, 5_000 * attempt));
    }
  }
  const cached = out.ok ? { ok: true, files: [...out.source.files].map(([p, f]) => [p, f.sha256, f.eol, f.size]), kept: [...out.source.kept] } : out;
  writeFileSync(`${file}.tmp`, JSON.stringify(cached)); renameSync(`${file}.tmp`, file);
  return out;
}

type Row = Record<string, unknown> & { set: LdRow["set"]; outcome: string };
const results: Row[] = [];
for (const [i, row] of rows.entries()) {
  const base: Row = { set: row.set, id: row.id, name: row.name, version: row.version, files_from: row.sources.next, outcome: "not comparable" };
  if (row.set === "malicious") base.disputed = disputed(row.name, row.version);
  const docAnswer = await archive.get("registry", `https://registry.npmjs.org/${regPath(row.name)}/${encodeURIComponent(row.version)}`);
  const doc = docAnswer?.status === 200 ? docAnswer.json : null;
  base.registry_document = docAnswer ? docAnswer.status : "unreadable";
  const finish = (r: Row) => { results.push(r); log(`${i + 1}/${rows.length} ${r.set} ${r.name}@${r.version}: ${r.outcome}${r.reason ? ` (${r.reason}${r.sub ? `: ${r.sub}` : ""})` : ""}`); };

  const v = await versionFiles(row, doc);
  if (!v.ok) { finish({ ...base, reason: "files not obtained", sub: v.why }); continue; }
  if (!v.pkg || typeof v.pkg !== "object" || Array.isArray(v.pkg)) { finish({ ...base, reason: "package.json unreadable" }); continue; }
  const pkg = v.pkg as Record<string, unknown>;

  // The repository and its release tag.
  const repo = repositoryOf(pkg);
  base.repository = repo.ok ? `${repo.owner}/${repo.repo}` : null;
  base.repository_directory = repo.ok ? repo.directory : null;
  let repoStatus: string = repo.ok ? "usable" : repo.why;
  let release: { kind: "tag"; tag: string; form: number } | { kind: "provenance" } | null = null;
  let owner = "", name = "", commit = "";
  if (repo.ok) {
    const refs = await archive.get("github-refs", `https://github.com/${repo.owner}/${repo.repo}.git/info/refs?service=git-upload-pack`, "text");
    if (!refs) repoStatus = "repository not reachable (no answer)";
    else if (refs.status !== 200 || typeof refs.text !== "string") repoStatus = `repository not reachable (HTTP ${refs.status})`;
    else {
      const tag = releaseTag(tagsFromRefs(refs.text), row.name, row.version);
      if (tag) { release = { kind: "tag", tag: tag.tag, form: tag.form }; owner = repo.owner; name = repo.repo; commit = tag.commit; }
      else repoStatus = "no tag of the 8 forms";
    }
  }
  // Without a tag: the provenance commit.
  let provStatus = "not needed";
  if (!release) {
    if (!doc?.dist?.attestations) provStatus = "no attestations";
    else {
      const att = await archive.get("registry", `https://registry.npmjs.org/-/npm/v1/attestations/${regPath(row.name)}@${encodeURIComponent(row.version)}`);
      if (!att || att.status !== 200) provStatus = `attestations not read (${att ? `HTTP ${att.status}` : "no answer"})`;
      else {
        try {
          const prov = provenanceFrom(att.json, { name: row.name, version: row.version, integrity: typeof doc.dist.integrity === "string" ? doc.dist.integrity : null });
          const gh = prov?.repository ? githubOf(prov.repository) : null;
          if (!prov) provStatus = "no SLSA provenance";
          else if (!gh?.ok) provStatus = `provenance repository ${gh ? gh.why : "missing"}`;
          else if (!prov.commit) provStatus = "provenance without a commit";
          else { release = { kind: "provenance" }; owner = gh.owner; name = gh.repo; commit = prov.commit; provStatus = "used"; }
        } catch (e) { provStatus = `provenance unreadable: ${String(e).slice(0, 160)}`; }
      }
    }
  }
  base.repository_status = repoStatus;
  base.provenance_status = provStatus;
  if (!release) { finish({ ...base, reason: "no release tag and no provenance", sub: `${repoStatus}; ${provStatus}` }); continue; }
  base.release = release;
  base.source = `${owner}/${name}@${commit}`;

  const src = await sourceArchive(owner, name, commit);
  if (!src.ok) { finish({ ...base, reason: "source archive not read", sub: src.why }); continue; }
  const where = packageDir(src.source, row.name, repo.ok ? repo.directory : null);
  if (!where.ok) { finish({ ...base, reason: where.why, built: "unknown" }); continue; }
  base.package_directory = where.dir;
  base.package_directory_from = where.how;
  let sourcePkg: Record<string, unknown>;
  try { const t = src.source.kept.get(where.dir ? `${where.dir}/package.json` : "package.json"); const p = t === undefined ? null : JSON.parse(t); if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("not an object"); sourcePkg = p; }
  catch { finish({ ...base, reason: "source package.json unreadable", built: "unknown" }); continue; }
  const c = compare({ files: v.files, pkg }, src.source, where.dir, sourcePkg);
  const { differentPaths, absentPaths, ...counts } = c;
  // Paths are committed for genuine versions only (definitions §7).
  finish({ ...base, outcome: c.outcome, built: built(sourcePkg) ? "built" : "not built", ...counts, ...(row.set === "genuine" ? { different_paths: differentPaths.slice(0, 20), absent_paths: absentPaths.slice(0, 20) } : {}) });
}

// --- Summary ---
const tally = (list: Row[], key: (r: Row) => string) => list.reduce<Record<string, number>>((a, r) => { const k = key(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(2)}%` : "n/a";
function summary(set: Row["set"]) {
  const list = results.filter(r => r.set === set);
  const comparable = list.filter(r => r.outcome !== "not comparable");
  const n = (o: string, l = list) => l.filter(r => r.outcome === o).length;
  const byBuilt: Record<string, unknown> = {};
  for (const b of ["built", "not built", "unknown"]) {
    const l = list.filter(r => (r.built ?? "unknown") === b), lc = l.filter(r => r.outcome !== "not comparable");
    byBuilt[b] = { rows: l.length, outcomes: tally(l, r => r.outcome), match_of_comparable: `${n("match", lc)} / ${lc.length} (${pct(n("match", lc), lc.length)})` };
  }
  const notMatch = n("differs") + n("absent files only");
  return {
    rows: list.length,
    outcomes: Object.fromEntries(["match", "differs", "absent files only", "not comparable"].map(o => [o, `${n(o)} / ${list.length} (${pct(n(o), list.length)})`])),
    match_of_comparable: `${n("match")} / ${comparable.length} (${pct(n("match"), comparable.length)})`,
    not_match: `${notMatch} / ${list.length} (${pct(notMatch, list.length)})`,
    not_match_of_comparable: `${notMatch} / ${comparable.length} (${pct(notMatch, comparable.length)})`,
    by_built: byBuilt,
    not_comparable_reasons: tally(list.filter(r => r.outcome === "not comparable"), r => String(r.reason)),
    not_comparable_detail: tally(list.filter(r => r.outcome === "not comparable"), r => `${r.reason}${r.sub ? `: ${r.sub}` : ""}`),
    release_kind: tally(comparable, r => { const k = r.release as any; return k?.kind === "tag" ? `tag form ${k.form}` : "provenance"; }),
    shown: {
      absent_under_missing_top: comparable.reduce((a, r) => a + Number(r.absentUnderMissingTop ?? 0), 0),
      absent_total: comparable.reduce((a, r) => a + Number(r.absent ?? 0), 0),
      different_total: comparable.reduce((a, r) => a + Number(r.different ?? 0), 0),
      different_but_eol_identical: comparable.reduce((a, r) => a + Number(r.differentButEolIdentical ?? 0), 0),
      rows_eol_not_computed: comparable.filter(r => r.differentButEolIdentical === null).length,
      differs_only_by_eol: comparable.filter(r => r.outcome === "differs" && r.different === r.differentButEolIdentical && !(r.packageJson as any).installScripts && !(r.packageJson as any).dependencyNames).length,
    },
    ...(set === "malicious" ? { disputed: list.filter(r => r.disputed).map(r => `${r.name}@${r.version}: ${r.outcome}`) } : {}),
  };
}
const blob = (p: string) => { const b = readFileSync(p); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };
const here = new URL(".", import.meta.url).pathname;
const blobs = Object.fromEntries([
  ["docs/bench/2026-10-30-lo-tarball-source/scripts/run-lo.ts", join(here, "run-lo.ts")],
  ["docs/bench/2026-10-30-lo-tarball-source/scripts/lo.ts", join(here, "lo.ts")],
  ["tools/backtest/src/archives-v5.ts", join(here, "../../../../tools/backtest/src/archives-v5.ts")],
  ["packages/cli/src/security/npm-facts.ts", join(here, "../../../../packages/cli/src/security/npm-facts.ts")],
  ["packages/cli/src/security/judge.ts", join(here, "../../../../packages/cli/src/security/judge.ts")],
].map(([k, p]) => [k, blob(p!)]));
const out = {
  run: { started_at: startedAt, ended_at: new Date().toISOString(), node: process.version, blobs, requests: { ...archive.counters, ...counters } },
  definitions: "docs/decisions/2026-10-30-lo-tarball-source-definitions.md",
  data: { file: "docs/bench/2026-10-30-delta-v1/delta-v1.json at 79f8816 (lane LD)", sha256: createHash("sha256").update(readFileSync(deltaFile)).digest("hex") },
  genuine: summary("genuine"),
  malicious: summary("malicious"),
  rows: results,
};
writeFileSync(`${outFile}.tmp`, JSON.stringify(out, null, 1)); renameSync(`${outFile}.tmp`, outFile);
log(`done: ${results.length} rows`);
