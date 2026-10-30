import { compare, officialImage, releaseJson, type Release, type RuntimeImage, type Scan } from "./php.ts";

/**
 * The official Node.js image, moved to a security release of its own line (docs/decisions/2026-10-31-lnode-node-image.md).
 * The same path as PHP's image (php.ts): nodejs.org's release index marks each release `security: true` or `false`.
 */
export const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
/** A Dockerfile line that names the official node image, for init and scan to offer the Node.js policy. */
export const NODE_FROM = /^\s*FROM\s+(?:(?:docker\.io\/)?library\/)?node:/im;

export function nodeImage(dockerfile: string): RuntimeImage {
  return officialImage(dockerfile, /^(?:(?:docker\.io\/)?library\/)?node:(\d+\.\d+\.\d+)((?:-[a-z][a-z0-9.-]{0,63})?)(?:@sha256:[a-f0-9]{64})?$/,
    "Use one official Node.js image with an exact version, e.g. node:22.23.4-alpine. ARGs, aliases and floating tags (node:22, node:lts, node:22-alpine) are not supported.",
    version => version.split(".")[0]!);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const realDay = (date: string) => {
  const match = DAY.exec(date), at = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  return at !== null && at.toISOString().slice(0, 10) === date;
};

/** The releases of one line (the major) from nodejs.org's index, newest first. Any entry of the line that is incomplete fails the lookup. */
export function parseNodeReleases(input: unknown, line: string): Release[] {
  if (!Array.isArray(input)) throw new Error("Invalid official Node.js release index.");
  const releases: Release[] = [];
  for (const value of input) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Node.js release entry.");
    const item = value as { version?: unknown; date?: unknown; security?: unknown };
    if (typeof item.version !== "string") throw new Error("Invalid Node.js release entry.");
    const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(item.version);
    // Prereleases and other lines are left out.
    if (!match || match[1] !== line) continue;
    if (typeof item.date !== "string" || !realDay(item.date) || typeof item.security !== "boolean") {
      throw new Error("Incomplete Node.js release metadata. No update decision was made.");
    }
    const version = item.version.slice(1);
    if (releases.some(r => r.version === version)) throw new Error(`Node.js ${version} is listed twice. No update decision was made.`);
    releases.push({ version, date: item.date, security: item.security });
  }
  if (!releases.length) throw new Error(`No official releases found for Node.js ${line}. Do not interpret this as safe or supported.`);
  return releases.sort((a, b) => compare(b.version, a.version));
}

export async function scanNode(dockerfile: string, fetchFn: typeof fetch = fetch): Promise<Scan> {
  const current = nodeImage(dockerfile);
  const releases = parseNodeReleases(await releaseJson(NODE_INDEX_URL, "Node.js release", 4, 30_000, fetchFn), current.branch);
  const fixes = releases.filter(r => r.security && compare(r.version, current.version) > 0);
  // Releases of a line are cumulative: the newest security release is the smallest version holding every published fix.
  const fixed = fixes[0];
  const candidate = fixed ? { version: fixed.version, reference: `node:${fixed.version}${current.flavor}` } : null;
  return {
    schema: 1, checked_at: new Date().toISOString(), status: candidate ? "update_available" : "no_newer_security_release",
    scope: "dockerfile_base_image", runtime: "node", current, candidate, security_releases: fixes, source: NODE_INDEX_URL,
    note: "Checks nodejs.org's security-release marks against the Dockerfile, not live deployment inventory or every CVE. No match is not a security guarantee. No major upgrades, end-of-life certification, same-tag image rebuilds, or automatic production deployment.",
  };
}
