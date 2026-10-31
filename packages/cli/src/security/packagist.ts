// Packagist's security advisories for Composer packages, read next to OSV while planning (docs/decisions.md,
// "Composer plans also read Packagist's advisories"). Packagist publishes some advisories (FriendsOfPHP, vendor feeds)
// before or without OSV, and its affected ranges can end at a later fix. Each advisory is turned into an OSV-shaped
// record whose fixed events are the exclusive upper bounds of its ranges, so the same smallest-fix planning applies.
import semver from "semver";
import type { Advisory } from "./osv.ts";

export const PACKAGIST_ADVISORIES = "https://packagist.org/api/security-advisories/";
/**
 * A Packagist advisory ID, in the same form deliver.ts's ADVISORY lets into a fix's commit (review 6518582507, N-d):
 * no "-" at either end, so an ID read here is never one the PR job refuses.
 */
export const PKSA_ID = /^PKSA-[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

type Term = { op: "<" | "<=" | ">" | ">=" | "=" | "!="; version: string };
/** Alternatives (`|`), each a conjunction of comparisons; null when any part cannot be read. */
export type Constraint = Term[][];
export type PackagistAdvisory = { advisory: Advisory; constraint: Constraint | null };

function version(text: string): string | null {
  const parts = text.replace(/^v(?=\d)/, "").split(".");
  while (parts.length > 3 && parts.at(-1) === "0") parts.pop();
  if (parts.length > 3 || !parts.every(p => /^\d+$/.test(p))) return null;
  return semver.valid([...parts, "0", "0"].slice(0, 3).join("."));
}

/** Composer constraint as Packagist writes affected versions (">=5.4.1,<5.4.54|>=6.0.1,<6.1.0"). */
export function parseConstraint(text: string): Constraint | null {
  if (text.length > 4000) return null;
  const out: Constraint = [];
  for (const alternative of text.split(/\s*\|\|?\s*/)) {
    if (alternative.trim() === "*") { out.push([]); continue; }
    const terms: Term[] = [];
    for (const raw of alternative.trim().split(/\s*,\s*|\s+/)) {
      const m = /^(<=|>=|<|>|==|=|!=)?(v?\d[\d.]*)$/.exec(raw);
      const v = m ? version(m[2]!) : null;
      if (!m || !v) return null;
      terms.push({ op: (m[1] === "==" || !m[1] ? "=" : m[1]) as Term["op"], version: v });
    }
    if (!terms.length) return null;
    out.push(terms);
  }
  return out.length ? out : null;
}

export function affects(constraint: Constraint, installed: string): boolean {
  const v = semver.valid(installed);
  if (!v) return true;
  const holds = (t: Term) => ({ "<": semver.lt, "<=": semver.lte, ">": semver.gt, ">=": semver.gte, "=": semver.eq, "!=": semver.neq }[t.op])(v, t.version);
  return constraint.some(alternative => alternative.every(holds));
}

/** Exclusive upper bounds of the affected ranges: the first versions each range says are fixed. */
function fixedEvents(constraint: Constraint): { fixed: string }[] {
  return constraint.flatMap(alternative => alternative.filter(t => t.op === "<").map(t => ({ fixed: t.version })));
}

/** Fixed-origin requests with bounded bodies and deadlines. Any failure throws: an unavailable source is never clean. */
export async function packagistAdvisories(fetchFn: typeof fetch, names: string[]): Promise<PackagistAdvisory[]> {
  const out: PackagistAdvisory[] = [];
  for (let start = 0; start < names.length; start += 40) {
    const chunk = names.slice(start, start + 40);
    const url = `${PACKAGIST_ADVISORIES}?${chunk.map(n => `packages[]=${encodeURIComponent(n)}`).join("&")}`;
    const r = await fetchFn(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { accept: "application/json", "user-agent": "Ludion-Security-Preview" } });
    if (!r.ok) throw new Error(`Packagist advisory lookup failed (HTTP ${r.status}); no clean result is available.`);
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Empty Packagist response.");
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw new Error("Packagist response exceeds 4 MiB."); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const body: any = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const advisories = body?.advisories;
    // An empty result is encoded as [] by Packagist; anything else must be an object keyed by requested names.
    if (Array.isArray(advisories) && !advisories.length) continue;
    if (!advisories || typeof advisories !== "object" || Array.isArray(advisories)) throw new Error("Invalid Packagist advisory response; no clean result is available.");
    for (const [name, items] of Object.entries<unknown>(advisories)) {
      if (!chunk.includes(name) || !Array.isArray(items)) throw new Error("Invalid Packagist advisory response; no clean result is available.");
      for (const item of items) {
        if (!item || typeof item !== "object" || typeof item.advisoryId !== "string" || !PKSA_ID.test(item.advisoryId) || item.packageName !== name || typeof item.affectedVersions !== "string") throw new Error("Invalid Packagist advisory record; no clean result is available.");
        const constraint = parseConstraint(item.affectedVersions);
        const aliases = [item.cve, ...(Array.isArray(item.sources) ? item.sources.map((s: any) => s?.remoteId) : [])].filter((s: unknown): s is string => typeof s === "string" && /^(CVE-\d{4}-\d{4,}|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$/.test(s));
        out.push({
          constraint,
          advisory: { id: item.advisoryId, summary: String(item.title ?? item.advisoryId).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500), aliases: [...new Set(aliases)], affected: [{ package: { ecosystem: "Packagist", name }, ranges: [{ events: constraint ? fixedEvents(constraint) : [] }] }] },
        });
      }
    }
  }
  return out;
}
