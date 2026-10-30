// Lanes LO2 and LD2 (docs/decisions/2026-10-30-lold2-release-link-definitions.md). Pure helpers: LD's v1 diff with
// changed code files matched to their previous file by content (§5), what the source diff explains (§6), a source
// archive read in memory keeping only one directory's bytes, and the time statistics (§3). Nothing read here is
// extracted to a disk, required or run.
import { createHash } from "node:crypto";
import { capabilityCounts, CAPABILITIES, delta, FILE_CAPABILITIES, isCode, type Delta, type Files } from "../../../../tools/backtest/src/delta.ts";
import { parsePax, stripTop } from "../../2026-10-30-lo-tarball-source/scripts/lo.ts";

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** §5: a file's distinct lines, each trimmed, empty ones dropped. */
export function lineSet(bytes: Buffer): Set<string> {
  const out = new Set<string>();
  for (const l of bytes.toString("utf8").split("\n")) { const t = l.trim(); if (t) out.add(t); }
  return out;
}

/** The `bin` paths of a package.json, as delta.ts reads them. */
export function binsOf(pkg: Record<string, unknown>): Set<string> {
  const bin = pkg.bin;
  const list = typeof bin === "string" ? [bin] : Object.values(object(bin)).filter((v): v is string => typeof v === "string");
  return new Set(list.map(p => p.replace(/^[.]?[/]/, "")));
}

const manifest = (files: Files): Record<string, unknown> => { try { return object(JSON.parse(files.get("package.json")!.toString("utf8"))); } catch { return {}; } };

export const THRESHOLD = 0.5;
export type Matched = { path: string; predecessor: string | null; how: "content" | "same path" | "none"; similarity: number };
export type ContentDelta =
  | { status: "undecidable"; why: string }
  | { status: "clean" | "flagged"; capabilities: string[]; where: Record<string, string[]>; v1: { status: "clean" | "flagged"; capabilities: string[] }; matched: Matched[] };

/**
 * §5: LD's v1 (`delta`) for rules 4-6, and rules 1-3 and 7 per changed code file against its predecessor by content:
 * the previous code file with the highest similarity (shared distinct lines / the changed file's distinct lines) when it
 * is at least 0.5, ties to the same path and then the first path in code-unit order; else the same path; else none.
 */
export function contentDelta(prev: Files, next: Files): ContentDelta {
  const v1: Delta = delta(prev, next);
  if (v1.status === "undecidable") return v1;
  const prevPkg = manifest(prev), nextPkg = manifest(next);
  const prevBins = binsOf(prevPkg), nextBins = binsOf(nextPkg);
  const prevHashes = new Set([...prev.values()].map(sha256));

  // The previous version's code files, and an index from each distinct line to the files holding it.
  const prevCode = [...prev].filter(([p, b]) => isCode(p, b, prevBins)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const index = new Map<string, number[]>();
  prevCode.forEach(([, b], i) => { for (const l of lineSet(b)) { const list = index.get(l); if (list) list.push(i); else index.set(l, [i]); } });
  const counted = new Map<number, ReturnType<typeof capabilityCounts>>();
  const countsOf = (i: number) => { let c = counted.get(i); if (!c) { c = capabilityCounts(prevCode[i]![1].toString("utf8")); counted.set(i, c); } return c; };

  const where: Record<string, string[]> = {};
  for (const c of ["install-script", "new-dependency", "binary"]) if (v1.where[c]) where[c] = [...v1.where[c]!];
  const matched: Matched[] = [];
  for (const [path, bytes] of [...next].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const before = prev.get(path);
    if (before && before.equals(bytes)) continue;
    if (!isCode(path, bytes, nextBins) || prevHashes.has(sha256(bytes))) continue;
    const lines = lineSet(bytes);
    const shared = new Map<number, number>();
    for (const l of lines) for (const i of index.get(l) ?? []) shared.set(i, (shared.get(i) ?? 0) + 1);
    let best = -1, bestScore = -1;
    for (const [i, n] of shared) {
      const score = n / lines.size;
      const better = score > bestScore || (score === bestScore && (prevCode[i]![0] === path || (prevCode[best]![0] !== path && i < best)));
      if (better) { best = i; bestScore = score; }
    }
    let pred: { path: string; counts: ReturnType<typeof capabilityCounts> } | null = null;
    let how: Matched["how"] = "none";
    if (best >= 0 && bestScore >= THRESHOLD) { pred = { path: prevCode[best]![0], counts: countsOf(best) }; how = "content"; }
    else if (before) { pred = { path, counts: capabilityCounts(before.toString("utf8")) }; how = "same path"; }
    matched.push({ path, predecessor: pred?.path ?? null, how, similarity: bestScore < 0 ? 0 : Math.round(bestScore * 1e4) / 1e4 });
    const after = capabilityCounts(bytes.toString("utf8"));
    for (const c of FILE_CAPABILITIES) if (after[c]! > (pred?.counts[c] ?? 0)) (where[c] ??= []).push(path);
  }
  const capabilities = CAPABILITIES.filter(c => where[c]);
  return { status: capabilities.length ? "flagged" : "clean", capabilities, where, v1: { status: v1.status, capabilities: v1.capabilities }, matched };
}

const PER_NAME = new Set(["new-dependency", "install-script"]);
/** §6: a tarball capability is explained when the source diff has it new; per name for dependencies and install scripts. */
export function explain(tarball: Record<string, string[]>, source: Record<string, string[]>): { explained: string[]; unexplained: string[] } {
  const explained: string[] = [], unexplained: string[] = [];
  for (const c of CAPABILITIES) {
    if (!tarball[c]) continue;
    const ok = PER_NAME.has(c) ? !!source[c] && tarball[c]!.every(n => source[c]!.includes(n)) : !!source[c];
    (ok ? explained : unexplained).push(c);
  }
  return { explained, unexplained };
}

const T = { file: 48, nul: 0, contiguous: 55, hardlink: 49, symlink: 50, dir: 53, L: 76, K: 75, x: 120, g: 103 };
export type SourceTar = { paths: Set<string>; packageJsons: Map<string, string>; kept: Map<string, Buffer> };
/**
 * A gunzipped source archive held in memory: every path (as LO's `stripTop` gives it), every `package.json` text up
 * to 1 MiB, and the bytes of the files under `keepDir` ("" keeps all, null none), keyed by path relative to it. Links
 * are kept as the text `link:<target>`, as delta.ts does. Throws on a malformed archive.
 */
export function readSourceTar(tar: Buffer, keepDir: string | null): SourceTar {
  const paths = new Set<string>(), packageJsons = new Map<string, string>(), kept = new Map<string, Buffer>();
  let longName: string | null = null, longLink: string | null = null, paxPath: string | null = null, paxLink: string | null = null;
  const text = (h: Buffer, from: number, len: number) => { const raw = h.subarray(from, from + len); const z = raw.indexOf(0); return raw.subarray(0, z < 0 ? len : z).toString("utf8"); };
  const under = (p: string) => keepDir === null ? null : keepDir === "" ? p : p.startsWith(`${keepDir}/`) ? p.slice(keepDir.length + 1) : null;
  for (let at = 0; at + 512 <= tar.length;) {
    const h = tar.subarray(at, at + 512);
    if (h.every(b => b === 0)) break;
    if (h[124]! & 0x80) throw new Error("tar entry too large");
    const size = parseInt(text(h, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("tar size field unreadable");
    const type = h[156]!;
    const body = tar.subarray(at + 512, at + 512 + size);
    if (body.length !== size) throw new Error("tar truncated");
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === T.L || type === T.K) { const z = body.indexOf(0); const s = body.subarray(0, z < 0 ? size : z).toString("utf8"); if (type === T.L) longName = s; else longLink = s; continue; }
    if (type === T.x) { const pax = parsePax(body); paxPath = pax.path ?? null; paxLink = pax.linkpath ?? null; continue; }
    if (type === T.g) continue;
    const prefix = text(h, 257, 6).startsWith("ustar") ? text(h, 345, 155) : "";
    const raw = paxPath ?? longName ?? (prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100));
    const link = paxLink ?? longLink ?? text(h, 157, 100);
    longName = longLink = paxPath = paxLink = null;
    const path = stripTop(raw);
    if (!path || type === T.dir) continue;
    const isFile = type === T.file || type === T.nul || type === T.contiguous;
    const isLink = type === T.hardlink || type === T.symlink;
    if (!isFile && !isLink) continue;
    paths.add(path);
    if (isFile && path.split("/").pop() === "package.json" && size <= 1 << 20) packageJsons.set(path, body.toString("utf8"));
    const rel = under(path);
    if (rel) kept.set(rel, isFile ? Buffer.from(body) : Buffer.from(`link:${link}`));
  }
  return { paths, packageJsons, kept };
}

/** Quantile by linear interpolation between closest ranks (the median of an even count is the mean of the middle two). */
export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)) * 100) / 100;
}

export const BUCKETS = ["<= -168h", "(-168h, -24h]", "(-24h, -1h]", "(-1h, 0h]", "(0h, 1h]", "(1h, 24h]", "(24h, 168h]", "> 168h"] as const;
/** §3's buckets of a difference in hours. */
export function bucket(h: number): (typeof BUCKETS)[number] {
  if (h <= -168) return "<= -168h";
  if (h <= -24) return "(-168h, -24h]";
  if (h <= -1) return "(-24h, -1h]";
  if (h <= 0) return "(-1h, 0h]";
  if (h <= 1) return "(0h, 1h]";
  if (h <= 24) return "(1h, 24h]";
  if (h <= 168) return "(24h, 168h]";
  return "> 168h";
}

export function timeStats(hours: number[]) {
  const s = [...hours].sort((a, b) => a - b);
  const buckets = Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<string, number>;
  for (const h of s) buckets[bucket(h)]!++;
  return { n: s.length, min: s.length ? s[0]! : null, q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75), max: s.length ? s.at(-1)! : null, buckets };
}
