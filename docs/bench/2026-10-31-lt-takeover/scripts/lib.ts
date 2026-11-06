// Lane LT (docs/decisions/2026-10-31-lt-takeover-definitions.md). Pure helpers: the GH Archive window and line
// matching (§4), the compare reading (§5), and the outcome of a malicious row (§8). Nothing read here is run.

export const HOUR = 3_600_000;

/** §4: the hours (UTC, as epoch ms of each hour's start) holding the window [t − 24 h, t + 24 h]. */
export function windowHours(published: string): number[] {
  const t = Date.parse(published);
  if (!Number.isFinite(t)) throw new Error(`publish time unreadable: ${published}`);
  const first = Math.floor((t - 24 * HOUR) / HOUR) * HOUR, last = Math.floor((t + 24 * HOUR) / HOUR) * HOUR;
  const out: number[] = [];
  for (let h = first; h <= last; h += HOUR) out.push(h);
  return out;
}
export function inWindow(published: string, createdAt: string): boolean {
  const t = Date.parse(published), c = Date.parse(createdAt);
  return Number.isFinite(c) && c >= t - 24 * HOUR && c <= t + 24 * HOUR;
}

/** GH Archive's file for an hour: `YYYY-MM-DD-H` with the hour not zero-padded. */
export function archiveUrl(hour: number): string {
  const d = new Date(hour);
  return `https://data.gharchive.org/${d.toISOString().slice(0, 10)}-${d.getUTCHours()}.json.gz`;
}

/**
 * §4: the repository of a GH Archive line without parsing it all: `"repo":{"id":<n>,"name":"<owner/repo>"`. Null when
 * the line does not have that shape (the caller then parses the whole line).
 */
export function repoOfLine(line: string): { id: number; name: string } | null {
  const at = line.indexOf('"repo":{"id":');
  if (at < 0) return null;
  let i = at + 13, id = 0, digits = 0;
  while (i < line.length) { const c = line.charCodeAt(i); if (c < 48 || c > 57) break; id = id * 10 + (c - 48); i++; digits++; }
  if (!digits || !line.startsWith(',"name":"', i)) return null;
  const from = i + 9, to = line.indexOf('"', from);
  return to < 0 ? null : { id, name: line.slice(from, to) };
}

/** §5: GitHub's compare status of `<default branch>...<commit>`. */
export function reachability(status: string): "reachable" | "not reachable" | "unknown" {
  if (status === "identical" || status === "behind") return "reachable";
  if (status === "ahead" || status === "diverged") return "not reachable";
  return "unknown";
}

export type MaliciousFacts = {
  prevRepo: "github" | "no repository" | "not GitHub" | "repository not understood" | "not obtained";
  tagNow: boolean;
  refsReachable: boolean;
  /** §4: null when not looked up. */
  atTheTime: "tag created at the time" | "no tag event" | "not fully checked" | null;
  provenance: boolean;
};

/** §8: exactly one outcome per malicious row. */
export function outcome(f: MaliciousFacts): string {
  if (f.prevRepo === "github" && f.tagNow) return "tied: tag now";
  if (f.prevRepo === "github" && f.atTheTime === "tag created at the time") return "tied: tag at the time only";
  if (f.provenance) return "tied: provenance only";
  if (f.prevRepo === "not obtained") return "not tied: P not obtained";
  if (f.prevRepo === "no repository") return "not tied: P names no repository";
  if (f.prevRepo === "not GitHub") return "not tied: P's repository not GitHub";
  if (f.prevRepo === "repository not understood") return "not tied: P's repository not understood";
  if (f.atTheTime === "no tag event") return f.refsReachable ? "not tied: no tag now, no tag event (repository reachable now)" : "not tied: no tag now, no tag event (repository not reachable now)";
  if (f.atTheTime === null) return "unknown: no tag now, GH Archive not looked up";
  return "unknown: no tag now, window not fully checked";
}
