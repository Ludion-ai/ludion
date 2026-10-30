// Lane LT runner (docs/decisions/2026-10-31-lt-takeover-definitions.md). Runs only inside a credential-free container
// (run.sh). The GitHub API part runs on the host in gh.sh. Tarballs, source archives and GH Archive files are held in
// memory or streamed; nothing fetched is extracted to a disk or run.
// Usage: node lt.ts refs    <malicious-v5.json> <lold2.json> <cache-dir> <out-dir>
//        node lt.ts archive <cache-dir> <out-dir>     (reads <out-dir>/phase1.json and gh-repos.tsv)
//        node lt.ts source  <cache-dir> <out-dir>     (reads phase1.json and gh-repos.tsv)
//        node lt.ts summary <lold2.json> <out-dir>    (reads every phase's output, writes lt.json)
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { createGunzip, gunzipSync } from "node:zlib";
import { Archive } from "../../../../tools/backtest/src/archives-v5.ts";
import { untar, type Files } from "../../../../tools/backtest/src/delta.ts";
import { registryTarball } from "../../../../packages/cli/src/security/judge.ts";
import { provenanceFrom } from "../../../../packages/cli/src/security/npm-facts.ts";
import { githubOf, packageDir, releaseTag, repositoryOf, tagCandidates, tagsFromRefs } from "../../2026-10-30-lo-tarball-source/scripts/lo.ts";
import { contentDelta, explain, readSourceTar, timeStats } from "../../2026-10-30-lold2/scripts/lold2.ts";
import { archiveUrl, inWindow, outcome, reachability, repoOfLine, windowHours } from "./lib.ts";

const [mode, ...args] = process.argv.slice(2);
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const regPath = (name: string) => name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
const write = (file: string, data: unknown) => { writeFileSync(`${file}.tmp`, typeof data === "string" ? data : JSON.stringify(data, null, 1)); renameSync(`${file}.tmp`, file); };
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const tally = <T>(list: T[], key: (r: T) => string) => list.reduce<Record<string, number>>((a, r) => { const k = key(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(2)}%` : "n/a";
const frac = (n: number, d: number) => `${n} / ${d} (${pct(n, d)})`;
async function pool<T>(items: T[], n: number, work: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; await work(items[i]!, i); } }));
}

// --- Registry and ecosyste.ms (§2, §7) ---
type Doc = { status: number | "unreadable"; doc: any };
async function versionDoc(archive: Archive, name: string, version: string): Promise<Doc> {
  const a = await archive.get("registry", `https://registry.npmjs.org/${regPath(name)}/${encodeURIComponent(version)}`);
  return { status: a ? a.status : "unreadable", doc: a?.status === 200 && a.json && typeof a.json === "object" ? a.json : null };
}
async function ecoMetadata(archive: Archive, name: string, version: string): Promise<{ status: number | "unreadable"; metadata: any }> {
  const a = await archive.get("ecosystems", `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
  const m = a?.status === 200 && a.json?.metadata && typeof a.json.metadata === "object" && Object.keys(a.json.metadata).length ? a.json.metadata : null;
  return { status: a ? a.status : "unreadable", metadata: m };
}
type RepoReading = { from: "registry" | "ecosyste.ms" | null; status: string; repo: string | null; directory: string | null; registry: number | "unreadable"; ecosystems: number | "unreadable" | null };
/** §2: a version's repository, from its registry document, else ecosyste.ms's copy. */
async function repositoryReading(archive: Archive, name: string, version: string, doc: Doc): Promise<RepoReading> {
  let from: RepoReading["from"] = null, pkg: any = null, eco: number | "unreadable" | null = null;
  if (doc.doc) { from = "registry"; pkg = doc.doc; }
  else { const e = await ecoMetadata(archive, name, version); eco = e.status; if (e.metadata) { from = "ecosyste.ms"; pkg = e.metadata; } }
  if (!pkg) return { from, status: "not obtained", repo: null, directory: null, registry: doc.status, ecosystems: eco };
  const r = repositoryOf(pkg);
  return { from, status: r.ok ? "github" : r.why, repo: r.ok ? `${r.owner}/${r.repo}` : null, directory: r.ok ? r.directory : null, registry: doc.status, ecosystems: eco };
}
/** §7 (LO2 §2's reading): the provenance's GitHub repository and commit. */
async function provenance(archive: Archive, name: string, version: string, doc: any): Promise<{ status: string; repo?: string; commit?: string }> {
  if (!doc) return { status: "V not listed" };
  if (!doc.dist?.attestations) return { status: "no attestations" };
  const att = await archive.get("registry", `https://registry.npmjs.org/-/npm/v1/attestations/${regPath(name)}@${encodeURIComponent(version)}`);
  if (!att || att.status !== 200) return { status: `provenance unreadable: attestations not read (${att ? `HTTP ${att.status}` : "no answer"})` };
  try {
    const p = provenanceFrom(att.json, { name, version, integrity: typeof doc.dist.integrity === "string" ? doc.dist.integrity : null });
    if (!p) return { status: "provenance unreadable: no SLSA provenance" };
    const gh = p.repository ? githubOf(p.repository) : null;
    if (!gh?.ok) return { status: `provenance unreadable: repository ${gh ? gh.why : "missing"}` };
    if (!p.commit) return { status: "provenance unreadable: no commit" };
    return { status: "provenance read", repo: `${gh.owner}/${gh.repo}`, commit: p.commit };
  } catch (e) { return { status: `provenance unreadable: ${String(e).slice(0, 160)}` }; }
}

// --- refs: §2, §3 (references), §7 ---
async function refsMode(v5File: string, lold2File: string, cacheDir: string, outDir: string) {
  const archive = new Archive(cacheDir);
  const v5 = JSON.parse(readFileSync(v5File, "utf8")) as { rows: any[] };
  if (v5.rows.length !== 1148) throw new Error(`expected 1148 rows, got ${v5.rows.length}`);
  const refsOf = new Map<string, Promise<{ status: string; tags: Map<string, string> | null }>>();
  const references = (repo: string) => {
    let p = refsOf.get(repo.toLowerCase());
    if (!p) {
      p = archive.get("github-refs", `https://github.com/${repo}.git/info/refs?service=git-upload-pack`, "text").then(a =>
        a?.status === 200 && typeof a.text === "string" ? { status: "read", tags: tagsFromRefs(a.text) } : { status: a ? `HTTP ${a.status}` : "no answer", tags: null });
      refsOf.set(repo.toLowerCase(), p);
    }
    return p;
  };
  const rows: any[] = new Array(v5.rows.length);
  await pool(v5.rows, 8, async (r, i) => {
    const out: any = { id: r.id, name: r.name, version: r.version, prev: r.previous, published: r.published, disputed: r.disputed?.disputed === true };
    const pDoc = await versionDoc(archive, r.name, r.previous);
    out.prev_repository = await repositoryReading(archive, r.name, r.previous, pDoc);
    out.prev_attestations = !!pDoc.doc?.dist?.attestations;
    const vDoc = await versionDoc(archive, r.name, r.version);
    out.version_repository = await repositoryReading(archive, r.name, r.version, vDoc);
    out.version_provenance = await provenance(archive, r.name, r.version, vDoc.doc);
    out.version_listed = !!vDoc.doc;
    if (out.prev_repository.repo) {
      const refs = await references(out.prev_repository.repo);
      out.refs = refs.status;
      const vTag = refs.tags ? releaseTag(refs.tags, r.name, r.version) : null;
      const pTag = refs.tags ? releaseTag(refs.tags, r.name, r.previous) : null;
      out.tag_now = vTag; out.prev_tag_now = pTag;
    }
    rows[i] = out;
    if ((i + 1) % 50 === 0) log(`refs ${i + 1}/${v5.rows.length}`);
  });
  for (const [i, o] of rows.entries()) log(`malicious ${i + 1} ${o.name} ${o.prev} -> ${o.version}: P ${o.prev_repository.status}${o.prev_repository.repo ? ` ${o.prev_repository.repo}` : ""} (${o.prev_repository.from ?? `registry ${o.prev_repository.registry}, ecosyste.ms ${o.prev_repository.ecosystems}`}); refs ${o.refs ?? "-"}; tag ${o.tag_now?.tag ?? "-"}; V ${o.version_provenance.status}`);
  // The host's gh.sh reads these: repositories (malicious P's and genuine) and the commits to compare.
  const lold2 = JSON.parse(readFileSync(lold2File, "utf8"));
  const genuine = lold2.rows.genuine as any[];
  if (genuine.length !== 192) throw new Error(`expected 192 genuine rows, got ${genuine.length}`);
  const repos = new Set<string>(), commits = new Set<string>();
  for (const o of rows) if (o.prev_repository.repo) repos.add(o.prev_repository.repo);
  // The third column says whether gh.sh also reads the commit's time (§3, shown for malicious tags).
  for (const o of rows) if (o.tag_now) commits.add(`${o.prev_repository.repo}\t${o.tag_now.commit}\tmalicious-tag`);
  for (const o of rows) if (o.version_provenance.status === "provenance read") { repos.add(o.version_provenance.repo); commits.add(`${o.version_provenance.repo}\t${o.version_provenance.commit}\tmalicious-provenance`); }
  for (const g of genuine) if (g.lo_release && g.lo_source) { const [repo, commit] = String(g.lo_source).split("@"); repos.add(repo!); commits.add(`${repo}\t${commit}\tgenuine`); }
  const ok = (repo: string) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
  write(join(outDir, "repos.txt"), [...repos].filter(ok).sort().join("\n") + "\n");
  write(join(outDir, "commits.tsv"), [...commits].filter(l => ok(l.split("\t")[0]!) && /^[0-9a-f]{40}$/.test(l.split("\t")[1]!)).sort().join("\n") + "\n");
  write(join(outDir, "phase1.json"), { run: { mode: "refs", ended_at: new Date().toISOString(), node: process.version, requests: archive.counters, data: { malicious_v5: sha(v5File), lold2: sha(lold2File) } }, rows });
  log(`refs done: ${rows.length} rows, ${repos.size} repositories, ${commits.size} commits`);
}

// --- gh.sh's output ---
type Meta = { status: string; id: number | null; full_name: string | null; default_branch: string | null };
function readMeta(outDir: string): Map<string, Meta> {
  const m = new Map<string, Meta>();
  for (const line of readFileSync(join(outDir, "gh-repos.tsv"), "utf8").split("\n")) {
    if (!line) continue;
    const [repo, status, id, full, branch] = line.split("\t");
    m.set(repo!.toLowerCase(), { status: status!, id: status === "200" && /^\d+$/.test(id ?? "") ? Number(id) : null, full_name: status === "200" ? full! : null, default_branch: status === "200" ? branch! : null });
  }
  return m;
}
function readCompare(outDir: string): Map<string, { default_branch: string; status: string; reach: string }> {
  const m = new Map<string, { default_branch: string; status: string; reach: string }>();
  for (const line of readFileSync(join(outDir, "gh-compare.tsv"), "utf8").split("\n")) {
    if (!line) continue;
    const [repo, commit, branch, status] = line.split("\t");
    m.set(`${repo!.toLowerCase()}@${commit}`, { default_branch: branch!, status: status!, reach: reachability(status!) });
  }
  return m;
}

// --- archive: §4 ---
type Ev = { type: string; repo_id: number; repo_name: string; ref: string | null; ref_type: string | null; created_at: string };
async function archiveMode(cacheDir: string, outDir: string) {
  const phase1 = JSON.parse(readFileSync(join(outDir, "phase1.json"), "utf8"));
  const meta = readMeta(outDir);
  const rows = phase1.rows as any[];
  const github = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.prev_repository.repo);
  const looked = github.filter(({ r }) => !r.tag_now);
  // Matching: by the API's id, else by name (P's owner/repo and the current full_name).
  const ids = new Map<number, number[]>(), names = new Map<string, number[]>();
  const add = <K>(m: Map<K, number[]>, k: K, i: number) => { const l = m.get(k); if (l) { if (!l.includes(i)) l.push(i); } else m.set(k, [i]); };
  for (const { r, i } of github) {
    const mt = meta.get(r.prev_repository.repo.toLowerCase());
    if (mt?.id) add(ids, mt.id, i);
    else { add(names, r.prev_repository.repo.toLowerCase(), i); if (mt?.full_name) add(names, mt.full_name.toLowerCase(), i); }
  }
  const hours = [...new Set(looked.flatMap(({ r }) => windowHours(r.published)))].sort((a, b) => a - b);
  log(`archive: ${looked.length} rows looked up, ${hours.length} hours to read`);
  const key = createHash("sha256").update(JSON.stringify([[...ids.keys()].sort(), [...names.keys()].sort()])).digest("hex").slice(0, 16);
  const cdir = join(cacheDir, "gharchive"); mkdirSync(cdir, { recursive: true });
  const read = new Map<number, { ok: boolean; why?: string; events: Ev[] }>();
  let done = 0, bytes = 0;
  const started = Date.now();
  await pool(hours, 4, async hour => {
    const cfile = join(cdir, `${hour}-${key}.json`);
    if (existsSync(cfile)) { read.set(hour, JSON.parse(readFileSync(cfile, "utf8"))); done++; return; }
    let result: { ok: boolean; why?: string; events: Ev[] } = { ok: false, why: "no attempt", events: [] };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const events: Ev[] = [];
      let raw: Readable | null = null, unparsed = 0;
      try {
        const res = await fetch(archiveUrl(hour), { headers: { "user-agent": "Ludion-Backtest (read-only)" }, signal: AbortSignal.timeout(1_800_000) });
        if (res.status === 404) { result = { ok: false, why: "HTTP 404", events: [] }; break; }
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        raw = Readable.fromWeb(res.body as any);
        raw.on("data", (c: Buffer) => { bytes += c.length; });
        const lines = createInterface({ input: raw.pipe(createGunzip()), crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line) continue;
          let repo = repoOfLine(line), parsed: any = null;
          if (!repo) {
            try { parsed = JSON.parse(line); } catch { unparsed++; continue; }
            repo = { id: Number(parsed?.repo?.id), name: String(parsed?.repo?.name ?? "") };
          }
          if (!ids.has(repo.id) && !names.has(repo.name.toLowerCase())) continue;
          const e = parsed ?? JSON.parse(line);
          if (e.type !== "CreateEvent" && e.type !== "DeleteEvent" && e.type !== "PushEvent") continue;
          events.push({ type: e.type, repo_id: repo.id, repo_name: repo.name, ref: typeof e.payload?.ref === "string" ? e.payload.ref : null, ref_type: typeof e.payload?.ref_type === "string" ? e.payload.ref_type : null, created_at: String(e.created_at) });
        }
        result = { ok: true, events, ...(unparsed ? { unparsed } : {}) } as any;
        break;
      } catch (e) { raw?.destroy(); result = { ok: false, why: String(e).slice(0, 200), events: [] }; await new Promise(r => setTimeout(r, 10_000 * attempt)); }
    }
    if (result.ok || result.why === "HTTP 404") write(cfile, result);
    read.set(hour, result);
    done++;
    log(`hour ${new Date(hour).toISOString().slice(0, 13)} ${result.ok ? `${result.events.length} events` : `missing (${result.why})`}; ${done}/${hours.length}, ${(bytes / 1e9).toFixed(2)} GB in ${Math.round((Date.now() - started) / 60000)} min`);
  });
  const out = github.map(({ r, i }) => {
    const forms = new Set(tagCandidates(r.name, r.version));
    const win = windowHours(r.published);
    const readHours = win.filter(h => read.get(h)?.ok);
    const matches = (e: Ev) => (ids.get(e.repo_id)?.includes(i) || names.get(e.repo_name.toLowerCase())?.includes(i)) && inWindow(r.published, e.created_at);
    const evs = readHours.flatMap(h => read.get(h)!.events).filter(matches);
    const created = evs.filter(e => e.type === "CreateEvent" && e.ref_type === "tag" && forms.has(e.ref ?? ""));
    const o: any = {
      index: i, name: r.name, version: r.version, looked_up: !r.tag_now,
      hours_read: readHours.length, hours_in_window: win.length, missing_hours: win.filter(h => read.has(h) && !read.get(h)!.ok).map(h => `${new Date(h).toISOString().slice(0, 13)} ${read.get(h)!.why}`),
      tag_created: created.map(e => ({ ref: e.ref, created_at: e.created_at, hours_after_publish: Math.round((Date.parse(e.created_at) - Date.parse(r.published)) / 36e3) / 100 })),
      tag_deleted: evs.filter(e => e.type === "DeleteEvent" && e.ref_type === "tag" && forms.has(e.ref ?? "")).map(e => ({ ref: e.ref, created_at: e.created_at })),
      other_tags_created: evs.filter(e => e.type === "CreateEvent" && e.ref_type === "tag" && !forms.has(e.ref ?? "")).length,
      pushes: evs.filter(e => e.type === "PushEvent").length,
    };
    o.at_the_time = !o.looked_up ? null : created.length ? "tag created at the time" : readHours.length === win.length ? "no tag event" : "not fully checked";
    return o;
  });
  write(join(outDir, "phase3.json"), { run: { mode: "archive", ended_at: new Date().toISOString(), hours: hours.length, hours_read: hours.filter(h => read.get(h)?.ok).length, missing: hours.filter(h => !read.get(h)?.ok).map(h => `${new Date(h).toISOString().slice(0, 13)} ${read.get(h)?.why}`), gigabytes: Math.round(bytes / 1e7) / 100, match_key: key }, rows: out });
  log(`archive done: ${out.length} rows`);
}

// --- source: §6 ---
const LIMIT = 2 ** 30;
async function sourceTar(owner: string, repo: string, commit: string): Promise<{ ok: true; tar: Buffer } | { ok: false; why: string }> {
  let why = "no attempt";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${commit}`, { headers: { "user-agent": "Ludion-Backtest (read-only)" }, signal: AbortSignal.timeout(900_000) });
      if (!res.ok) { why = `HTTP ${res.status}`; if (res.status >= 400 && res.status < 500 && res.status !== 429) break; await new Promise(r => setTimeout(r, 5_000 * attempt)); continue; }
      const gz = Buffer.from(await res.arrayBuffer());
      try { return { ok: true, tar: gunzipSync(gz, { maxOutputLength: LIMIT }) }; } catch (e) { return { ok: false, why: /maxOutputLength|buffer|range/i.test(String(e)) ? "source archive over the limit" : `not unpacked: ${String(e).slice(0, 160)}` }; }
    } catch (e) { why = String(e).slice(0, 200); await new Promise(r => setTimeout(r, 5_000 * attempt)); }
  }
  return { ok: false, why };
}
async function sourcePackage(owner: string, repo: string, commit: string, name: string, directory: string | null): Promise<{ ok: true; dir: string; files: Files } | { ok: false; why: string }> {
  const got = await sourceTar(owner, repo, commit);
  if (!got.ok) return { ok: false, why: got.why === "source archive over the limit" ? got.why : `source archive not read: ${got.why}` };
  let listing;
  try { listing = readSourceTar(got.tar, null); } catch (e) { return { ok: false, why: `source archive not read: ${String(e).slice(0, 160)}` }; }
  const where = packageDir({ files: new Map([...listing.paths].map(p => [p, { sha256: "", eol: null, size: 0 }])), kept: listing.packageJsons }, name, directory);
  if (!where.ok) return { ok: false, why: where.why };
  return { ok: true, dir: where.dir, files: readSourceTar(got.tar, where.dir).kept };
}
async function tarball(archive: Archive, name: string, version: string, doc: any): Promise<{ ok: true; files: Files } | { ok: false; why: string }> {
  const sri = typeof doc?.dist?.integrity === "string" ? doc.dist.integrity.split(/\s+/).find((s: string) => s.startsWith("sha512-")) : undefined;
  if (!sri) return { ok: false, why: doc ? "no sha512 integrity" : "no version document" };
  const res = await archive.bytes("registry-tarball", registryTarball(name, version));
  if (!res || res.status !== 200 || !res.body) return { ok: false, why: `tarball ${res ? `HTTP ${res.status}` : "unreadable"}` };
  if (`sha512-${createHash("sha512").update(res.body).digest("base64")}` !== sri) return { ok: false, why: "integrity mismatch" };
  try { return { ok: true, files: untar(res.body) }; } catch (e) { return { ok: false, why: `tarball unreadable: ${String(e).slice(0, 160)}` }; }
}
async function sourceMode(cacheDir: string, outDir: string) {
  const archive = new Archive(cacheDir);
  const phase1 = JSON.parse(readFileSync(join(outDir, "phase1.json"), "utf8"));
  const meta = readMeta(outDir);
  const out: any[] = [];
  const tagged = (phase1.rows as any[]).map((r, i) => ({ r, i })).filter(({ r }) => r.tag_now);
  for (const [n, { r, i }] of tagged.entries()) {
    const repo = r.prev_repository.repo as string;
    const full = meta.get(repo.toLowerCase())?.full_name ?? repo;
    const [owner, name] = full.split("/") as [string, string];
    const o: any = { index: i, name: r.name, prev: r.prev, version: r.version, repository: full, version_commit: r.tag_now.commit };
    let prevCommit: string | null = r.prev_tag_now?.commit ?? null, prevHow = r.prev_tag_now ? `tag form ${r.prev_tag_now.form}` : "";
    const pDoc = await versionDoc(archive, r.name, r.prev);
    if (!prevCommit && pDoc.doc) {
      const pv = await provenance(archive, r.name, r.prev, pDoc.doc);
      o.prev_provenance = pv.status;
      if (pv.status === "provenance read" && pv.repo!.toLowerCase() === repo.toLowerCase()) { prevCommit = pv.commit!; prevHow = "provenance"; }
    }
    o.prev_commit = prevCommit; o.prev_release = prevHow || null;
    if (!prevCommit) o.source = { outcome: "not comparable", reason: "no release for the previous version" };
    else if (prevCommit === r.tag_now.commit) o.source = { outcome: "not comparable", reason: "the same commit for both versions" };
    else {
      const ps = await sourcePackage(owner, name, prevCommit, r.name, r.prev_repository.directory);
      const vs = ps.ok ? await sourcePackage(owner, name, r.tag_now.commit, r.name, r.prev_repository.directory) : null;
      if (!ps.ok) o.source = { outcome: "not comparable", reason: `previous commit: ${ps.why}` };
      else if (!vs!.ok) o.source = { outcome: "not comparable", reason: `version commit: ${vs!.why}` };
      else {
        const sd = contentDelta(ps.files, vs!.files);
        o.source = sd.status === "undecidable" ? { outcome: "not comparable", reason: `source package.json unreadable: ${sd.why}` } : { outcome: sd.status === "flagged" ? "new capability in the source" : "none", capabilities: sd.capabilities, changed_code_files: sd.matched.length, dir: ps.dir };
        if (r.version_listed && sd.status !== "undecidable") {
          const vDoc = await versionDoc(archive, r.name, r.version);
          const pt = await tarball(archive, r.name, r.prev, pDoc.doc), vt = await tarball(archive, r.name, r.version, vDoc.doc);
          if (!pt.ok || !vt.ok) o.tarball = { computed: false, why: !pt.ok ? `previous: ${pt.why}` : `version: ${(vt as any).why}` };
          else {
            const td = contentDelta(pt.files, vt.files);
            o.tarball = td.status === "undecidable" ? { computed: true, status: "undecidable", why: td.why } : { computed: true, status: td.status, capabilities: td.capabilities, ...(td.status === "flagged" ? explain(td.where, sd.where) : {}) };
          }
        }
      }
    }
    out.push(o);
    log(`source ${n + 1}/${tagged.length} ${r.name} ${r.prev} -> ${r.version} ${full}: ${o.source.outcome}${o.source.reason ? ` (${o.source.reason})` : ""}${o.source.capabilities?.length ? ` [${o.source.capabilities.join(", ")}]` : ""}${o.tarball ? `; tarball ${o.tarball.status ?? o.tarball.why}` : ""}`);
  }
  write(join(outDir, "phase4.json"), { run: { mode: "source", ended_at: new Date().toISOString(), requests: archive.counters }, rows: out });
}

// --- summary: §8 ---
function summaryMode(lold2File: string, outDir: string) {
  const p1 = JSON.parse(readFileSync(join(outDir, "phase1.json"), "utf8"));
  const p3 = JSON.parse(readFileSync(join(outDir, "phase3.json"), "utf8"));
  const p4 = JSON.parse(readFileSync(join(outDir, "phase4.json"), "utf8"));
  const meta = readMeta(outDir), cmp = readCompare(outDir);
  const at = new Map<number, any>((p3.rows as any[]).map(o => [o.index, o]));
  const src = new Map<number, any>((p4.rows as any[]).map(o => [o.index, o]));
  const M = (p1.rows as any[]).map((r, i) => {
    const a = at.get(i), s = src.get(i);
    const repo = r.prev_repository.repo as string | null;
    const full = repo ? meta.get(repo.toLowerCase())?.full_name ?? repo : null;
    const c = r.tag_now ? cmp.get(`${repo!.toLowerCase()}@${r.tag_now.commit}`) : undefined;
    const prov = r.version_provenance.status === "provenance read";
    const o = outcome({ prevRepo: r.prev_repository.status, tagNow: !!r.tag_now, refsReachable: r.refs === "read", atTheTime: a?.at_the_time ?? null, provenance: prov });
    return {
      ...r, outcome: o, api: repo ? meta.get(repo.toLowerCase())?.status ?? "not read" : null, full_name: full,
      reach: r.tag_now ? c?.reach ?? "unknown" : null, compare: c?.status ?? null,
      commit_minus_publish_hours: null as number | null, at_the_time: a ?? null, source: s ?? null,
      version_names_other_repository: r.version_repository.repo && repo ? r.version_repository.repo.toLowerCase() !== repo.toLowerCase() : null,
      provenance_same_repository: prov && repo ? r.version_provenance.repo.toLowerCase() === repo.toLowerCase() : null,
    };
  });
  // §3 shown: tag commit times, read by gh.sh into gh-commit-times.tsv (repo, commit, committer date).
  const times = new Map<string, string>();
  if (existsSync(join(outDir, "gh-commit-times.tsv"))) for (const line of readFileSync(join(outDir, "gh-commit-times.tsv"), "utf8").split("\n")) { const [repo, commit, date] = line.split("\t"); if (repo && commit && date && date !== "error") times.set(`${repo.toLowerCase()}@${commit}`, date); }
  for (const m of M) if (m.tag_now) { const d = times.get(`${m.prev_repository.repo.toLowerCase()}@${m.tag_now.commit}`); if (d) m.commit_minus_publish_hours = Math.round((Date.parse(d) - Date.parse(m.published)) / 36e3) / 100; }
  const strengthened = (m: any) => (m.outcome === "tied: tag now" && m.reach === "reachable") || (m.outcome === "tied: provenance only" && cmp.get(`${String(m.version_provenance.repo).toLowerCase()}@${m.version_provenance.commit}`)?.reach === "reachable");
  const N = M.length, D = M.filter(m => !m.disputed);
  const tagged = M.filter(m => m.tag_now);
  const malicious = {
    rows: N,
    prev_repository: tally(M, m => m.prev_repository.status),
    prev_repository_from: tally(M, m => `${m.prev_repository.status} (${m.prev_repository.from ?? "-"})`),
    prev_registry_answer: tally(M, m => String(m.prev_repository.registry)),
    github_rows: M.filter(m => m.prev_repository.repo).length,
    github_repositories: new Set(M.filter(m => m.prev_repository.repo).map(m => m.prev_repository.repo.toLowerCase())).size,
    refs: tally(M.filter(m => m.prev_repository.repo), m => m.refs),
    api: tally(M.filter(m => m.prev_repository.repo), m => m.api),
    outcomes: Object.fromEntries(Object.entries(tally(M, m => m.outcome)).sort().map(([k, v]) => [k, frac(v, N)])),
    outcomes_without_disputed: Object.fromEntries(Object.entries(tally(D, m => m.outcome)).sort().map(([k, v]) => [k, frac(v, D.length)])),
    disputed: M.filter(m => m.disputed).map(m => `${m.name}@${m.version}: ${m.outcome}`),
    tied: frac(M.filter(m => m.outcome.startsWith("tied")).length, N),
    not_tied: frac(M.filter(m => m.outcome.startsWith("not tied")).length, N),
    unknown: frac(M.filter(m => m.outcome.startsWith("unknown")).length, N),
    strengthened_tied: frac(M.filter(strengthened).length, N),
    tag_now: {
      rows: tagged.length,
      forms: tally(tagged, m => `form ${m.tag_now.form}`),
      reach: tally(tagged, m => m.reach),
      commit_minus_publish_hours: timeStats(tagged.filter(m => typeof m.commit_minus_publish_hours === "number").map(m => m.commit_minus_publish_hours)),
      source: tally(tagged, m => m.source ? m.source.source.outcome === "not comparable" ? `not comparable: ${m.source.source.reason.replace(/: .*$/, "")}` : m.source.source.outcome : "not computed"),
      tarball: tally(tagged.filter(m => m.source?.tarball), m => m.source.tarball.computed ? `${m.source.tarball.status}${m.source.tarball.unexplained?.length ? ", unexplained" : m.source.tarball.explained ? ", all explained" : ""}` : `not computed: ${m.source.tarball.why}`),
      list: tagged.map(m => `${m.name}@${m.version} ${m.full_name} ${m.tag_now.tag} (form ${m.tag_now.form}); ${m.reach}; commit ${m.commit_minus_publish_hours ?? "?"} h; source ${m.source?.source?.outcome ?? "-"}${m.source?.source?.capabilities?.length ? ` [${m.source.source.capabilities.join(", ")}]` : ""}`),
    },
    at_the_time: {
      looked_up: M.filter(m => m.at_the_time?.looked_up).length,
      outcome: tally(M.filter(m => m.at_the_time?.looked_up), m => m.at_the_time.at_the_time),
      tag_deleted_in_window: M.filter(m => m.at_the_time?.tag_deleted?.length).map(m => `${m.name}@${m.version}`),
      rows_with_pushes_in_window: M.filter(m => m.at_the_time?.looked_up && m.at_the_time.pushes > 0).length,
      rows_with_other_tags_in_window: M.filter(m => m.at_the_time?.looked_up && m.at_the_time.other_tags_created > 0).length,
      tagged_rows_shown: tally(tagged, m => m.at_the_time ? `${m.at_the_time.hours_read}/${m.at_the_time.hours_in_window} hours read, ${m.at_the_time.tag_created.length ? "tag event" : "no tag event"}` : "-"),
    },
    version_provenance: tally(M, m => m.version_provenance.status.replace(/: .*$/, "")),
    version_repository: tally(M, m => `${m.version_repository.status} (${m.version_repository.from ?? "-"})`),
    version_names_other_repository: M.filter(m => m.version_names_other_repository).map(m => `${m.name}@${m.version}: P ${m.prev_repository.repo}, V ${m.version_repository.repo}`),
  };
  const lold2 = JSON.parse(readFileSync(lold2File, "utf8"));
  const G = (lold2.rows.genuine as any[]).map(g => {
    const [repo, commit] = g.lo_source ? String(g.lo_source).split("@") : [null, null];
    const c = repo && commit ? cmp.get(`${repo.toLowerCase()}@${commit}`) : undefined;
    return { name: g.name, version: g.version, kind: g.lo_release?.kind ?? null, repo, commit, reach: g.lo_release ? c?.reach ?? "unknown" : null, compare: c?.status ?? null, default_branch: c?.default_branch ?? null, ld2: g.ld2.outcome };
  });
  const ld2ok = (g: any) => g.ld2 === "no new capability" || g.ld2 === "all explained";
  const genuine = {
    rows: G.length,
    tied: frac(G.filter(g => g.kind).length, G.length),
    tag: { rows: G.filter(g => g.kind === "tag").length, reach: tally(G.filter(g => g.kind === "tag"), g => g.reach) },
    provenance: { rows: G.filter(g => g.kind === "provenance").length, reach: tally(G.filter(g => g.kind === "provenance"), g => g.reach) },
    strengthened: frac(G.filter(g => g.reach === "reachable").length, G.length),
    strengthened_of_tied: frac(G.filter(g => g.reach === "reachable").length, G.filter(g => g.kind).length),
    both_prongs_plain: frac(G.filter(g => g.kind && ld2ok(g)).length, G.length),
    both_prongs_strengthened: frac(G.filter(g => g.reach === "reachable" && ld2ok(g)).length, G.length),
    not_reachable: G.filter(g => g.reach === "not reachable").map(g => `${g.name}@${g.version} ${g.repo} (${g.compare}, default ${g.default_branch})`),
    unknown: G.filter(g => g.reach === "unknown").map(g => `${g.name}@${g.version} ${g.repo} (${g.compare ?? "not compared"})`),
  };
  const blob = (p: string) => { const b = readFileSync(p); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };
  const here = new URL(".", import.meta.url).pathname;
  write(join(outDir, "lt.json"), {
    definitions: "docs/decisions/2026-10-31-lt-takeover-definitions.md",
    run: { ended_at: new Date().toISOString(), node: process.version, phases: { refs: p1.run, archive: p3.run, source: p4.run }, blobs: Object.fromEntries(["lt.ts", "lib.ts"].map(f => [`docs/bench/2026-10-31-lt-takeover/scripts/${f}`, blob(join(here, f))])) },
    malicious, genuine,
    rows: { malicious: M.map(m => ({ id: m.id, name: m.name, prev: m.prev, version: m.version, published: m.published, disputed: m.disputed, outcome: m.outcome, prev_repository: m.prev_repository, refs: m.refs ?? null, api: m.api, full_name: m.full_name, tag_now: m.tag_now ?? null, prev_tag_now: m.prev_tag_now ?? null, reach: m.reach, compare: m.compare, commit_minus_publish_hours: m.commit_minus_publish_hours, at_the_time: m.at_the_time, source: m.source, version_listed: m.version_listed, version_repository: m.version_repository, version_provenance: m.version_provenance })), genuine: G },
  });
  log("summary done");
}

if (mode === "refs") await refsMode(args[0]!, args[1]!, args[2]!, args[3]!);
else if (mode === "archive") await archiveMode(args[0]!, args[1]!);
else if (mode === "source") await sourceMode(args[0]!, args[1]!);
else if (mode === "summary") summaryMode(args[0]!, args[1]!);
else throw new Error("mode: refs | archive | source | summary");
