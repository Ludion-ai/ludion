// Delta v1 (docs/decisions/2026-10-30-ld-delta-v1-definitions.md): fetch each malicious version and each genuine fix
// with its previous version, in memory, and judge the diff with delta.ts. Run only in a container with no credentials.
// Tarballs and files are held in memory: nothing is extracted to disk, installed, required or run. Only the fetchers'
// JSON answers (lists and metadata) are cached.
//
// Usage: node tools/backtest/src/delta-v1.ts <malicious-v5.json> <fixes-v4.json> <cache-dir> <out.json> <detail.json> [--swh-hours=6]
// <out.json> holds no file content and no path of a malicious version; <detail.json> (paths too) is not committed.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registryTarball } from "../../../packages/cli/src/security/judge.ts";
import { Archive, ecosystems, jsdelivrList, registryVersions, swhFiles, swhLocate, type RegistryDist } from "./archives-v5.ts";
import { CAPABILITIES, delta, FILE_CAPABILITIES, untar, type Delta, type Files } from "./delta.ts";

const [malFile, fixFile, cacheDir, outFile, detailFile, ...flags] = process.argv.slice(2);
if (!malFile || !fixFile || !cacheDir || !outFile || !detailFile) throw new Error("Usage: node tools/backtest/src/delta-v1.ts <malicious-v5.json> <fixes-v4.json> <cache-dir> <out.json> <detail.json> [--swh-hours=6]");
const SWH_HOURS = Number(flags.find(f => f.startsWith("--swh-hours="))?.slice(12) ?? "6");
const startedAt = new Date().toISOString();
const repo = new URL("../../../", import.meta.url).pathname;
const blob = (f: string) => { const b = readFileSync(join(repo, f)); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };
const blobs = Object.fromEntries(["tools/backtest/src/delta-v1.ts", "tools/backtest/src/delta.ts", "tools/backtest/src/archives-v5.ts", "packages/cli/src/security/judge.ts"].map(f => [f, blob(f)]));
const archive = new Archive(cacheDir);
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

// --- The pairs (section 1). ---
type Version = { name: string; version: string; published: string | null };
type Pair = { set: "malicious" | "genuine"; id: string; prev: Version; next: Version };
const pairs: Pair[] = [
  ...(JSON.parse(readFileSync(malFile, "utf8")).rows as any[]).map((r): Pair => ({ set: "malicious", id: r.id, prev: { name: r.name, version: r.previous, published: null }, next: { name: r.name, version: r.version, published: r.published } })),
  ...(JSON.parse(readFileSync(fixFile, "utf8")).rows as any[]).map((r): Pair => ({ set: "genuine", id: r.id, prev: { name: r.name, version: r.from, published: null }, next: { name: r.name, version: r.to, published: r.fix_published } })),
];
const key = (v: Version) => `${v.name}@${v.version}`;

// --- Getting a version's files (section 2). ---
type Got = { files: Files; source: "registry" | "registry, hash unknown" | "jsdelivr" | "software-heritage" };
type Tried = Record<string, string>;
const sha = (alg: string, b: Buffer, enc: "hex" | "base64") => createHash(alg).update(b).digest(enc);
const dists = new Map<string, Promise<RegistryDist | null>>();
const dist = (name: string) => { if (!dists.has(name)) dists.set(name, registryVersions(archive, cacheDir!, name)); return dists.get(name)!; };

async function fromRegistry(v: Version, tried: Tried): Promise<Got | null> {
  const listed = (await dist(v.name))?.[v.version];
  let integrity = listed?.integrity ?? null, shasum = listed?.shasum ?? null;
  if (!listed) {
    const eco = await ecosystems(archive, v.name, v.version);
    if (eco !== "unreadable" && eco.held) { integrity = eco.integrity; shasum = eco.shasum; }
  }
  const res = await archive.bytes("registry-tarball", registryTarball(v.name, v.version));
  if (!res) { tried.registry = "unreadable"; return null; }
  if (res.status !== 200 || !res.body) { tried.registry = `HTTP ${res.status}`; return null; }
  const sri = integrity?.split(/\s+/).find(s => s.startsWith("sha512-"));
  let source: Got["source"] = "registry";
  if (sri) { if (`sha512-${sha("sha512", res.body, "base64")}` !== sri) { tried.registry = "sha512 integrity mismatch"; return null; } }
  else if (shasum) { if (sha("sha1", res.body, "hex") !== shasum) { tried.registry = "shasum mismatch"; return null; } }
  else source = "registry, hash unknown";
  try { return { files: untar(res.body), source }; } catch (e) { tried.registry = `tarball unreadable: ${String(e)}`; return null; }
}

async function fromJsdelivr(v: Version, tried: Tried): Promise<Got | null> {
  const list = await jsdelivrList(archive, v.name, v.version);
  if (list === "unreadable") { tried.jsdelivr = "list unreadable"; return null; }
  if (!list || !list.size) { tried.jsdelivr = "not listed"; return null; }
  const files: Files = new Map();
  // package.json first, so a CDN that no longer serves the version costs one request.
  for (const path of [...list.keys()].sort((a, b) => (a === "package.json" ? -1 : b === "package.json" ? 1 : a.localeCompare(b)))) {
    const res = await archive.bytes("jsdelivr-cdn", `https://cdn.jsdelivr.net/npm/${v.name}@${encodeURIComponent(v.version)}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!res) { tried.jsdelivr = "file unreadable"; return null; }
    if (res.status !== 200 || !res.body) { tried.jsdelivr = `CDN HTTP ${res.status}`; return null; }
    if (sha("sha256", res.body, "hex") !== list.get(path)!.sha256) { tried.jsdelivr = "file differs from the list's sha256"; return null; }
    files.set(path, res.body);
  }
  return { files, source: "jsdelivr" };
}

// Software Heritage's raw content, one request at a time, waiting out its rate limit (Archive does the same for JSON).
const SWH = "https://archive.softwareheritage.org/api/1";
let swhResetAt = 0, swhRemaining = Infinity, swhRequests = 0;
async function swhRaw(sha1Git: string): Promise<Buffer | null> {
  for (let attempt = 0, limited = 0; attempt < 4;) {
    if (swhRemaining <= 1) {
      await new Promise(r => setTimeout(r, Math.max(60_000, swhResetAt - Date.now() + 5_000)));
      swhRemaining = Infinity;
    }
    swhRequests++;
    const res = await fetch(`${SWH}/content/sha1_git:${sha1Git}/raw/`, { headers: { "user-agent": "Ludion-Backtest (read-only)" }, signal: AbortSignal.timeout(300_000) }).catch(() => null);
    if (res) {
      const left = Number(res.headers.get("x-ratelimit-remaining")), reset = Number(res.headers.get("x-ratelimit-reset"));
      if (Number.isFinite(left)) swhRemaining = left;
      if (Number.isFinite(reset) && reset > 0) swhResetAt = reset * 1000;
      if (res.status === 429 && limited++ < 6) { swhRemaining = 0; continue; }
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
    }
    attempt++;
    await new Promise(r => setTimeout(r, 3_000 * attempt));
  }
  return null;
}
async function fromSwh(v: Version, tried: Tried): Promise<Got | null> {
  if (!v.published) { tried["software-heritage"] = "no publish time"; return null; }
  const hold = await swhLocate(archive, v.name, v.version, v.published);
  if (hold === "unreadable") { tried["software-heritage"] = "unreadable"; return null; }
  if (!hold.held) { tried["software-heritage"] = `not held: ${hold.why}`; return null; }
  const list = await swhFiles(archive, hold.packageRoot);
  if (list === "unreadable") { tried["software-heritage"] = "directory unreadable"; return null; }
  // swhFiles gives sha256 per path; the content endpoint wants sha1_git, which each directory listing holds.
  const ids = new Map<string, string>();
  const walk = async (id: string, prefix: string): Promise<boolean> => {
    const a = await archive.get("swh", `${SWH}/directory/${id}/`);
    if (!a?.json || !Array.isArray(a.json)) return false;
    for (const e of a.json) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.type === "dir") { if (!await walk(e.target, path)) return false; }
      else if (e.type === "file") ids.set(path, e.target);
    }
    return true;
  };
  if (!await walk(hold.packageRoot, "")) { tried["software-heritage"] = "directory unreadable"; return null; }
  const files: Files = new Map();
  for (const [path, f] of list) {
    const id = ids.get(path);
    if (!id) { files.set(path, Buffer.from(`link:${path}`)); continue; }
    const body = await swhRaw(id);
    if (!body) { tried["software-heritage"] = "file unreadable"; return null; }
    if (sha("sha256", body, "hex") !== f.sha256) { tried["software-heritage"] = "file differs from the directory's sha256"; return null; }
    files.set(path, body);
  }
  return { files, source: "software-heritage" };
}

/** A publish time for Software Heritage: the registry's `time`, else (for a malicious version's previous) V's. */
const times = new Map<string, Promise<Record<string, string> | null>>();
async function publishTime(v: Version, fallback: string | null): Promise<string | null> {
  if (v.published) return v.published;
  if (!times.has(v.name)) times.set(v.name, (async () => {
    const res = await archive.bytes("registry", `https://registry.npmjs.org/${v.name.startsWith("@") ? `@${encodeURIComponent(v.name.slice(1))}` : encodeURIComponent(v.name)}`);
    try { return res?.status === 200 && res.body ? JSON.parse(res.body.toString("utf8")).time ?? null : null; } catch { return null; }
  })());
  return (await times.get(v.name)!)?.[v.version] ?? fallback;
}

// --- Phase 1: the registry and jsDelivr, for every version. Phase 2: Software Heritage, in key order, for 6 hours. ---
type Row = {
  set: Pair["set"]; id: string; name: string; prev: string; version: string;
  sources: { prev: string | null; next: string | null };
  tried: { prev: Tried; next: Tried };
  status: "flagged" | "clean" | "undecidable" | "not obtained";
  not_obtained?: "next" | "prev" | "both";
  undecidable?: string;
  capabilities?: string[];
  size?: Extract<Delta, { size: unknown }>["size"];
  shown?: { scriptFiles: number; reference: string[]; packageWide: string[] };
  /** Changed code files: how many, and the file capabilities they had before and have after (counts > 0). */
  changed_code?: { files: number; with_previous: number; before: string[]; after: string[] };
  /** Genuine fixes only: where each capability is new. */
  where?: Record<string, string[]>;
};
const rows: Row[] = [];
const details: any[] = [];
const got = new Map<string, Got | null>();
const triedOf = new Map<string, Tried>();

async function obtain(v: Version, phase: 1 | 2, fallbackTime: string | null): Promise<Got | null> {
  const k = key(v);
  const tried = triedOf.get(k) ?? {};
  triedOf.set(k, tried);
  if (phase === 1) return (await fromRegistry(v, tried)) ?? (await fromJsdelivr(v, tried));
  return fromSwh({ ...v, published: await publishTime(v, fallbackTime) }, tried);
}

function judgeRow(p: Pair, a: Got, b: Got): Row {
  // An analyzer error is reported as undecidable, never as clean or flagged (README, "Runs").
  let d: Delta;
  try { d = delta(a.files, b.files); } catch (e) { d = { status: "undecidable", why: `analyzer error: ${String(e).slice(0, 200)}` }; }
  const base: Row = { set: p.set, id: p.id, name: p.next.name, prev: p.prev.version, version: p.next.version, sources: { prev: a.source, next: b.source }, tried: { prev: triedOf.get(key(p.prev)) ?? {}, next: triedOf.get(key(p.next)) ?? {} }, status: "undecidable" };
  details.push({ set: p.set, id: p.id, version: key(p.next), prev: p.prev.version, delta: d });
  if (d.status === "undecidable") return { ...base, undecidable: d.why };
  const present = (side: "before" | "after") => FILE_CAPABILITIES.filter(c => d.changedCode.some(f => f[side][c]! > 0));
  return {
    ...base,
    status: d.status,
    capabilities: d.capabilities,
    size: d.size,
    shown: { scriptFiles: d.shown.scriptFiles.length, reference: d.shown.reference, packageWide: d.shown.packageWide },
    changed_code: { files: d.changedCode.length, with_previous: d.changedCode.filter(f => f.previous).length, before: present("before"), after: present("after") },
    ...(p.set === "genuine" ? { where: d.where } : {}),
  };
}

const pending: Pair[] = [];
let n = 0;
for (const p of pairs) {
  if (++n % 100 === 0) log(`phase 1: ${n}/${pairs.length}`);
  const a = await obtain(p.prev, 1, null);
  const b = await obtain(p.next, 1, null);
  if (a && b) { rows.push(judgeRow(p, a, b)); continue; }
  got.set(key(p.prev), a ? { ...a, files: new Map() } : null);
  got.set(key(p.next), b ? { ...b, files: new Map() } : null);
  pending.push(p);
}
log(`phase 1 done: ${rows.length} pairs judged, ${pending.length} pending`);

// Phase 2: every version still missing, in the order of SHA-256(name@version), until the deadline.
const missing = new Map<string, { v: Version; fallback: string | null }>();
for (const p of pending) {
  if (!got.get(key(p.prev))) missing.set(key(p.prev), { v: p.prev, fallback: p.next.published });
  if (!got.get(key(p.next))) missing.set(key(p.next), { v: p.next, fallback: null });
}
const order = [...missing.keys()].sort((x, y) => sha("sha256", Buffer.from(x), "hex").localeCompare(sha("sha256", Buffer.from(y), "hex")));
const swh = new Map<string, Got | null>();
let deadline = Infinity, swhStartedAt: string | null = null;
for (const [i, k] of order.entries()) {
  if (Date.now() >= deadline) break;
  if (deadline === Infinity) { deadline = Date.now() + SWH_HOURS * 3_600_000; swhStartedAt = new Date().toISOString(); }
  const { v, fallback } = missing.get(k)!;
  const g = await obtain(v, 2, fallback);
  // The files are not kept: a pair is judged below, fetching both sides again.
  swh.set(k, g ? { ...g, files: new Map() } : null);
  if ((i + 1) % 20 === 0) log(`phase 2: ${i + 1}/${order.length} looked up, ${[...swh.values()].filter(Boolean).length} held`);
}
const swhEndedAt = new Date().toISOString();
log(`phase 2 done: ${swh.size}/${order.length} looked up, ${[...swh.values()].filter(Boolean).length} held`);

for (const p of pending) {
  const sides = [p.prev, p.next].map(v => got.get(key(v)) ?? swh.get(key(v)) ?? null);
  const base: Row = { set: p.set, id: p.id, name: p.next.name, prev: p.prev.version, version: p.next.version, sources: { prev: sides[0]?.source ?? null, next: sides[1]?.source ?? null }, tried: { prev: triedOf.get(key(p.prev)) ?? {}, next: triedOf.get(key(p.next)) ?? {} }, status: "not obtained" };
  for (const [i, v] of [p.prev, p.next].entries()) if (!sides[i] && !swh.has(key(v))) base.tried[i ? "next" : "prev"]["software-heritage"] = "not looked up in time";
  if (!sides[0] || !sides[1]) { rows.push({ ...base, not_obtained: !sides[0] && !sides[1] ? "both" : sides[0] ? "next" : "prev" }); continue; }
  // Both sides are held: fetch them again from where they were found, and judge.
  const again = async (v: Version, s: Got) => s.source === "software-heritage" ? fromSwh({ ...v, published: await publishTime(v, p.next.published) }, {}) : (await fromRegistry(v, {})) ?? (await fromJsdelivr(v, {}));
  const a = await again(p.prev, sides[0]), b = await again(p.next, sides[1]);
  if (!a || !b) { rows.push({ ...base, not_obtained: !a && !b ? "both" : a ? "next" : "prev", undecidable: "held, but a second fetch failed" }); continue; }
  rows.push(judgeRow(p, a, b));
}

// --- Section 6: the counts. ---
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
function summary(set: Row["set"]) {
  const r = rows.filter(x => x.set === set);
  const judged = r.filter(x => x.status === "flagged" || x.status === "clean");
  const tally = (f: (x: Row) => string) => r.reduce<Record<string, number>>((o, x) => { const k = f(x); o[k] = (o[k] ?? 0) + 1; return o; }, {});
  const size = (k: keyof NonNullable<Row["size"]>) => { const xs = judged.map(x => x.size![k]); return { median: median(xs), max: xs.length ? Math.max(...xs) : null }; };
  return {
    pairs: r.length,
    by_status: tally(x => x.status),
    not_obtained_by_side: tally(x => x.status === "not obtained" ? x.not_obtained! : "-"),
    sources: tally(x => `${x.sources.prev ?? "none"} / ${x.sources.next ?? "none"}`),
    per_capability: Object.fromEntries(CAPABILITIES.map(c => [c, { fires: judged.filter(x => x.capabilities!.includes(c)).length, alone: judged.filter(x => x.capabilities!.length === 1 && x.capabilities![0] === c).length }])),
    package_wide_reading: { flagged: judged.filter(x => x.capabilities!.some(c => !FILE_CAPABILITIES.includes(c as any)) || x.shown!.packageWide.length > 0).length },
    size: { files_added: size("filesAdded"), files_removed: size("filesRemoved"), files_changed: size("filesChanged"), code_files_changed: size("codeFilesChanged"), lines_added: size("linesAdded"), lines_removed: size("linesRemoved") },
  };
}
const why = (side: Tried) => Object.entries(side).map(([s, w]) => `${s}: ${w}`).join("; ");
const notObtainedReasons = (set: Row["set"]) => rows.filter(x => x.set === set && x.status === "not obtained").reduce<Record<string, number>>((o, x) => {
  for (const side of ["prev", "next"] as const) if (!x.sources[side]) { const k = `${side}: ${why(x.tried[side])}`; o[k] = (o[k] ?? 0) + 1; }
  return o;
}, {});

const out = {
  run: { started_at: startedAt, ended_at: new Date().toISOString(), swh: { started_at: swhStartedAt, ended_at: swhEndedAt, hours: SWH_HOURS, looked_up: swh.size, to_look_up: order.length, held: [...swh.values()].filter(Boolean).length, raw_requests: swhRequests }, blobs, node: process.version, requests: archive.counters },
  definitions: "docs/decisions/2026-10-30-ld-delta-v1-definitions.md",
  malicious: { ...summary("malicious"), not_obtained_reasons: notObtainedReasons("malicious") },
  genuine: { ...summary("genuine"), not_obtained_reasons: notObtainedReasons("genuine") },
  rows,
};
writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
writeFileSync(detailFile, JSON.stringify(details));
log(`done: ${JSON.stringify({ malicious: out.malicious.by_status, genuine: out.genuine.by_status })}`);
