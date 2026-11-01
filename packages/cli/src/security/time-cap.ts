// The time cap (docs/decisions.md, "Moving dependencies are capped at the fix's publish time"). T is the publish time of
// the fix (the latest, when one change fixes several packages). Every other version a change installs must already be
// in the lockfile or have been published strictly before T (rule 1), and a new dependency whose package first appeared
// less than the base wait before T stops the change (rule 2). The rules are one pure function, used by `ludion judge`
// (npm, pnpm) and on `ludion patch` candidates (npm, Composer), with the release facts fetched below.
// A version published at or after T may still move when it is the same release as a target (the same-release
// exception, docs/decisions.md, "Rule 1's same-release exception").

export type Release = { name: string; version: string };
/**
 * What the same-release exception compares: the publisher's account (null when unknown, or when the registry names no
 * account, as for trusted publishing) and the provenance's source.
 */
export type ReleaseIdentity = { publisher: string | null; provenance: Provenance | null };
/**
 * Build provenance as the registry recorded it (npm-facts.ts, provenanceFrom). `repository_id` and `event` are GitHub's
 * numeric repository id and the event that started the run; null (or absent, in facts read before they were) when the
 * statement records none (docs/decisions/2026-10-30-provenance-immutable-id.md).
 */
export type Provenance = { repository: string | null; workflow: string | null; commit: string | null; repository_id?: string | null; event?: string | null };
/** The only GitHub events a release may be published from: none of them runs on input from outside the repository. */
export const PUBLISH_EVENTS = ["push", "release", "workflow_dispatch"];
/** Why a statement's event cannot publish, or null. One with a repository id but no event cannot be told apart, so it has a reason. */
export function eventProblem(p: Provenance): string | null {
  const event = p.event ?? null;
  if (event === null) return (p.repository_id ?? null) === null ? null : "records a GitHub repository id but no triggering event";
  return PUBLISH_EVENTS.includes(event) ? null : `was published from a GitHub ${event} event, not push, release or workflow_dispatch`;
}
/** The two statements' repository ids: the same, different, recorded on one side only, or on neither (compared by name only). */
export function repositoryIds(a: Provenance, b: Provenance): "same" | "differ" | "one" | "none" {
  const x = a.repository_id ?? null, y = b.repository_id ?? null;
  return x === null && y === null ? "none" : x === null || y === null ? "one" : x === y ? "same" : "differ";
}
/** A version published at or after T that the exception allows, the target it belongs with, and why. */
export type SameRelease = { version: string; target: string; basis: "provenance" | "publisher"; by_id?: boolean };
/** Without provenance, a sibling must be published at most this long after its target (and so after T). */
export const SAME_RELEASE_MINUTES = 15;

/**
 * Is a version published at or after T the same release as a target? With provenance on both: the same repository,
 * workflow, commit and repository id (neither recording an id: compared without it), neither recorded as published from another event than push, release
 * or workflow_dispatch. Without provenance on either: the same publisher, the same version number, and at most 15 minutes
 * after the target (T is the latest target, so also after T). Provenance on only one side, a record naming no
 * repository, workflow or commit, or an unknown publisher: no.
 */
export function sameRelease(target: { version: string; published: number; identity: ReleaseIdentity }, other: { version: string; published: number; identity: ReleaseIdentity }, t: number): SameRelease["basis"] | null {
  const a = target.identity.provenance, b = other.identity.provenance;
  if (a && b) return a.repository && a.workflow && a.commit && a.repository === b.repository && a.workflow === b.workflow && a.commit === b.commit && ["same", "none"].includes(repositoryIds(a, b)) && !eventProblem(a) && !eventProblem(b) ? "provenance" : null;
  if (a || b) return null;
  const within = other.published >= t && other.published - target.published <= SAME_RELEASE_MINUTES * 60_000;
  return target.identity.publisher && target.identity.publisher === other.identity.publisher && target.version === other.version && within ? "publisher" : null;
}

export type TimeCap = {
  /** T: the latest publish time of the targets; null when it cannot be known. */
  t: string | null;
  targets: string[];
  /** Versions other than the targets, not in the lockfile before, published at or after T, and not the same release as a target. */
  after_t: string[];
  /** Versions published at or after T that the same-release exception allows. */
  same_release: SameRelease[];
  /** New dependencies whose package first appeared later than T minus the base wait. */
  young: string[];
  /** Why the cap could not be checked; each makes the change undecidable. */
  undecidable: string[];
  wait_hours: number;
};

export function timeCap(input: {
  targets: Release[];
  /** Every other version the change installs. */
  others: Release[];
  /** `name@version` of everything in the lockfile before the change. */
  locked: Set<string>;
  /** Package names newly declared by a changed version, or new to the lockfile. */
  newDependencies: string[];
  published: (name: string, version: string) => string | null | undefined;
  created: (name: string) => string | null | undefined;
  /** Publisher and provenance per version, for the same-release exception; without it, nothing after T is allowed. */
  identity?: (name: string, version: string) => ReleaseIdentity | undefined;
  /** The base wait of the change's urgency, before any extension. */
  waitHours: number;
}): TimeCap {
  const out: TimeCap = { t: null, targets: input.targets.map(r => `${r.name}@${r.version}`).sort(), after_t: [], same_release: [], young: [], undecidable: [], wait_hours: input.waitHours };
  if (!input.targets.length) { out.undecidable.push("The change names no fixed package and no direct dependency, so T (the fix's publish time) is unknown."); return out; }
  let t = -Infinity;
  for (const r of input.targets) {
    const at = Date.parse(input.published(r.name, r.version) ?? "");
    if (!Number.isFinite(at)) { out.undecidable.push(`${r.name}@${r.version} has no publish time, so T is unknown.`); continue; }
    t = Math.max(t, at);
  }
  if (out.undecidable.length) return out;
  out.t = new Date(t).toISOString();
  const targets = new Set(out.targets);
  for (const r of input.others) {
    const id = `${r.name}@${r.version}`;
    if (targets.has(id) || input.locked.has(id)) continue;
    const at = Date.parse(input.published(r.name, r.version) ?? "");
    if (!Number.isFinite(at)) { out.undecidable.push(`${id} has no publish time; it cannot be checked against T.`); continue; }
    if (at < t || out.after_t.includes(id) || out.same_release.some(s => s.version === id)) continue;
    const identity = input.identity?.(r.name, r.version);
    const sibling = identity && input.targets.map(target => {
      const own = input.identity!(target.name, target.version);
      const basis = own && sameRelease({ version: target.version, published: Date.parse(input.published(target.name, target.version)!), identity: own }, { version: r.version, published: at, identity }, t);
      return basis ? { version: id, target: `${target.name}@${target.version}`, basis, ...(basis === "provenance" ? { by_id: repositoryIds(own.provenance!, identity.provenance!) === "same" } : {}) } : null;
    }).find(s => s !== null);
    if (sibling) out.same_release.push(sibling);
    else out.after_t.push(id);
  }
  for (const name of [...new Set(input.newDependencies)].sort()) {
    const at = Date.parse(input.created(name) ?? "");
    if (!Number.isFinite(at)) out.undecidable.push(`The first publish of ${name}, a new dependency, is unknown.`);
    else if (at > t - input.waitHours * 3_600_000) out.young.push(`${name} (first published ${new Date(at).toISOString()})`);
  }
  out.after_t = [...new Set(out.after_t)].sort();
  out.same_release.sort((a, b) => a.version.localeCompare(b.version));
  return out;
}

/** The cap as comment lines. Always shows the count, including 0, and each version the same-release exception allows. */
export function renderTimeCap(cap: TimeCap): string[] {
  const lines = [`Published at or after T (${cap.t ?? "unknown"}, the fix's publish time): ${cap.t ? cap.after_t.length + cap.same_release.length : "unknown"} version(s)`];
  for (const v of cap.after_t) lines.push(`  ${v}`);
  for (const s of cap.same_release) lines.push(`  ${s.version}: allowed, the same release as ${s.target} (${s.basis === "provenance" ? (s.by_id === true ? "provenance names the same repository, workflow, commit and repository id" : "provenance names the same repository, workflow and commit; neither records a repository id, so not compared by ID") : `no provenance; same publisher and version, at most ${SAME_RELEASE_MINUTES} minutes after it`})`);
  return lines;
}

/** What a registry says about one package's releases. */
export type Releases = {
  created: string | null; published: Map<string, string>; requires: Map<string, string[]>;
  /** npm: the registry document's `time.modified` (a publish, a deprecation or an unpublish moves it); read by `ludion check`. */
  modified?: string | null;
};

async function boundedJson(fetchFn: typeof fetch, url: string, maxBytes: number): Promise<any> {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(30_000), headers: { accept: "application/json", "user-agent": "Ludion-Security-Preview" } });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`${new URL(url).hostname} answered HTTP ${res.status}; the time cap cannot be checked.`); }
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

/**
 * When an npm package first appeared: the earliest of `time.created` and every version's publish time. A package that
 * was unpublished and created again gets a new `created`, while its old versions keep their times.
 */
export function firstPublish(time: Record<string, unknown>): string | null {
  const times = Object.entries(time).filter(([key, at]) => key !== "modified" && key !== "unpublished" && typeof at === "string").map(([, at]) => Date.parse(at as string)).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
/** npm: the registry's `time` (publish times and `created`) and each version's declared dependencies. */
export async function npmReleases(name: string, fetchFn: typeof fetch = fetch): Promise<Releases> {
  if (!NPM_NAME.test(name) || name.length > 214) throw new Error(`Invalid npm package name: ${name}`);
  const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const doc = await boundedJson(fetchFn, `https://registry.npmjs.org/${path}`, 64 * 1024 * 1024);
  if (!doc || typeof doc.time !== "object" || typeof doc.versions !== "object") throw new Error(`Invalid registry document for ${name}.`);
  const published = new Map<string, string>(), requires = new Map<string, string[]>();
  for (const [version, at] of Object.entries(doc.time)) if (version !== "created" && version !== "modified" && typeof at === "string") published.set(version, at);
  for (const [version, manifest] of Object.entries<any>(doc.versions)) requires.set(version, Object.keys({ ...manifest?.dependencies, ...manifest?.optionalDependencies }).sort());
  return { created: firstPublish(doc.time), published, requires, modified: typeof doc.time.modified === "string" ? doc.time.modified : null };
}

const COMPOSER_NAME = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/;
/** Without a leading "v", so "v1.2.3" in a lockfile and "1.2.3" on Packagist are one version. */
export const composerVersion = (version: string) => version.replace(/^v(?=\d)/, "");
/**
 * Composer: Packagist's metadata for tagged releases (`time`, `require`). The minified format lists only what changed
 * from the previous entry; "__unset" removes a key. Packagist's `time` is the release's commit or tag date, which its
 * author sets: a backdated release is not caught by the cap (docs/decisions.md).
 */
export async function packagistReleases(name: string, fetchFn: typeof fetch = fetch): Promise<Releases> {
  if (!COMPOSER_NAME.test(name)) throw new Error(`Invalid Composer package name: ${name}`);
  const doc = await boundedJson(fetchFn, `https://repo.packagist.org/p2/${name}.json`, 32 * 1024 * 1024);
  const list = doc?.packages?.[name];
  if (!Array.isArray(list)) throw new Error(`Invalid Packagist metadata for ${name}.`);
  const published = new Map<string, string>(), requires = new Map<string, string[]>();
  let current: Record<string, unknown> = {};
  for (const entry of list) {
    if (!entry || typeof entry !== "object") throw new Error(`Invalid Packagist metadata for ${name}.`);
    current = doc.minified === "composer/2.0" ? { ...current } : {};
    for (const [key, value] of Object.entries(entry)) { if (value === "__unset") delete current[key]; else current[key] = value; }
    if (typeof current.version !== "string") throw new Error(`Invalid Packagist metadata for ${name}.`);
    const version = composerVersion(current.version);
    if (typeof current.time === "string") published.set(version, current.time);
    const require = current.require && typeof current.require === "object" ? Object.keys(current.require).filter(r => r.includes("/")) : [];
    requires.set(version, require.sort());
  }
  const times = [...published.values()].map(Date.parse).filter(Number.isFinite);
  return { created: times.length ? new Date(Math.min(...times)).toISOString() : null, published, requires };
}
