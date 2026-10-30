import semver from "semver";
import { OSV_NAMES, type Package, type Inventory, type Change, type Ecosystem } from "./inventory.ts";
import { affects, packagistAdvisories, PACKAGIST_ADVISORIES } from "./packagist.ts";
import type { ReadOnlyInventory, ReadOnlyPackage } from "./readonly/types.ts";

export function comparableVersion(version: string, ecosystem: Ecosystem): string | null {
  if (ecosystem === "maven") {
    if (!/^\d+(?:\.\d+){0,2}$/.test(version)) return null;
    return semver.valid([...version.split("."), "0", "0"].slice(0, 3).join("."));
  }
  return semver.valid(version);
}

export type Advisory = { id: string; summary: string; aliases: string[]; affected: { package: { ecosystem: string; name: string }; ranges?: { type?: string; events?: { fixed?: string }[] }[]; database_specific?: unknown }[]; withdrawn?: string };
export type Finding = { package: Package; advisory: Advisory };
export type DependencyScan = {
  schema: 1; checked_at: string; source: "https://osv.dev";
  /** Every advisory source read: OSV, and Packagist's advisory API when the inventory has Composer packages. */
  sources: string[]; status: "vulnerabilities_found" | "no_known_vulnerabilities" | "incomplete";
  inventory: Inventory; findings: Finding[]; plan: Change[]; blocked: string[];
  note: string;
};
/**
 * OSV matched this exact name and version. fixed_versions are OSV's own strings, for display only: never compared.
 * kind "informational" is a RustSec unmaintained or notice record: listed, but not counted as a vulnerability.
 */
export type ReadOnlyFinding = { package: ReadOnlyPackage; advisory: Advisory; fixed_versions: string[] } & ({ kind: "vulnerability" } | { kind: "informational"; informational: string });
/** An ecosystem Ludion reads but does not patch: findings only, no plan and no apply. */
export type ReadOnlyScan = {
  schema: 1; checked_at: string; source: "https://osv.dev"; status: "vulnerabilities_found" | "no_known_vulnerabilities" | "incomplete";
  inventory: ReadOnlyInventory; findings: ReadOnlyFinding[]; fixed_versions_note: string; note: string;
};
/** One OSV batch query; ecosystem is OSV's own name (npm, Packagist, Maven, PyPI, Go, crates.io). */
export type OsvQuery = { ecosystem: string; name: string; version: string };
const queryKey = (q: OsvQuery) => `${q.ecosystem}\0${q.name}\0${q.version}`;
const READONLY_ECOSYSTEMS: readonly string[] = ["PyPI", "Go", "crates.io"];
/** Printable ASCII without spaces: what is sent to OSV, and what a terminal shows, for read-only coordinates. */
const PLAIN = /^[\x21-\x7e]+$/;

/** golang.org/x/mod's CheckPath: a lower-case first element with a dot, then elements of [A-Za-z0-9._~-] not starting or ending with a dot. */
function goModulePath(path: string): boolean {
  const elements = path.split("/");
  return /^[a-z0-9][a-z0-9.-]*$/.test(elements[0]!) && elements[0]!.includes(".") && elements.every(e => /^[A-Za-z0-9._~-]+$/.test(e) && !e.startsWith(".") && !e.endsWith("."));
}
/**
 * The names each ecosystem can have, so a reader that passes on something else (an extra, a marker, a path) fails
 * closed here instead of becoming a query that matches nothing.
 */
const VALID_NAME: Record<string, (name: string) => boolean> = {
  // PEP 508 names: no extras, markers or version specifiers.
  PyPI: name => name.length <= 240 && /^([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9])$/.test(name),
  // A module path, or the names OSV gives the standard library and the go command.
  Go: name => name.length <= 240 && (name === "stdlib" || name === "toolchain" || goModulePath(name)),
  "crates.io": name => /^[A-Za-z0-9_-]{1,64}$/.test(name),
};
/** PEP 503: PyPI names compare case-insensitively, with runs of -, _ and . equal. */
const pep503 = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");
const sameName = (ecosystem: string, a: string, b: string) => ecosystem === "PyPI" ? pep503(a) === pep503(b) : a === b;
/** "unsound" is not here: an unsound API is a memory-safety bug, and counts as a vulnerability. */
const RUSTSEC_INFORMATIONAL = ["unmaintained", "notice"];
/**
 * RustSec's informational kind for this package, or null when the advisory counts as a vulnerability. Only a RUSTSEC
 * record can be informational, every OSV entry for the package must carry an informational kind, and a record with a
 * CVE or GHSA alias counts as a vulnerability whatever it says (OSV may not have that alias's own record yet).
 */
function informational(advisory: Advisory, ecosystem: string, name: string): string | null {
  if (ecosystem !== "crates.io" || !/^RUSTSEC-/.test(advisory.id) || advisory.aliases.some(id => /^(CVE|GHSA)-/i.test(id))) return null;
  const kinds = advisory.affected.filter(a => a.package.ecosystem === ecosystem && sameName(ecosystem, a.package.name, name)).map(a => {
    const specific = a.database_specific;
    const kind = specific && typeof specific === "object" && !Array.isArray(specific) ? (specific as Record<string, unknown>).informational : undefined;
    return typeof kind === "string" && RUSTSEC_INFORMATIONAL.includes(kind) ? kind : null;
  });
  return kinds.length && kinds.every(k => k !== null) ? [...new Set(kinds)].join(", ") : null;
}
/**
 * The fixed versions OSV gives for one package, in OSV's order, as plain strings. Only SEMVER and ECOSYSTEM ranges hold
 * versions (a GIT range holds commits). Nothing here compares versions: PEP 440 and Go versions are not semver.
 */
function fixedVersions(advisory: Advisory, ecosystem: string, name: string): string[] {
  const fixed = new Set<string>();
  for (const affected of advisory.affected) {
    if (affected.package.ecosystem !== ecosystem || !sameName(ecosystem, affected.package.name, name)) continue;
    for (const range of affected.ranges ?? []) {
      if (!range || typeof range !== "object" || (range.events !== undefined && !Array.isArray(range.events))) throw new Error(`Invalid range in OSV advisory ${advisory.id}.`);
      if (range.type !== "SEMVER" && range.type !== "ECOSYSTEM") continue;
      for (const event of range.events ?? []) {
        if (!event || typeof event !== "object") throw new Error(`Invalid range event in OSV advisory ${advisory.id}.`);
        if (event.fixed === undefined) continue;
        if (typeof event.fixed !== "string" || event.fixed.length > 100 || !PLAIN.test(event.fixed)) throw new Error(`Invalid fixed version in OSV advisory ${advisory.id}.`);
        fixed.add(event.fixed);
      }
    }
  }
  return [...fixed];
}

/**
 * Every receipt's scan note. It names each host Ludion's code sends a request to, across all its commands, not only the
 * scan's; packages/cli/test/osv-note.test.ts fails when a host in packages/cli/src is missing here, or one here is not there.
 */
export const SCAN_NOTE = "Known advisories for the recorded package inventory only. No match is not a security guarantee. Across its commands, Ludion sends package names and versions to OSV (api.osv.dev), and back to OSV the IDs of the advisories it returned; for npm, to the npm registry (registry.npmjs.org); for Composer, to Packagist (packagist.org, repo.packagist.org), and the archive URLs in composer.lock, which name each package's repository and commit, to their hosts (api.github.com, codeload.github.com, github.com, bitbucket.org); for Maven, to Maven Central (repo.maven.apache.org). For PHP Docker it sends the PHP branch to PHP's release list (www.php.net) and the image tag to Docker Hub (auth.docker.io, registry-1.docker.io), and Docker pulls the images Ludion builds in from Docker Hub. It downloads CISA's catalog of exploited vulnerabilities (www.cisa.gov) and the EPSS list (epss.empiricalsecurity.com) whole, rather than sending them CVE IDs. `ludion deliver open` pushes each fix's commit to the project's own GitHub repository and opens its PR there; no other source is sent. Major-version fixes, unresolved inventory and unsupported builds require review.";

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
  /** Advisory ids for each query, keyed `${ecosystem}\0${name}\0${version}` with OSV's ecosystem name. */
  async ids(packages: OsvQuery[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const key = queryKey;
    for (let start = 0; start < packages.length; start += 100) {
      let pending = packages.slice(start, start + 100).map(p => ({ p, token: "" }));
      const pages = new Set<string>();
      for (let page = 0; pending.length; page++) {
        if (page >= 20) throw new Error("OSV pagination limit exceeded; scan is incomplete.");
        const response = await this.json("querybatch", { queries: pending.map(({ p, token }) => ({ package: { ecosystem: p.ecosystem, name: p.name }, version: p.version, ...(token ? { page_token: token } : {}) })) });
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
    const ids = await this.ids(inventory.packages.map(p => ({ ecosystem: OSV_NAMES[p.ecosystem], name: p.name, version: p.version })));
    const records = [...new Set([...ids.values()].flat())];
    if (records.length > 1000) throw new Error("More than 1,000 advisory records; automatic planning is unavailable.");
    for (let at = 0; at < records.length; at += 4) await Promise.all(records.slice(at, at + 4).map(id => this.advisory(id)));
    const findings: Finding[] = [];
    for (const pkg of inventory.packages) for (const id of ids.get(`${OSV_NAMES[pkg.ecosystem]}\0${pkg.name}\0${pkg.version}`) ?? []) {
      const advisory = this.cache.get(id)!;
      if (!advisory.withdrawn) findings.push({ package: pkg, advisory });
    }
    // Composer: Packagist's advisories too. Planning takes the later fix of the two sources for each package.
    const blocked: string[] = [], unreadable: string[] = [], planned = new Map<string, Change>();
    const composer = inventory.packages.filter(p => p.ecosystem === "composer");
    const packagist = composer.length ? await packagistAdvisories(this.fetchFn, [...new Set(composer.map(p => p.name))]) : [];
    const packagistFor = (name: string) => packagist.filter(a => a.advisory.affected[0]!.package.name === name);
    for (const pkg of composer) for (const item of packagistFor(pkg.name)) {
      if (!item.constraint) unreadable.push(`${pkg.name}@${pkg.version}: Packagist advisory ${item.advisory.id} has affected versions Ludion cannot read; review it by hand.`);
      else if (affects(item.constraint, pkg.version)) findings.push({ package: pkg, advisory: item.advisory });
    }
    for (const finding of findings) {
      const { package: pkg, advisory } = finding;
      const current = comparableVersion(pkg.version, pkg.ecosystem);
      const fixed = advisory.affected.filter(a => a.package.ecosystem === OSV_NAMES[pkg.ecosystem] && a.package.name === pkg.name).flatMap(a => (a.ranges ?? []).flatMap(r => (r.events ?? []).flatMap(e => typeof e.fixed === "string" ? [{ raw: e.fixed, version: comparableVersion(e.fixed, pkg.ecosystem) }] : []))).filter((v): v is { raw: string; version: string } => !!v.version && !semver.prerelease(v.version) && !!current && semver.gt(v.version, current) && semver.major(v.version) === semver.major(current) && (semver.major(current) !== 0 || semver.minor(v.version) === semver.minor(current))).sort((a, b) => semver.compare(a.version, b.version));
      if (!current || !fixed.length) { blocked.push(`${pkg.name}@${pkg.version}: ${advisory.id} has no supported same-major fixed version.`); continue; }
      const key = `${pkg.name}\0${pkg.version}`, previous = planned.get(key), candidate = fixed[0]!;
      planned.set(key, { name: pkg.name, from: pkg.version, to: previous && semver.gt(comparableVersion(previous.to, pkg.ecosystem)!, candidate.version) ? previous.to : candidate.raw, advisories: [...new Set([...(previous?.advisories ?? []), advisory.id])] });
    }
    // A planned Composer version that Packagist still lists as affected moves to the end of that range, or is blocked.
    for (const [key, change] of planned) {
      if (!composer.some(p => p.name === change.name)) continue;
      const from = comparableVersion(change.from, "composer")!;
      for (let round = 0; ; round++) {
        const to = comparableVersion(change.to, "composer")!;
        const still = packagistFor(change.name).filter(a => a.constraint && affects(a.constraint, to));
        if (!still.length) break;
        const next = still.flatMap(a => a.constraint!.filter(alternative => affects([alternative], to)).flatMap(alternative => alternative.filter(t => t.op === "<").map(t => t.version))).filter(v => semver.gt(v, to) && semver.major(v) === semver.major(from) && (semver.major(from) !== 0 || semver.minor(v) === semver.minor(from))).sort(semver.compare);
        if (round >= 20 || !next.length) { planned.delete(key); blocked.push(`${change.name}@${change.from}: Packagist lists ${change.to} as affected (${still.map(a => a.advisory.id).join(", ")}) and gives no supported same-major fixed version.`); break; }
        change.to = next.at(-1)!; change.advisories = [...new Set([...change.advisories, ...still.map(a => a.advisory.id)])];
      }
    }
    return { schema: 1, checked_at: new Date().toISOString(), source: "https://osv.dev", sources: composer.length ? ["https://osv.dev", PACKAGIST_ADVISORIES] : ["https://osv.dev"], status: findings.length ? "vulnerabilities_found" : inventory.limitations.length || unreadable.length ? "incomplete" : "no_known_vulnerabilities", inventory, findings, plan: [...planned.values()], blocked: [...new Set([...unreadable, ...blocked])], note: SCAN_NOTE };
  }
  /**
   * Known advisories for an inventory Ludion reads but does not patch (PyPI, Go, crates.io): OSV's match on the exact
   * name and version. No version is compared, so there is no plan and nothing to apply.
   */
  async scanReadOnly(inventory: ReadOnlyInventory): Promise<ReadOnlyScan> {
    const ecosystem = inventory.ecosystem;
    if (!READONLY_ECOSYSTEMS.includes(ecosystem) || !Array.isArray(inventory.packages) || !Array.isArray(inventory.limitations) || !Array.isArray(inventory.files)) throw new Error("Invalid read-only inventory.");
    if (inventory.packages.length > 2000) throw new Error("Advisory scan exceeds 2,000 distinct installed package versions.");
    // One query per package and version (PyPI names by PEP 503); listed twice, it is direct if either entry is.
    const unique = new Map<string, ReadOnlyPackage>();
    for (const pkg of inventory.packages) {
      if (typeof pkg?.name !== "string" || !VALID_NAME[ecosystem]!(pkg.name) || typeof pkg.version !== "string" || pkg.version.length > 100 || !PLAIN.test(pkg.version) || typeof pkg.direct !== "boolean") throw new Error(`Invalid ${ecosystem} package coordinate ${JSON.stringify(`${String(pkg?.name).slice(0, 100)}@${String(pkg?.version).slice(0, 100)}`)}; no clean result is available.`);
      const key = queryKey({ ecosystem, name: ecosystem === "PyPI" ? pep503(pkg.name) : pkg.name, version: pkg.version });
      const seen = unique.get(key);
      unique.set(key, seen ? { ...seen, direct: seen.direct || pkg.direct } : { ...pkg });
    }
    const ids = await this.ids([...unique.values()].map(p => ({ ecosystem, name: p.name, version: p.version })));
    const records = [...new Set([...ids.values()].flat())];
    if (records.length > 1000) throw new Error("More than 1,000 advisory records; the read-only scan is incomplete.");
    for (let at = 0; at < records.length; at += 4) await Promise.all(records.slice(at, at + 4).map(id => this.advisory(id)));
    const findings: ReadOnlyFinding[] = [];
    for (const pkg of unique.values()) for (const id of ids.get(queryKey({ ecosystem, name: pkg.name, version: pkg.version })) ?? []) {
      const advisory = this.cache.get(id)!;
      if (advisory.withdrawn) continue;
      const fixed_versions = fixedVersions(advisory, ecosystem, pkg.name), kind = informational(advisory, ecosystem, pkg.name);
      findings.push(kind !== null ? { package: pkg, advisory, fixed_versions, kind: "informational", informational: kind } : { package: pkg, advisory, fixed_versions, kind: "vulnerability" });
    }
    return {
      schema: 1, checked_at: new Date().toISOString(), source: "https://osv.dev",
      status: findings.some(f => f.kind === "vulnerability") ? "vulnerabilities_found" : inventory.limitations.length ? "incomplete" : "no_known_vulnerabilities",
      inventory, findings,
      fixed_versions_note: `Each finding's fixed_versions are the fixed versions OSV gives for that ${ecosystem} package, copied as plain strings for display. Ludion does not compare them with the installed version, so it does not say which one applies or whether one is newer.`,
      note: `Read-only: Ludion reports known advisories for this ecosystem but does not plan or apply updates. Only the exact package names and versions read from the files are looked up; no match is not a security guarantee. Package names and versions are sent to OSV; source is not.${ecosystem === "crates.io" ? " RustSec advisories marked unmaintained or notice are listed with kind \"informational\" and do not count as vulnerabilities, unless they have a CVE or GHSA alias. Unsound ones count as vulnerabilities." : ""}`,
    };
  }
}
