/** Glob matching for guard file checks.
 *  Supports `**`, `*`, `?`, and `{a,b}`. `**` matches zero or more segments, including dot-directories.
 *  `*` matches any characters inside one segment, including a leading dot. No RegExp.
 *  Brace expansion is capped at 64; a pattern that expands further does not match.
 */

const MAX_EXPANSIONS = 64;

/** Recipient paths may use backslashes or `./`; normalize them before matching. */
function splitPath(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter((s) => s.length > 0 && s !== ".");
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

/** Returns null when braces are unbalanced, nested, or the expansion count would pass the cap. */
function expandBraces(pattern: string): string[] | null {
  const out: string[] = [];
  const walk = (current: string): boolean => {
    const start = current.indexOf("{");
    if (start < 0) {
      if (out.length >= MAX_EXPANSIONS) return false;
      out.push(current);
      return true;
    }
    let depth = 0;
    let end = -1;
    for (let i = start; i < current.length; i++) {
      const c = current[i];
      if (c === "{") {
        depth++;
        if (depth > 1) return false;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return false;
    const before = current.slice(0, start);
    const after = current.slice(end + 1);
    for (const alt of splitTopCommas(current.slice(start + 1, end))) {
      if (!walk(before + alt + after)) return false;
    }
    return true;
  };
  return walk(pattern) ? out : null;
}

/** `*` / `?` against one concrete segment. O(len(pattern) * len(seg)). */
function wildMatch(pat: string, seg: string): boolean {
  const m = seg.length;
  let prev: boolean[] = Array.from({ length: m + 1 }, () => false);
  prev[0] = true;
  for (let i = 0; i < pat.length; i++) {
    const pc = pat.charAt(i);
    const cur: boolean[] = Array.from({ length: m + 1 }, () => false);
    if (pc === "*") cur[0] = prev[0] === true;
    for (let j = 0; j < m; j++) {
      if (pc === "*") cur[j + 1] = cur[j] === true || prev[j + 1] === true;
      else if ((pc === "?" || pc === seg.charAt(j)) && prev[j] === true) cur[j + 1] = true;
    }
    prev = cur;
  }
  return prev[m] === true;
}

function matchSegments(pat: readonly string[], path: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  const rec = (pi: number, si: number): boolean => {
    const key = `${pi}:${si}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    const p = pat[pi];
    if (pi === pat.length) ok = si === path.length;
    else if (p === "**") {
      if (rec(pi + 1, si) || (si < path.length && rec(pi, si + 1))) ok = true;
    } else if (p !== undefined && si < path.length) {
      const seg = path[si];
      if (seg !== undefined && wildMatch(p, seg)) ok = rec(pi + 1, si + 1);
    }
    memo.set(key, ok);
    return ok;
  };
  return rec(0, 0);
}

export function globMatch(pattern: string, file: string): boolean {
  const path = splitPath(file);
  if (path.includes("..")) return false;
  const expanded = expandBraces(pattern);
  if (expanded === null) return false;
  for (const one of expanded) {
    if (matchSegments(splitPath(one), path)) return true;
  }
  return false;
}

export function anyGlob(globs: readonly string[], file: string): boolean {
  return globs.some((g) => globMatch(g, file));
}
