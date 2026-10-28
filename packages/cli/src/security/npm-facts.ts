// Live facts for the judge: npm registry metadata and attestations, OSV (malicious records and advisories),
// CISA KEV and FIRST EPSS. Fixed origins, bounded bodies and deadlines. A failed lookup throws; `ludion judge` then
// reports the judgement as undecidable, never as a pass. Only package names, versions and
// advisory ids leave the machine.
import { installScripts, type Change, type FixedAdvisory, type VersionFacts } from "./judge.ts";

type Fetch = typeof fetch;

async function boundedJson(fetchFn: Fetch, url: string, init: RequestInit = {}, maxBytes = 64 * 1024 * 1024): Promise<any> {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(30_000), ...init, headers: { accept: "application/json", "user-agent": "Ludion-Judge", ...(init.headers ?? {}) } });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw Object.assign(new Error(`${new URL(url).hostname} answered HTTP ${res.status}.`), { status: res.status }); }
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`Empty response from ${new URL(url).hostname}.`);
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
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const registryPath = (name: string) => {
  if (!NAME.test(name) || name.length > 214) throw new Error(`Invalid npm package name: ${name}`);
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
};

/** Repository and workflow from an SLSA provenance statement (v1 or v0.2), as the registry recorded it. */
export function provenanceFrom(attestations: unknown): { repository: string | null; workflow: string | null } | null {
  const list = (attestations as { attestations?: unknown })?.attestations;
  if (!Array.isArray(list)) throw new Error("Invalid attestations record.");
  const slsa = list.find(a => typeof a?.predicateType === "string" && a.predicateType.startsWith("https://slsa.dev/provenance/"));
  if (!slsa) return null;
  const payload = slsa.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== "string") throw new Error("Provenance attestation has no payload.");
  const predicate = JSON.parse(Buffer.from(payload, "base64").toString("utf8"))?.predicate;
  const workflow = predicate?.buildDefinition?.externalParameters?.workflow;
  if (workflow) return { repository: typeof workflow.repository === "string" ? workflow.repository : null, workflow: typeof workflow.path === "string" ? workflow.path : null };
  const source = predicate?.invocation?.configSource;
  if (source) return { repository: typeof source.uri === "string" ? source.uri.replace(/@.*$/, "").replace(/^git\+/, "") : null, workflow: typeof source.entryPoint === "string" ? source.entryPoint : null };
  return { repository: null, workflow: null };
}

/** Registry facts for the given versions of one package (one packument read, plus one attestation read per version). */
export async function registryFacts(name: string, versions: string[], fetchFn: Fetch = fetch): Promise<Map<string, Omit<VersionFacts, "malicious" | "advisories">>> {
  const doc = await boundedJson(fetchFn, `https://registry.npmjs.org/${registryPath(name)}`);
  if (!doc || typeof doc !== "object" || typeof doc.versions !== "object" || typeof doc.time !== "object") throw new Error(`Invalid registry document for ${name}.`);
  const facts = new Map<string, Omit<VersionFacts, "malicious" | "advisories">>();
  for (const version of versions) {
    const manifest = doc.versions[version];
    const published = typeof doc.time[version] === "string" ? doc.time[version] : null;
    if (!manifest) {
      // Unpublished: the registry keeps only its publish time. Nothing else about it can be compared.
      facts.set(version, { published_at: published, present: false, deprecated: null, publisher: null, provenance: null, install_scripts: [], dependencies: [], integrity: null });
      continue;
    }
    let provenance: VersionFacts["provenance"] = null;
    if (manifest.dist?.attestations) {
      provenance = provenanceFrom(await boundedJson(fetchFn, `https://registry.npmjs.org/-/npm/v1/attestations/${registryPath(name)}@${encodeURIComponent(version)}`, {}, 4 * 1024 * 1024));
    }
    facts.set(version, {
      published_at: published,
      present: true,
      deprecated: typeof manifest.deprecated === "string" && manifest.deprecated ? manifest.deprecated : null,
      publisher: typeof manifest._npmUser?.name === "string" ? manifest._npmUser.name : null,
      provenance,
      install_scripts: installScripts(manifest.scripts),
      dependencies: Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).sort(),
      integrity: typeof manifest.dist?.integrity === "string" ? manifest.dist.integrity : null,
    });
  }
  return facts;
}

/** OSV advisory ids per `name@version` (malicious records included), via the batch API. */
export async function osvIds(packages: { name: string; version: string }[], fetchFn: Fetch = fetch): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (let start = 0; start < packages.length; start += 100) {
    const slice = packages.slice(start, start + 100);
    const body = await boundedJson(fetchFn, "https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: slice.map(p => ({ package: { ecosystem: "npm", name: p.name }, version: p.version })) }) }, 8 * 1024 * 1024);
    if (!Array.isArray(body?.results) || body.results.length !== slice.length) throw new Error("OSV batch result count mismatch.");
    body.results.forEach((item: any, i: number) => {
      if (item?.next_page_token) throw new Error("OSV paginated a judge query; refusing a partial answer.");
      const ids = (item?.vulns ?? []).map((v: any) => v?.id);
      if (!ids.every((id: unknown) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(id))) throw new Error("Invalid OSV advisory id.");
      result.set(`${slice[i]!.name}@${slice[i]!.version}`, ids);
    });
  }
  return result;
}

/** CVE ids in CISA's Known Exploited Vulnerabilities catalog. */
export async function kevCves(fetchFn: Fetch = fetch): Promise<Set<string>> {
  const body = await boundedJson(fetchFn, "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", {}, 32 * 1024 * 1024);
  if (!Array.isArray(body?.vulnerabilities)) throw new Error("Invalid KEV catalog.");
  return new Set(body.vulnerabilities.map((v: any) => v?.cveID).filter((id: unknown): id is string => typeof id === "string"));
}

/** EPSS scores for CVE ids; a CVE FIRST does not list is left out. */
export async function epssScores(cves: string[], fetchFn: Fetch = fetch): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  for (let at = 0; at < cves.length; at += 50) {
    const slice = cves.slice(at, at + 50).filter(c => /^CVE-\d{4}-\d{4,}$/.test(c));
    if (!slice.length) continue;
    const body = await boundedJson(fetchFn, `https://api.first.org/data/v1/epss?cve=${slice.join(",")}`, {}, 4 * 1024 * 1024);
    for (const row of body?.data ?? []) if (typeof row?.cve === "string" && Number.isFinite(Number(row.epss))) scores.set(row.cve, Number(row.epss));
  }
  return scores;
}

/** Everything the judge needs for one lockfile change, fetched live. */
export async function gatherFacts(changes: Change[], fetchFn: Fetch = fetch, also: { name: string; version: string }[] = []): Promise<{ facts: Map<string, VersionFacts>; fixes: FixedAdvisory[] }> {
  const wanted = new Map<string, Set<string>>();
  const want = (name: string, version: string) => { const set = wanted.get(name) ?? new Set<string>(); set.add(version); wanted.set(name, set); };
  for (const c of changes) { want(c.name, c.to); if (c.from) want(c.name, c.from); }
  // Other entries gate 4 checks (re-pointed or second copies): their registry integrity is needed too.
  for (const e of also) want(e.name, e.version);
  const all = [...wanted].flatMap(([name, versions]) => [...versions].map(version => ({ name, version })));
  const ids = await osvIds(all, fetchFn);
  const facts = new Map<string, VersionFacts>();
  for (const [name, versions] of wanted) {
    const registry = await registryFacts(name, [...versions], fetchFn);
    for (const [version, fact] of registry) {
      const all = ids.get(`${name}@${version}`) ?? [];
      facts.set(`${name}@${version}`, { ...fact, malicious: all.filter(id => id.startsWith("MAL-")), advisories: all.filter(id => !id.startsWith("MAL-")) });
    }
  }
  // A fix: an advisory on the version before that no longer names the version after.
  const fixed: { id: string; package: string }[] = [];
  for (const c of changes) {
    if (!c.from) continue;
    const after = new Set(ids.get(`${c.name}@${c.to}`) ?? []);
    for (const id of ids.get(`${c.name}@${c.from}`) ?? []) if (!id.startsWith("MAL-") && !after.has(id)) fixed.push({ id, package: c.name });
  }
  const records = new Map<string, { aliases: string[]; severity: string | null }>();
  for (const id of new Set(fixed.map(f => f.id))) {
    const record = await boundedJson(fetchFn, `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {}, 4 * 1024 * 1024);
    records.set(id, {
      aliases: Array.isArray(record?.aliases) ? record.aliases.filter((a: unknown): a is string => typeof a === "string") : [],
      severity: typeof record?.database_specific?.severity === "string" ? record.database_specific.severity : null,
    });
  }
  const cves = [...new Set([...records.values()].flatMap(r => r.aliases).filter(a => a.startsWith("CVE-")))];
  const kev = fixed.length ? await kevCves(fetchFn) : new Set<string>();
  const epss = cves.length ? await epssScores(cves, fetchFn) : new Map<string, number>();
  const fixes = fixed.map(f => {
    const r = records.get(f.id)!;
    const cveScores = r.aliases.map(a => epss.get(a)).filter((s): s is number => s !== undefined);
    return { id: f.id, package: f.package, aliases: r.aliases, severity: r.severity, kev: r.aliases.some(a => kev.has(a)), epss: cveScores.length ? Math.max(...cveScores) : null };
  });
  return { facts, fixes };
}
