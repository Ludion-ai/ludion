import semver from "semver";
import { OSV_NAMES, type Package, type Inventory, type Change, type Ecosystem } from "./inventory.ts";

export function comparableVersion(version: string, ecosystem: Ecosystem): string | null {
  if (ecosystem === "maven") {
    if (!/^\d+(?:\.\d+){0,2}$/.test(version)) return null;
    return semver.valid([...version.split("."), "0", "0"].slice(0, 3).join("."));
  }
  return semver.valid(version);
}

export type Advisory = { id: string; summary: string; aliases: string[]; affected: { package: { ecosystem: string; name: string }; ranges?: { events?: { fixed?: string }[] }[] }[]; withdrawn?: string };
export type Finding = { package: Package; advisory: Advisory };
export type DependencyScan = {
  schema: 1; checked_at: string; source: "https://osv.dev"; status: "vulnerabilities_found" | "no_known_vulnerabilities" | "incomplete";
  inventory: Inventory; findings: Finding[]; plan: Change[]; blocked: string[];
  note: string;
};

/** Fixed-origin requests only, with bounded bodies, deadlines and explicit pagination. No registry or database failure becomes a clean result. */
export class OsvClient {
  private cache = new Map<string, Advisory>();
  private fetchFn: typeof fetch;
  constructor(fetchFn: typeof fetch = fetch) { this.fetchFn = fetchFn; }
  private async json(path: string, body?: unknown): Promise<any> {
    const r = await this.fetchFn(`https://api.osv.dev/v1/${path}`, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "accept": "application/json", "content-type": "application/json", "user-agent": "Ludion-Security-Preview" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`OSV lookup failed (HTTP ${r.status}); no clean result is available.`);
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Empty OSV response.");
    let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw new Error("OSV response exceeds 4 MiB."); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid OSV response.");
    return result;
  }
  async ids(packages: Package[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const key = (p: Package) => `${p.ecosystem}\0${p.name}\0${p.version}`;
    for (let start = 0; start < packages.length; start += 100) {
      let pending = packages.slice(start, start + 100).map(p => ({ p, token: "" }));
      const pages = new Set<string>();
      for (let page = 0; pending.length; page++) {
        if (page >= 20) throw new Error("OSV pagination limit exceeded; scan is incomplete.");
        const response = await this.json("querybatch", { queries: pending.map(({ p, token }) => ({ package: { ecosystem: OSV_NAMES[p.ecosystem], name: p.name }, version: p.version, ...(token ? { page_token: token } : {}) })) });
        if (!Array.isArray(response.results) || response.results.length !== pending.length) throw new Error("OSV batch result count mismatch.");
        const next: typeof pending = [];
        for (const [i, item] of response.results.entries()) {
          if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(k => !["vulns", "next_page_token"].includes(k)) || (item.vulns !== undefined && !Array.isArray(item.vulns))) throw new Error("Invalid OSV batch item; no clean result is available.");
          const { p } = pending[i]!;
          const ids = result.get(key(p)) ?? [];
          for (const vuln of item.vulns ?? []) { if (typeof vuln?.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(vuln.id)) throw new Error("Invalid OSV advisory id."); ids.push(vuln.id); }
          result.set(key(p), [...new Set(ids)]);
          if (item.next_page_token !== undefined && typeof item.next_page_token !== "string") throw new Error("Invalid OSV pagination token.");
          if (item.next_page_token) {
            const marker = `${key(p)}\0${item.next_page_token}`;
            if (pages.has(marker)) throw new Error("OSV repeated a pagination token.");
            pages.add(marker); next.push({ p, token: item.next_page_token });
          }
        }
        pending = next;
      }
    }
    return result;
  }
  async advisory(id: string): Promise<Advisory> {
    const cached = this.cache.get(id); if (cached) return cached;
    const item = await this.json(`vulns/${encodeURIComponent(id)}`);
    if (item.id !== id || !Array.isArray(item.affected)) throw new Error("Incomplete OSV advisory record.");
    if (item.withdrawn !== undefined && (typeof item.withdrawn !== "string" || !Number.isFinite(Date.parse(item.withdrawn)))) throw new Error("Invalid OSV withdrawal timestamp.");
    for (const affected of item.affected) if (typeof affected?.package?.name !== "string" || typeof affected?.package?.ecosystem !== "string" || (affected.ranges !== undefined && !Array.isArray(affected.ranges))) throw new Error("Invalid affected package in OSV record.");
    const advisory: Advisory = { id, summary: String(item.summary ?? id).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500), aliases: Array.isArray(item.aliases) ? item.aliases.filter((s: unknown) => typeof s === "string" && s.length < 200) : [], affected: item.affected, ...(typeof item.withdrawn === "string" ? { withdrawn: item.withdrawn } : {}) };
    this.cache.set(id, advisory); return advisory;
  }
  async scan(inventory: Inventory): Promise<DependencyScan> {
    const ids = await this.ids(inventory.packages);
    const records = [...new Set([...ids.values()].flat())];
    if (records.length > 1000) throw new Error("More than 1,000 advisory records; automatic planning is unavailable.");
    for (let at = 0; at < records.length; at += 4) await Promise.all(records.slice(at, at + 4).map(id => this.advisory(id)));
    const findings: Finding[] = [];
    for (const pkg of inventory.packages) for (const id of ids.get(`${pkg.ecosystem}\0${pkg.name}\0${pkg.version}`) ?? []) {
      const advisory = this.cache.get(id)!;
      if (!advisory.withdrawn) findings.push({ package: pkg, advisory });
    }
    const blocked: string[] = [], planned = new Map<string, Change>();
    for (const finding of findings) {
      const { package: pkg, advisory } = finding;
      const current = comparableVersion(pkg.version, pkg.ecosystem);
      const fixed = advisory.affected.filter(a => a.package.ecosystem === OSV_NAMES[pkg.ecosystem] && a.package.name === pkg.name).flatMap(a => (a.ranges ?? []).flatMap(r => (r.events ?? []).flatMap(e => typeof e.fixed === "string" ? [{ raw: e.fixed, version: comparableVersion(e.fixed, pkg.ecosystem) }] : []))).filter((v): v is { raw: string; version: string } => !!v.version && !semver.prerelease(v.version) && !!current && semver.gt(v.version, current) && semver.major(v.version) === semver.major(current) && (semver.major(current) !== 0 || semver.minor(v.version) === semver.minor(current))).sort((a, b) => semver.compare(a.version, b.version));
      if (!current || !fixed.length) { blocked.push(`${pkg.name}@${pkg.version}: ${advisory.id} has no supported same-major fixed version.`); continue; }
      const key = `${pkg.name}\0${pkg.version}`, previous = planned.get(key), candidate = fixed[0]!;
      planned.set(key, { name: pkg.name, from: pkg.version, to: previous && semver.gt(comparableVersion(previous.to, pkg.ecosystem)!, candidate.version) ? previous.to : candidate.raw, advisories: [...new Set([...(previous?.advisories ?? []), advisory.id])] });
    }
    return { schema: 1, checked_at: new Date().toISOString(), source: "https://osv.dev", status: findings.length ? "vulnerabilities_found" : inventory.limitations.length ? "incomplete" : "no_known_vulnerabilities", inventory, findings, plan: [...planned.values()], blocked: [...new Set(blocked)], note: "Known advisories for the recorded package inventory only. No match is not a security guarantee. Coordinates are sent to OSV; source is not. Major-version fixes, unresolved inventory and unsupported builds require review." };
  }
}
