// The next smallest fix (LV): when an npm package's smallest fixed version is deprecated, no longer listed by the
// registry, or named by an OSV record that is not a MAL- record, `ludion patch` takes the next smallest version in
// the same major (and the same minor below 1.0.0) that is listed, not deprecated, and named by no OSV record, MAL- or
// other. Without one, the smallest stays and its fix
// stops, as before. Only package names and versions leave the machine, and, back to OSV, the ids of the records it
// returned. Composer and Maven have no per-version
// deprecation to read (Packagist marks a whole package abandoned; Maven Central lists versions only), so this is npm only.
// A version taken instead must come from the same publisher account, or the same provenance repository and workflow,
// as the smallest it passes over; otherwise, or when the two cannot be compared, the fix stops
// (docs/decisions/2026-10-30-next-fix-same-publisher.md). A smallest with a MAL- record stops the fix, and no later
// version is looked at (docs/decisions/2026-10-30-mal-smallest-stops-the-fix.md).
import semver from "semver";
import { releaseIdentity } from "./judge.ts";
import { osvIds, registryFacts, registryVersions } from "./npm-facts.ts";
import { OsvClient } from "./osv.ts";
import { eventProblem, repositoryIds, type ReleaseIdentity } from "./time-cap.ts";

/** One smallest fixed version that was passed over, or kept because it could not be checked; in the fix's receipt. */
export type VersionChoice = {
  package: string; smallest: string;
  /**
   * The version taken instead, or null: none qualified, or the check failed, so the smallest stays; or the version that
   * qualified is not the smallest's publisher's (publisher_check), so the fix stops.
   */
  chosen: string | null;
  /** Each version passed over, the smallest first, with why. */
  skipped: { version: string; reason: string }[];
  /** When a later version qualified: it and the smallest, compared as releases of one publisher. */
  publisher_check?: PublisherCheck;
  /** The MAL- records naming the smallest: no later version is looked at, and the fix stops. */
  malicious?: string[];
  note: string;
};

/** The smallest fixed version and the version that qualified instead, as compared; a stop stops the fix. */
export type PublisherCheck = {
  version: string;
  /** Each side's publisher account (null: none, or trusted publishing's shared user) and provenance; null when it could not be read or the registry no longer lists it. */
  smallest: ReleaseIdentity | null; candidate: ReleaseIdentity | null;
  /** "provenance": the same repository, workflow and repository id (or neither records an id); "publisher": neither has provenance, and the same account. */
  result: "provenance" | "publisher" | "stop";
  detail: string;
};

const plain = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200);
const described = (version: string, f: ReleaseIdentity) => f.provenance
  ? `${version} has provenance from repository ${f.provenance.repository === null ? "(none named)" : plain(f.provenance.repository)}, workflow ${f.provenance.workflow === null ? "(none named)" : plain(f.provenance.workflow)}, GitHub repository id ${f.provenance.repository_id ?? "(none recorded)"}, event ${f.provenance.event ?? "(none recorded)"}`
  : `${version} has no provenance and was published by ${f.publisher === null ? "no single account (none, or trusted publishing's shared user)" : `the npm account ${plain(f.publisher)}`}`;

/**
 * Do the smallest fixed version and the version that qualified instead come from one publisher? As in the judge's
 * same-release exception, but across two releases, so the commit is not compared: with provenance on both, the same
 * repository, workflow and GitHub repository id (neither recording an id: compared without it, and the detail says so),
 * neither recorded as published from another event than push, release or workflow_dispatch; with provenance on neither, the same publisher account (trusted
 * publishing's shared user is none). Anything else stops: provenance or a repository id on one side only, a side the
 * registry no longer lists, or a read that fails (docs/decisions/2026-10-30-provenance-immutable-id.md).
 */
export function comparePublishers(smallest: string, a: ReleaseIdentity | null, version: string, b: ReleaseIdentity | null): Pick<PublisherCheck, "result" | "detail"> {
  if (!a) return { result: "stop", detail: `${smallest} is no longer listed by the registry, so there is no publisher or provenance to compare ${version} with.` };
  if (!b) return { result: "stop", detail: `${version} is no longer listed by the registry, so its publisher and provenance cannot be compared.` };
  const both = `${described(smallest, a)}; ${described(version, b)}.`;
  if (a.provenance && b.provenance) {
    const event = eventProblem(a.provenance) ? `${smallest}'s provenance ${eventProblem(a.provenance)}` : eventProblem(b.provenance) ? `${version}'s provenance ${eventProblem(b.provenance)}` : null;
    if (event) return { result: "stop", detail: `${event}: ${both}` };
    const ids = repositoryIds(a.provenance, b.provenance);
    if (ids === "differ") return { result: "stop", detail: `The GitHub repository ids differ: ${both}` };
    if (ids === "one") return { result: "stop", detail: `Only one of the two records a GitHub repository id, so they cannot be compared: ${both}` };
    const same = !!a.provenance.repository && !!a.provenance.workflow && a.provenance.repository === b.provenance.repository && a.provenance.workflow === b.provenance.workflow;
    return same ? { result: "provenance", detail: ids === "same" ? `The same provenance repository, workflow and GitHub repository id: ${both}` : `The same provenance repository and workflow; neither records a GitHub repository id, so not compared by ID: ${both}` } : { result: "stop", detail: `The provenance differs, or names no repository or workflow: ${both}` };
  }
  if (a.provenance || b.provenance) return { result: "stop", detail: `Only one of the two has provenance: ${both}` };
  return a.publisher && a.publisher === b.publisher ? { result: "publisher", detail: `The same publisher account: ${both}` } : { result: "stop", detail: `The publishers differ, or one is no single account: ${both}` };
}

/** The publisher check on the version that qualified; a failed read stops, as nothing can be compared. */
async function publisherCheck(name: string, smallest: string, version: string, fetchFn: typeof fetch): Promise<PublisherCheck> {
  try {
    const facts = await registryFacts(name, [smallest, version], fetchFn);
    const side = (v: string) => { const f = facts.get(v); return f?.present ? releaseIdentity({ ...f, malicious: [], advisories: [] }) : null; };
    const a = side(smallest), b = side(version);
    return { version, smallest: a, candidate: b, ...comparePublishers(smallest, a, version, b) };
  } catch (error) {
    return { version, smallest: null, candidate: null, result: "stop", detail: `The publishers and provenance of ${smallest} and ${version} could not be read (${plain(error instanceof Error ? error.message : String(error))}).` };
  }
}

/** At most this many later versions are looked at, smallest first. */
export const NEXT_FIX_LIMIT = 50;

/**
 * null when the smallest fixed version can be used; otherwise what was passed over and what is taken. OSV is asked about
 * the smallest first, and about later versions only when the smallest cannot be used. A record OSV marks withdrawn does
 * not count, as in OsvClient.scan. A failed lookup, or a version OSV gave no answer for, throws. The version that
 * qualifies is taken only when it passes the publisher check; otherwise `chosen` is null and `publisher_check` says why
 * the fix stops. A smallest with a MAL- record also stops the fix, with `malicious` naming the records, and OSV is not
 * asked about any later version.
 */
export async function nextFix(name: string, smallest: string, fetchFn: typeof fetch = fetch): Promise<VersionChoice | null> {
  const from = semver.valid(smallest);
  if (!from) throw new Error(`${name}@${smallest} is not a semver version.`);
  const listed = await registryVersions(name, fetchFn);
  const scope = semver.major(from) === 0 ? `0.${semver.minor(from)}` : `${semver.major(from)}.x`;
  const later = [...listed.keys()].filter(v => semver.valid(v) === v && !semver.prerelease(v) && semver.gt(v, from) && semver.major(v) === semver.major(from) && (semver.major(from) !== 0 || semver.minor(v) === semver.minor(from))).sort(semver.compare);
  const looked = later.slice(0, NEXT_FIX_LIMIT);
  // OSV is asked about the smallest, and about the later versions that are listed and not deprecated (the others are
  // passed over already). Each record it names is read once, for its withdrawal.
  const ids = new Map<string, string[]>(), records = new OsvClient(fetchFn);
  const ask = async (versions: string[], all = false) => {
    const found = await osvIds(versions.filter(v => all || (listed.has(v) && !listed.get(v))).map(version => ({ name, version })), fetchFn);
    const withdrawn = new Set<string>();
    for (const id of new Set([...found.values()].flat())) if ((await records.advisory(id)).withdrawn) withdrawn.add(id);
    for (const [key, named] of found) ids.set(key, named.filter(id => !withdrawn.has(id)));
  };
  const registryReason = (version: string): string | null => {
    if (!listed.has(version)) return "no longer listed by the registry (unpublished or withdrawn)";
    const deprecated = listed.get(version);
    return deprecated ? `deprecated: ${deprecated.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200)}` : null;
  };
  const why = (version: string): string | null => {
    const registry = registryReason(version);
    if (registry) return registry;
    const named = ids.get(`${name}@${version}`);
    if (!named) throw new Error(`OSV gave no answer for ${name}@${version}.`);
    const malicious = named.filter(id => id.startsWith("MAL-"));
    if (malicious.length) return `in OSV's malicious-package records (${malicious.join(", ")})`;
    if (named.length) return `OSV names it in ${named.join(", ")}`;
    return null;
  };
  // The smallest is asked about even when deprecated or no longer listed, so that a MAL- record on it is seen: then the
  // fix stops with every reason found, and nothing later is looked at.
  await ask([from], true);
  const first = why(from);
  if (!first) return null;
  const named = ids.get(`${name}@${from}`)!, malicious = named.filter(id => id.startsWith("MAL-"));
  if (malicious.length) {
    const others = named.filter(id => !malicious.includes(id)), registry = registryReason(from);
    const reason = [`in OSV's malicious-package records (${malicious.join(", ")})`, ...(others.length ? [`OSV also names it in ${others.join(", ")}`] : []), ...(registry ? [registry] : [])].join("; ");
    return { package: name, smallest: from, chosen: null, skipped: [{ version: from, reason }], malicious, note: `The smallest fixed version ${name}@${from} is ${reason}. Its source may be taken over, so no later version is taken, and this fix stops (docs/decisions/2026-10-30-mal-smallest-stops-the-fix.md).` };
  }
  await ask(looked);
  const skipped = [{ version: from, reason: first }];
  for (const version of looked) {
    const reason = why(version);
    if (!reason) {
      const check = await publisherCheck(name, from, version, fetchFn);
      const found = `The smallest fixed version ${name}@${from} cannot be used (${first}). ${version} is the next smallest ${scope} version the registry lists that is not deprecated and that no OSV record names`;
      if (check.result === "stop") return { package: name, smallest: from, chosen: null, skipped, publisher_check: check, note: `${found}, but it is not taken, and this fix stops: it must come from the same publisher account or provenance repository and workflow as ${from} (docs/decisions/2026-10-30-next-fix-same-publisher.md). ${check.detail}` };
      return { package: name, smallest: from, chosen: version, skipped, publisher_check: check, note: `${found}, so it is taken instead. ${check.detail}` };
    }
    skipped.push({ version, reason });
  }
  return { package: name, smallest: from, chosen: null, skipped, note: `The smallest fixed version ${name}@${from} cannot be used (${first}), and no later ${scope} version qualifies (${looked.length} looked at${later.length > looked.length ? ` of ${later.length}` : ""}); the smallest stays, so this fix stops, as before.` };
}
