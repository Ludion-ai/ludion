import type { Change, Ecosystem } from "./inventory.ts";
import { compare, type Scan } from "./php.ts";
import { composerVersion, npmReleases, packagistReleases } from "./time-cap.ts";

/**
 * The exposure-time start in a receipt: when the fix was officially published. `at` is null when it cannot be read, and
 * `note` says where it came from or why it is missing. Reading it never stops a fix.
 */
export type FixPublished = { at: string | null; note: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** PHP: php.net's release date of the first security release newer than the Dockerfile's version. */
export function phpFixPublished(scan: Scan): FixPublished {
  const first = [...scan.security_releases].sort((a, b) => compare(a.version, b.version))[0];
  if (!first) return { at: null, note: "Not found: php.net lists no security release newer than the Dockerfile's version." };
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(first.date.trim());
  const at = match && MONTHS.includes(match[2]!) ? new Date(Date.UTC(Number(match[3]), MONTHS.indexOf(match[2]!), Number(match[1]))) : null;
  if (!at || at.getUTCDate() !== Number(match![1])) return { at: null, note: `Not read: php.net's date for PHP ${first.version} is not in the form "21 Oct 2026".` };
  return { at: at.toISOString(), note: `php.net's release date of PHP ${first.version}, the first security release newer than the Dockerfile's version. php.net gives a day only; recorded as 00:00 UTC that day.` };
}

/** Node.js: nodejs.org's index date of the first security release of the line newer than the Dockerfile's version. */
export function nodeFixPublished(scan: Scan): FixPublished {
  const first = [...scan.security_releases].sort((a, b) => compare(a.version, b.version))[0];
  if (!first) return { at: null, note: "Not found: nodejs.org lists no security release of the line newer than the Dockerfile's version." };
  const at = /^\d{4}-\d{2}-\d{2}$/.test(first.date) ? new Date(`${first.date}T00:00:00.000Z`) : null;
  if (!at || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== first.date) return { at: null, note: `Not read: nodejs.org's date for Node.js ${first.version} is not in the form "2026-10-21".` };
  return { at: at.toISOString(), note: `nodejs.org's release date of Node.js ${first.version}, the first security release of the line newer than the Dockerfile's version. nodejs.org gives a day only; recorded as 00:00 UTC that day.` };
}

/** npm and Composer: the registry's publish time of each planned version; the latest of them, when a fix has several. */
export async function dependencyFixPublished(ecosystem: Ecosystem, changes: Change[], fetchFn: typeof fetch = fetch): Promise<FixPublished> {
  if (ecosystem === "maven") return { at: null, note: "Not read: Ludion does not read Maven Central's publish times yet." };
  try {
    const times: number[] = [];
    for (const change of changes) {
      const releases = await (ecosystem === "npm" ? npmReleases : packagistReleases)(change.name, fetchFn);
      const at = Date.parse(releases.published.get(composerVersion(change.to)) ?? "");
      if (!Number.isFinite(at)) return { at: null, note: `Not found: the registry gives no publish time for ${change.name}@${change.to}.` };
      times.push(at);
    }
    return { at: new Date(Math.max(...times)).toISOString(), note: ecosystem === "npm" ? "registry.npmjs.org's publish time of the fixed version." : "Packagist's release date of the fixed version, which its author sets." };
  } catch (error) {
    return { at: null, note: `Not read: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` };
  }
}
