import { compare, imageMove, officialImage, releaseJson, withoutBom, type Release, type RuntimeImage, type Scan } from "./php.ts";

/**
 * The official Node.js image, moved to the newest release of its line that Docker still builds in its variant
 * (docs/decisions/2026-10-31-lnode-node-image.md; its item 5 replaced by docs/decisions/2026-10-31-limgv-image-newest-built-release.md).
 * The same path as PHP's image (php.ts): nodejs.org's release index marks each release `security: true` or `false`.
 */
export const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
/**
 * A FROM line that names a node image, for init and scan to offer the Node.js policy: after any --flag arguments, with
 * any registry or namespace prefix, by tag, digest or neither. Only the FROM line counts (not `COPY --chown=node:node`).
 * Detecting is not reading: nodeImage accepts only the official image at an exact version, and every other form found
 * here becomes a check that could not be made, never a skipped one.
 */
export const NODE_FROM = /^[ \t]*FROM[ \t]+(?:--\S+[ \t]+)*(?:\S*\/)?node(?=[:@ \t\r]|$)/im;
/**
 * Whether a Dockerfile names a node image (NODE_FROM), read as BuildKit reads it: without a leading byte-order mark or
 * any line's left whitespace (U+0085 included), and with its comments out and its continuations joined, a backtick's
 * too. The lines are also read as they stand, as a backtick continues only under an escape directive. Finding more here
 * only makes a check that nodeImage then refuses.
 */
export const namesNodeImage = (dockerfile: string): boolean => {
  const lines = withoutBom(dockerfile).replace(/^[\s\u0085]+/gm, "");
  return NODE_FROM.test(lines) || NODE_FROM.test(lines.replace(/^#[^\n]*\n?/gm, "").replace(/[\\`][ \t]*\r*\n/g, ""));
};

export function nodeImage(dockerfile: string): RuntimeImage {
  return officialImage(dockerfile, /^(?:(?:docker\.io\/)?library\/)?node:(\d+\.\d+\.\d+)((?:-[a-z][a-z0-9.-]{0,63})?)(?:@sha256:[a-f0-9]{64})?$/,
    "Use one official Node.js image with an exact version, e.g. node:22.23.4-alpine. ARGs, aliases and floating tags (node:22, node:lts, node:22-alpine) are not supported.",
    version => version.split(".")[0]!);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** nodejs.org's release day ("2026-10-21") as 00:00 UTC that day; null when it is not in that form or not a real day. */
export const nodeDay = (date: string): Date | null => {
  const match = DAY.exec(date), at = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  return at !== null && at.toISOString().slice(0, 10) === date ? at : null;
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
    if (typeof item.date !== "string" || !nodeDay(item.date) || typeof item.security !== "boolean") {
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
  const now = new Date(), move = await imageMove("node", releases, current, `Node.js ${current.branch}`, nodeDay, now, fetchFn);
  return {
    schema: 1, checked_at: now.toISOString(), status: move.status,
    scope: "dockerfile_base_image", runtime: "node", current, candidate: move.candidate, security_releases: move.security_releases, ...(move.wait_until ? { wait_until: move.wait_until } : {}), source: NODE_INDEX_URL,
    note: "Checks nodejs.org's release index (the line's newest release and its security marks), and Docker Hub's tag for a move, against the Dockerfile, not live deployment inventory or every CVE. No match is not a security guarantee. No major upgrades, end-of-life certification, same-tag image rebuilds, or automatic production deployment.",
  };
}
