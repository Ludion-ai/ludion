// Live facts for the judge: npm registry metadata and attestations, OSV (malicious records and advisories),
// CISA KEV and FIRST EPSS. Fixed origins, bounded bodies and deadlines. A failed lookup throws; `ludion judge` then
// reports the judgement as undecidable, never as a pass. Only package names, versions and the ids of the advisories
// OSV returned leave the machine; CISA's and FIRST's lists are downloaded whole and looked up here.
import { gunzipSync } from "node:zlib";
import { installScripts, type Change, type FixedAdvisory, type VersionFacts } from "./judge.ts";
import { firstPublish, npmReleases } from "./time-cap.ts";

type Fetch = typeof fetch;

async function boundedJson(fetchFn: Fetch, url: string, init: RequestInit = {}, maxBytes = 64 * 1024 * 1024): Promise<any> {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(30_000), ...init, headers: { accept: "application/json", "user-agent": "Ludion-Judge", ...(init.headers ?? {}) } });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw Object.assign(new Error(`${new URL(url).hostname} answered HTTP ${res.status}.`), { status: res.status }); }
  return JSON.parse((await boundedBody(res, new URL(url).hostname, maxBytes)).toString("utf8"));
}

/** A response body of at most maxBytes. An aborted signal also ends a read that has stalled, and throws. */
async function boundedBody(res: Response, host: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`Empty response from ${host}.`);
  const stop = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", stop);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error(`Response from ${host} exceeds ${maxBytes} bytes.`);
      chunks.push(value);
    }
  } finally { signal?.removeEventListener("abort", stop); await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const registryPath = (name: string) => {
  if (!NAME.test(name) || name.length > 214) throw new Error(`Invalid npm package name: ${name}`);
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
};

const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const commitOf = (digest: unknown, key: string) => { const value = (digest as Record<string, unknown> | undefined)?.[key]; return typeof value === "string" && COMMIT.test(value) ? value : null; };
/**
 * A v0.2 source URI without its `@ref`: the first `@` after the host's first path slash starts the ref (owner and
 * repository names have none; a tag such as `@scope/pkg@1.2.3` does).
 */
const withoutRef = (uri: string) => {
  const u = uri.replace(/^git\+/, ""), path = u.indexOf("/", u.indexOf("://") + 3), at = path > 0 ? u.indexOf("@", path) : -1;
  return at > path ? u.slice(0, at) : u;
};
/**
 * Repository, workflow and source commit from an SLSA provenance statement (v1 or v0.2), as the registry recorded it.
 * The commit is v1's first resolved dependency (`gitCommit`) or v0.2's config source (`sha1`). Given the version and
 * its registry integrity, the statement must name that version and that tarball (its subject), or it is refused.
 */
export function provenanceFrom(attestations: unknown, subject?: { name: string; version: string; integrity: string | null }): { repository: string | null; workflow: string | null; commit: string | null } | null {
  const list = (attestations as { attestations?: unknown })?.attestations;
  if (!Array.isArray(list)) throw new Error("Invalid attestations record.");
  const slsa = list.find(a => typeof a?.predicateType === "string" && a.predicateType.startsWith("https://slsa.dev/provenance/"));
  if (!slsa) return null;
  const payload = slsa.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== "string") throw new Error("Provenance attestation has no payload.");
  const statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  if (subject) {
    const purl = `pkg:npm/${subject.name.replace(/^@/, "%40")}@${subject.version}`;
    const sha512 = subject.integrity?.startsWith("sha512-") ? Buffer.from(subject.integrity.slice(7), "base64").toString("hex") : null;
    if (!sha512 || !Array.isArray(statement?.subject) || !statement.subject.some((s: any) => s?.name === purl && s?.digest?.sha512 === sha512)) throw new Error(`The provenance statement does not name ${subject.name}@${subject.version} and its tarball.`);
  }
  const predicate = statement?.predicate;
  const workflow = predicate?.buildDefinition?.externalParameters?.workflow;
  const resolved = predicate?.buildDefinition?.resolvedDependencies;
  const v1Commit = Array.isArray(resolved) ? commitOf(resolved[0]?.digest, "gitCommit") : null;
  if (workflow) return { repository: typeof workflow.repository === "string" ? workflow.repository : null, workflow: typeof workflow.path === "string" ? workflow.path : null, commit: v1Commit };
  const source = predicate?.invocation?.configSource;
  if (source) return { repository: typeof source.uri === "string" ? withoutRef(source.uri) : null, workflow: typeof source.entryPoint === "string" ? source.entryPoint : null, commit: commitOf(source.digest, "sha1") };
  return { repository: null, workflow: null, commit: v1Commit };
}

/**
 * Does the registry's user name no single account? npm trusted publishing records a shared user ("GitHub Actions",
 * `npm-oidc-no-reply@github.com`, with `trustedPublisher`) for every package published that way. Any name outside
 * `[a-z0-9][a-z0-9._-]*` (uppercase or spaces, but also a leading `_` or `-`, or `!~*'()`) is treated the same, so a
 * shared user with such a name fails closed. A shared CI account with a plain lowercase name and neither marker still
 * counts as an account.
 */
export const sharedPublisher = (npmUser: any) => !!npmUser?.trustedPublisher || (typeof npmUser?.email === "string" && npmUser.email.startsWith("npm-oidc-no-reply@")) || (typeof npmUser?.name === "string" && !/^[a-z0-9][a-z0-9._-]*$/.test(npmUser.name));

/** Registry facts for the given versions of one package (one packument read, plus one attestation read per version). */
export async function registryFacts(name: string, versions: string[], fetchFn: Fetch = fetch): Promise<Map<string, Omit<VersionFacts, "malicious" | "advisories">>> {
  const doc = await boundedJson(fetchFn, `https://registry.npmjs.org/${registryPath(name)}`);
  if (!doc || typeof doc !== "object" || typeof doc.versions !== "object" || typeof doc.time !== "object") throw new Error(`Invalid registry document for ${name}.`);
  const facts = new Map<string, Omit<VersionFacts, "malicious" | "advisories">>();
  const created = firstPublish(doc.time);
  for (const version of versions) {
    const manifest = doc.versions[version];
    const published = typeof doc.time[version] === "string" ? doc.time[version] : null;
    if (!manifest) {
      // Unpublished: the registry keeps only its publish time. Nothing else about it can be compared.
      facts.set(version, { published_at: published, present: false, deprecated: null, publisher: null, shared_publisher: false, provenance: null, install_scripts: [], dependencies: [], integrity: null, package_created: created });
      continue;
    }
    const integrity = typeof manifest.dist?.integrity === "string" ? manifest.dist.integrity : null;
    let provenance: VersionFacts["provenance"] = null;
    if (manifest.dist?.attestations) {
      provenance = provenanceFrom(await boundedJson(fetchFn, `https://registry.npmjs.org/-/npm/v1/attestations/${registryPath(name)}@${encodeURIComponent(version)}`, {}, 4 * 1024 * 1024), { name, version, integrity });
    }
    facts.set(version, {
      published_at: published,
      present: true,
      deprecated: typeof manifest.deprecated === "string" && manifest.deprecated ? manifest.deprecated : null,
      publisher: typeof manifest._npmUser?.name === "string" ? manifest._npmUser.name : null,
      shared_publisher: sharedPublisher(manifest._npmUser),
      provenance,
      install_scripts: installScripts(manifest.scripts),
      dependencies: Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).sort(),
      integrity,
      package_created: created,
    });
  }
  return facts;
}

/**
 * Every version the registry still lists for a package (an unpublished one is not), with its deprecation message or null.
 * A version whose manifest is not an object (null, a string) cannot be judged listed or not deprecated, so it throws.
 */
export async function registryVersions(name: string, fetchFn: Fetch = fetch): Promise<Map<string, string | null>> {
  const doc = await boundedJson(fetchFn, `https://registry.npmjs.org/${registryPath(name)}`);
  if (!doc || typeof doc !== "object" || !doc.versions || typeof doc.versions !== "object" || Array.isArray(doc.versions)) throw new Error(`Invalid registry document for ${name}.`);
  return new Map(Object.entries<any>(doc.versions).map(([version, manifest]) => {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`Invalid registry manifest for ${name}@${version.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 100)}.`);
    return [version, typeof manifest.deprecated === "string" && manifest.deprecated ? manifest.deprecated : null];
  }));
}

/**
 * OSV advisory ids per `name@version` (malicious records included), via the batch API. Each item is checked as
 * OsvClient.ids checks it: one that is not an object (null, a number), has a key other than vulns and next_page_token,
 * or has vulns that is not a list ({vulns: null}) throws, rather than reading as no record.
 */
export async function osvIds(packages: { name: string; version: string }[], fetchFn: Fetch = fetch): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (let start = 0; start < packages.length; start += 100) {
    const slice = packages.slice(start, start + 100);
    const body = await boundedJson(fetchFn, "https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: slice.map(p => ({ package: { ecosystem: "npm", name: p.name }, version: p.version })) }) }, 8 * 1024 * 1024);
    if (!Array.isArray(body?.results) || body.results.length !== slice.length) throw new Error("OSV batch result count mismatch.");
    body.results.forEach((item: any, i: number) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(k => !["vulns", "next_page_token"].includes(k)) || (item.vulns !== undefined && !Array.isArray(item.vulns))) throw new Error("Invalid OSV batch item; no clean result is available.");
      if (item.next_page_token !== undefined && typeof item.next_page_token !== "string") throw new Error("Invalid OSV pagination token.");
      if (item.next_page_token) throw new Error("OSV paginated a judge query; refusing a partial answer.");
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

/**
 * FIRST's daily list of every EPSS score, as first.org/epss/data gives it: one fixed URL that redirects to that day's
 * file on the same host. One redirect is followed, to a file on that host named for any day (the list's own
 * score_date, not the name, says how old it is). No other redirect is followed.
 */
export const EPSS_LIST = "https://epss.empiricalsecurity.com/epss_scores-current.csv.gz";
const EPSS_DAY = /^\/epss_scores-\d{4}-\d{2}-\d{2}\.csv\.gz$/;
/** On 2026-10-29 the list was 2,789,117 bytes compressed and 12,088,559 bytes expanded. */
export const EPSS_LIMITS = { compressed: 16 * 1024 * 1024, expanded: 64 * 1024 * 1024, ms: 120_000 };
const SCORE = /^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const SCORE_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):?(\d{2})))?$/;
/** A score_date in the form FIRST writes it, naming a day on the calendar and a time of day (V8's Date.parse takes 2026-02-30). */
const scoreDate = (text: string) => {
  const m = SCORE_DATE.exec(text);
  if (!m) return false;
  const [y, mo, d, h = 0, mi = 0, s = 0, oh = 0, om = 0] = m.slice(1).map(v => v === undefined ? undefined : Number(v));
  const day = new Date(Date.UTC(y!, mo! - 1, d!));
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo! - 1 && day.getUTCDate() === d && h <= 23 && mi <= 59 && s <= 59 && oh <= 23 && om <= 59;
};

/**
 * EPSS scores for CVE ids, looked up in FIRST's whole daily list, so no CVE id is sent; a CVE the list does not have
 * is left out. `date` is the list's own score_date, as written on its first line (null when the list gives none). An
 * old list is not refused: the date is only shown. A list that cannot be fetched, is too large or too slow, has a
 * score_date that is not a date, or has any line that is not a score throws.
 */
export async function epssScores(cves: string[], fetchFn: Fetch = fetch, limits = EPSS_LIMITS): Promise<{ date: string | null; scores: Map<string, number> }> {
  const signal = AbortSignal.timeout(limits.ms);
  const init: RequestInit = { redirect: "manual", signal, headers: { "user-agent": "Ludion-Judge" } };
  const list = new URL(EPSS_LIST);
  let res = await fetchFn(EPSS_LIST, init);
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    let day: URL | null = null;
    try { day = location ? new URL(location, EPSS_LIST) : null; } catch {}
    if (!day || day.origin !== list.origin || !EPSS_DAY.test(day.pathname) || day.search || day.hash || day.username || day.password) throw new Error(`The EPSS list redirected somewhere other than a day's file on ${list.hostname}.`);
    // Fetched with redirect "manual" too: a second redirect is not a 200 and throws below.
    res = await fetchFn(day.href, init);
  }
  if (res.status !== 200) { await res.body?.cancel().catch(() => {}); throw new Error(`${list.hostname} answered HTTP ${res.status} for the EPSS list.`); }
  const compressed = await boundedBody(res, list.hostname, limits.compressed, signal);
  let text: string;
  try { text = gunzipSync(compressed, { maxOutputLength: limits.expanded }).toString("utf8"); } catch (error) { throw new Error(`The EPSS list could not be expanded within ${limits.expanded} bytes: ${error instanceof Error ? error.message : String(error)}`); }
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  // A first line starting with # names the model version and the score date ("#model_version:…,score_date:…").
  let at = 0, date: string | null = null;
  if (lines[0]?.startsWith("#")) {
    const field = lines[0].slice(1).replace(/\r$/, "").split(",").find(f => f.startsWith("score_date:"));
    if (field !== undefined) {
      date = field.slice("score_date:".length);
      if (!scoreDate(date)) throw new Error("The EPSS list's score_date is not a date.");
    }
    at = 1;
  }
  if (lines[at]?.replace(/\r$/, "") !== "cve,epss,percentile") throw new Error("The EPSS list has no cve,epss,percentile header.");
  const wanted = new Set(cves), seen = new Set<string>(), scores = new Map<string, number>();
  for (at++; at < lines.length; at++) {
    const [cve, epss, percentile, extra] = lines[at]!.replace(/\r$/, "").split(",");
    const valid = extra === undefined && cve !== undefined && /^CVE-\d{4}-\d{4,}$/.test(cve) && !seen.has(cve) && [epss, percentile].every(v => v !== undefined && SCORE.test(v) && Number(v) <= 1);
    if (!valid) throw new Error(`The EPSS list's line ${at + 1} is not a score.`);
    seen.add(cve!);
    if (wanted.has(cve!)) scores.set(cve!, Number(epss));
  }
  if (!seen.size) throw new Error("The EPSS list has no scores.");
  return { date, scores };
}

/** Everything the judge needs for one lockfile change, fetched live. */
export async function gatherFacts(changes: Change[], fetchFn: Fetch = fetch, also: { name: string; version: string }[] = []): Promise<{ facts: Map<string, VersionFacts>; fixes: FixedAdvisory[]; created: Map<string, string | null> }> {
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
  // The first publish of every package a changed version newly declares (the time cap's rule 2).
  const created = new Map<string, string | null>();
  for (const [id, f] of facts) created.set(id.slice(0, id.lastIndexOf("@")), f.package_created ?? null);
  for (const c of changes) {
    const next = facts.get(`${c.name}@${c.to}`), prev = c.from ? facts.get(`${c.name}@${c.from}`) : undefined;
    for (const name of next && prev?.present ? next.dependencies.filter(d => !prev.dependencies.includes(d)) : []) if (!created.has(name)) created.set(name, (await npmReleases(name, fetchFn)).created);
  }
  // A fix: an advisory on the version before that no longer names the version after.
  const fixed: { id: string; package: string; from: string; to: string }[] = [];
  for (const c of changes) {
    if (!c.from) continue;
    const after = new Set(ids.get(`${c.name}@${c.to}`) ?? []);
    for (const id of ids.get(`${c.name}@${c.from}`) ?? []) if (!id.startsWith("MAL-") && !after.has(id)) fixed.push({ id, package: c.name, from: c.from, to: c.to });
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
  const epss = cves.length ? await epssScores(cves, fetchFn) : { date: null, scores: new Map<string, number>() };
  const fixes = fixed.map(f => {
    const r = records.get(f.id)!;
    // Of several CVE aliases, the highest score counts.
    const cveScores = r.aliases.map(a => epss.scores.get(a)).filter((s): s is number => s !== undefined);
    const looked = r.aliases.some(a => a.startsWith("CVE-"));
    return { id: f.id, package: f.package, from: f.from, to: f.to, aliases: r.aliases, severity: r.severity, kev: r.aliases.some(a => kev.has(a)), epss: cveScores.length ? Math.max(...cveScores) : null, ...(looked ? { epss_date: epss.date } : {}) };
  });
  return { facts, fixes, created };
}
