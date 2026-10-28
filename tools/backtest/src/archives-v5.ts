// Backtest v5 (docs/bench/2026-10-28-backtest-v5/definitions.md): what archives say about versions the registry no
// longer lists. Pure helpers (a tarball's files, install scripts from files, code identity, OSV naming) and cached,
// read-only fetchers for the registry, ecosyste.ms, jsDelivr and Software Heritage. Nothing read here is run or
// extracted to disk.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import semver from "semver";
import { installScripts, registryTarball } from "../../../packages/cli/src/security/judge.ts";

/** Files by path relative to the package root, with sha256 (hex) and size. */
export type FileList = Map<string, { sha256: string; size: number }>;

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * A gzipped tarball's regular files, read in memory: each path loses its first component, as npm strips the
 * tarball's top folder. Links are listed with the hash of their target, so a changed link counts as a change.
 * Returns the root package.json's bytes too. Throws on a malformed archive.
 */
export function tarFiles(tgz: Buffer): { files: FileList; packageJson: Buffer | null } {
  const tar = gunzipSync(tgz, { maxOutputLength: 1 << 30 });
  const files: FileList = new Map();
  let packageJson: Buffer | null = null, longName: string | null = null, paxPath: string | null = null;
  const text = (from: number, len: number) => { const raw = tar.subarray(from, from + len); const end = raw.indexOf(0); return raw.subarray(0, end < 0 ? len : end).toString("utf8"); };
  for (let at = 0; at + 512 <= tar.length;) {
    const header = at;
    if (tar.subarray(header, header + 512).every(b => b === 0)) break;
    // Base-256 sizes (high bit set) are for entries of 8 GB and more: refuse them.
    if (tar[header + 124]! & 0x80) throw new Error("tar entry too large");
    const size = parseInt(text(header + 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("tar size field unreadable");
    const type = tar[header + 156]!;
    const body = tar.subarray(header + 512, header + 512 + size);
    if (body.length !== size) throw new Error("tar entry truncated");
    at = header + 512 + Math.ceil(size / 512) * 512;
    // GNU long name ("L") and pax ("x") headers name the next entry; global ("g") and long link ("K") are skipped.
    if (type === CHAR.L) { const end = body.indexOf(0); longName = body.subarray(0, end < 0 ? size : end).toString("utf8"); continue; }
    if (type === CHAR.x) { paxPath = body.toString("utf8").split(String.fromCharCode(10)).map(r => /^[0-9]+ path=(.*)$/.exec(r)?.[1]).find(p => p !== undefined) ?? null; continue; }
    if (type === CHAR.g || type === CHAR.K) continue;
    const prefix = text(header + 257, 6).startsWith("ustar") ? text(header + 345, 155) : "";
    const raw = paxPath ?? longName ?? (prefix ? `${prefix}/${text(header, 100)}` : text(header, 100));
    longName = null; paxPath = null;
    const path = raw.replace(/^[.]?[/]/, "").split("/").slice(1).join("/");
    if (!path || type === CHAR.dir) continue;
    if (type === CHAR.file || type === 0 || type === CHAR.contiguous) {
      files.set(path, { sha256: sha256(body), size });
      if (path === "package.json") packageJson = Buffer.from(body);
    } else if (type === CHAR.hardlink || type === CHAR.symlink) {
      files.set(path, { sha256: sha256(Buffer.from(`link:${text(header + 157, 100)}`)), size: 0 });
    }
  }
  return { files, packageJson };
}
const CHAR = { L: 76, x: 120, g: 103, K: 75, dir: 53, file: 48, contiguous: 55, hardlink: 49, symlink: 50 };

const LIFECYCLE = ["preinstall", "install", "postinstall"];
/**
 * The install scripts a version runs, from its archived package.json: the judge's lifecycle names, plus `install`
 * when the root has binding.gyp, neither `install` nor `preinstall` is declared and `gypfile` is not false (npm's
 * default, which the registry records at publish).
 */
export function scriptsFromFiles(pkg: unknown, hasBindingGyp: boolean): string[] {
  const p = (pkg && typeof pkg === "object" ? pkg : {}) as Record<string, any>;
  const names = installScripts(p.scripts);
  if (hasBindingGyp && !names.includes("install") && !names.includes("preinstall") && p.gypfile !== false) names.push("install");
  return LIFECYCLE.filter(n => names.includes(n));
}

const INERT_NAMES = /^(?:license|licence|copying|notice|authors|readme|changelog|history)(?:\.(?:md|txt))?$/i;
/** Inert files (definitions, section 3 item 5): data and documentation that npm and Node do not run. */
export function inert(path: string): boolean {
  if (path === "package.json" || path === "npm-shrinkwrap.json") return false;
  const base = path.slice(path.lastIndexOf("/") + 1);
  return /\.json$/i.test(base) || /\.(?:md|markdown|txt|map)$/i.test(base) || INERT_NAMES.test(base) || base === "yarn.lock";
}

/** JSON with sorted keys, so equal values compare equal; absent is "undefined". */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
const LOAD_FIELDS = ["bin", "main", "module", "browser", "exports", "imports", "type", "gypfile", "bundleDependencies", "bundledDependencies"];
const RUN_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];
const REQUIREMENTS = ["dependencies", "optionalDependencies", "peerDependencies"];

/**
 * Is V's code identical to prev's (definitions, section 3 item 5)? Every non-inert file of V is in prev at the same
 * path with the same hash; the root package.json's run and load fields are equal; and every runtime requirement of V
 * is in prev's same field with the same spec. Returns every difference found, so an empty list means identical.
 */
export function codeDifferences(v: FileList, vPkg: unknown, prev: FileList, prevPkg: unknown): string[] {
  const out: string[] = [];
  for (const [path, f] of v) {
    if (path === "package.json" || inert(path)) continue;
    const p = prev.get(path);
    if (!p) out.push(`added: ${path}`);
    else if (p.sha256 !== f.sha256) out.push(`changed: ${path}`);
  }
  if (!v.has("package.json")) out.push("package.json missing in V");
  if (!vPkg || typeof vPkg !== "object" || !prevPkg || typeof prevPkg !== "object") { out.push("package.json unreadable"); return out; }
  const a = vPkg as Record<string, any>, b = prevPkg as Record<string, any>;
  for (const k of RUN_SCRIPTS) if (canonical(a.scripts?.[k]) !== canonical(b.scripts?.[k])) out.push(`package.json scripts.${k}`);
  for (const k of LOAD_FIELDS) if (canonical(a[k]) !== canonical(b[k])) out.push(`package.json ${k}`);
  if (canonical(a.directories?.bin) !== canonical(b.directories?.bin)) out.push("package.json directories.bin");
  for (const field of REQUIREMENTS) {
    const mine = a[field] && typeof a[field] === "object" ? a[field] as Record<string, unknown> : {};
    const theirs = b[field] && typeof b[field] === "object" ? b[field] as Record<string, unknown> : {};
    for (const [name, spec] of Object.entries(mine)) if (theirs[name] !== spec) out.push(`package.json ${field}.${name}`);
  }
  return out;
}

/** Does an OSV record's npm entry for `name` name `version`, in `versions` or within a SEMVER/ECOSYSTEM range? */
export function names(record: any, name: string, version: string): boolean {
  for (const affected of record?.affected ?? []) {
    if (affected?.package?.ecosystem !== "npm" || affected.package.name !== name) continue;
    if (Array.isArray(affected.versions) && affected.versions.includes(version)) return true;
    for (const range of affected.ranges ?? []) {
      if (range?.type !== "SEMVER" && range?.type !== "ECOSYSTEM") continue;
      const events: any[] = Array.isArray(range.events) ? range.events : [];
      const at = (e: any) => e.introduced ?? e.fixed ?? e.last_affected ?? e.limit;
      // An event that is not a version cannot be placed: the version counts as named (it is then no prev_d).
      if (!semver.valid(version) || events.some(e => at(e) !== "0" && !semver.valid(at(e)))) return true;
      const sorted = [...events].sort((x, y) => at(x) === "0" ? -1 : at(y) === "0" ? 1 : semver.compare(at(x), at(y)));
      let affectedNow = false;
      for (const e of sorted) {
        if (e.introduced !== undefined) { if (e.introduced === "0" || semver.gte(version, e.introduced)) affectedNow = true; }
        else if (e.fixed !== undefined || e.limit !== undefined) { if (semver.gte(version, e.fixed ?? e.limit)) affectedNow = false; }
        else if (e.last_affected !== undefined) { if (semver.gt(version, e.last_affected)) affectedNow = false; }
      }
      if (affectedNow) return true;
    }
  }
  return false;
}

// --- Fetchers: read-only, cached under <cache>/<source>/. ---

const UA = { "user-agent": "Ludion-Backtest (read-only)" };
export type Answer = { status: number; json?: any; text?: string };
export type Counters = Record<string, { requests: number; unreadable: number }>;

/** One cached GET. 404 and other 4xx are answers; 429, 5xx and network errors are retried, 4 attempts in all. */
export class Archive {
  readonly counters: Counters = {};
  private swhQueue: Promise<unknown> = Promise.resolve();
  private swhResetAt = 0;
  private swhRemaining = Infinity;
  private readonly cacheDir: string;
  constructor(cacheDir: string) { this.cacheDir = cacheDir; }

  private file(source: string, url: string) {
    const dir = join(this.cacheDir, source);
    mkdirSync(dir, { recursive: true });
    return join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);
  }
  private count(source: string, key: "requests" | "unreadable") { (this.counters[source] ??= { requests: 0, unreadable: 0 })[key]++; }

  /** JSON or text by URL; null when it could not be read after every attempt. */
  async get(source: string, url: string, as: "json" | "text" = "json"): Promise<Answer | null> {
    const file = this.file(source, url);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    const answer = source === "swh" ? await this.swh(() => this.fetch(source, url, as)) : await this.fetch(source, url, as);
    if (!answer) { this.count(source, "unreadable"); return null; }
    writeFileSync(`${file}.tmp`, JSON.stringify(answer)); renameSync(`${file}.tmp`, file);
    return answer;
  }

  /** Bytes (not cached: tarballs are hashed by the caller, which caches its result). */
  async bytes(source: string, url: string): Promise<{ status: number; body?: Buffer } | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      this.count(source, "requests");
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) }).catch(() => null);
      if (res && (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429))) return res.ok ? { status: res.status, body: Buffer.from(await res.arrayBuffer()) } : { status: res.status };
      await new Promise(r => setTimeout(r, 3_000 * (attempt + 1)));
    }
    this.count(source, "unreadable");
    return null;
  }

  private async fetch(source: string, url: string, as: "json" | "text"): Promise<Answer | null> {
    for (let attempt = 0, limited = 0; attempt < 4;) {
      this.count(source, "requests");
      const res = await fetch(url, { headers: { ...UA, accept: as === "json" ? "application/json" : "*/*" }, signal: AbortSignal.timeout(300_000) }).catch(() => null);
      if (source === "swh" && res) {
        const left = Number(res.headers.get("x-ratelimit-remaining")), reset = Number(res.headers.get("x-ratelimit-reset"));
        if (Number.isFinite(left)) this.swhRemaining = left;
        if (Number.isFinite(reset) && reset > 0) this.swhResetAt = reset * 1000;
      }
      // A rate limit is waited out, not counted as a failed attempt (at most 6 times per request).
      if (res?.status === 429 && limited++ < 6) { await this.waitForReset(); continue; }
      if (res && (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429))) {
        if (!res.ok) return { status: res.status };
        if (as === "text") return { status: res.status, text: await res.text() };
        try { return { status: res.status, json: await res.json() }; } catch { attempt++; continue; }
      }
      attempt++;
      await new Promise(r => setTimeout(r, 3_000 * attempt));
    }
    return null;
  }

  private async waitForReset() {
    const ms = Math.max(60_000, this.swhResetAt - Date.now() + 5_000);
    console.log(`Software Heritage rate limit: waiting ${Math.round(ms / 60_000)} min`);
    await new Promise(r => setTimeout(r, ms));
    this.swhRemaining = Infinity;
  }
  /** Software Heritage requests run one at a time, and wait for the reset when the hour's allowance is spent. */
  private swh<T>(work: () => Promise<T>): Promise<T> {
    const run = this.swhQueue.then(async () => { if (this.swhRemaining <= 1) await this.waitForReset(); return work(); });
    this.swhQueue = run.catch(() => undefined);
    return run;
  }
}

const registryPath = (name: string) => name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);

/** Per listed version: install script names and the dist fields, from the registry's packument on the run date. */
export type RegistryDist = Record<string, { scripts: string[]; integrity: string | null; shasum: string | null; unpackedSize: number | null }>;
/** Read from the packument on the run date; only these fields are cached. */
export async function registryVersions(archive: Archive, cacheDir: string, name: string): Promise<RegistryDist | null> {
  const file = join(cacheDir, "registry-dist", `${encodeURIComponent(name)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const res = await archive.bytes("registry", `https://registry.npmjs.org/${registryPath(name)}`);
  if (!res || res.status !== 200 || !res.body) return null;
  const raw = JSON.parse(res.body.toString("utf8"));
  const out: RegistryDist = {};
  for (const [v, m] of Object.entries<any>(raw.versions ?? {})) out[v] = { scripts: installScripts(m?.scripts), integrity: typeof m?.dist?.integrity === "string" ? m.dist.integrity : null, shasum: typeof m?.dist?.shasum === "string" ? m.dist.shasum : null, unpackedSize: typeof m?.dist?.unpackedSize === "number" ? m.dist.unpackedSize : null };
  mkdirSync(join(cacheDir, "registry-dist"), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(out)); renameSync(`${file}.tmp`, file);
  return out;
}

/** ecosyste.ms's copy of a version's registry document. `scripts` is null when the copy has no `scripts` key. */
export type EcoRecord = { held: boolean; scripts: string[] | null; shasum: string | null; integrity: string | null; unpackedSize: number | null };
export async function ecosystems(archive: Archive, name: string, version: string): Promise<EcoRecord | "unreadable"> {
  const a = await archive.get("ecosystems", `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`);
  if (!a) return "unreadable";
  const m = a.status === 200 && a.json?.metadata && typeof a.json.metadata === "object" ? a.json.metadata : null;
  if (!m || !Object.keys(m).length) return { held: false, scripts: null, shasum: null, integrity: null, unpackedSize: null };
  return {
    held: true,
    scripts: "scripts" in m ? (m.scripts && typeof m.scripts === "object" ? installScripts(m.scripts) : []) : null,
    shasum: typeof m.dist?.shasum === "string" ? m.dist.shasum : null,
    integrity: typeof m.dist?.integrity === "string" ? m.dist.integrity : null,
    unpackedSize: typeof m.dist?.unpackedSize === "number" ? m.dist.unpackedSize : null,
  };
}

/** jsDelivr's flat file list of a version: paths without the leading slash, sha256 in hex. */
export async function jsdelivrList(archive: Archive, name: string, version: string): Promise<FileList | null | "unreadable"> {
  const a = await archive.get("jsdelivr", `https://data.jsdelivr.com/v1/packages/npm/${name}@${encodeURIComponent(version)}?structure=flat`);
  if (!a) return "unreadable";
  if (a.status !== 200 || !Array.isArray(a.json?.files)) return null;
  const out: FileList = new Map();
  for (const f of a.json.files) if (typeof f?.name === "string" && typeof f.hash === "string") out.set(f.name.replace(/^\//, ""), { sha256: Buffer.from(f.hash, "base64").toString("hex"), size: Number(f.size) });
  return out;
}
export async function jsdelivrFile(archive: Archive, name: string, version: string, path: string): Promise<Buffer | null> {
  const res = await archive.bytes("jsdelivr", `https://cdn.jsdelivr.net/npm/${name}@${encodeURIComponent(version)}/${path}`);
  return res?.status === 200 && res.body ? res.body : null;
}

/** A listed version's registry tarball, checked against its sha512 integrity and listed in memory (cached listing). */
export type TarListing = { ok: true; files: [string, string, number][]; packageJson: string | null } | { ok: false; reason: string };
export async function registryTarFiles(archive: Archive, cacheDir: string, name: string, version: string, integrity: string | null): Promise<TarListing> {
  const file = join(cacheDir, "tarfiles", `${encodeURIComponent(`${name}@${version}`)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const sri = integrity?.split(/\s+/).find(s => s.startsWith("sha512-"));
  let out: TarListing;
  if (!sri) out = { ok: false, reason: "no sha512 integrity" };
  else {
    const res = await archive.bytes("registry-tarball", registryTarball(name, version));
    if (!res) return { ok: false, reason: "tarball unreadable" };
    if (res.status !== 200 || !res.body) out = { ok: false, reason: `tarball HTTP ${res.status}` };
    else if (`sha512-${createHash("sha512").update(res.body).digest("base64")}` !== sri) out = { ok: false, reason: "integrity mismatch" };
    else {
      try {
        const t = tarFiles(res.body);
        out = { ok: true, files: [...t.files].map(([p, f]) => [p, f.sha256, f.size]), packageJson: t.packageJson?.toString("utf8") ?? null };
      } catch (error) { out = { ok: false, reason: `tarball unreadable: ${String(error)}` }; }
    }
  }
  mkdirSync(join(cacheDir, "tarfiles"), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(out)); renameSync(`${file}.tmp`, file);
  return out;
}

const SWH = "https://archive.softwareheritage.org/api/1";
/** Where Software Heritage holds a version: the root directory of its archived tarball, and the visit it came from. */
export type SwhHold = { held: true; visit: string; root: string; packageRoot: string } | { held: false; why: string } | "unreadable";
export async function swhLocate(archive: Archive, name: string, version: string, published: string): Promise<SwhHold> {
  const at = Date.parse(published);
  const visits: any[] = [];
  let url: string | null = `${SWH}/origin/https://www.npmjs.com/package/${name}/visits/?per_page=100`;
  for (let page = 0; url && page < 50; page++) {
    const a = await archive.get("swh", url);
    if (!a) return "unreadable";
    if (a.status === 404 && page === 0) return { held: false, why: "origin not archived" };
    if (a.status !== 200 || !Array.isArray(a.json)) break;
    visits.push(...a.json);
    if (a.json.some((v: any) => Date.parse(v?.date) < at)) break;
    // The visit list pages by visit id: the next page starts below the smallest one seen.
    const last = Math.min(...a.json.map((v: any) => Number(v?.visit)).filter((n: number) => Number.isFinite(n)));
    url = a.json.length === 100 && Number.isFinite(last) && last > 1 ? `${SWH}/origin/https://www.npmjs.com/package/${name}/visits/?per_page=100&last_visit=${last}` : null;
  }
  const after = visits.filter(v => v?.snapshot && Date.parse(v.date) >= at).sort((x, y) => Date.parse(x.date) - Date.parse(y.date)).slice(0, 2);
  if (!after.length) return { held: false, why: "no visit with a snapshot after publication" };
  for (const v of after) {
    const s = await archive.get("swh", `${SWH}/snapshot/${v.snapshot}/?branches_from=${encodeURIComponent(`releases/${version}`)}&branches_count=1`);
    if (!s) return "unreadable";
    const branch = s.json?.branches?.[`releases/${version}`];
    if (!branch) continue;
    let target: string = branch.target, type: string = branch.target_type;
    if (type === "release") { const r = await archive.get("swh", `${SWH}/release/${target}/`); if (!r?.json) return "unreadable"; target = r.json.target; type = r.json.target_type; }
    if (type === "revision") { const r = await archive.get("swh", `${SWH}/revision/${target}/`); if (!r?.json) return "unreadable"; target = r.json.directory; type = "directory"; }
    if (type !== "directory" || typeof target !== "string") return { held: false, why: `branch leads to ${type}` };
    const root = await archive.get("swh", `${SWH}/directory/${target}/`);
    if (!root?.json || !Array.isArray(root.json)) return "unreadable";
    const only = root.json.length === 1 && root.json[0]?.type === "dir" ? root.json[0].target as string : target;
    return { held: true, visit: v.date, root: target, packageRoot: only };
  }
  return { held: false, why: "not in the first snapshots after publication" };
}
/** The root package.json and whether binding.gyp is at the package root. */
export async function swhManifest(archive: Archive, packageRoot: string): Promise<{ pkg: unknown; bindingGyp: boolean } | "unreadable" | "no package.json"> {
  const dir = await archive.get("swh", `${SWH}/directory/${packageRoot}/`);
  if (!dir?.json || !Array.isArray(dir.json)) return "unreadable";
  const entry = dir.json.find((e: any) => e?.type === "file" && e.name === "package.json");
  if (!entry) return "no package.json";
  const raw = await archive.get("swh", `${SWH}/content/sha1_git:${entry.target}/raw/`, "text");
  if (!raw || raw.status !== 200 || typeof raw.text !== "string") return "unreadable";
  let pkg: unknown;
  try { pkg = JSON.parse(raw.text); } catch { pkg = null; }
  return { pkg, bindingGyp: dir.json.some((e: any) => e?.type === "file" && e.name === "binding.gyp") };
}
/** Every archived file under the package root, with its sha256. */
export async function swhFiles(archive: Archive, packageRoot: string): Promise<FileList | "unreadable"> {
  const out: FileList = new Map();
  const walk = async (dir: string, prefix: string): Promise<boolean> => {
    const a = await archive.get("swh", `${SWH}/directory/${dir}/`);
    if (!a?.json || !Array.isArray(a.json)) return false;
    for (const e of a.json) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.type === "dir") { if (!await walk(e.target, path)) return false; }
      else if (e.type === "file") { if (typeof e.checksums?.sha256 !== "string") return false; out.set(path, { sha256: e.checksums.sha256, size: Number(e.length) }); }
      else out.set(path, { sha256: sha256(Buffer.from(`link:${e.target}`)), size: 0 });
    }
    return true;
  };
  return await walk(packageRoot, "") ? out : "unreadable";
}
/** Software Heritage's extrinsic metadata for the archived root: the replicated version document and the original artifact. */
export async function swhMetadata(archive: Archive, root: string): Promise<{ dist: any | null; artifacts: any[] } | "unreadable"> {
  const auth = await archive.get("swh", `${SWH}/raw-extrinsic-metadata/swhid/swh:1:dir:${root}/authorities/`);
  if (!auth) return "unreadable";
  if (auth.status !== 200 || !Array.isArray(auth.json)) return { dist: null, artifacts: [] };
  let dist: any = null;
  const artifacts: any[] = [];
  for (const a of auth.json) {
    if (typeof a?.metadata_list_url !== "string") continue;
    const list = await archive.get("swh", a.metadata_list_url);
    if (!list) return "unreadable";
    for (const m of Array.isArray(list.json) ? list.json : []) {
      if (m?.format !== "replicate-npm-package-json" && m?.format !== "original-artifacts-json") continue;
      const body = await archive.get("swh", m.metadata_url, "text");
      if (!body || body.status !== 200 || typeof body.text !== "string") return "unreadable";
      let parsed: any;
      try { parsed = JSON.parse(body.text); } catch { continue; }
      if (m.format === "replicate-npm-package-json") dist = parsed?.dist ?? dist;
      else if (Array.isArray(parsed)) artifacts.push(...parsed);
    }
  }
  return { dist, artifacts };
}
