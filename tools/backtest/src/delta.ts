// Delta v1 (docs/decisions/2026-10-30-ld-delta-v1-definitions.md): what the diff from the previous version adds.
// Pure: two versions' files (path -> bytes) in, a judgement out. Nothing read here is run, required or written to disk.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

/** A version's files by path relative to the package root (the tarball's top folder stripped). */
export type Files = Map<string, Buffer>;

const CHAR = { L: 76, x: 120, g: 103, K: 75, dir: 53, file: 48, contiguous: 55, hardlink: 49, symlink: 50 };
/**
 * A gzipped tarball's regular files, read in memory (as archives-v5.ts's tarFiles, keeping the bytes). Links are kept
 * as the text `link:<target>`, so a changed link counts as a changed file. Throws on a malformed archive.
 */
export function untar(tgz: Buffer): Files {
  const tar = gunzipSync(tgz, { maxOutputLength: 1 << 30 });
  const files: Files = new Map();
  let longName: string | null = null, paxPath: string | null = null;
  const text = (from: number, len: number) => { const raw = tar.subarray(from, from + len); const end = raw.indexOf(0); return raw.subarray(0, end < 0 ? len : end).toString("utf8"); };
  for (let at = 0; at + 512 <= tar.length;) {
    const header = at;
    if (tar.subarray(header, header + 512).every(b => b === 0)) break;
    if (tar[header + 124]! & 0x80) throw new Error("tar entry too large");
    const size = parseInt(text(header + 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("tar size field unreadable");
    const type = tar[header + 156]!;
    const body = tar.subarray(header + 512, header + 512 + size);
    if (body.length !== size) throw new Error("tar entry truncated");
    at = header + 512 + Math.ceil(size / 512) * 512;
    if (type === CHAR.L) { const end = body.indexOf(0); longName = body.subarray(0, end < 0 ? size : end).toString("utf8"); continue; }
    if (type === CHAR.x) { paxPath = body.toString("utf8").split("\n").map(r => /^[0-9]+ path=(.*)$/.exec(r)?.[1]).find(p => p !== undefined) ?? null; continue; }
    if (type === CHAR.g || type === CHAR.K) continue;
    const prefix = text(header + 257, 6).startsWith("ustar") ? text(header + 345, 155) : "";
    const raw = paxPath ?? longName ?? (prefix ? `${prefix}/${text(header, 100)}` : text(header, 100));
    longName = null; paxPath = null;
    const path = raw.replace(/^[.]?[/]/, "").split("/").slice(1).join("/");
    if (!path || type === CHAR.dir) continue;
    if (type === CHAR.file || type === 0 || type === CHAR.contiguous) files.set(path, Buffer.from(body));
    else if (type === CHAR.hardlink || type === CHAR.symlink) files.set(path, Buffer.from(`link:${text(header + 157, 100)}`));
  }
  return files;
}

// --- Section 4's capabilities. ---

const MODULES: [string, string][] = [
  ["child_process", "child_process"], ["net", "net"], ["http", "http(s)"], ["https", "http(s)"], ["http2", "http(s)"],
  ["dns", "dns"], ["tls", "tls"], ["dgram", "dgram"], ["worker_threads", "worker_threads"], ["vm", "vm"],
];
const MOD = "(?:node:)?(child_process|net|https?|http2|dns|tls|dgram|worker_threads|vm)";
const MODULE_PATTERNS = [
  new RegExp(String.raw`\brequire\s*\(\s*(['"\x60])${MOD}\1\s*\)`, "g"),
  new RegExp(String.raw`\bimport\s*\(\s*(['"\x60])${MOD}\1\s*\)`, "g"),
  new RegExp(String.raw`\bfrom\s*(['"])${MOD}\1`, "g"),
  new RegExp(String.raw`\bimport\s*(['"])${MOD}\1`, "g"),
];
/** Per-file capabilities (rules 1-3 and 7), in report order. */
export const FILE_CAPABILITIES = [
  ...[...new Set(MODULES.map(([, c]) => c))].map(c => `module:${c}`),
  "api:fetch", "api:XMLHttpRequest", "api:WebSocket",
  "code:eval", "code:new Function",
  "obf:long-hex", "obf:long-base64", "obf:high-entropy-line", "obf:very-long-line", "obf:_0x-names",
] as const;
/** Every capability of section 4, in report order. */
export const CAPABILITIES = [...FILE_CAPABILITIES, "install-script", "new-dependency", "binary"] as const;
/** Shown only, never part of "clean" (section 4, last paragraph). */
export const REFERENCE = ["ref:process.env", "ref:homedir", "ref:base64-decode", "ref:atob"] as const;

export type Counts = Record<string, number>;
const count = (text: string, re: RegExp) => { re.lastIndex = 0; let n = 0; while (re.exec(text)) n++; return n; };

/** Shannon entropy in bits per character. */
export function entropy(line: string): number {
  const freq = new Map<string, number>();
  for (const ch of line) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const n = [...line].length;
  let h = 0;
  for (const f of freq.values()) { const p = f / n; h -= p * Math.log2(p); }
  return h;
}

/** Rules 1-3 and 7 (and the shown-only counts) over one code file's text. */
export function capabilityCounts(text: string): Counts {
  const out: Counts = Object.fromEntries([...FILE_CAPABILITIES, ...REFERENCE].map(c => [c, 0]));
  const group = new Map(MODULES);
  for (const re of MODULE_PATTERNS) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) out[`module:${group.get(m[2]!)}`]!++;
  }
  out["api:fetch"] = count(text, /\bfetch\s*\(/g);
  out["api:XMLHttpRequest"] = count(text, /\bXMLHttpRequest\b/g);
  out["api:WebSocket"] = count(text, /\bWebSocket\b/g);
  out["code:eval"] = count(text, /\beval\s*\(/g);
  out["code:new Function"] = count(text, /\bnew\s+Function\s*\(/g);
  out["obf:long-hex"] = count(text, /[0-9a-fA-F]{200,}/g) + count(text, /(?:\\x[0-9a-fA-F]{2}){50,}/g) + count(text, /(?:\\u[0-9a-fA-F]{4}){50,}/g);
  out["obf:long-base64"] = (text.match(/[A-Za-z0-9+/]{200,}/g) ?? []).filter(s => !/^[0-9a-fA-F]+$/.test(s)).length;
  for (const line of text.split("\n")) {
    if (line.length >= 5000) out["obf:very-long-line"]!++;
    if (line.length >= 200 && entropy(line) >= 5.5) out["obf:high-entropy-line"]!++;
  }
  out["obf:_0x-names"] = count(text, /\b_0x[0-9a-fA-F]{4,}\b/g);
  out["ref:process.env"] = count(text, /\bprocess\.env\b/g);
  out["ref:homedir"] = count(text, /\bhomedir\s*\(/g);
  out["ref:base64-decode"] = count(text, /\bBuffer\.from\s*\([^)]{0,500}?['"]base64['"]\s*\)/g);
  out["ref:atob"] = count(text, /\batob\s*\(/g);
  return out;
}

const CODE_EXT = /\.(?:js|cjs|mjs|jsx|ts|cts|mts|tsx)$/i;
const DECLARATIONS = /\.d\.(?:ts|cts|mts)$/i;
const SCRIPT_EXT = /\.(?:sh|bat|cmd|ps1|py|vbs)$/i;
const BINARY_EXT = /\.(?:node|exe|dll|so|dylib|wasm)$/i;
const MAGIC = ["7f454c46", "feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "0061736d"];

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Section 3: code files, given the version's package.json. */
export function isCode(path: string, bytes: Buffer, bins: Set<string>): boolean {
  if (bins.has(path)) return true;
  if (CODE_EXT.test(path)) return !DECLARATIONS.test(path);
  if (base(path).includes(".")) return false;
  const first = bytes.subarray(0, 200).toString("utf8").split("\n")[0]!;
  return first.startsWith("#!") && first.includes("node");
}

/** Rule 6: an executable by extension or magic bytes. */
export function isBinary(path: string, bytes: Buffer): boolean {
  if (BINARY_EXT.test(path)) return true;
  if (MAGIC.includes(bytes.subarray(0, 4).toString("hex"))) return true;
  if (bytes.length >= 0x40 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    const at = bytes.readUInt32LE(0x3c);
    return at + 4 <= bytes.length && bytes.subarray(at, at + 4).toString("hex") === "50450000";
  }
  return false;
}

const isText = (b: Buffer) => !b.subarray(0, 8000).includes(0);
const lines = (b: Buffer) => { const all = b.toString("utf8").split("\n").map(l => l.replace(/\r$/, "")); if (all.at(-1) === "") all.pop(); return all; };
/** Lines of `a` beyond their copies in `b`, as multisets. */
function linesBeyond(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const l of b) left.set(l, (left.get(l) ?? 0) + 1);
  let n = 0;
  for (const l of a) { const k = left.get(l) ?? 0; if (k > 0) left.set(l, k - 1); else n++; }
  return n;
}

function bins(pkg: Record<string, unknown>): Set<string> {
  const bin = pkg.bin;
  const list = typeof bin === "string" ? [bin] : Object.values(object(bin)).filter((v): v is string => typeof v === "string");
  return new Set(list.map(p => p.replace(/^[.]?[/]/, "")));
}
const LIFECYCLE = ["preinstall", "install", "postinstall"];
const runtimeDeps = (pkg: Record<string, unknown>) => new Set(["dependencies", "optionalDependencies", "peerDependencies"].flatMap(k => Object.keys(object(pkg[k]))));

export type Size = { filesAdded: number; filesRemoved: number; filesChanged: number; codeFilesChanged: number; linesAdded: number; linesRemoved: number };
export type ChangedCode = { path: string; previous: boolean; before: Counts; after: Counts };
export type Delta =
  | { status: "undecidable"; why: string }
  | {
      status: "clean" | "flagged";
      /** Section 4's capabilities that are new, in report order. */
      capabilities: string[];
      /** For each new capability, the paths (or names, for install scripts and dependencies) it is new in. */
      where: Record<string, string[]>;
      size: Size;
      changedCode: ChangedCode[];
      /** Shown only: new script files, per-file increases of the reference counts, and the package-wide reading. */
      shown: { scriptFiles: string[]; reference: string[]; packageWide: string[] };
    };

function manifest(files: Files): Record<string, unknown> | string {
  const raw = files.get("package.json");
  if (!raw) return "no root package.json";
  try { const pkg = JSON.parse(raw.toString("utf8")); return pkg && typeof pkg === "object" && !Array.isArray(pkg) ? pkg : "package.json is not an object"; }
  catch { return "package.json is not JSON"; }
}

/** The judgement of section 4 and the size of section 5, for `prev` -> `next`. */
export function delta(prev: Files, next: Files): Delta {
  const prevPkg = manifest(prev), nextPkg = manifest(next);
  if (typeof prevPkg === "string") return { status: "undecidable", why: `previous: ${prevPkg}` };
  if (typeof nextPkg === "string") return { status: "undecidable", why: `new: ${nextPkg}` };

  const where: Record<string, string[]> = {};
  const fire = (cap: string, at: string) => (where[cap] ??= []).push(at);

  // Rule 4: install scripts.
  const prevScripts = object(prevPkg.scripts), nextScripts = object(nextPkg.scripts);
  for (const n of LIFECYCLE) if (typeof nextScripts[n] === "string" && nextScripts[n] !== prevScripts[n]) fire("install-script", n);
  if (next.has("binding.gyp") && !prev.has("binding.gyp") && typeof nextScripts.install !== "string" && typeof nextScripts.preinstall !== "string" && nextPkg.gypfile !== false) fire("install-script", "install (binding.gyp)");
  // Rule 5: new dependencies.
  const had = runtimeDeps(prevPkg);
  for (const d of [...runtimeDeps(nextPkg)].sort()) if (!had.has(d)) fire("new-dependency", d);

  // Rules 1-3 and 7 per changed code file; rule 6 over every file; section 5's sizes.
  const prevHashes = new Set([...prev.values()].map(sha256));
  const nextBins = bins(nextPkg), prevBins = bins(prevPkg);
  const size: Size = { filesAdded: 0, filesRemoved: 0, filesChanged: 0, codeFilesChanged: 0, linesAdded: 0, linesRemoved: 0 };
  const changedCode: ChangedCode[] = [];
  const scriptFiles: string[] = [];
  const reference = new Set<string>();
  const total = (files: Files, binSet: Set<string>) => {
    const sum: Counts = {};
    for (const [p, b] of files) if (isCode(p, b, binSet)) for (const [c, n] of Object.entries(capabilityCounts(b.toString("utf8")))) sum[c] = (sum[c] ?? 0) + n;
    return sum;
  };
  for (const [path, bytes] of [...next].sort(([a], [b]) => a.localeCompare(b))) {
    const before = prev.get(path);
    if (before && before.equals(bytes)) continue;
    if (before) size.filesChanged++; else size.filesAdded++;
    if (!before && SCRIPT_EXT.test(path)) scriptFiles.push(path);
    if (isBinary(path, bytes)) fire("binary", path);
    if (isText(bytes)) {
      const now = lines(bytes), then = before && isText(before) ? lines(before) : [];
      size.linesAdded += linesBeyond(now, then);
      size.linesRemoved += linesBeyond(then, now);
    } else if (before && isText(before)) size.linesRemoved += lines(before).length;
    if (!isCode(path, bytes, nextBins) || prevHashes.has(sha256(bytes))) continue;
    size.codeFilesChanged++;
    const after = capabilityCounts(bytes.toString("utf8"));
    const was = before ? capabilityCounts(before.toString("utf8")) : Object.fromEntries(Object.keys(after).map(c => [c, 0]));
    changedCode.push({ path, previous: !!before, before: was, after });
    for (const c of FILE_CAPABILITIES) if (after[c]! > was[c]!) fire(c, path);
    for (const c of REFERENCE) if (after[c]! > was[c]!) reference.add(c);
  }
  for (const [path, bytes] of prev) {
    if (next.has(path)) continue;
    size.filesRemoved++;
    if (isText(bytes)) size.linesRemoved += lines(bytes).length;
  }
  const prevTotal = total(prev, prevBins), nextTotal = total(next, nextBins);
  const packageWide = FILE_CAPABILITIES.filter(c => (nextTotal[c] ?? 0) > (prevTotal[c] ?? 0));

  const capabilities = CAPABILITIES.filter(c => where[c]);
  return {
    status: capabilities.length ? "flagged" : "clean",
    capabilities,
    where,
    size,
    changedCode,
    shown: { scriptFiles, reference: REFERENCE.filter(c => reference.has(c)), packageWide },
  };
}
