/** Glob helpers for guard file matching and the write/protect overlap check.
 *  Matcher supports `**`, `*`, `?`, and `{a,b}`. `**` does not enter dot-directories.
 *  Overlap uses a conservative literal prefix: segments before the first glob metacharacter.
 */

const META = /[*?[\]{}!]/;

export function splitPath(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter((s) => s.length > 0 && s !== ".");
}

/** Path segments before the first segment that contains a glob metacharacter. An empty prefix overlaps everything. */
export function literalPrefix(glob: string): string[] {
  const prefix: string[] = [];
  for (const seg of splitPath(glob)) {
    if (META.test(seg)) break;
    prefix.push(seg);
  }
  return prefix;
}

export function isSegmentPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== full[i]) return false;
  return true;
}

/** True when either literal prefix is a segment-wise prefix of the other, including an empty prefix. */
export function prefixesOverlap(a: readonly string[], b: readonly string[]): boolean {
  return isSegmentPrefix(a, b) || isSegmentPrefix(b, a);
}

export function globsMayOverlap(a: string, b: string): boolean {
  return prefixesOverlap(literalPrefix(a), literalPrefix(b));
}

export function globMayOverlapDir(glob: string, dir: string): boolean {
  return prefixesOverlap(literalPrefix(glob), splitPath(dir));
}

/** A protected glob covers a mount directory when its literal prefix is at or above the mount and the rest is `**`. */
export function globCoversDir(glob: string, dir: string): boolean {
  const segs = splitPath(glob);
  const prefix: string[] = [];
  let i = 0;
  for (; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === undefined || META.test(seg)) break;
    prefix.push(seg);
  }
  const rest = segs.slice(i);
  if (!isSegmentPrefix(prefix, splitPath(dir))) return false;
  return rest.length >= 1 && rest.every((s) => s === "**");
}

function splitTopCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf("{");
  if (start < 0) return [pattern];
  let depth = 0;
  let end = -1;
  for (let i = start; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [pattern];
  const before = pattern.slice(0, start);
  const after = pattern.slice(end + 1);
  const out: string[] = [];
  for (const alt of splitTopCommas(pattern.slice(start + 1, end))) {
    for (const rest of expandBraces(before + alt + after)) out.push(rest);
  }
  return out;
}

function segMatch(pat: string, seg: string): boolean {
  let re = "^";
  for (const c of pat) {
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$").test(seg);
}

function matchSegments(pat: string[], path: string[]): boolean {
  const memo = new Map<string, boolean>();
  const rec = (pi: number, si: number): boolean => {
    const key = `${pi}:${si}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    const p = pat[pi];
    if (pi === pat.length) ok = si === path.length;
    else if (p === "**") {
      if (rec(pi + 1, si)) ok = true;
      else {
        for (let k = si; k < path.length; k++) {
          const seg = path[k];
          if (seg === undefined || seg.startsWith(".")) break;
          if (rec(pi + 1, k + 1)) {
            ok = true;
            break;
          }
        }
      }
    } else if (p !== undefined && si < path.length && segMatch(p, path[si] ?? "")) {
      ok = rec(pi + 1, si + 1);
    }
    memo.set(key, ok);
    return ok;
  };
  return rec(0, 0);
}

export function globMatch(pattern: string, file: string): boolean {
  const path = splitPath(file);
  if (path.includes("..")) return false;
  for (const expanded of expandBraces(pattern.replaceAll("\\", "/"))) {
    if (matchSegments(splitPath(expanded), path)) return true;
  }
  return false;
}

export function anyGlob(globs: readonly string[], file: string): boolean {
  return globs.some((g) => globMatch(g, file));
}
