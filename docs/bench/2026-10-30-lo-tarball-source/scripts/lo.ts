// Lane LO (docs/decisions/2026-10-30-lo-tarball-source-definitions.md): does a published tarball equal its public
// source release? Pure helpers: a streaming tar reader that only hashes, the repository field, the release tag
// names, the git reference list, the package directory, the comparison and the build reading. Nothing read here
// is extracted, written to a disk or run.
import { createHash, type Hash } from "node:crypto";

/** A file's hashes: SHA-256 of its bytes, and of its bytes with CRLF turned into LF (null when not computed). */
export type Entry = { sha256: string; eol: string | null; size: number };
export type Files = Map<string, Entry>;

/** A tar path without its top folder (§2): `.` and empty segments dropped, a `..` segment kept as written. */
export function stripTop(raw: string): string {
  return raw.split("/").filter(s => s !== "" && s !== ".").slice(1).join("/");
}

const CR = 13, LF = 10;
/** Hashes bytes as given and with CRLF turned into LF, across chunk boundaries. */
class Hasher {
  private readonly plain: Hash = createHash("sha256");
  private readonly eol: Hash = createHash("sha256");
  private pendingCr = false;
  size = 0;
  update(chunk: Buffer) {
    if (!chunk.length) return;
    this.size += chunk.length;
    this.plain.update(chunk);
    let from = 0;
    if (this.pendingCr) { if (chunk[0] !== LF) this.eol.update(Buffer.from([CR])); this.pendingCr = false; }
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== CR) continue;
      if (i + 1 === chunk.length) { this.eol.update(chunk.subarray(from, i)); from = chunk.length; this.pendingCr = true; break; }
      if (chunk[i + 1] === LF) { this.eol.update(chunk.subarray(from, i)); from = i + 1; }
    }
    if (from < chunk.length) this.eol.update(chunk.subarray(from));
  }
  done(): Entry {
    if (this.pendingCr) this.eol.update(Buffer.from([CR]));
    return { sha256: this.plain.digest("hex"), eol: this.eol.digest("hex"), size: this.size };
  }
}
export function hashBytes(b: Buffer): Entry { const h = new Hasher(); h.update(b); return h.done(); }

const T = { file: 48, nul: 0, contiguous: 55, hardlink: 49, symlink: 50, dir: 53, L: 76, K: 75, x: 120, g: 103 };

/**
 * A tar stream (already gunzipped) read in chunks. Regular files are hashed and never kept, except files named
 * `package.json` up to 1 MiB, whose text is kept by path (`keep`). Links are hashed as `link:<target>`. Throws on a
 * malformed archive or when the files' total size passes `limit`.
 */
export class TarReader {
  readonly files: Files = new Map();
  readonly kept = new Map<string, string>();
  private buf: Buffer = Buffer.alloc(0);
  private state: "header" | "body" | "skip" | "end" = "header";
  private left = 0; private pad = 0;
  private hasher: Hasher | null = null; private keep: Buffer[] | null = null; private path = "";
  private meta: Buffer[] | null = null; private metaType = 0;
  private longName: string | null = null; private longLink: string | null = null;
  private paxPath: string | null = null; private paxLink: string | null = null;
  private total = 0;
  private readonly limit: number;
  constructor(limit: number) { this.limit = limit; }

  push(chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.state === "end") { this.buf = Buffer.alloc(0); return; }
      if (this.state === "header") {
        if (this.buf.length < 512) return;
        const h = this.buf.subarray(0, 512);
        this.buf = this.buf.subarray(512);
        this.header(h);
        continue;
      }
      // body or skip: `left` data bytes, then `pad` padding bytes
      if (this.left > 0) {
        if (!this.buf.length) return;
        const take = this.buf.subarray(0, Math.min(this.left, this.buf.length));
        this.buf = this.buf.subarray(take.length);
        this.left -= take.length;
        if (this.hasher) this.hasher.update(take);
        if (this.keep) this.keep.push(Buffer.from(take));
        if (this.meta) this.meta.push(Buffer.from(take));
        continue;
      }
      if (this.buf.length < this.pad) return;
      this.buf = this.buf.subarray(this.pad);
      this.finishEntry();
      this.state = "header";
    }
  }
  /** Call after the last chunk: the archive must have ended on an entry boundary. */
  end() { if (this.state === "body" || this.state === "skip") throw new Error("tar truncated"); }

  private text(h: Buffer, from: number, len: number) { const raw = h.subarray(from, from + len); const z = raw.indexOf(0); return raw.subarray(0, z < 0 ? len : z).toString("utf8"); }

  private header(h: Buffer) {
    if (h.every(b => b === 0)) { this.state = "end"; return; }
    if (h[124]! & 0x80) throw new Error("tar entry too large");
    const size = parseInt(this.text(h, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("tar size field unreadable");
    const type = h[156]!;
    this.left = size; this.pad = (512 - (size % 512)) % 512;
    this.state = "skip"; this.hasher = null; this.keep = null; this.meta = null;
    if (type === T.L || type === T.K || type === T.x || type === T.g) { this.meta = []; this.metaType = type; this.state = "body"; return; }
    const prefix = this.text(h, 257, 6).startsWith("ustar") ? this.text(h, 345, 155) : "";
    const raw = this.paxPath ?? this.longName ?? (prefix ? `${prefix}/${this.text(h, 0, 100)}` : this.text(h, 0, 100));
    const link = this.paxLink ?? this.longLink ?? this.text(h, 157, 100);
    this.paxPath = this.paxLink = this.longName = this.longLink = null;
    const path = stripTop(raw);
    this.path = path;
    if (!path || type === T.dir) return;
    if (type === T.file || type === T.nul || type === T.contiguous) {
      this.total += size;
      if (this.total > this.limit) throw new Error("archive over the size limit");
      this.hasher = new Hasher(); this.state = "body";
      if (path.split("/").pop() === "package.json" && size <= 1 << 20) this.keep = [];
    } else if (type === T.hardlink || type === T.symlink) {
      this.files.set(path, { ...hashBytes(Buffer.from(`link:${link}`)), size: 0 });
    }
  }

  private finishEntry() {
    if (this.meta) {
      const body = Buffer.concat(this.meta);
      const z = body.indexOf(0);
      const str = body.subarray(0, z < 0 ? body.length : z).toString("utf8");
      if (this.metaType === T.L) this.longName = str;
      else if (this.metaType === T.K) this.longLink = str;
      else if (this.metaType === T.x) { const pax = parsePax(body); this.paxPath = pax.path ?? null; this.paxLink = pax.linkpath ?? null; }
      this.meta = null;
      return;
    }
    if (this.hasher) { this.files.set(this.path, this.hasher.done()); this.hasher = null; }
    if (this.keep) { this.kept.set(this.path, Buffer.concat(this.keep).toString("utf8")); this.keep = null; }
  }
}

/** pax extended header records: `<len> <key>=<value>\n`. */
export function parsePax(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < body.length) {
    const sp = body.indexOf(32, at);
    if (sp < 0) break;
    const len = Number(body.subarray(at, sp).toString("ascii"));
    if (!Number.isInteger(len) || len <= 0 || at + len > body.length) break;
    const rec = body.subarray(sp + 1, at + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    at += len;
  }
  return out;
}

/** Reads a whole gunzipped tar held in memory. */
export function readTar(tar: Buffer, limit = 2 ** 31): TarReader {
  const r = new TarReader(limit);
  r.push(tar);
  r.end();
  return r;
}

// --- §3: the repository field ---

export type Repo = { ok: true; owner: string; repo: string; directory: string | null } | { ok: false; why: "no repository" | "not GitHub" | "repository not understood" };

const PART = /^[A-Za-z0-9_.-]+$/;
function ownerRepo(path: string): { owner: string; repo: string } | null {
  let p = path.replace(/\/+$/, "");
  if (p.toLowerCase().endsWith(".git")) p = p.slice(0, -4);
  p = p.replace(/\/+$/, "");
  const parts = p.split("/");
  if (parts.length !== 2 || !PART.test(parts[0]!) || !PART.test(parts[1]!)) return null;
  return { owner: parts[0]!, repo: parts[1]! };
}

/** A GitHub URL or shorthand (§3) to owner/repo. */
export function githubOf(url: string): Repo {
  const s = url.trim().replace(/#.*$/, "");
  if (!s) return { ok: false, why: "no repository" };
  const short = /^github:(.+)$/i.exec(s);
  if (short) { const r = ownerRepo(short[1]!); return r ? { ok: true, ...r, directory: null } : { ok: false, why: "repository not understood" }; }
  if (/^(gitlab|bitbucket|gist):/i.test(s)) return { ok: false, why: "not GitHub" };
  if (!s.includes(":")) { const r = ownerRepo(s); return r && !s.endsWith("/") ? { ok: true, ...r, directory: null } : { ok: false, why: "repository not understood" }; }
  const m = /^(?:https?:\/\/|git\+https:\/\/|git:\/\/|git\+ssh:\/\/git@|ssh:\/\/git@|git@)([^/:]+)[/:](.*)$/i.exec(s);
  if (!m) return { ok: false, why: "repository not understood" };
  // git@host:path uses a colon; every URL form uses a slash after the host.
  const colonForm = /^git@/i.test(s);
  const sep = s.charAt(m[0].length - m[2]!.length - 1);
  if ((colonForm && sep !== ":") || (!colonForm && sep !== "/")) return { ok: false, why: "repository not understood" };
  const host = m[1]!.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return { ok: false, why: "not GitHub" };
  const r = ownerRepo(m[2]!);
  return r ? { ok: true, ...r, directory: null } : { ok: false, why: "repository not understood" };
}

/** The version's package.json `repository` (§3). */
export function repositoryOf(pkg: Record<string, unknown>): Repo {
  const field = pkg.repository;
  const url = typeof field === "string" ? field : field && typeof field === "object" && typeof (field as any).url === "string" ? (field as any).url as string : null;
  if (url === null) return { ok: false, why: "no repository" };
  const r = githubOf(url);
  if (!r.ok) return r;
  const dir = field && typeof field === "object" && typeof (field as any).directory === "string" ? normalizeDir((field as any).directory) : null;
  return { ...r, directory: dir };
}

/** `repository.directory`: leading `./` and `/` and trailing `/` dropped; `.` is the root. */
export function normalizeDir(d: string): string {
  return d.split("/").filter(s => s !== "" && s !== ".").join("/");
}

/** The 8 tag names of §3, in order (forms 1–8; an unscoped name repeats form 3 as form 4). */
export function tagCandidates(name: string, version: string): string[] {
  const u = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  return [`v${version}`, version, `${name}@${version}`, `${u}@${version}`, `${u}-v${version}`, `${u}-${version}`, `${u}/v${version}`, `${u}/${version}`];
}

/** Tags from a smart-HTTP reference advertisement: each tag's peeled commit (`^{}`), else its direct object. */
export function tagsFromRefs(advert: string): Map<string, string> {
  const direct = new Map<string, string>(), peeled = new Map<string, string>();
  for (const line of advert.split("\n")) {
    const m = /([0-9a-f]{40}) refs\/tags\/([^\0\s]+)/.exec(line);
    if (!m) continue;
    if (m[2]!.endsWith("^{}")) peeled.set(m[2]!.slice(0, -3), m[1]!);
    else direct.set(m[2]!, m[1]!);
  }
  const out = new Map(direct);
  for (const [t, c] of peeled) out.set(t, c);
  return out;
}

/** The first tag of §3's order that exists. */
export function releaseTag(tags: Map<string, string>, name: string, version: string): { tag: string; form: number; commit: string } | null {
  const all = tagCandidates(name, version);
  for (const [i, tag] of all.entries()) {
    const commit = tags.get(tag);
    if (commit) return { tag, form: i + 1, commit };
  }
  return null;
}

// --- §3: the package directory ---

export type Source = { files: Files; kept: Map<string, string> };
const nameIn = (text: string | undefined): string | null => {
  if (text === undefined) return null;
  try { const p = JSON.parse(text); return p && typeof p === "object" && typeof p.name === "string" ? p.name : null; } catch { return null; }
};

export function packageDir(source: Source, name: string, directory: string | null): { ok: true; dir: string; how: "directory" | "root" | "search" } | { ok: false; why: "directory not in source" | "package directory not found" } {
  const pj = (dir: string) => dir ? `${dir}/package.json` : "package.json";
  if (directory !== null) return source.files.has(pj(directory)) ? { ok: true, dir: directory, how: "directory" } : { ok: false, why: "directory not in source" };
  if (nameIn(source.kept.get("package.json")) === name) return { ok: true, dir: "", how: "root" };
  const found = [...source.kept.keys()].filter(p => p.endsWith("/package.json") && !p.split("/").includes("node_modules") && nameIn(source.kept.get(p)) === name).map(p => p.slice(0, -"/package.json".length));
  return found.length === 1 ? { ok: true, dir: found[0]!, how: "search" } : { ok: false, why: "package directory not found" };
}

// --- §4 and §5: comparing, and the build reading ---

const ROOT_FALLBACK = /^(readme|license|licence|changelog|history|notice|authors)/i;
const INSTALL = ["preinstall", "install", "postinstall"] as const;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export type Comparison = {
  outcome: "match" | "differs" | "absent files only";
  files: number; identical: number; different: number; absent: number;
  /** Shown only: absent files under a top-level directory the source package directory lacks entirely. */
  absentUnderMissingTop: number;
  /** Shown only: different files identical after CRLF → LF; null when a side has no such hash. */
  differentButEolIdentical: number | null;
  packageJson: { installScripts: boolean; dependencyNames: boolean };
  differentPaths: string[]; absentPaths: string[];
};

export function compare(version: { files: Files; pkg: Record<string, unknown> }, source: Source, dir: string, sourcePkg: Record<string, unknown>): Comparison {
  const at = (p: string) => dir ? `${dir}/${p}` : p;
  const tops = new Set<string>();
  for (const p of source.files.keys()) {
    const rel = dir ? (p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : null) : p;
    if (rel && rel.includes("/")) tops.add(rel.slice(0, rel.indexOf("/")));
  }
  let identical = 0, different = 0, absent = 0, absentUnderMissingTop = 0, eolSame = 0, eolKnown = true, files = 0;
  const differentPaths: string[] = [], absentPaths: string[] = [];
  for (const [p, e] of version.files) {
    if (p === "package.json") continue;
    files++;
    let s = source.files.get(at(p));
    if (!s && dir && !p.includes("/") && ROOT_FALLBACK.test(p)) s = source.files.get(p);
    if (!s) {
      absent++; absentPaths.push(p);
      if (p.includes("/") && !tops.has(p.slice(0, p.indexOf("/")))) absentUnderMissingTop++;
    } else if (s.sha256 === e.sha256) identical++;
    else {
      different++; differentPaths.push(p);
      if (e.eol === null || s.eol === null) eolKnown = false;
      else if (e.eol === s.eol) eolSame++;
    }
  }
  const vs = obj(version.pkg.scripts), ss = obj(sourcePkg.scripts);
  const installScripts = INSTALL.some(k => JSON.stringify(vs[k]) !== JSON.stringify(ss[k]));
  const depNames = (p: Record<string, unknown>) => [...new Set([...Object.keys(obj(p.dependencies)), ...Object.keys(obj(p.optionalDependencies))])].sort();
  const dependencyNames = JSON.stringify(depNames(version.pkg)) !== JSON.stringify(depNames(sourcePkg));
  const differs = installScripts || dependencyNames || different > 0;
  return {
    outcome: differs ? "differs" : absent > 0 ? "absent files only" : "match",
    files, identical, different, absent, absentUnderMissingTop,
    differentButEolIdentical: eolKnown ? eolSame : null,
    packageJson: { installScripts, dependencyNames },
    differentPaths: differentPaths.sort(), absentPaths: absentPaths.sort(),
  };
}

/** §5: built when the source package.json has build, prepack, prepublishOnly or prepublish, or a prepare not starting with husky. */
export function built(sourcePkg: Record<string, unknown>): boolean {
  const s = obj(sourcePkg.scripts);
  if (["build", "prepack", "prepublishOnly", "prepublish"].some(k => k in s)) return true;
  return "prepare" in s && !(typeof s.prepare === "string" && s.prepare.startsWith("husky"));
}
