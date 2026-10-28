// The time cap (docs/decisions.md, "Moving dependencies are capped at the fix's publish time"). T is the publish time of
// the fix (the latest, when one change fixes several packages). Every other version a change installs must already be
// in the lockfile or have been published strictly before T (rule 1), and a new dependency whose package first appeared
// less than the base wait before T stops the change (rule 2). The rules are one pure function, used by `ludion judge`
// (npm, pnpm) and on `ludion patch` candidates (npm, Composer), with the release facts fetched below.

export type Release = { name: string; version: string };
export type TimeCap = {
  /** T: the latest publish time of the targets; null when it cannot be known. */
  t: string | null;
  targets: string[];
  /** Versions other than the targets, not in the lockfile before, published at or after T. */
  after_t: string[];
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
  /** The base wait of the change's urgency, before any extension. */
  waitHours: number;
}): TimeCap {
  const out: TimeCap = { t: null, targets: input.targets.map(r => `${r.name}@${r.version}`).sort(), after_t: [], young: [], undecidable: [], wait_hours: input.waitHours };
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
    if (!Number.isFinite(at)) out.undecidable.push(`${id} has no publish time; it cannot be checked against T.`);
    else if (at >= t) out.after_t.push(id);
  }
  for (const name of [...new Set(input.newDependencies)].sort()) {
    const at = Date.parse(input.created(name) ?? "");
    if (!Number.isFinite(at)) out.undecidable.push(`The first publish of ${name}, a new dependency, is unknown.`);
    else if (at > t - input.waitHours * 3_600_000) out.young.push(`${name} (first published ${new Date(at).toISOString()})`);
  }
  out.after_t = [...new Set(out.after_t)].sort();
  return out;
}

/** The cap as comment lines. Always shows the count, including 0. */
export function renderTimeCap(cap: TimeCap): string[] {
  const lines = [`Published at or after T (${cap.t ?? "unknown"}, the fix's publish time): ${cap.t ? cap.after_t.length : "unknown"} version(s)`];
  for (const v of cap.after_t) lines.push(`  ${v}`);
  return lines;
}

/** What a registry says about one package's releases. */
export type Releases = { created: string | null; published: Map<string, string>; requires: Map<string, string[]> };

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
  return { created: firstPublish(doc.time), published, requires };
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
