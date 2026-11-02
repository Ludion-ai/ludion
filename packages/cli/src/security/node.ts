import { compare, imageMove, isSpace, officialImage, releaseJson, type Release, type RuntimeImage, type Scan } from "./php.ts";

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
 * here becomes a check that could not be made, never a skipped one. A space, tab, vertical tab, form feed or carriage
 * return separates the words, as in BuildKit.
 */
export const NODE_FROM = /^[ \t]*FROM[ \t\v\f\r]+(?:--\S+[ \t\v\f\r]+)*(?:\S*\/)?node(?=[:@ \t\v\f\r]|$)/im;
/**
 * Whether a Dockerfile names a node image (NODE_FROM). Each line, cut at a line feed, is read without the whitespace at
 * its end: a carriage return, U+0085 and a byte-order mark are among it, so CRLF is one line end. Blank lines are left out.
 * The lines are read without their left whitespace too, once as they stand, and once with comments left out and
 * continuations joined, a backtick's too, before that left whitespace goes, as it separates words across a join
 * (a backtick continues only under an escape directive, so the lines are read both ways). Finding more here only makes a
 * check that nodeImage then reads or refuses. It does not find every FROM BuildKit reads: not an image in quotes or with a
 * backslash in its name, not one from an ARG or `${X:-...}`, and not one after `--` or a raw byte that ends a flag. A policy
 * that names node refuses each (dockerfile-check.test.ts holds these).
 */
export const namesNodeImage = (dockerfile: string): boolean => {
  const withoutLeft = (line: string): string => {
    let first = 0;
    while (first < line.length && isSpace(line[first]!)) first++;
    return line.slice(first);
  };
  const named = (lines: string[]): boolean => NODE_FROM.test(lines.map(withoutLeft).join("\n"));
  const lines = dockerfile.split("\n").map(line => {
    let end = line.length;
    while (end > 0 && isSpace(line[end - 1]!)) end--;
    return line.slice(0, end);
  }).filter(line => line !== "");
  return named(lines) || named([...lines.filter(line => !withoutLeft(line).startsWith("#")), ""].join("\n").replace(/[\\`]\n/g, "").split("\n"));
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
