// The next smallest fix (LV): when an npm package's smallest fixed version is deprecated, no longer listed by the
// registry, or named by an OSV record (a MAL- record or an advisory), `ludion patch` takes the next smallest version in
// the same major (and the same minor below 1.0.0) that is none of these. Without one, the smallest stays and its fix
// stops, as before. Only package names and versions leave the machine. Composer and Maven have no per-version
// deprecation to read (Packagist marks a whole package abandoned; Maven Central lists versions only), so this is npm only.
import semver from "semver";
import { osvIds, registryVersions } from "./npm-facts.ts";

/** One smallest fixed version that was passed over, or kept because it could not be checked; in the fix's receipt. */
export type VersionChoice = {
  package: string; smallest: string;
  /** The version taken instead, or null: none qualified, or the check failed, so the smallest stays. */
  chosen: string | null;
  /** Each version passed over, the smallest first, with why. */
  skipped: { version: string; reason: string }[];
  note: string;
};

/** At most this many later versions are looked at, smallest first. */
export const NEXT_FIX_LIMIT = 50;

/** null when the smallest fixed version can be used; otherwise what was passed over and what is taken. A failed lookup throws. */
export async function nextFix(name: string, smallest: string, fetchFn: typeof fetch = fetch): Promise<VersionChoice | null> {
  const from = semver.valid(smallest);
  if (!from) throw new Error(`${name}@${smallest} is not a semver version.`);
  const listed = await registryVersions(name, fetchFn);
  const scope = semver.major(from) === 0 ? `0.${semver.minor(from)}` : `${semver.major(from)}.x`;
  const later = [...listed.keys()].filter(v => semver.valid(v) === v && !semver.prerelease(v) && semver.gt(v, from) && semver.major(v) === semver.major(from) && (semver.major(from) !== 0 || semver.minor(v) === semver.minor(from))).sort(semver.compare);
  const looked = later.slice(0, NEXT_FIX_LIMIT);
  // OSV is asked only about listed versions that are not deprecated: the others are passed over already.
  const ids = await osvIds([from, ...looked].filter(v => listed.has(v) && !listed.get(v)).map(version => ({ name, version })), fetchFn);
  const why = (version: string): string | null => {
    if (!listed.has(version)) return "no longer listed by the registry (unpublished or withdrawn)";
    const deprecated = listed.get(version);
    if (deprecated) return `deprecated: ${deprecated.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200)}`;
    const named = ids.get(`${name}@${version}`) ?? [], malicious = named.filter(id => id.startsWith("MAL-"));
    if (malicious.length) return `in OSV's malicious-package records (${malicious.join(", ")})`;
    if (named.length) return `OSV names it in ${named.join(", ")}`;
    return null;
  };
  const first = why(from);
  if (!first) return null;
  const skipped = [{ version: from, reason: first }];
  for (const version of looked) {
    const reason = why(version);
    if (!reason) return { package: name, smallest: from, chosen: version, skipped, note: `The smallest fixed version ${name}@${from} cannot be used (${first}). ${version} is taken instead: the next smallest ${scope} version the registry lists that is not deprecated and that no OSV record names.` };
    skipped.push({ version, reason });
  }
  return { package: name, smallest: from, chosen: null, skipped, note: `The smallest fixed version ${name}@${from} cannot be used (${first}), and no later ${scope} version qualifies (${looked.length} looked at${later.length > looked.length ? ` of ${later.length}` : ""}); the smallest stays, so this fix stops, as before.` };
}
