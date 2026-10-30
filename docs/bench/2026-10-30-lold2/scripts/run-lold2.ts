// Lanes LO2 and LD2 runner (docs/decisions/2026-10-30-lold2-release-link-definitions.md). Runs only inside a
// credential-free container (run.sh). Tarballs and source archives are held in memory; git fetches only commit and
// tag objects into a tmpfs. Nothing fetched is extracted to a disk or run.
// Usage: node run-lold2.ts <delta-v1.json> <lo.json> <malicious-v5.json> <cache-dir> <git-dir> <out.json> [--smoke=N]
// --smoke=N handles only the first N genuine rows and no malicious row, to try the runner; its output is never the result.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Archive } from "../../../../tools/backtest/src/archives-v5.ts";
import { untar, type Files } from "../../../../tools/backtest/src/delta.ts";
import { registryTarball } from "../../../../packages/cli/src/security/judge.ts";
import { provenanceFrom } from "../../../../packages/cli/src/security/npm-facts.ts";
import { githubOf, packageDir, releaseTag, repositoryOf, tagsFromRefs } from "../../2026-10-30-lo-tarball-source/scripts/lo.ts";
import { contentDelta, explain, readSourceTar, timeStats, type ContentDelta } from "./lold2.ts";

const [deltaFile, loFile, v5File, cacheDir, gitDir, outFile, smokeFlag] = process.argv.slice(2);
const smoke = smokeFlag?.startsWith("--smoke=") ? Number(smokeFlag.slice(8)) : null;
if (!deltaFile || !loFile || !v5File || !cacheDir || !gitDir || !outFile) throw new Error("Usage: node run-lold2.ts <delta-v1.json> <lo.json> <malicious-v5.json> <cache-dir> <git-dir> <out.json>");
const startedAt = new Date().toISOString();
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const archive = new Archive(cacheDir);
const counters: Record<string, { requests: number; failed: number }> = {};
const count = (k: string, failed = false) => { const c = (counters[k] ??= { requests: 0, failed: 0 }); if (failed) c.failed++; else c.requests++; };
const regPath = (name: string) => name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

type LdRow = { set: "genuine" | "malicious"; id: string; name: string; prev: string; version: string; status: string; sources: { prev: string; next: string }; capabilities?: string[] };
const ld = JSON.parse(readFileSync(deltaFile, "utf8")) as { rows: LdRow[] };
const all = ld.rows.filter(r => r.status !== "not obtained");
const genuineRows = all.filter(r => r.set === "genuine"), maliciousRows = all.filter(r => r.set === "malicious");
if (genuineRows.length !== 192 || maliciousRows.length !== 11) throw new Error(`expected 192 genuine and 11 malicious rows, got ${genuineRows.length} and ${maliciousRows.length}`);
const lo = JSON.parse(readFileSync(loFile, "utf8")) as { rows: any[] };
const loRow = (r: LdRow) => { const x = lo.rows.filter(l => l.set === r.set && l.name === r.name && l.version === r.version); if (x.length !== 1) throw new Error(`${r.name}@${r.version}: ${x.length} LO rows`); return x[0]; };
const v5 = JSON.parse(readFileSync(v5File, "utf8")) as { rows: any[] };
const disputed = (name: string, version: string) => v5.rows.find(x => x?.name === name && x?.version === version)?.disputed?.disputed === true;

// --- Registry ---
async function versionDoc(name: string, version: string): Promise<{ status: number | "unreadable"; doc: any }> {
  const a = await archive.get("registry", `https://registry.npmjs.org/${regPath(name)}/${encodeURIComponent(version)}`);
  return { status: a ? a.status : "unreadable", doc: a?.status === 200 ? a.json : null };
}
async function publishTime(name: string, version: string): Promise<string | null> {
  const a = await archive.get("registry", `https://registry.npmjs.org/${regPath(name)}`);
  const t = a?.json?.time?.[version];
  return typeof t === "string" ? t : null;
}
/** A registry tarball checked against the version document's sha512 integrity, unpacked in memory. */
async function tarball(name: string, version: string, doc: any): Promise<{ ok: true; files: Files } | { ok: false; why: string }> {
  const sri = typeof doc?.dist?.integrity === "string" ? doc.dist.integrity.split(/\s+/).find((s: string) => s.startsWith("sha512-")) : undefined;
  if (!sri) return { ok: false, why: doc ? "no sha512 integrity in the version document" : "no version document" };
  const res = await archive.bytes("registry-tarball", registryTarball(name, version));
  if (!res) return { ok: false, why: "tarball unreadable" };
  if (res.status !== 200 || !res.body) return { ok: false, why: `tarball HTTP ${res.status}` };
  if (`sha512-${createHash("sha512").update(res.body).digest("base64")}` !== sri) return { ok: false, why: "integrity mismatch" };
  try { return { ok: true, files: untar(res.body) }; } catch (e) { return { ok: false, why: `tarball unreadable: ${String(e).slice(0, 160)}` }; }
}
const pkgOf = (files: Files): Record<string, unknown> | null => { try { const p = JSON.parse(files.get("package.json")!.toString("utf8")); return p && typeof p === "object" && !Array.isArray(p) ? p : null; } catch { return null; } };
/** §2: the provenance's GitHub repository and commit, read now. */
async function provenance(name: string, version: string, doc: any): Promise<{ attestations: boolean; status: string; repo?: string; commit?: string }> {
  if (!doc) return { attestations: false, status: "no version document" };
  if (!doc.dist?.attestations) return { attestations: false, status: "no attestations" };
  const att = await archive.get("registry", `https://registry.npmjs.org/-/npm/v1/attestations/${regPath(name)}@${encodeURIComponent(version)}`);
  if (!att || att.status !== 200) return { attestations: true, status: `attestations not read (${att ? `HTTP ${att.status}` : "no answer"})` };
  try {
    const p = provenanceFrom(att.json, { name, version, integrity: typeof doc.dist.integrity === "string" ? doc.dist.integrity : null });
    if (!p) return { attestations: true, status: "no SLSA provenance" };
    const gh = p.repository ? githubOf(p.repository) : null;
    if (!gh?.ok) return { attestations: true, status: `provenance repository ${gh ? gh.why : "missing"}` };
    if (!p.commit) return { attestations: true, status: "provenance without a commit" };
    return { attestations: true, status: "read", repo: `${gh.owner}/${gh.repo}`, commit: p.commit };
  } catch (e) { return { attestations: true, status: `provenance unreadable: ${String(e).slice(0, 160)}` }; }
}

// --- Git: commit and tag objects only, into a tmpfs ---
const GIT_ENV = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: join(gitDir, "home"), GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env: GIT_ENV, timeout: 180_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 20 }).toString("utf8").trim();
function repoDir(owner: string, repo: string): string {
  const dir = join(gitDir, `${owner}__${repo}`);
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); git(dir, ["init", "-q", "--bare"]); }
  return dir;
}
function gitFetch(owner: string, repo: string, what: string): { ok: true } | { ok: false; why: string } {
  const dir = repoDir(owner, repo);
  let why = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    count("git-fetch");
    try { git(dir, ["fetch", "-q", "--depth=1", "--filter=tree:0", "--no-tags", `https://github.com/${owner}/${repo}.git`, what]); return { ok: true }; }
    catch (e: any) { count("git-fetch", true); why = String(e?.stderr ?? e).replace(/\s+/g, " ").slice(0, 200); execFileSync("sleep", [String(3 * attempt)]); }
  }
  return { ok: false, why };
}
function commitTimes(dir: string, rev: string) { const [c, a] = git(dir, ["log", "-1", "--format=%ct %at", rev]).split(" ").map(Number); return { committer: c!, author: a! }; }
const iso = (s: number) => new Date(s * 1000).toISOString();
const hours = (from: string, toSec: number) => Math.round((toSec * 1000 - Date.parse(from)) / 36e3) / 100;

// --- Source archives ---
async function sourceTar(owner: string, repo: string, commit: string): Promise<{ ok: true; tar: Buffer } | { ok: false; why: string }> {
  let why = "no attempt";
  for (let attempt = 1; attempt <= 3; attempt++) {
    count("codeload");
    try {
      const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${commit}`, { headers: { "user-agent": "Ludion-Backtest (read-only)" }, signal: AbortSignal.timeout(900_000) });
      if (!res.ok) { why = `HTTP ${res.status}`; count("codeload", true); if (res.status >= 400 && res.status < 500 && res.status !== 429) break; await new Promise(r => setTimeout(r, 5_000 * attempt)); continue; }
      const gz = Buffer.from(await res.arrayBuffer());
      try { return { ok: true, tar: gunzipSync(gz, { maxOutputLength: 2 ** 31 }) }; } catch (e) { return { ok: false, why: `not unpacked: ${String(e).slice(0, 160)}` }; }
    } catch (e) { count("codeload", true); why = String(e).slice(0, 200); await new Promise(r => setTimeout(r, 5_000 * attempt)); }
  }
  return { ok: false, why };
}
/** §6: one commit's package directory files, by LO §3's rules with that version's own repository.directory. */
async function sourcePackage(owner: string, repo: string, commit: string, name: string, directory: string | null): Promise<{ ok: true; dir: string; files: Files } | { ok: false; why: string }> {
  const got = await sourceTar(owner, repo, commit);
  if (!got.ok) return { ok: false, why: `source archive not read: ${got.why}` };
  let listing;
  try { listing = readSourceTar(got.tar, null); } catch (e) { return { ok: false, why: `source archive not read: ${String(e).slice(0, 160)}` }; }
  const where = packageDir({ files: new Map([...listing.paths].map(p => [p, { sha256: "", eol: null, size: 0 }])), kept: listing.packageJsons }, name, directory);
  if (!where.ok) return { ok: false, why: where.why };
  return { ok: true, dir: where.dir, files: readSourceTar(got.tar, where.dir).kept };
}

// --- The rows ---
const capWhere = (w: Record<string, string[]>) => Object.fromEntries(Object.entries(w).map(([c, l]) => [c, l.slice(0, 20)]));
const genuineOut: any[] = [], maliciousOut: any[] = [];
const genuineToDo = smoke === null ? genuineRows : genuineRows.slice(0, smoke);
for (const [i, r] of genuineToDo.entries()) {
  const l = loRow(r);
  const out: any = { id: r.id, name: r.name, prev: r.prev, version: r.version };
  // §2: tied, by LO's release; attestations read now.
  out.tied = !!l.release;
  out.lo_release = l.release ?? null;
  out.lo_source = l.source ?? null;
  out.lo_reason = l.release ? null : `${l.reason}${l.sub ? `: ${l.sub}` : ""}`;
  const next = await versionDoc(r.name, r.version), prev = await versionDoc(r.name, r.prev);
  out.registry_document = { prev: prev.status, next: next.status };
  const prov = await provenance(r.name, r.version, next.doc);
  out.provenance = prov;
  const publish = await publishTime(r.name, r.version);
  out.publish_time = publish;
  // §3: the tagged commit's time.
  if (l.release?.kind === "tag" || l.release?.kind === "provenance") {
    const [repoPart, loCommit] = String(l.source).split("@");
    const [owner, repo] = repoPart!.split("/");
    const t: any = { kind: l.release.kind };
    if (l.release.kind === "tag") {
      const tag = l.release.tag as string;
      const f = gitFetch(owner!, repo!, `+refs/tags/${tag}:refs/tags/${tag}`);
      if (!f.ok) t.not_comparable = `tag not fetched: ${f.why}`;
      else {
        const dir = repoDir(owner!, repo!);
        const peeled = git(dir, ["rev-parse", `refs/tags/${tag}^{commit}`]);
        const [type, tagger] = git(dir, ["for-each-ref", "--format=%(objecttype) %(taggerdate:unix)", `refs/tags/${tag}`]).split(" ");
        t.commit = peeled; t.annotated = type === "tag";
        if (peeled !== loCommit) t.not_comparable = "tag moved";
        else {
          const ct = commitTimes(dir, peeled);
          t.committer_time = iso(ct.committer); t.author_time = iso(ct.author);
          if (t.annotated && tagger) t.tagger_time = iso(Number(tagger));
          if (!publish) t.not_comparable = "no publish time";
          else { t.hours = hours(publish, ct.committer); if (t.tagger_time) t.tagger_hours = hours(publish, Number(tagger)); }
        }
      }
    } else {
      const f = gitFetch(owner!, repo!, loCommit!);
      if (!f.ok) t.not_comparable = `commit not fetched: ${f.why}`;
      else {
        const ct = commitTimes(repoDir(owner!, repo!), loCommit!);
        t.committer_time = iso(ct.committer); t.author_time = iso(ct.author);
        if (!publish) t.not_comparable = "no publish time"; else t.hours = hours(publish, ct.committer);
      }
    }
    out.release_time = t;
  }
  // §5: the tarball diff, files matched by content.
  const pt = await tarball(r.name, r.prev, prev.doc), nt = await tarball(r.name, r.version, next.doc);
  let td: ContentDelta | null = null;
  if (!pt.ok || !nt.ok) out.ld2 = { outcome: "not comparable", reason: `tarball not obtained: ${!pt.ok ? `previous: ${pt.why}` : ""}${!pt.ok && !nt.ok ? "; " : ""}${!nt.ok ? `fixed: ${nt.why}` : ""}` };
  else {
    td = contentDelta(pt.files, nt.files);
    if (td.status === "undecidable") out.ld2 = { outcome: "not comparable", reason: `tarball diff undecidable: ${td.why}` };
    else {
      const by = td.matched.reduce<Record<string, number>>((a, m) => { a[m.how] = (a[m.how] ?? 0) + 1; return a; }, {});
      out.tarball = { status: td.status, capabilities: td.capabilities, where: capWhere(td.where), v1: td.v1, changed_code_files: td.matched.length, predecessor_by: by };
      if (td.status === "clean") out.ld2 = { outcome: "no new capability" };
    }
  }
  // §6: the source diff, only for a pair with a new capability.
  if (!out.ld2 && td && td.status === "flagged") {
    if (!l.release) out.ld2 = { outcome: "not comparable", reason: "no release for the fixed version" };
    else {
      const [repoPart, nextCommit] = String(l.source).split("@");
      const [owner, repo] = repoPart!.split("/") as [string, string];
      // The previous version's release: a tag of the 8 forms, else its provenance commit in the same repository.
      let prevCommit: string | null = null, prevHow = "";
      const refs = await archive.get("github-refs", `https://github.com/${owner}/${repo}.git/info/refs?service=git-upload-pack`, "text");
      if (refs?.status === 200 && typeof refs.text === "string") {
        const tag = releaseTag(tagsFromRefs(refs.text), r.name, r.prev);
        if (tag) { prevCommit = tag.commit; prevHow = `tag form ${tag.form}`; }
      }
      const prevRefs = refs ? (refs.status === 200 ? "read" : `HTTP ${refs.status}`) : "no answer";
      let prevProv: Awaited<ReturnType<typeof provenance>> | null = null;
      if (!prevCommit) {
        prevProv = await provenance(r.name, r.prev, prev.doc);
        if (prevProv.status === "read" && prevProv.repo!.toLowerCase() === `${owner}/${repo}`.toLowerCase()) { prevCommit = prevProv.commit!; prevHow = "provenance"; }
      }
      const src: any = { repository: `${owner}/${repo}`, next_commit: nextCommit, prev_commit: prevCommit, prev_release: prevHow || null, refs: prevRefs, ...(prevProv ? { prev_provenance: prevProv.status } : {}) };
      out.source = src;
      if (!prevCommit) out.ld2 = { outcome: "not comparable", reason: "no release for the previous version" };
      else {
        const prevPkg = pkgOf(pt.ok ? pt.files : new Map()) ?? {}, nextPkg = pkgOf(nt.ok ? nt.files : new Map()) ?? {};
        const pr = repositoryOf(prevPkg), nr = repositoryOf(nextPkg);
        const ps = await sourcePackage(owner, repo, prevCommit, r.name, pr.ok ? pr.directory : null);
        const ns = ps.ok ? await sourcePackage(owner, repo, nextCommit!, r.name, nr.ok ? nr.directory : null) : null;
        if (!ps.ok) out.ld2 = { outcome: "not comparable", reason: `previous commit: ${ps.why}` };
        else if (!ns!.ok) out.ld2 = { outcome: "not comparable", reason: `fixed commit: ${ns!.why}` };
        else {
          src.prev_dir = ps.dir; src.next_dir = ns!.dir;
          const sd = contentDelta(ps.files, ns!.files);
          if (sd.status === "undecidable") out.ld2 = { outcome: "not comparable", reason: `source package.json unreadable: ${sd.why}` };
          else {
            src.capabilities = sd.capabilities; src.where = capWhere(sd.where); src.changed_code_files = sd.matched.length;
            const e = explain(td.where, sd.where);
            out.ld2 = { outcome: e.unexplained.length ? "unexplained" : "all explained", explained: e.explained, unexplained: e.unexplained };
          }
        }
      }
    }
  }
  genuineOut.push(out);
  log(`genuine ${i + 1}/${genuineToDo.length} ${r.name} ${r.prev} -> ${r.version}: tied ${out.tied}; time ${out.release_time?.hours ?? out.release_time?.not_comparable ?? "-"}; ld2 ${out.ld2.outcome}${out.ld2.reason ? ` (${out.ld2.reason})` : ""}${out.ld2.unexplained?.length ? ` [${out.ld2.unexplained.join(", ")}]` : ""}`);
}

// §4 (and §5 shown): the malicious versions' previous versions.
for (const [i, r] of (smoke === null ? maliciousRows : []).entries()) {
  const l = loRow(r);
  const out: any = { id: r.id, name: r.name, prev: r.prev, version: r.version, disputed: disputed(r.name, r.version), version_repository: l.repository ?? null, version_repository_status: l.repository_status ?? null };
  const prev = await versionDoc(r.name, r.prev);
  out.prev_registry_document = prev.status;
  const pt = await tarball(r.name, r.prev, prev.doc);
  let from = "", repo: ReturnType<typeof repositoryOf> | null = null;
  if (pt.ok) { const p = pkgOf(pt.files); if (p) { repo = repositoryOf(p); from = "tarball package.json"; } else from = "tarball package.json unreadable"; }
  if (!repo && prev.doc && typeof prev.doc === "object") { repo = repositoryOf(prev.doc); from = "registry version document"; }
  out.prev_repository_from = from || `not obtained (${pt.ok ? "package.json unreadable" : pt.why})`;
  out.prev_repository = repo ? (repo.ok ? `${repo.owner}/${repo.repo}` : null) : null;
  out.prev_repository_status = repo ? (repo.ok ? "usable" : repo.why) : "not obtained";
  out.prev_names_repository = repo ? (repo.ok || repo.why !== "no repository") : null;
  out.removed = repo ? out.prev_names_repository && l.repository_status === "no repository" : null;
  out.same_repository = repo?.ok && l.repository ? `${repo.owner}/${repo.repo}`.toLowerCase() === String(l.repository).toLowerCase() : false;
  if (r.sources.prev === "registry" && r.sources.next === "registry") {
    const vd = await versionDoc(r.name, r.version);
    const vt = pt.ok ? await tarball(r.name, r.version, vd.doc) : null;
    if (!pt.ok || !vt?.ok) out.content_delta = { computed: false, why: !pt.ok ? `previous: ${pt.why}` : `version: ${vt && !vt.ok ? vt.why : "?"}` };
    else {
      const d = contentDelta(pt.files, vt.files);
      out.content_delta = d.status === "undecidable" ? { computed: true, status: "undecidable", why: d.why } : { computed: true, status: d.status, capabilities: d.capabilities, v1: d.v1 };
    }
  } else out.content_delta = { computed: false, why: "a side read from Software Heritage" };
  maliciousOut.push(out);
  log(`malicious ${i + 1}/11 ${r.name} ${r.prev} -> ${r.version}: previous ${out.prev_repository_status} (${out.prev_repository_from}); version ${out.version_repository_status}; removed ${out.removed}; content ${out.content_delta.status ?? out.content_delta.why}`);
}

// --- Summary ---
const tally = <T>(list: T[], key: (r: T) => string) => list.reduce<Record<string, number>>((a, r) => { const k = key(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(2)}%` : "n/a";
const frac = (n: number, d: number) => `${n} / ${d} (${pct(n, d)})`;
const G = genuineOut, N = G.length;
const tagRows = G.filter(r => r.lo_release?.kind === "tag"), provRows = G.filter(r => r.lo_release?.kind === "provenance");
const timed = tagRows.filter(r => typeof r.release_time?.hours === "number");
const hasTag = (r: any) => r.lo_release?.kind === "tag", hasProv = (r: any) => r.provenance.status === "read";
const ld2Comparable = G.filter(r => r.ld2.outcome !== "not comparable");
const caps = [...new Set(G.flatMap(r => r.tarball?.capabilities ?? []))].sort();
const M = maliciousOut;
const summary = {
  lo2: {
    rows: N,
    tied: frac(G.filter(r => r.tied).length, N),
    tied_by_kind: tally(G.filter(r => r.tied), r => r.lo_release.kind === "tag" ? `tag form ${r.lo_release.form}` : "provenance"),
    not_tied_by_reason: tally(G.filter(r => !r.tied), r => r.lo_reason),
    shown_tag_and_provenance_now: {
      "tag and provenance": G.filter(r => hasTag(r) && hasProv(r)).length,
      "tag only": G.filter(r => hasTag(r) && !hasProv(r)).length,
      "provenance only": G.filter(r => !hasTag(r) && hasProv(r)).length,
      "neither": G.filter(r => !hasTag(r) && !hasProv(r)).length,
      provenance_status: tally(G, r => r.provenance.status.startsWith("provenance unreadable") ? "provenance unreadable" : r.provenance.status),
    },
    tag_time: {
      tag_tied: tagRows.length,
      timed: frac(timed.length, tagRows.length),
      not_comparable: tally(tagRows.filter(r => typeof r.release_time?.hours !== "number"), r => r.release_time?.not_comparable ?? "not fetched"),
      commit_minus_publish_hours: timeStats(timed.map(r => r.release_time.hours)),
      annotated: frac(timed.filter(r => r.release_time.annotated).length, timed.length),
      tagger_minus_publish_hours: timeStats(timed.filter(r => typeof r.release_time.tagger_hours === "number").map(r => r.release_time.tagger_hours)),
      provenance_commit_minus_publish_hours: timeStats(provRows.filter(r => typeof r.release_time?.hours === "number").map(r => r.release_time.hours)),
    },
    malicious_previous: smoke !== null ? null : {
      rows: M.length,
      previous_names_a_repository: frac(M.filter(r => r.prev_names_repository === true).length, M.length),
      previous_names_a_github_repository: frac(M.filter(r => r.prev_repository_status === "usable").length, M.length),
      previous_status: tally(M, r => `${r.prev_repository_status} (${r.prev_repository_from})`),
      removed_in_the_malicious_version: frac(M.filter(r => r.removed === true).length, M.length),
      same_repository: frac(M.filter(r => r.same_repository === true).length, M.length),
      disputed: M.filter(r => r.disputed).map(r => `${r.name}@${r.version}: previous ${r.prev_repository_status}, removed ${r.removed}`),
    },
  },
  ld2: {
    rows: N,
    outcomes: Object.fromEntries(["no new capability", "all explained", "unexplained", "not comparable"].map(o => [o, frac(G.filter(r => r.ld2.outcome === o).length, N)])),
    unexplained_of_comparable: frac(G.filter(r => r.ld2.outcome === "unexplained").length, ld2Comparable.length),
    not_comparable_by_reason: tally(G.filter(r => r.ld2.outcome === "not comparable"), r => r.ld2.reason.replace(/: .*$/, "")),
    not_comparable_detail: tally(G.filter(r => r.ld2.outcome === "not comparable"), r => r.ld2.reason),
    per_capability: Object.fromEntries(caps.map(c => [c, { new: G.filter(r => r.tarball?.capabilities.includes(c)).length, unexplained: G.filter(r => r.ld2.unexplained?.includes(c)).length, explained: G.filter(r => r.ld2.explained?.includes(c)).length }])),
    shown: {
      v1_flagged: frac(G.filter(r => r.tarball?.v1.status === "flagged").length, N),
      content_flagged: frac(G.filter(r => r.tarball?.status === "flagged").length, N),
      flagged_by_v1_only: G.filter(r => r.tarball?.v1.status === "flagged" && r.tarball.status === "clean").map(r => `${r.name}@${r.version}`),
      flagged_by_content_only: G.filter(r => r.tarball?.v1.status === "clean" && r.tarball.status === "flagged").map(r => `${r.name}@${r.version}`),
      vite: tally(G.filter(r => r.name === "vite"), r => `v1 ${r.tarball?.v1.status ?? "-"}, content ${r.tarball?.status ?? "-"}, ${r.ld2.outcome}`),
      both_prongs_pass: frac(G.filter(r => r.tied && (r.ld2.outcome === "no new capability" || r.ld2.outcome === "all explained")).length, N),
      malicious_content_delta: smoke !== null ? null : tally(M, r => r.content_delta.computed ? `v1 ${r.content_delta.v1?.status ?? "-"}, content ${r.content_delta.status}` : `not computed: ${r.content_delta.why}`),
    },
  },
};
const blob = (p: string) => { const b = readFileSync(p); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };
const here = new URL(".", import.meta.url).pathname;
const blobs = Object.fromEntries([
  ["docs/bench/2026-10-30-lold2/scripts/run-lold2.ts", join(here, "run-lold2.ts")],
  ["docs/bench/2026-10-30-lold2/scripts/lold2.ts", join(here, "lold2.ts")],
  ["docs/bench/2026-10-30-lo-tarball-source/scripts/lo.ts", join(here, "../../2026-10-30-lo-tarball-source/scripts/lo.ts")],
  ["tools/backtest/src/delta.ts", join(here, "../../../../tools/backtest/src/delta.ts")],
  ["tools/backtest/src/archives-v5.ts", join(here, "../../../../tools/backtest/src/archives-v5.ts")],
  ["packages/cli/src/security/npm-facts.ts", join(here, "../../../../packages/cli/src/security/npm-facts.ts")],
  ["packages/cli/src/security/judge.ts", join(here, "../../../../packages/cli/src/security/judge.ts")],
].map(([k, p]) => [k, blob(p!)]));
const out = {
  run: { smoke, started_at: startedAt, ended_at: new Date().toISOString(), node: process.version, git: execFileSync("git", ["--version"]).toString().trim(), blobs, requests: { ...archive.counters, ...counters } },
  definitions: "docs/decisions/2026-10-30-lold2-release-link-definitions.md",
  data: { delta_v1: sha(deltaFile), lo: sha(loFile) },
  ...summary,
  rows: { genuine: genuineOut, malicious: maliciousOut },
};
writeFileSync(`${outFile}.tmp`, JSON.stringify(out, null, 1)); renameSync(`${outFile}.tmp`, outFile);
log(`done: ${genuineOut.length} genuine, ${maliciousOut.length} malicious`);
