// The shadow's recorder (docs/bench/2026-10-28-shadow-design/README.md, sections 2.1 to 2.4). It follows npm's
// replication feed, and for each watched package that changes it stores, right away, what the judge would read:
// the packument's `time` and `dist-tags`, each new version's manifest without e-mail addresses, its attestations, and
// the file list (path, size, sha256) of its registry tarball. The tarball itself is never stored, extracted to disk
// or run. Once a day it stores new and changed MAL- records from OSV's npm export.
// What leaves the machine: package names and versions (registry URLs), the feed position, and OSV record ids. It
// stops recording when the data directory reaches its limit. It judges nothing: the replay is not built.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import semver from "semver";
import { registryTarball } from "../../../packages/cli/src/security/judge.ts";
import { sharedPublisher } from "../../../packages/cli/src/security/npm-facts.ts";
import { firstPublish } from "../../../packages/cli/src/security/time-cap.ts";
import { tarFiles } from "../../backtest/src/archives-v5.ts";

type Fetch = typeof fetch;
export type Config = {
  dir: string;
  /** Watched names and the versions the watched lockfiles hold. */
  watched: Record<string, string[]>;
  /** Stop recording at this many bytes in `dir`. */
  maxBytes: number;
  fetchFn?: Fetch;
  now?: () => Date;
  /** Recorded in the start record: the commit the recorder runs at and the watched list's sha256. */
  commit?: string;
  watchedSha256?: string;
  /** Tarballs larger than this (compressed, or `dist.unpackedSize`) get no file list. */
  maxTarballBytes?: number;
  maxUnpackedBytes?: number;
};
type State = { seq: string | null; feed_started_at: string | null; osv_since: string | null; osv_day: string | null; pending: string[]; stopped: string | null; failures: Record<string, number>; osv_retry: { id: string; modified: string; tries: number }[] };
/** Per stored version: `tries` counts captures still incomplete (a sub-read failed); 0 when complete or given up. */
type Known = { time: Record<string, string>; dist_tags: Record<string, string>; versions: Record<string, { deprecated: string | null; integrity: string | null; removed?: boolean; tries?: number }> };
type Reason = "new" | "retry" | "lockfile" | "predecessor";
/** Give up re-reading a version's attestations, tarball or dependency times after this many polls; that is recorded. */
const MAX_TRIES = 60;
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

const HOSTS = new Set(["registry.npmjs.org", "replicate.npmjs.com", "api.osv.dev", "osv-vulnerabilities.storage.googleapis.com"]);
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const regPath = (name: string) => { if (!NAME.test(name) || name.length > 214) throw new Error(`Invalid npm package name: ${name}`); return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name); };
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
// An address: a local part not preceded by a URL, path or spec character, and a domain whose last label is alphabetic.
// So `p@1.0.1`, `npm:x@1.0.0`, `git@github.com` inside `ssh://` URLs and scoped tarball URLs are left alone.
const EMAIL = /(?<![\p{L}\p{N}_.%+\-/@])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}_@:-])/gu;
const scrubText = (text: string) => text.replace(/mailto:[^\s"'<>]+/gi, "mailto:[email removed]").replace(EMAIL, "[email removed]");

/** A copy of a registry document with every e-mail address removed: `email` keys dropped, addresses in strings replaced. */
export function scrub(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => k.toLowerCase() !== "email").map(([k, v]) => [scrubText(k), scrub(v)]));
  return value;
}

/** Total bytes of the files under `dir`. */
export function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(path) : statSync(path).size;
  }
  return total;
}

/** OSV's modified_id.csv (newest first): the ids modified after `since`, MAL- only, and the newest time read. */
export function newMalIds(csv: string, since: string | null): { ids: { id: string; modified: string }[]; newest: string | null } {
  const ids: { id: string; modified: string }[] = [];
  let newest: string | null = null;
  for (const line of csv.split("\n")) {
    const [modified, id] = line.trim().split(",");
    if (!modified || !id) continue;
    newest ??= modified;
    if (since && modified <= since) break;
    if (id.startsWith("MAL-")) ids.push({ id, modified });
  }
  return { ids, newest };
}

/** The latest-published version lower than `version` by semver and published before it (v5's prev_d rule). */
export function predecessor(listed: string[], time: Record<string, string>, version: string): string | undefined {
  if (!semver.valid(version)) return undefined;
  const at = time[version];
  if (!at) return undefined;
  return listed.filter(x => semver.valid(x) && semver.lt(x, version) && time[x] && time[x]! < at).sort((a, b) => (time[a]! < time[b]! ? 1 : -1))[0];
}

export class Recorder {
  readonly cfg: Required<Omit<Config, "commit" | "watchedSha256">> & Pick<Config, "commit" | "watchedSha256">;
  state: State;
  bytes: number;
  /** A Map, so that a package named like an Object property ("constructor") is never watched by accident. */
  readonly watched: Map<string, string[]>;
  constructor(cfg: Config) {
    this.watched = new Map(Object.entries(cfg.watched));
    this.cfg = { fetchFn: fetch, now: () => new Date(), maxTarballBytes: 50 * 1024 * 1024, maxUnpackedBytes: 256 * 1024 * 1024, ...cfg };
    mkdirSync(cfg.dir, { recursive: true });
    const statePath = join(cfg.dir, "state.json");
    this.state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { seq: null, feed_started_at: null, osv_since: null, osv_day: null, pending: [], stopped: null, failures: {}, osv_retry: [] };
    this.state.feed_started_at ??= null;
    this.state.failures ??= {};
    this.state.osv_retry ??= [];
    this.bytes = dirBytes(cfg.dir);
  }

  private at() { return this.cfg.now().toISOString(); }
  private saveState() { this.writeAtomic(join(this.cfg.dir, "state.json"), JSON.stringify(this.state)); }
  private writeAtomic(path: string, text: string) {
    mkdirSync(dirname(path), { recursive: true });
    const before = existsSync(path) ? statSync(path).size : 0;
    writeFileSync(`${path}.tmp`, text); renameSync(`${path}.tmp`, path);
    this.bytes += Buffer.byteLength(text) - before;
  }
  /** Append one record to `<kind>/<UTC day>.jsonl`; false (and recording stops) once the limit would be passed. */
  append(kind: "captures" | "osv" | "status", record: object): boolean {
    const line = JSON.stringify(record) + "\n";
    if (this.bytes + Buffer.byteLength(line) > this.cfg.maxBytes) { this.stop(`the data directory would pass ${this.cfg.maxBytes} bytes`); return false; }
    const path = join(this.cfg.dir, kind, `${this.at().slice(0, 10)}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line);
    this.bytes += Buffer.byteLength(line);
    return true;
  }
  /** Stop recording for good: the last status line says why. Kept small so that it still fits under the limit. */
  stop(reason: string) {
    if (this.state.stopped) return;
    this.state.stopped = reason;
    const path = join(this.cfg.dir, "status", `${this.at().slice(0, 10)}.jsonl`);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ type: "stopped", at: this.at(), reason, bytes: this.bytes }) + "\n");
    this.saveState();
  }

  private async get(url: string, maxBytes: number, init: RequestInit = {}): Promise<{ status: number; body: Buffer | null }> {
    if (!HOSTS.has(new URL(url).hostname)) throw new Error(`Refused host: ${new URL(url).hostname}`);
    const res = await this.cfg.fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(60_000), ...init, headers: { "user-agent": "Ludion-Shadow-Recorder", ...(init.headers ?? {}) } });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return { status: res.status, body: null }; }
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, body: Buffer.alloc(0) };
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw new Error(`Response from ${new URL(url).hostname} exceeds ${maxBytes} bytes.`);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { status: res.status, body: Buffer.concat(chunks) };
  }
  private async json(url: string, maxBytes: number) {
    const r = await this.get(url, maxBytes);
    if (r.status !== 200 || !r.body) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { status: r.status });
    return { doc: JSON.parse(r.body.toString("utf8")), sha256: sha256(r.body) };
  }

  private createdPath(name: string) { const h = sha256(name); return join(this.cfg.dir, "known", "created", h.slice(0, 2), `${h}.json`); }
  /** The first publish time of a package whose time is not stored (rule 2's `created`): its record, appended, or null. */
  async created(name: string): Promise<boolean> {
    let url = "";
    try {
      url = `https://registry.npmjs.org/${regPath(name)}`;
      let record: object;
      try {
        const { doc, sha256: bodySha } = await this.json(url, 64 * 1024 * 1024);
        record = { type: "created", name, fetched_at: this.at(), url, body_sha256: bodySha, created: isObject(doc?.time) ? firstPublish(doc.time) : null };
      } catch (e) {
        if ((e as { status?: number }).status !== 404) throw e;
        record = { type: "created", name, fetched_at: this.at(), url, status: 404, created: null };
      }
      // The record first, then the marker that suppresses a re-read: a crash in between only causes a second read.
      if (!this.append("captures", record)) return false;
      // A 404 is not kept as a marker: the package may be published later, and a later version must read it again.
      if (!("status" in record)) this.writeAtomic(this.createdPath(name), JSON.stringify(record));
      return true;
    } catch (e) {
      this.append("status", { type: "error", at: this.at(), name, url, error: String((e as Error).message).slice(0, 300) });
      return false;
    }
  }
  private knownPath(name: string) { const h = sha256(name); return join(this.cfg.dir, "known", h.slice(0, 2), `${h}.json`); }
  private known(name: string): Known | null { const p = this.knownPath(name); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; }

  /** The file list of a version's registry tarball, checked against its integrity; the tarball is not kept. */
  async files(name: string, version: string, manifest: any): Promise<object> {
    const url = registryTarball(name, version);
    if (manifest?.dist?.tarball !== url) return { status: "not_registry_tarball", tarball: manifest?.dist?.tarball ?? null };
    const unpacked = manifest?.dist?.unpackedSize;
    if (typeof unpacked === "number" && unpacked > this.cfg.maxUnpackedBytes) return { status: "too_large", unpacked_size: unpacked };
    const integrity: unknown = manifest?.dist?.integrity;
    if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) return { status: "no_sha512_integrity" };
    let r;
    try { r = await this.get(url, this.cfg.maxTarballBytes); } catch (e) { return { status: "error", error: String((e as Error).message).slice(0, 300) }; }
    if (r.status !== 200 || !r.body) return { status: "error", error: `HTTP ${r.status}` };
    if (`sha512-${createHash("sha512").update(r.body).digest("base64")}` !== integrity) return { status: "integrity_mismatch", tarball_sha256: sha256(r.body) };
    try {
      // Refuse an archive that inflates past the limit before the shared reader inflates it again.
      gunzipSync(r.body, { maxOutputLength: this.cfg.maxUnpackedBytes });
      const { files } = tarFiles(r.body);
      return { status: "hashed", tarball_bytes: r.body.length, files: [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, f]) => [path, f.size, f.sha256]) };
    } catch (e) { return { status: "unreadable", error: String((e as Error).message).slice(0, 300) }; }
  }

  /**
   * One version's record: the manifest without e-mail addresses, the publisher check, attestations, and (for a new
   * version) the file list. `complete` is false when a read that may succeed later failed: attestations the manifest
   * lists that did not answer 200, or a tarball read error.
   */
  async version(name: string, version: string, manifest: any, reason: Reason): Promise<{ record: object; complete: boolean }> {
    let attestations: { status: number | "error" } & Record<string, unknown> | null = null;
    if (manifest?.dist?.attestations) {
      const url = `https://registry.npmjs.org/-/npm/v1/attestations/${regPath(name)}@${encodeURIComponent(version)}`;
      try { const r = await this.get(url, 4 * 1024 * 1024); attestations = { url, status: r.status, sha256: r.body ? sha256(r.body) : null, body: r.status === 200 && r.body ? JSON.parse(r.body.toString("utf8")) : null }; }
      catch (e) { attestations = { url, status: "error", error: String((e as Error).message).slice(0, 300) }; }
    }
    const files = reason === "new" || reason === "retry" ? await this.files(name, version, manifest) as { status: string } : null;
    return {
      record: { type: "version", name, version, reason, fetched_at: this.at(), shared_publisher: sharedPublisher(manifest?._npmUser), manifest: scrub(manifest), attestations, files },
      complete: (!attestations || attestations.status === 200) && files?.status !== "error",
    };
  }

  /**
   * Read one watched package now and store what changed since its last capture. "failed": nothing stored, retry the
   * whole capture. "incomplete": stored, but a version's sub-read failed and is retried on the next poll.
   */
  async capture(name: string): Promise<"ok" | "failed" | "incomplete"> {
    let url = "", doc: any, bodySha: string;
    try { url = `https://registry.npmjs.org/${regPath(name)}`; ({ doc, sha256: bodySha } = await this.json(url, 64 * 1024 * 1024)); }
    catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404) return this.append("captures", { type: "gone", name, fetched_at: this.at(), url, status }) ? "ok" : "failed";
      this.append("status", { type: "error", at: this.at(), name, url, error: String((e as Error).message).slice(0, 300) });
      return "failed";
    }
    if (!isObject(doc) || !isObject(doc.versions) || !isObject(doc.time)) { this.append("status", { type: "error", at: this.at(), name, url, error: "not a packument" }); return "failed"; }
    const before = this.known(name);
    const time: Record<string, string> = Object.fromEntries(Object.entries(doc.time).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const tags: Record<string, string> = isObject(doc["dist-tags"]) ? doc["dist-tags"] : {};
    const listed = Object.keys(doc.versions).filter(v => isObject(doc.versions[v]));
    const versions: Known["versions"] = { ...(before?.versions ?? {}) };
    const head = { name, fetched_at: this.at(), url, body_sha256: bodySha };
    const removed = Object.keys(versions).filter(v => !versions[v]!.removed && !Object.hasOwn(doc.versions, v));
    const records: object[] = [before
      ? { type: "change", ...head, dist_tags: JSON.stringify(tags) === JSON.stringify(before.dist_tags) ? null : tags, time: Object.fromEntries(Object.entries(time).filter(([k, v]) => before.time[k] !== v)), removed }
      : { type: "baseline", ...head, dist_tags: tags, time }];
    const tail: object[] = [];
    for (const v of removed) {
      if ((versions[v]!.tries ?? 0) > 0) tail.push({ type: "gave_up", name, version: v, fetched_at: this.at(), tries: versions[v]!.tries, reason: "removed before its capture was complete" });
      versions[v] = { ...versions[v]!, removed: true, tries: 0 };
    }
    // New: not in the stored time map; on first sight, published at or after the feed start (so a name's first change
    // seen being a publish is captured as new, with its file list, predecessor and dependency times).
    const started = this.state.feed_started_at;
    const fresh = before ? listed.filter(v => !Object.hasOwn(before.time, v) && !Object.hasOwn(before.versions, v)) : listed.filter(v => started !== null && time[v] !== undefined && time[v]! >= started);
    const wanted = new Map<string, Reason>();
    for (const v of fresh) wanted.set(v, "new");
    for (const v of listed) if ((versions[v]?.tries ?? 0) > 0 && !wanted.has(v)) wanted.set(v, "retry");
    // On first sight: the versions the watched lockfiles hold (each possible prev), and each dist-tag's version.
    if (!before) { for (const v of this.watched.get(name) ?? []) if (Object.hasOwn(doc.versions, v) && !wanted.has(v)) wanted.set(v, "lockfile"); for (const v of Object.values(tags)) if (Object.hasOwn(doc.versions, v) && !wanted.has(v)) wanted.set(v, "predecessor"); }
    for (const v of fresh) {
      // The registry's predecessor for the replay, if not stored yet: the latest-published version lower than it by
      // semver and published before it.
      const prior = predecessor(listed, time, v);
      if (prior && !Object.hasOwn(versions, prior) && !wanted.has(prior)) wanted.set(prior, "predecessor");
    }
    const incomplete = new Set<string>();
    for (const [v, reason] of wanted) {
      const { record, complete } = await this.version(name, v, doc.versions[v], reason);
      records.push(record);
      if (!complete) incomplete.add(v);
    }
    for (const r of records) if (!this.append("captures", r)) return "failed";
    // Rule 2 needs when each new dependency's package first appeared: read it once for any package whose time is not stored.
    for (const [v, reason] of wanted) {
      if (reason !== "new" && reason !== "retry") continue;
      const m = doc.versions[v];
      for (const dep of Object.keys({ ...(isObject(m.dependencies) ? m.dependencies : {}), ...(isObject(m.optionalDependencies) ? m.optionalDependencies : {}) })) {
        if (!NAME.test(dep) || dep.length > 214) { this.append("status", { type: "error", at: this.at(), name, version: v, error: `dependency name not read: ${dep.slice(0, 80)}` }); continue; }
        if (existsSync(this.knownPath(dep)) || existsSync(this.createdPath(dep))) continue;
        if (!(await this.created(dep))) { if (this.state.stopped) return "failed"; incomplete.add(v); }
      }
    }
    for (const v of wanted.keys()) {
      const tries = incomplete.has(v) ? (versions[v]?.tries ?? 0) + 1 : 0;
      if (tries >= MAX_TRIES) tail.push({ type: "gave_up", name, version: v, fetched_at: this.at(), tries, reason: "a read kept failing" });
      versions[v] = { deprecated: versions[v]?.deprecated ?? null, integrity: doc.versions[v]?.dist?.integrity ?? null, tries: tries >= MAX_TRIES ? 0 : tries };
    }
    // Deprecation of a stored version, recorded when it changes (and on its first capture, when set).
    for (const v of Object.keys(versions)) {
      if (!Object.hasOwn(doc.versions, v)) continue;
      const dep = doc.versions[v]?.deprecated, now = typeof dep === "string" && dep ? dep : null;
      if (versions[v]!.deprecated !== now) { tail.push({ type: "deprecation", name, version: v, fetched_at: this.at(), deprecated: now }); versions[v]!.deprecated = now; }
    }
    for (const r of tail) if (!this.append("captures", r)) return "failed";
    this.writeAtomic(this.knownPath(name), JSON.stringify({ time, dist_tags: tags, versions } satisfies Known));
    return Object.values(versions).some(x => !x.removed && (x.tries ?? 0) > 0) ? "incomplete" : "ok";
  }

  /** Give up a package after MAX_TRIES failed polls: one record for it, and one for each of its versions still retried. */
  private giveUp(name: string, tries: number, result: "failed" | "incomplete") {
    this.append("captures", { type: "gave_up", name, fetched_at: this.at(), tries, reason: result === "failed" ? "the package read kept failing" : "a version's reads kept failing" });
    const known = this.known(name);
    if (!known) return;
    for (const [v, x] of Object.entries(known.versions)) if ((x.tries ?? 0) > 0) { this.append("captures", { type: "gave_up", name, version: v, fetched_at: this.at(), tries: x.tries, reason: "its package was given up" }); x.tries = 0; }
    this.writeAtomic(this.knownPath(name), JSON.stringify(known));
  }

  /** Read the feed from the stored position to its end, capturing every watched change. */
  async poll(): Promise<{ entries: number; watched: number; seq: string | null }> {
    const summary = { entries: 0, watched: 0, seq: this.state.seq };
    if (this.state.stopped) return summary;
    if (this.state.seq === null) {
      const { doc } = await this.json("https://replicate.npmjs.com/", 1024 * 1024);
      this.state.seq = String(doc.update_seq);
      this.state.feed_started_at = this.at();
      this.saveState();
      this.append("status", { type: "feed_start", at: this.at(), seq: this.state.seq });
      return { ...summary, seq: this.state.seq };
    }
    for (let page = 0; page < 100; page++) {
      const { doc } = await this.json(`https://replicate.npmjs.com/registry/_changes?since=${encodeURIComponent(this.state.seq!)}&limit=10000`, 64 * 1024 * 1024);
      const results: { id?: unknown }[] = Array.isArray(doc.results) ? doc.results : [];
      summary.entries += results.length;
      const names = new Set([...(page === 0 ? this.state.pending : []), ...results.map(r => r.id).filter((id): id is string => typeof id === "string" && this.watched.has(id))]);
      summary.watched += names.size;
      const failed: string[] = [];
      for (const name of names) {
        // One document can never hold the feed: any error keeps that name pending, and the others go on.
        let result: "ok" | "failed" | "incomplete";
        try { result = await this.capture(name); }
        catch (e) { this.append("status", { type: "error", at: this.at(), name, error: String((e as Error).message).slice(0, 300) }); result = "failed"; }
        if (this.state.stopped) return summary;
        if (result === "ok") { delete this.state.failures[name]; continue; }
        const tries = (this.state.failures[name] ?? 0) + 1;
        if (tries >= MAX_TRIES) { this.giveUp(name, tries, result); delete this.state.failures[name]; continue; }
        this.state.failures[name] = tries;
        failed.push(name);
      }
      // Failed or incomplete names are retried on the next poll; the feed position moves on once the page is handled.
      this.state.pending = page === 0 ? failed : [...new Set([...this.state.pending, ...failed])];
      if (doc.last_seq === undefined || doc.last_seq === null) throw new Error("The feed answered without last_seq.");
      const moved = String(doc.last_seq) !== this.state.seq;
      this.state.seq = String(doc.last_seq);
      this.saveState();
      summary.seq = this.state.seq;
      if (results.length < 10000 || !moved) break;
    }
    return summary;
  }

  private async osvRecord(id: string, modified: string): Promise<"stored" | "failed" | "stopped"> {
    let read;
    try { read = await this.json(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, 4 * 1024 * 1024); }
    catch (e) { this.append("status", { type: "error", at: this.at(), id, error: `osv: ${String((e as Error).message).slice(0, 300)}` }); return "failed"; }
    return this.append("osv", { type: "osv", id, modified, fetched_at: this.at(), sha256: read.sha256, record: scrub(read.doc) }) ? "stored" : "stopped";
  }

  /** Once per UTC day: MAL- records modified since the last read, all of them, watched or not. */
  async osv(): Promise<number> {
    const day = this.at().slice(0, 10);
    if (this.state.stopped) return 0;
    let stored = 0;
    if (this.state.osv_retry.length) {
      const again: State["osv_retry"] = [];
      for (const item of this.state.osv_retry) {
        const r = await this.osvRecord(item.id, item.modified);
        if (r === "stopped") return stored;
        if (r === "stored") { stored++; continue; }
        if (item.tries + 1 >= MAX_TRIES) this.append("osv", { type: "gave_up", id: item.id, modified: item.modified, fetched_at: this.at(), tries: item.tries + 1 });
        else again.push({ ...item, tries: item.tries + 1 });
      }
      this.state.osv_retry = again;
      this.saveState();
    }
    if (this.state.osv_day === day) return stored;
    const r = await this.get("https://osv-vulnerabilities.storage.googleapis.com/npm/modified_id.csv", 64 * 1024 * 1024);
    if (r.status !== 200 || !r.body) throw new Error(`modified_id.csv: HTTP ${r.status}`);
    const { ids, newest } = newMalIds(r.body.toString("utf8"), this.state.osv_since);
    // The first read only sets the position: records modified before the recorder started are not the shadow's.
    if (this.state.osv_since !== null) {
      for (const { id, modified } of ids) {
        // A record that cannot be read is an error line and is read again on later polls; the day's read goes on.
        const r = await this.osvRecord(id, modified);
        if (r === "stopped") return stored;
        if (r === "stored") stored++;
        else this.state.osv_retry.push({ id, modified, tries: 1 });
      }
    }
    this.state.osv_since = newest ?? this.state.osv_since;
    this.state.osv_day = day;
    this.saveState();
    this.append("status", { type: "osv", at: this.at(), stored, since: this.state.osv_since });
    return stored;
  }
}

/** Run forever: a poll every `intervalMs`, OSV once a day, a status line per poll. Stops recording at the limit. */
export async function run(cfg: Config, intervalMs = 60_000) {
  const rec = new Recorder(cfg);
  rec.append("status", { type: "start", at: new Date().toISOString(), commit: cfg.commit ?? null, watched_sha256: cfg.watchedSha256 ?? null, watched_names: Object.keys(cfg.watched).length, max_bytes: cfg.maxBytes, bytes: rec.bytes, node: process.version });
  while (true) {
    if (rec.state.stopped) { await new Promise(r => setTimeout(r, 3_600_000)); continue; }
    const started = Date.now();
    try {
      const s = await rec.poll();
      rec.append("status", { type: "poll", at: new Date().toISOString(), ...s, pending: rec.state.pending.length, bytes: rec.bytes, ms: Date.now() - started });
    } catch (e) { rec.append("status", { type: "error", at: new Date().toISOString(), error: String((e as Error).message).slice(0, 300) }); }
    try { await rec.osv(); } catch (e) { rec.append("status", { type: "error", at: new Date().toISOString(), error: `osv: ${String((e as Error).message).slice(0, 300)}` }); }
    await new Promise(r => setTimeout(r, Math.max(1_000, intervalMs - (Date.now() - started))));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // node tools/shadow/src/recorder.ts <data dir> <max bytes> [commit]
  const [dir, max, commit] = process.argv.slice(2);
  if (!dir || !max) throw new Error("usage: recorder.ts <data dir> <max bytes> [commit]");
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "watched.json"), "utf8");
  await run({ dir, maxBytes: Number(max), watched: JSON.parse(text).names, commit, watchedSha256: sha256(text) });
}
