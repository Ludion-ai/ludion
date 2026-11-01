import { createHash } from "node:crypto";

export const RELEASES_URL = "https://www.php.net/releases/index.php";
export const hash = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
/** An official runtime image in a Dockerfile's one FROM: PHP's, or Node.js's (node.ts). `branch` is the release line. */
export type RuntimeImage = { reference: string; version: string; branch: string; flavor: string; start: number; end: number };
export type Release = { version: string; date: string; security: boolean };
export type Scan = {
  schema: 1;
  checked_at: string;
  /** "wait": a move with no newer security release, before its 72 hours have passed (`wait_until`). */
  status: "update_available" | "wait" | "no_newer_security_release";
  scope: "dockerfile_base_image";
  /** Absent for PHP, as before Node.js images were read (docs/decisions/2026-10-31-lnode-node-image.md). */
  runtime?: "node";
  current: RuntimeImage;
  candidate: { version: string; reference: string } | null;
  security_releases: Release[];
  /** A move with no newer security release only: the end of its wait, 72 hours after the end of the candidate's release day. */
  wait_until?: string;
  source: string;
  note: string;
};

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
export function compare(a: string, b: string): number {
  const av = VERSION.exec(a), bv = VERSION.exec(b);
  if (!av || !bv) throw new Error("Expected exact stable PHP versions.");
  for (let i = 1; i <= 3; i++) {
    const delta = Number(av[i]) - Number(bv[i]);
    if (delta) return delta;
  }
  return 0;
}

/** A Dockerfile as Docker (BuildKit) reads it: one UTF-8 byte-order mark at the start of the file is removed. */
export const withoutBom = (text: string): string => text.startsWith("\u{FEFF}") ? text.slice(1) : text;

/** What BuildKit takes off a line's left (Go's unicode.IsSpace) and JavaScript's `\s`, together: `\s` lacks U+0085. */
const isSpace = (char: string): boolean => /[\s\u0085]/.test(char);
/**
 * A directive BuildKit acts on, at a `#` or `//` that starts a line: `# escape=`, `# syntax=`, and `// syntax=`, which
 * sends the build to another frontend. Tried at each such place only, so the runs of space it crosses are read once.
 */
const DIRECTIVE = /(?:#|\/\/)\s*(?:syntax|escape)\s*=/iy;
const COPY_FROM = /--from(?:[=\s]|$)/i;
const RUN_OVERRIDE = /--(?:network|mount)(?:[=\s]|$)/i;
const NOT_READ = "Dockerfile frontend directives and continuations are not supported in this preview.";

/** One instruction of a Dockerfile: its first word in lower case, and what follows it on the line, at `at` in the text. */
type Instruction = { word: string; args: string; at: number; lead: string; bare: boolean };

/**
 * A Dockerfile's instructions, read in the order of BuildKit's parser: cut at line feeds, drop the carriage returns at a
 * line's end, drop the left's whitespace, then look at the directives and continuations, and then at the first word. A
 * form BuildKit would read differently is refused here, not guessed at:
 * - an `escape` or `syntax` directive anywhere (so the escape is always a backslash), and a `//` one. The third form, a
 *   whole file of JSON with a `syntax` key, has no line that starts with FROM, so it has no stage.
 * - a line whose last non-space character is a backslash: BuildKit continues it when only spaces and tabs follow.
 * - a carriage return, U+2028 or U+2029 inside a line. BuildKit reads them as part of the line; what is read here must
 *   not depend on that.
 * Every line counts, a heredoc's too: that can only refuse more.
 */
function instructions(dockerfile: string): Instruction[] {
  const found: Instruction[] = [];
  let next = 0;
  for (const raw of dockerfile.split("\n")) {
    const lineAt = next;
    next += raw.length + 1;
    let end = raw.length;
    while (end > 0 && raw[end - 1] === "\r") end--;
    const line = raw.slice(0, end);
    if (/[\r\u2028\u2029]/.test(line)) throw new Error("A carriage return or Unicode line separator inside a Dockerfile line is not supported in this preview.");
    let first = 0, last = end;
    while (first < end && isSpace(line[first]!)) first++;
    if (first === end) continue;
    while (last > first && isSpace(line[last - 1]!)) last--;
    if (line[first] === "#" || line.startsWith("//", first)) {
      DIRECTIVE.lastIndex = lineAt + first;
      if (DIRECTIVE.test(dockerfile)) throw new Error(NOT_READ);
    }
    if (line[last - 1] === "\\") throw new Error(NOT_READ);
    // A comment's first word starts with #, so it is no instruction that is looked for.
    let wordEnd = first;
    while (wordEnd < end && !isSpace(line[wordEnd]!)) wordEnd++;
    found.push({ word: line.slice(first, wordEnd).toLowerCase(), args: line.slice(wordEnd), at: lineAt + wordEnd, lead: line.slice(0, first), bare: wordEnd >= last });
  }
  return found;
}

/**
 * Whether an instruction reaches outside the build's own context: ADD, COPY --from, RUN --network or --mount. A flag's
 * name counts as BuildKit reads it, with its quotes and backslashes taken out (`--fr"om"=x` is `--from=x`), anywhere on
 * the line; COPY or RUN with nothing after it is one too, as the flag could only be on a line BuildKit would not read.
 */
function reachesOutside({ word, args, bare }: Instruction): boolean {
  if (word === "add") return true;
  if (word !== "copy" && word !== "run") return false;
  return bare || (word === "copy" ? COPY_FROM : RUN_OVERRIDE).test(args.replace(/["'\\]/g, ""));
}

/**
 * Deliberately narrow: one stage, an exact version, an official image. Never guess ARGs or floating tags. `ref` matches the
 * whole FROM image and captures its version and flavor; `usage` is the refusal when it does not match. The file is read
 * without its byte-order mark (withoutBom); `start` and `end` stay offsets in the file as given, mark included.
 */
export function officialImage(file: string, ref: RegExp, usage: string, line: (version: string) => string): RuntimeImage {
  if (file.length > 64 * 1024) throw new Error("Dockerfile exceeds 64 KiB.");
  const dockerfile = withoutBom(file), mark = file.length - dockerfile.length;
  const read = instructions(dockerfile), stages = read.filter(instruction => instruction.word === "from");
  if (stages.length !== 1) throw new Error("Expected one FROM stage. Multi-stage and missing-base projects need manual review.");
  const stage = stages[0]!;
  const from = stage.args.trim();
  // U+0085 before the image, or after it, stays in `from` (JavaScript's trim keeps it), so `ref` does not match. Before FROM it is refused here.
  const match = stage.lead.includes("\u0085") ? null : ref.exec(from);
  if (!match) throw new Error(usage);
  // Block hidden downloads/frontends in an otherwise offline build. No remote ADD, external COPY or network overrides.
  if (read.some(reachesOutside)) {
    throw new Error("ADD, external COPY and RUN network/mount overrides are not supported by the offline validator.");
  }
  const start = mark + stage.at + stage.args.length - stage.args.trimStart().length;
  return { reference: from, version: match[1]!, branch: line(match[1]!), flavor: match[2]!, start, end: mark + stage.at + stage.args.length };
}

export function phpImage(dockerfile: string): RuntimeImage {
  const image = officialImage(dockerfile, /^(?:(?:docker\.io\/)?library\/)?php:(\d+\.\d+\.\d+)(-?(?:cli|fpm|apache)(?:-[a-z0-9][a-z0-9.-]*)?)(?:@sha256:[a-f0-9]{64})?$/,
    "Use one official PHP image with an exact stable version and flavor, e.g. php:8.4.26-cli-alpine. ARGs, aliases and floating tags are not supported.",
    version => version.split(".").slice(0, 2).join("."));
  if (!image.flavor.startsWith("-")) throw new Error("PHP image flavor must follow a hyphen.");
  return image;
}

export function parseReleases(input: unknown, branch: string): Release[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid official PHP release response.");
  const releases: Release[] = [];
  for (const [version, value] of Object.entries(input)) {
    if (!VERSION.test(version) || !version.startsWith(`${branch}.`)) continue;
    if (!value || typeof value !== "object") throw new Error("Invalid PHP release entry.");
    const item = value as { date?: unknown; tags?: unknown };
    if (typeof item.date !== "string" || !Number.isFinite(Date.parse(item.date)) || !Array.isArray(item.tags) || !item.tags.every(t => typeof t === "string")) {
      throw new Error("Incomplete PHP release metadata. No update decision was made.");
    }
    releases.push({ version, date: item.date, security: item.tags.includes("security") });
  }
  if (!releases.length) throw new Error(`No official releases found for PHP ${branch}. Do not interpret this as safe or supported.`);
  return releases.sort((a, b) => compare(b.version, a.version));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** php.net's release day ("21 Oct 2026") as 00:00 UTC that day; null when it is not in that form or not a real day. */
export function phpDay(date: string): Date | null {
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(date.trim());
  const at = match && MONTHS.includes(match[2]!) ? new Date(Date.UTC(Number(match[3]), MONTHS.indexOf(match[2]!), Number(match[1]))) : null;
  return at && at.getUTCDate() === Number(match![1]) ? at : null;
}

const HOUR = 60 * 60 * 1000;
/** The official images Ludion moves: their Docker Hub repository under `library/`. */
export type OfficialRepository = "php" | "node";
/**
 * The digest Docker Hub gives for an official image's tag now, by a HEAD on its manifest (the manifest list's digest,
 * what `docker pull` records); null when Docker Hub has no such tag (HTTP 404). Only the tag name is sent.
 */
export async function dockerHubTag(repository: OfficialRepository, tag: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tag)) throw new Error("Invalid image tag.");
  if (repository !== "php" && repository !== "node") throw new Error("Not an official image Ludion updates.");
  const auth = await releaseJson(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/${repository}:pull`, "Docker Hub token", 1, 30_000, fetchFn) as { token?: unknown } | null;
  if (typeof auth?.token !== "string") throw new Error("Docker Hub gave no pull token.");
  const res = await fetchFn(`https://registry-1.docker.io/v2/library/${repository}/manifests/${tag}`, {
    method: "HEAD", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${auth.token}`, accept: ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.oci.image.manifest.v1+json"].join(", ") },
  });
  if (res.status === 404) return null;
  const digest = res.headers.get("docker-content-digest") ?? "";
  if (!res.ok || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`Docker Hub gave no digest for ${repository}:${tag} (HTTP ${res.status}).`);
  return digest;
}

/**
 * A move stopped at Docker Hub's check of its tag, after the line's security releases newer than the Dockerfile's version
 * were counted from the official list. No move is decided, but those releases (newest first) are kept, and named first in
 * the message, so a scan still reports them (scan.ts): whether one is newer is read from the official list alone.
 */
export class ImageMoveStopped extends Error {
  readonly security_releases: Release[];
  constructor(message: string, security_releases: Release[]) { super(message); this.name = "ImageMoveStopped"; this.security_releases = security_releases; }
}
/** The stop for Docker Hub having no tag for the line's newest release in the Dockerfile's variant (HTTP 404). */
export class MissingImageTag extends ImageMoveStopped {
  constructor(message: string, security_releases: Release[]) { super(message, security_releases); this.name = "MissingImageTag"; }
}
const listed = (versions: string[]): string => versions.length > 1 ? `${versions.slice(0, -1).join(", ")} and ${versions.at(-1)}` : versions[0]!;

/**
 * An official image's move (docs/decisions/2026-10-31-limgv-image-newest-built-release.md): when the Dockerfile's version is
 * older than the newest release of its line, to that release, marked security or not, since Docker's official images
 * rebuild (with OS-package fixes) only the line's newest tag. `releases` is newest first; `fixes` are the line's security
 * releases newer than the Dockerfile's version, newest first. With none, the move waits 72 hours from the end of the
 * candidate's release day (`day` reads it). A move that does not wait, or whose wait has ended, needs its tag in the
 * Dockerfile's variant on Docker Hub; without it the lookup fails with MissingImageTag, which keeps `fixes`. When Docker
 * Hub cannot be checked (no pull token, an error status or no digest, a failed or timed-out request): with `fixes`, the
 * lookup fails with ImageMoveStopped, which keeps them and gives Docker Hub's error; with none, Docker Hub's error is
 * thrown as it is. A Dockerfile version newer than every listed release means the official list is missing releases, so
 * whether the tag is still the newest cannot be read: the lookup fails.
 */
export async function imageMove(repository: OfficialRepository, releases: Release[], current: RuntimeImage, line: string, day: (date: string) => Date | null, now: Date, fetchFn: typeof fetch): Promise<Pick<Scan, "status" | "candidate" | "security_releases" | "wait_until">> {
  const top = releases[0]!;
  if (compare(current.version, top.version) > 0) {
    throw new Error(`The official ${line} release list has no release as new as ${current.version}; it is missing releases. No update decision was made.`);
  }
  const fixes = releases.filter(r => r.security && compare(r.version, current.version) > 0);
  if (compare(top.version, current.version) <= 0) return { status: "no_newer_security_release", candidate: null, security_releases: fixes };
  const tag = `${top.version}${current.flavor}`, candidate = { version: top.version, reference: `${repository}:${tag}` };
  let wait: { wait_until: string } | Record<string, never> = {};
  if (!fixes.length) {
    const published = day(top.date);
    if (!published) throw new Error(`The official day of ${line.split(" ")[0]} ${top.version} is not in the form Ludion reads, so its 72-hour wait cannot be counted. No update decision was made.`);
    wait = { wait_until: new Date(published.getTime() + 96 * HOUR).toISOString() };
    if (now.getTime() < Date.parse(wait.wait_until)) return { status: "wait", candidate, security_releases: fixes, ...wait };
  }
  const named = fixes.length ? `${line.split(" ")[0]} ${listed(fixes.map(r => r.version))} ${fixes.length > 1 ? "are security releases" : "is a security release"} newer than ${current.version}; ` : "";
  let digest: string | null;
  try { digest = await dockerHubTag(repository, tag, fetchFn); } catch (error) {
    if (!fixes.length) throw error;
    // Docker Hub's own reason, as one sentence, without a second "No update decision was made."
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s*No update decision was made\.$/, "").trim() || "no reason given";
    throw new ImageMoveStopped(`${named}Docker Hub could not be checked for ${repository}:${tag}, the newest release of ${line} in the Dockerfile's variant: ${/[.!?]$/.test(reason) ? reason : `${reason}.`} Ludion does not move the image without that check. No update decision was made.`, fixes);
  }
  if (digest === null) {
    throw new MissingImageTag(`${named}Docker Hub has no ${repository}:${tag}, the newest release of ${line} in the Dockerfile's variant: Docker has not published it yet, or no longer builds this variant. Ludion does not move the variant or its OS release. No update decision was made.`, fixes);
  }
  return { status: "update_available", candidate, security_releases: fixes, ...wait };
}

/** An image fix's commit paragraph (patch.ts writes it, deliver.ts rebuilds it): its security releases, or the fact of a move without one. */
export const imageReason = (label: string, to: string, releases: readonly string[]): string => releases.length
  ? `Official ${label} security releases: ${releases.join(", ")}.`
  : `${label} ${to}, the newest release of the line (no newer security release); Docker rebuilds only the newest tag of a line.`;

/** An official release list as JSON: no redirect, at most `mib` MiB. `what` names it in errors ("PHP release"). */
export async function releaseJson(url: string, what: string, mib: number, timeoutMs: number, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "Ludion-Security-Preview", "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Official ${what} lookup failed (HTTP ${res.status}). No update decision was made.`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`Empty ${what} response.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > mib * 1024 * 1024) throw new Error(`${what} response exceeds ${mib} MiB.`);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function scanPhp(dockerfile: string, fetchFn: typeof fetch = fetch): Promise<Scan> {
  const current = phpImage(dockerfile);
  const url = `${RELEASES_URL}?json&version=${current.branch}&max=100`;
  const releases = parseReleases(await releaseJson(url, "PHP release", 1, 15_000, fetchFn), current.branch);
  const now = new Date(), move = await imageMove("php", releases, current, `PHP ${current.branch}`, phpDay, now, fetchFn);
  return {
    schema: 1, checked_at: now.toISOString(), status: move.status,
    scope: "dockerfile_base_image", current, candidate: move.candidate, security_releases: move.security_releases, ...(move.wait_until ? { wait_until: move.wait_until } : {}), source: url,
    note: "Checks php.net's release list (the branch's newest release and its security tags), and Docker Hub's tag for a move, against the Dockerfile, not live deployment inventory or every CVE. No match is not a security guarantee. No major/minor upgrades, EOL certification, or automatic production deployment.",
  };
}

export function replaceImage(text: string, image: RuntimeImage, reference: string): string {
  if (text.slice(image.start, image.end).trim() !== image.reference) throw new Error("Dockerfile changed; scan again.");
  return text.slice(0, image.start) + reference + text.slice(image.end);
}
