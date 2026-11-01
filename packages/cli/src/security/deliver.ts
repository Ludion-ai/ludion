import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { inflateRawSync } from "node:zlib";
import { publicArchiveUrl } from "./acquisition.ts";
import { fixBranchName, git, gitProgram, GIT_SETTINGS } from "./branch.ts";
import { candidateRefusal, judgeNpmCandidate } from "./candidate-judge.ts";
import { registryManifest } from "./npm-facts.ts";
import { changedManifest, MANIFESTS, type Change } from "./inventory.ts";
import { DECLARED, lockEntries, lockKey, newUnmetRequirements, readLock, requiredNames, requireName, resolveFrom, type Judgement, type LockEntry } from "./judge.ts";
import semver from "semver";
import { comparableVersion } from "./osv.ts";
import { compare, dockerHubTag, imageReason, phpImage } from "./php.ts";
import { nodeImage } from "./node.ts";
import { CONFIG, rootPath } from "./project.ts";

/**
 * The scheduled workflow's two jobs (action.yml, modes patch and pull-request; docs/bench/2026-10-30-lb-design).
 *
 * `packFixes`, in the validation job (contents: read, no secret): after `patch --apply`, writes the artifact, the run's
 * receipt and a Git bundle of the applied fixes' branches.
 *
 * `openFixes`, in the PR job (contents and pull-requests: write, runs no dependency code): reads that artifact as
 * untrusted data, checks every branch against the receipt, the base commit and the files the plan may change, and only
 * then pushes each fix to its own branch and opens one PR per fix, unless a PR for that fix already exists.
 */
export const RECEIPT_LIMIT = 8 * 1024 * 1024;
export const BUNDLE_LIMIT = 64 * 1024 * 1024;
/**
 * A changed file's size. A fix moves one package and adds the versions it brings, a few hundred bytes of lockfile per
 * new entry, so twice the base's file plus 1 MiB (thousands of new entries) leaves room for any real fix, while a file
 * padded with whitespace, which packs into a small bundle (40 MB into 41 KB in review 6516135819, N4), is refused.
 * Never more than 50 MiB, the size above which GitHub warns on a push (it refuses files over 100 MiB).
 */
export const FILE_LIMIT = 50 * 1024 * 1024;
export const fileLimit = (baseBytes: number) => Math.min(FILE_LIMIT, 2 * baseBytes + 1024 * 1024);
const RECEIPT = "receipt.json", BUNDLE = "fixes.bundle";

const plain = (text: string) => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Every value that reaches a branch name, a commit subject or a PR body matches one of these. None allows a backtick,
// "<", "]" or a line break, so in a code span nothing becomes Markdown, HTML or a mention.
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/**
 * A TIME that is a date: it reads back the same. Date.parse rolls a day past the month's end, or the hour 24, over to
 * another date (2026-02-30 is read as 2026-03-02), and gives NaN for a month over 12 (R252 N3, R252b N9).
 */
const isDate = (t: string) => {
  const ms = Date.parse(t);
  return Number.isFinite(ms) && new Date(ms).toISOString() === t.replace(/(?:\.(\d{1,3}))?Z$/, (_, f?: string) => `.${(f ?? "").padEnd(3, "0")}Z`);
};
/**
 * The Date header of an answer (an HTTP date in whole seconds, "Sun, 01 Nov 2026 08:32:10 GMT"), or null when it is
 * absent or does not read back the same. A time before the answer is less than one second past it (definitions.md, section 7).
 */
const answerDate = (response: Response): number | null => {
  const value = response.headers.get("date"), ms = value === null ? NaN : Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toUTCString() === value ? ms : null;
};
/** How much later GitHub's time `at` is than the Date of the answer that gives it, when that is at least one second; else 0. */
const pastAnswer = (at: number, date: number | null) => date !== null && at - date >= 1000 ? at - date : 0;
/** A difference of times: whole seconds under a minute, else minutes with one decimal; `wrap` puts the number in a code span. */
const span = (ms: number, wrap: (v: string) => string = v => v) =>
  ms < 60_000 ? `${wrap(String(Math.ceil(ms / 1000)))} second${Math.ceil(ms / 1000) === 1 ? "" : "s"}` : `${wrap((ms / 60_000).toFixed(1))} minutes`;
const NAME = /^@?[A-Za-z0-9][A-Za-z0-9._~/:-]{0,213}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_~-]{0,99}$/;
/**
 * The advisory IDs a receipt can hold: OSV's for npm, Packagist and Maven (GitHub's GHSA, CVE, OpenSSF's MAL) and
 * Packagist's own (PKSA, packagist.ts). Each goes into the commit's "Fixes …" line, so no other form is let through:
 * "GH-1" there would link, and maybe close, issue #1.
 */
export const ADVISORY = /^(?:GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|CVE-\d{4}-\d{4,7}|MAL-\d{4}-\d{1,7}|PKSA-[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?)$/;
const PATH = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,499}$/;
const IDENTITY = /^Ludion <ludion@ludion\.invalid> \d{1,12} [+-]\d{4}$/;
const VERDICTS = ["stop", "wait", "ready_except_build", "undecidable"] as const;

type Ecosystem = "npm" | "composer" | "maven" | "php" | "node";
/** The official runtime images (patch.ts): the Dockerfile policy's two ecosystems. */
const IMAGES = { php: { label: "PHP", parse: phpImage }, node: { label: "Node.js", parse: nodeImage } } as const;
const isImage = (ecosystem: Ecosystem | null): ecosystem is keyof typeof IMAGES => ecosystem === "php" || ecosystem === "node";
/** One applied fix, as the PR job takes it from the receipt after checking every field it uses. */
export type CheckedFix = {
  package: string; changes: Change[];
  /** The commit message `patch --apply` writes for this fix, rebuilt from checked fields; the commit must carry exactly it. */
  branch: string; commit: string; subject: string; message: string; tree: string; files: { path: string; after_hash: string }[];
  fix_published_at: string | null; found_at: string; applied_at: string; verdict: (typeof VERDICTS)[number] | null;
  /**
   * An image move with no newer security release (docs/decisions/2026-10-31-limgv-image-newest-built-release.md): the end
   * of its 72-hour wait, from the receipt's scan. Absent for every other fix.
   */
  waited_until?: string;
  /** An image move: the newer security releases the receipt's scan lists (none for a move to the line's newest release). */
  releases?: string[];
  /** Set by the PR job: where found_at comes from (docs/bench/lexp/definitions.md, section 3). Absent: the receipt's. */
  seen?: Seen;
};
/**
 * found_at's source. run: the run whose check saw the fix first, in an unbroken row of the workflow's runs; null when
 * found_at is the receipt's (this run's lookup). read: how many valid records were read. ended: a record that does not
 * list the fix ended the row (otherwise the records ran out, and an earlier run may have seen it). why: the walk was
 * not done. earlier: the receipt's lookup is earlier than every record that lists the fix. stop: the walk stopped, while
 * the row had not ended, at a run whose times do not agree (definitions.md, section 7).
 */
export type Seen = { at: string; run: number | null; read: number; ended: boolean; why?: string; earlier?: boolean; stop?: ClockStop };
/**
 * A run at which the walk stopped because its times do not agree, and by how many milliseconds. early: its record's
 * time is before GitHub's start of the run; late: after GitHub's upload time of its artifact; ahead: GitHub's start of
 * the run, or upload time of its artifact, is later than the Date of GitHub's answer that gives it.
 */
export type ClockStop = { run: number; kind: "early" | "late" | "ahead"; ms: number };
export type CheckedArtifact = { id: string | null; ecosystem: Ecosystem | null; base: string; fixes: CheckedFix[]; notApplied: Record<string, number> };
export type Delivery = { package: string; branch: string; outcome: "opened" | "open_pr_exists" | "closed_pr_exists" | "branch_differs" | "failed"; pr?: number; url?: string; reason?: string };

function refuse(why: string): never {
  throw new Error(`The artifact was refused, and nothing was pushed or opened: ${why}`);
}
const object = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(`${what} is not an object.`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, pattern: RegExp, what: string): string => {
  if (typeof value !== "string" || !pattern.test(value)) refuse(`${what} is missing or not in the expected form.`);
  return value;
};
const list = (value: unknown, min: number, max: number, what: string): unknown[] => {
  if (!Array.isArray(value) || value.length < min || value.length > max) refuse(`${what} is not a list of ${min} to ${max} entries.`);
  return value;
};
const time = (value: unknown, what: string) => text(value, TIME, what);
const timeOrNull = (value: unknown, what: string) => value === null ? null : time(value, what);

/** The project's folder as Git names it in the work tree ("" at the top, else ending with "/"), and the top folder. */
function workTree(root: string): { top: string; prefix: string } {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") throw new Error("The project's folder is not in a Git work tree.");
  return { top: git(root, ["rev-parse", "--show-toplevel"]).stdout.trim(), prefix: git(root, ["rev-parse", "--show-prefix"]).stdout.trim() };
}

/**
 * The validation job: the receipt of `patch --apply --json` (`result`, its whole output) and a bundle of the branches
 * of the fixes it applied, into `out`. Each branch must be at the commit the receipt names, on the receipt's base.
 */
export function packFixes(dir: string, result: string, out: string): { fixes: number } {
  const root = rootPath(dir), { top } = workTree(root);
  const parsed = object(JSON.parse(readFileSync(result, "utf8")), "patch's output");
  const receipt = parsed.receipt ?? null;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt === null) return { fixes: 0 };
  const r = object(receipt, "The receipt");
  const applied = "fixes" in r ? list(r.fixes, 0, 500, "fixes").map(f => object(f, "A fix")).filter(f => f.outcome === "applied") : r.outcome === "applied" ? [r] : [];
  if (!applied.length) return { fixes: 0 };
  const base = text(r.base_commit, SHA, "base_commit");
  const refs = applied.map(f => {
    const branch = text(f.branch, /^ludion\/[A-Za-z0-9._/-]+$/, "A fix's branch"), commit = text(f.commit, SHA, "A fix's commit");
    const tip = git(top, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], { allowFail: true }).stdout.trim();
    if (tip !== commit) throw new Error(`The branch ${branch} is not at the receipt's commit ${commit.slice(0, 12)}.`);
    return `refs/heads/${branch}`;
  });
  git(top, ["bundle", "create", "--quiet", join(out, BUNDLE), ...refs, `^${base}`]);
  return { fixes: refs.length };
}

/** The project's policy at the base commit, read by Git from that commit: the ecosystem and the files a fix may change. */
function policyAt(top: string, prefix: string, base: string): { ecosystem: Ecosystem; dockerfile: string | null; allowed: string[] } {
  const found = git(top, ["cat-file", "blob", `${base}:${prefix}${CONFIG}`], { allowFail: true });
  if (found.status !== 0) refuse(`the base commit has no ${prefix}${CONFIG}.`);
  let config: Record<string, unknown>;
  try { config = object(JSON.parse(found.stdout), CONFIG); } catch (error) { refuse(`${CONFIG} at the base commit could not be read (${plain(error instanceof Error ? error.message : String(error)).slice(0, 200)}).`); }
  if (typeof config.dockerfile === "string") {
    // The name as the policy gives it ("./Dockerfile") is in the commit's subject; the path as Git names it is compared.
    const dockerfile = posix.normalize(text(config.dockerfile, /^[A-Za-z0-9._/-]{1,500}$/, "The Dockerfile in the project's policy"));
    text(dockerfile, PATH, "The Dockerfile in the project's policy");
    if (dockerfile.split("/").some(part => part === ".." || part === ".") || /(^|\/)\.git(hub)?\//.test(dockerfile)) refuse("the Dockerfile in the project's policy is not a plain project path.");
    // project.ts: no ecosystem (or "php") is PHP's image, "node" Node.js's; any other with a Dockerfile is no policy.
    if (config.ecosystem !== undefined && config.ecosystem !== "php" && config.ecosystem !== "node") refuse("the project's policy names a Dockerfile and no supported image.");
    return { ecosystem: config.ecosystem === "node" ? "node" : "php", dockerfile: config.dockerfile as string, allowed: [dockerfile] };
  }
  const ecosystem = config.ecosystem;
  if (ecosystem !== "npm" && ecosystem !== "composer" && ecosystem !== "maven") refuse("the project's policy names no supported ecosystem.");
  return { ecosystem, dockerfile: null, allowed: [...MANIFESTS[ecosystem]] };
}

/** The receipt's applied fixes, each field checked. Fixes not applied are only counted. */
function checkedReceipt(value: unknown, policy: ReturnType<typeof policyAt>, prefix: string, base: string): Omit<CheckedArtifact, "base"> {
  if (value === null) return { id: null, ecosystem: null, fixes: [], notApplied: {} };
  const r = object(value, "The receipt");
  const id = text(r.id, ID, "The receipt's id");
  const notApplied: Record<string, number> = {};
  const count = (outcome: unknown) => { const key = typeof outcome === "string" && /^[a-z_]{1,20}$/.test(outcome) ? outcome : "other"; notApplied[key] = (notApplied[key] ?? 0) + 1; };
  if (isImage(policy.ecosystem)) {
    const runtime = policy.ecosystem, label = IMAGES[runtime].label;
    if (r.schema !== 1 || r.scope !== "dockerfile_only_not_deployed") refuse(`the receipt is not a ${label} Dockerfile receipt, and the project's policy is ${label}.`);
    // A Node.js scan says so (php.ts, Scan.runtime); a PHP scan has no runtime, as before Node.js images were read.
    const scanned = r.scan === null || typeof r.scan !== "object" ? undefined : (r.scan as Record<string, unknown>).runtime;
    if (scanned !== (runtime === "node" ? "node" : undefined)) refuse(`the receipt's scan is not of the ${label} image, and the project's policy is ${label}.`);
    if (r.outcome !== "applied") { count(r.outcome); return { id, ecosystem: runtime, fixes: [], notApplied }; }
    if (r.baseline_passed !== true || r.candidate_passed !== true) refuse("the receipt applies an update whose tests did not pass.");
    if (text(r.base_commit, SHA, "base_commit") !== base) refuse("the receipt's base_commit is not the commit this run checked out.");
    const scan = object(r.scan, "The receipt's scan"), current = object(scan.current, "scan.current"), candidate = object(scan.candidate, "scan.candidate");
    const from = text(current.version, VERSION, `The current ${label} version`), to = text(candidate.version, VERSION, `The candidate ${label} version`);
    // None for a move to the line's newest release with no newer security release (php.ts, imageMove).
    const releases = list(scan.security_releases, 0, 100, `The ${label} security releases`).map(release => text(object(release, `A ${label} release`).version, VERSION, `A ${label} release's version`));
    const subject = `ludion: ${label} ${from} -> ${to} in ${policy.dockerfile}`;
    const fix: CheckedFix = {
      package: runtime, changes: [{ name: runtime, from, to, advisories: [] }],
      branch: text(r.branch, /^ludion\/[A-Za-z0-9._/-]+$/, "The branch"), commit: text(r.commit, SHA, "The commit"), subject, tree: "",
      // patch.ts's message.
      message: `${subject}\n\n${imageReason(label, to, releases)}\n\nLudion receipt ${id}: the project's test passed on ${base.slice(0, 12)} and on this change, offline in Docker.\nSource Dockerfile only; production was not changed.\n`,
      files: [{ path: policy.allowed[0]!, after_hash: text(r.dockerfile_after, HEX64, "dockerfile_after") }],
      fix_published_at: timeOrNull(r.fix_published_at, "fix_published_at"), found_at: time(r.found_at, "found_at"), applied_at: time(r.applied_at, "applied_at"), verdict: null,
      releases,
    };
    if (!releases.length) {
      // Such a move waits 72 hours and has no advisory, so no exposure-time start (the decision's items 6 and 7).
      const waited = time(scan.wait_until, "scan.wait_until");
      if (Date.parse(fix.applied_at) < Date.parse(waited)) refuse(`the receipt applies a ${label} move with no newer security release at ${fix.applied_at}, before its wait ends at ${waited}.`);
      if (fix.fix_published_at !== null) refuse(`the receipt gives a ${label} move with no newer security release a fix_published_at; it has no advisory.`);
      fix.waited_until = waited;
    }
    if (fix.branch !== fixBranchName(prefix, runtime, null, [to])) refuse(`the branch ${fix.branch} is not the one Ludion names for ${label} ${to}.`);
    return { id, ecosystem: runtime, fixes: [fix], notApplied };
  }
  if (r.schema !== 2 || r.ecosystem !== policy.ecosystem || r.scope !== "dependency_files_only_not_deployed") refuse(`the receipt is not a ${policy.ecosystem} dependency receipt, and the project's policy is ${policy.ecosystem}.`);
  const fixes: CheckedFix[] = [];
  for (const entry of list(r.fixes, 0, 500, "fixes")) {
    const f = object(entry, "A fix");
    if (f.outcome !== "applied") { count(f.outcome); continue; }
    if (r.baseline_passed !== true || f.candidate_passed !== true) refuse("the receipt applies a fix whose tests did not pass.");
    if (text(r.base_commit, SHA, "base_commit") !== base) refuse("the receipt's base_commit is not the commit this run checked out.");
    const pkg = text(f.package, NAME, "A fix's package");
    const changes = list(f.changes, 1, 50, "A fix's changes").map(c => {
      const change = object(c, "A change");
      if (change.name !== pkg) refuse(`a change of ${pkg} names another package.`);
      return { name: pkg, from: text(change.from, VERSION, "A change's from"), to: text(change.to, VERSION, "A change's to"), advisories: list(change.advisories, 0, 100, "A change's advisories").map(a => text(a, ADVISORY, "An advisory")) };
    });
    const files = list(f.files, 1, MANIFESTS[policy.ecosystem as "npm" | "composer" | "maven"].length, "A fix's files").map(entry => {
      const file = object(entry, "A file");
      const path = text(file.path, PATH, "A file's path");
      if (!policy.allowed.includes(path)) refuse(`a fix changes ${path}, which a ${policy.ecosystem} fix may not change.`);
      return { path, after_hash: text(file.after_hash, HEX64, "A file's after_hash") };
    });
    if (new Set(files.map(file => file.path)).size !== files.length) refuse(`a fix of ${pkg} lists a file twice.`);
    const judgement = f.judgement === undefined ? null : object(f.judgement, "A fix's judgement");
    const verdict = judgement === null ? null : VERDICTS.find(v => v === judgement.verdict) ?? refuse("a fix's judgement has no known verdict.");
    if (policy.ecosystem === "npm" && verdict !== "ready_except_build") refuse(`the npm fix of ${pkg} is applied without the judge's ready_except_build.`);
    const subject = `ludion: ${pkg} ${changes.map(c => `${c.from} -> ${c.to}`).join(", ")} (${policy.ecosystem})`;
    const fix: CheckedFix = {
      package: pkg, changes, files, verdict, subject, tree: "",
      branch: text(f.branch, /^ludion\/[A-Za-z0-9._/-]+$/, "A fix's branch"), commit: text(f.commit, SHA, "A fix's commit"),
      // dependency-patch.ts's message.
      message: `${subject}\n\nFixes ${[...new Set(changes.flatMap(c => c.advisories))].join(", ")}.\n\nLudion receipt ${id}: the project's test passed on ${base.slice(0, 12)} and on this change alone, offline in Docker.\nSource dependency files only; production was not changed.\n`,
      fix_published_at: timeOrNull(f.fix_published_at, "fix_published_at"), found_at: time(f.found_at, "found_at"), applied_at: time(f.applied_at, "applied_at"),
    };
    if (fix.branch !== fixBranchName(prefix, policy.ecosystem, pkg, changes.map(c => c.to))) refuse(`the branch ${fix.branch} is not the one Ludion names for ${pkg}.`);
    fixes.push(fix);
  }
  if (new Set(fixes.map(f => f.branch)).size !== fixes.length) refuse("two applied fixes name the same branch.");
  return { id, ecosystem: policy.ecosystem, fixes, notApplied };
}

/**
 * The commit's headers and message. The parents and the tree are Git's own reading (rev-list, rev-parse), not a parse
 * of the raw text: Git counts only the `parent` lines right after `tree`, so a `parent` placed after `author` is no
 * parent to Git. The raw headers must also be exactly `tree`, `parent`…, `author`, `committer`, in that order, and agree
 * with Git's reading; `inOrder` is false otherwise.
 */
function commitOf(top: string, commit: string): { tree: string; parents: string[]; author: string; committer: string; message: string; inOrder: boolean } {
  const body = git(top, ["cat-file", "commit", commit]).stdout, split = body.indexOf("\n\n");
  const headers = (split < 0 ? body : body.slice(0, split)).split("\n");
  const [, ...parents] = git(top, ["rev-list", "--parents", "-n", "1", commit]).stdout.trim().split(" ");
  const tree = git(top, ["rev-parse", "--verify", `${commit}^{tree}`]).stdout.trim();
  const expected = [`tree ${tree}`, ...parents.map(p => `parent ${p}`)];
  const inOrder = split >= 0 && headers.length === expected.length + 2 && expected.every((h, i) => headers[i] === h)
    && headers[expected.length]!.startsWith("author ") && headers[expected.length + 1]!.startsWith("committer ");
  return {
    tree, parents, author: (headers[expected.length] ?? "").slice("author ".length), committer: (headers[expected.length + 1] ?? "").slice("committer ".length),
    message: split < 0 ? "" : body.slice(split + 2), inOrder,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * composer.lock keys that describe a package without changing what is installed or anything Composer calls.
 * Not notification-url: Composer sends a request to it on install.
 */
const COMPOSER_METADATA = new Set(["time", "published-time", "support", "funding", "description", "homepage", "keywords", "authors", "license"]);
/** The repository a pinned public archive comes from ("api.github.com/o/r" and the like), lower case; null otherwise. */
function archiveRepository(value: unknown): string | null {
  try {
    const url = publicArchiveUrl(String(value)), [first, second, third] = url.pathname.split("/").filter(Boolean);
    const [owner, name] = url.hostname === "api.github.com" ? [second, third] : [first, second];
    return `${url.hostname === "codeload.github.com" || url.hostname === "api.github.com" ? "github.com" : url.hostname}/${owner}/${name}`.toLowerCase();
  } catch { return null; }
}
/** What Composer installs, or runs, from a lock entry: compared with Packagist's release for every entry a fix adds or moves. */
const COMPOSER_INSTALL = ["type", "require", "conflict", "replace", "provide", "autoload", "autoload-dev", "bin", "include-path", "target-dir", "extra", "transport-options", "dist", "source"];
/** Every key a lock entry the fix adds or moves may have; any other refuses. */
const COMPOSER_KEYS = new Set([...COMPOSER_INSTALL, ...COMPOSER_METADATA, "name", "version", "require-dev", "suggest", "notification-url", "abandoned", "default-branch"]);
/** The notification-url Composer writes for a package from Packagist. */
const PACKAGIST_NOTIFY = "https://packagist.org/downloads/";
const withoutMetadata = (entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).filter(([key]) => !COMPOSER_METADATA.has(key)));

/** The requirement groups of the project's own entry (""), which mirror package.json's. */
const ROOT_GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/**
 * package-lock.json says the receipt's change and no other fix (gate 4: one fix per PR), by install path (review
 * 6518582507, N-a), as Composer's walk of what the fixed version requires does by name:
 * - every key is the root or an install path, read by the judge's own lockKey; a key in any other form (a folder, or
 *   "aaaaaaaaaaaaminimist", which npm installs nothing at) refuses the artifact, never is skipped (B1). `patch` does not
 *   fix workspaces, so a project folder has no place in a fix's lock; an extraneous folder may only stay as it was;
 * - the planned paths: each install path where the base has the fix's package at a change's `from`, whether the path
 *   is named for it or is an npm alias of it under another name (its entry's `name`; an alias of another package at
 *   the package's own path is not it) (review 6529858505, B2). Each change has one, and in the fix each is at the same
 *   path at that change's `to`, as the same package; no install path has the package at a `from` any more;
 * - every added path is installed, and is what a planned path or another added path resolves for one of its own
 *   requirements (requiredNames, by Node's lookup: an optional peer is not one), so none comes from nowhere;
 * - every other key is as at the base apart from its flags (sameButFlags); the root's only change is the fix's
 *   package's requirement;
 * - the fix leaves no requirement unmet that the base meets (newUnmetRequirements, with each side's package.json
 *   `overrides`): npm install would fetch it, unpinned. That also covers an added copy that is not what its requirer asks.
 * The judge, run again in openFixes, checks the changed and added entries against the registry.
 */
function npmLockProblem(old: string | null, now: string | null, fix: CheckedFix, manifests: { before: string | null; after: string | null }): string | null {
  if (old === null || now === null) return "package-lock.json is missing.";
  const show = (path: string) => plain(path).slice(0, 200), pkg = show(fix.package);
  let was: Record<string, unknown>, is: Record<string, unknown>, kinds: Map<string, ReturnType<typeof lockKey>>;
  try {
    was = readLock(old); is = readLock(now);
    // The judge's reading of both, which also refuses two paths that differ only in case and an invalid version.
    lockEntries(old); lockEntries(now);
    kinds = new Map([...Object.entries(was), ...Object.entries(is)].map(([path, item]) => [path, lockKey(path, item)]));
  } catch (error) { return `package-lock.json is not one Ludion reads (${plain(error instanceof Error ? error.message : String(error)).slice(0, 200)}).`; }
  // The rest of the file as at the base: lockfileVersion decides whether npm 6 reads the dependencies tree at all.
  const [baseTop, fixTop] = [JSON.parse(old), JSON.parse(now)] as Record<string, unknown>[];
  for (const key of new Set([...Object.keys(baseTop!), ...Object.keys(fixTop!)])) {
    if (key !== "packages" && key !== "dependencies" && !isDeepStrictEqual(baseTop![key], fixTop![key])) return `package-lock.json changes its top-level ${show(key)}.`;
  }
  // A tree npm 6 reads only where the base had one (review of 1e6f705, B1): a v3 base given one would hand npm 6 a tree to
  // install from. Where both have one, readLock has tied each to its packages section, which the checks below compare.
  if (Object.hasOwn(baseTop!, "dependencies") !== Object.hasOwn(fixTop!, "dependencies")) return `package-lock.json ${Object.hasOwn(fixTop!, "dependencies") ? "adds" : "removes"} the npm 6 dependencies tree.`;
  // A requirement the fix leaves unmet, which the base meets, npm install would fetch unpinned (review of ebfe89d, B1).
  const json = (text: string | null): unknown => { try { return text === null ? undefined : JSON.parse(text); } catch { return undefined; } };
  const unmet = newUnmetRequirements({ lock: old, manifest: json(manifests.before) }, { lock: now, manifest: json(manifests.after) });
  if (unmet.length) return plain(unmet[0]!).slice(0, 400);
  for (const [path, kind] of kinds) {
    if (kind === "folder") return `package-lock.json has ${show(path)}, which is not an install path (Ludion's fixes cover no workspace or local folder).`;
    if ([was, is].some(lock => Object.hasOwn(lock, path) && !isObject(lock[path]))) return `package-lock.json's ${show(path)} is not an object.`;
  }
  const entry = (lock: Record<string, unknown>, path: string) => Object.hasOwn(lock, path) ? lock[path] as Record<string, unknown> : null;
  const to = new Map<string, string>();
  for (const change of fix.changes) {
    if (to.has(change.from) && to.get(change.from) !== change.to) return `the receipt moves ${pkg} from ${plain(change.from).slice(0, 60)} twice.`;
    to.set(change.from, change.to);
  }
  // The package an install path holds: its entry's `name` for an npm alias, else the path's name.
  const ours = (path: string, item: Record<string, unknown> | null) => kinds.get(path) === "install" && !!item && !item.link && (typeof item.name === "string" ? item.name : requireName(path)) === fix.package;
  const planned = Object.keys(was).filter(path => ours(path, entry(was, path)) && to.has(String(entry(was, path)!.version)));
  for (const change of fix.changes) {
    if (!planned.some(path => entry(was, path)!.version === change.from)) return `the receipt moves ${pkg} from ${plain(change.from).slice(0, 60)}, and the base's package-lock.json does not have ${pkg} at that version.`;
  }
  for (const path of planned) {
    const from = String(entry(was, path)!.version), wanted = to.get(from)!;
    if (!ours(path, entry(is, path)) || entry(is, path)!.version !== wanted) return `package-lock.json does not have ${pkg} at ${plain(wanted).slice(0, 60)}, the fix's version, at ${show(path)}, where the base has ${plain(from).slice(0, 60)}.`;
  }
  const tos = new Set(to.values());
  for (const path of Object.keys(is)) {
    const version = String(entry(is, path)!.version);
    if (ours(path, entry(is, path)) && to.has(version) && !tos.has(version)) return `package-lock.json still has ${pkg} at ${plain(version).slice(0, 60)}, which the fix moves (${show(path)}).`;
  }
  // Each requirement group of the root with the fix's package's range blanked: nothing else of the root may change.
  const root = (item: Record<string, unknown> | null) => item && Object.fromEntries(Object.entries(item).map(([key, value]) => [key,
    ROOT_GROUPS.includes(key) && isObject(value) ? Object.fromEntries(Object.entries(value).map(([name, range]) => [name, name === fix.package ? "" : range])) : value]));
  const added: string[] = [];
  for (const path of kinds.keys()) {
    if (planned.includes(path)) continue;
    const before = entry(was, path), after = entry(is, path), version = (item: Record<string, unknown> | null) => plain(String(item?.version)).slice(0, 60);
    if (path === "") { if (!isDeepStrictEqual(root(before), root(after))) return "package-lock.json changes the project's own entry beyond the fix's requirement."; continue; }
    if (!after) return `package-lock.json removes ${show(path)} (${version(before)}), which this fix does not plan.`;
    if (!before) {
      if (kinds.get(path) !== "install" || after.link) return `package-lock.json adds ${show(path)}, which is not an installed package.`;
      added.push(path);
      continue;
    }
    if (!sameButFlags(before, after)) return `package-lock.json changes ${show(path)} (${version(before)} -> ${version(after)}), which this fix does not plan.`;
  }
  // From the planned paths, every added path some reached path resolves for one of its own requirements.
  const installed = new Map([...kinds].filter(([, kind]) => kind === "install").filter(([path]) => Object.hasOwn(is, path)).map(([path]) => [path, { path } as LockEntry]));
  const reached = new Set<string>(), queue = [...planned];
  while (queue.length) {
    const path = queue.shift()!, item = entry(is, path)!;
    // Whether each added copy is what its requirer asks for is newUnmetRequirements' question, above (review 6529858505, N5).
    // Only what npm installs for it: an optional peer adds nothing (audit 6541743253, item 1).
    for (const name of requiredNames(item)) {
      const target = resolveFrom(installed, `${path}/`, name)?.path;
      if (target && added.includes(target) && !reached.has(target)) { reached.add(target); queue.push(target); }
    }
  }
  const stray = added.filter(path => !reached.has(path));
  if (stray.length) return `package-lock.json adds ${stray.slice(0, 3).map(show).join(", ")}, which no package the fix moves or adds requires.`;
  // What the root and every entry the fix does not move load stays the same path: an added copy that shadows another
  // package's dependency would change what that package loads (review of 7d25696, B1 (B)).
  const wasAt = new Map([...kinds].filter(([path, kind]) => kind === "install" && Object.hasOwn(was, path)).map(([path]) => [path, { path } as LockEntry]));
  for (const path of Object.keys(is)) {
    if (planned.includes(path) || added.includes(path) || (path && (kinds.get(path) !== "install" || entry(is, path)!.link))) continue;
    const item = entry(is, path)!, dir = path ? `${path}/` : "";
    for (const group of path ? DECLARED : ROOT_GROUPS) for (const name of isObject(item[group]) ? Object.keys(item[group]) : []) {
      const then = resolveFrom(wasAt, dir, name)?.path, now = resolveFrom(installed, dir, name)?.path;
      if (then !== now) return `package-lock.json changes what ${path ? show(path) : "the project"} loads for ${show(name)} (${show(then ?? "nothing")} -> ${show(now ?? "nothing")}), which this fix does not plan.`;
    }
  }
  return null;
}

/** The flags npm writes on a lock entry from how the project reaches it, which decide what a production install leaves out. */
const NPM_FLAGS = ["dev", "optional", "devOptional", "peer"];

/**
 * Whether a lock entry is the base's apart from its flags, each `true` or absent, as npm writes them. A fix moves
 * an entry's flags where it changes how the entry is reached: node-fetch 2.6.7 requires whatwg-url, which was dev-only,
 * so npm drops `dev` from it and its dependencies (review 6538813186, B1). Version, resolved and integrity stay the
 * base's, so no code comes in that is not already in the base's lock; whether the flags are the ones npm computes is
 * not checked (docs/decisions/2026-10-31-lock-flags-only.md). The judge, run again, gives such an entry gate 2's checks
 * (docs/decisions/2026-10-31-flag-only-entries-gate2.md).
 */
function sameButFlags(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const rest = (item: Record<string, unknown>) => Object.fromEntries(Object.entries(item).filter(([key]) => !NPM_FLAGS.includes(key)));
  return NPM_FLAGS.every(flag => !Object.hasOwn(after, flag) || after[flag] === true) && isDeepStrictEqual(rest(before), rest(after));
}

/** The requirement groups compared with the registry: optional ones merged, as the registry also lists them in `dependencies`. */
const npmRequirements = (item: Record<string, unknown>) => ({
  requires: { ...(isObject(item.dependencies) ? item.dependencies : {}), ...(isObject(item.optionalDependencies) ? item.optionalDependencies : {}) },
  peers: isObject(item.peerDependencies) ? item.peerDependencies : {},
  // Which peers are optional: the requirement check leaves an optional peer out (review 6533374683, N1).
  peersMeta: isObject(item.peerDependenciesMeta) ? item.peerDependenciesMeta : {},
  os: item.os ?? null, cpu: item.cpu ?? null, libc: item.libc ?? null,
});

/**
 * npm: every package-lock.json entry the fix moves or adds must declare what the registry lists for that name and
 * version: its requirements (dependencies and optional ones together, peers, and which peers are optional) and its
 * `os`, `cpu` and `libc`, which decide whether npm installs it on a platform (reviews 6529858505, N1, and 6533374683,
 * N1). contentProblem's "required by a moved or added path" then rests on the registry's data, not on the artifact's
 * (review of 7d25696, B1 (A)), as composerAgain's does on Packagist's. Not compared: `bin`, `hasInstallScript`,
 * `engines`, `hasShrinkwrap` and the flags; an entry whose flags alone changed is not compared at all.
 */
async function npmAgain(top: string, prefix: string, base: string, fix: CheckedFix, manifest: (name: string, version: string) => Promise<Record<string, unknown> | null>): Promise<string | null> {
  try {
    const read = (rev: string) => readLock(git(top, ["cat-file", "blob", `${rev}:${prefix}package-lock.json`]).stdout);
    const was = read(base), is = read(fix.commit);
    for (const [path, item] of Object.entries(is)) {
      if (!isObject(item) || lockKey(path, item) !== "install" || item.link) continue;
      // An entry the fix leaves as at the base, or changes in its flags only, declares what the base's did.
      if (Object.hasOwn(was, path) && isObject(was[path]) && sameButFlags(was[path], item)) continue;
      const name = typeof item.name === "string" ? item.name : requireName(path), version = String(item.version), at = `${plain(name).slice(0, 100)}@${plain(version).slice(0, 60)}`;
      const listed = await manifest(name, version);
      if (!listed) return `the registry lists no ${at} (${plain(path).slice(0, 200)}).`;
      const lock = npmRequirements(item), registry = npmRequirements(listed);
      for (const key of ["requires", "peers", "peersMeta", "os", "cpu", "libc"] as const) {
        if (!isDeepStrictEqual(lock[key], registry[key])) return `package-lock.json's ${key === "requires" ? "dependencies" : key === "peers" ? "peerDependencies" : key === "peersMeta" ? "peerDependenciesMeta" : key} for ${at} (${plain(path).slice(0, 200)}) is not what the registry lists.`;
      }
    }
    return null;
  } catch (error) {
    return `the registry could not be read: ${plain(error instanceof Error ? error.message : String(error)).slice(0, 300)}`;
  }
}

/** composer.lock: why it says more than the fix, or null. See contentProblem. */
function composerLockProblem(old: string | null, now: string | null, fix: CheckedFix): string | null {
  if (old === null || now === null) return "composer.lock is missing.";
  let a: unknown, b: unknown;
  try { a = JSON.parse(old); b = JSON.parse(now); } catch { return "composer.lock is not JSON."; }
  if (!isObject(a) || !isObject(b)) return "composer.lock is not an object.";
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // plugin-api-version names the Composer that wrote the file (the tool image's), not what is installed.
    if (!["content-hash", "packages", "packages-dev", "plugin-api-version"].includes(key) && !isDeepStrictEqual(a[key], b[key])) return `composer.lock changes its ${plain(key).slice(0, 60)}.`;
  }
  const tos = new Set(fix.changes.map(c => c.to.replace(/^v/, "")));
  const added: Record<string, unknown>[] = [];
  let planned: Record<string, unknown> | null = null;
  // One entry per name across both lists: a second copy (say in packages-dev, with another archive) is refused.
  const names = [...(Array.isArray(b.packages) ? b.packages : []), ...(Array.isArray(b["packages-dev"]) ? b["packages-dev"] : [])].map(e => isObject(e) ? String(e.name).toLowerCase() : "");
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) return `composer.lock lists ${plain(twice[0]!).slice(0, 200)} more than once.`;
  for (const section of ["packages", "packages-dev"]) {
    const was = a[section] ?? [], is = b[section] ?? [];
    if (!Array.isArray(was) || !Array.isArray(is)) return `composer.lock's ${section} is not a list.`;
    const prior = new Map(was.filter(isObject).map(entry => [entry.name, entry]));
    const seen = new Set<unknown>();
    for (const entry of is) {
      if (!isObject(entry) || typeof entry.name !== "string") return `composer.lock has an entry without a name in ${section}.`;
      seen.add(entry.name);
      const earlier = prior.get(entry.name), name = plain(entry.name).slice(0, 200);
      const unknown = Object.keys(entry).filter(key => !COMPOSER_KEYS.has(key));
      if ((entry.name === fix.package || !earlier) && unknown.length) return `composer.lock gives ${name} keys Ludion does not check (${unknown.slice(0, 3).map(k => plain(k).slice(0, 40)).join(", ")}).`;
      if (entry.name === fix.package) {
        if (!earlier) return `composer.lock moves ${name} between its package lists, or adds it.`;
        if (!fix.changes.some(c => c.from.replace(/^v(?=\d)/, "") === String(earlier.version ?? "").replace(/^v(?=\d)/, ""))) return `the receipt moves ${name} from ${plain(fix.changes.map(c => c.from).join(", ")).slice(0, 60)}, and the base's composer.lock has ${plain(String(earlier.version)).slice(0, 60)}.`;
        if (!tos.has(String(entry.version ?? "").replace(/^v/, ""))) return `composer.lock moves ${name} to ${plain(String(entry.version)).slice(0, 60)}, not to the fix's version.`;
        // The same package from the same place: the archive's repository, the source's URL and the type stay the base's.
        const old = (key: string, inner: string) => isObject(earlier[key]) ? (earlier[key] as Record<string, unknown>)[inner] : undefined;
        const now = (key: string, inner: string) => isObject(entry[key]) ? (entry[key] as Record<string, unknown>)[inner] : undefined;
        const repository = archiveRepository(now("dist", "url"));
        if (!repository || repository !== archiveRepository(old("dist", "url"))) return `composer.lock takes ${name} from another archive repository than the base did, or from outside the pinned public archives.`;
        if (now("source", "url") !== old("source", "url") || entry.type !== earlier.type) return `composer.lock changes where ${name} comes from (source URL) or its type.`;
        if (isObject(entry["notification-url"]) || entry["notification-url"] !== earlier["notification-url"]) return `composer.lock changes ${name}'s notification-url.`;
        planned = entry;
        continue;
      }
      if (earlier) {
        if (!isDeepStrictEqual(withoutMetadata(earlier), withoutMetadata(entry))) return `composer.lock changes ${name}, which this fix does not plan.`;
        continue;
      }
      // A new package: from a pinned public archive, neither a Composer plugin nor an installer, no notification-url.
      if (!archiveRepository(isObject(entry.dist) ? entry.dist.url : "")) return `composer.lock takes ${name} from outside the pinned public archives.`;
      if (typeof entry.type === "string" && /^composer-(plugin|installer)$/.test(entry.type)) return `composer.lock brings ${name}, a ${entry.type}.`;
      if (entry["notification-url"] !== undefined && entry["notification-url"] !== PACKAGIST_NOTIFY) return `composer.lock gives the new ${name} a notification-url other than Packagist's.`;
      added.push(entry);
    }
    for (const name of prior.keys()) if (!seen.has(name) && name !== fix.package) return `composer.lock removes ${plain(String(name)).slice(0, 200)}.`;
  }
  if (!planned) return `composer.lock does not have ${plain(fix.package).slice(0, 200)}.`;
  // Each new package is required by the fixed version, or by a package that version newly brings: none comes from nowhere.
  const reached = new Set<string>(), queue: Record<string, unknown>[] = [planned];
  while (queue.length) {
    const entry = queue.shift()!, requires = isObject(entry.require) ? Object.keys(entry.require).map(n => n.toLowerCase()) : [];
    for (const next of added) {
      const key = String(next.name).toLowerCase();
      if (requires.includes(key) && !reached.has(key)) { reached.add(key); queue.push(next); }
    }
  }
  const stray = added.filter(entry => !reached.has(String(entry.name).toLowerCase()));
  if (stray.length) return `composer.lock adds ${stray.slice(0, 3).map(e => plain(String(e.name)).slice(0, 100)).join(", ")}, which the fixed version does not require.`;
  return null;
}

/**
 * Null when each file of the fix says only what `patch --apply` writes for the receipt's change, else why not. Both
 * sides are read by Git from the base commit and the fix's commit; nothing is installed or run.
 * - Dockerfile: only the FROM image changes, to the official PHP or Node.js image of a newer release of the same branch
 *   (Node.js: the same major) and flavor, pinned by digest.
 * - package.json, composer.json, pom.xml: exactly what `changedManifest` (inventory.ts, as `patch` calls it) makes from
 *   the base's files for the receipt's changes.
 * - composer.lock: no other top-level key changes; the planned package is at the fix's version; every other package is as
 *   at the base apart from descriptive metadata, or new; the planned and new ones come from a pinned public archive and
 *   are no Composer plugin or installer.
 * - package-lock.json: the judge, run again by the PR job (openFixes), since it needs the registry.
 */
export function contentProblem(ecosystem: Ecosystem, fix: CheckedFix, before: (path: string) => string | null, after: (path: string) => string | null): string | null {
  if (isImage(ecosystem)) {
    const path = fix.files[0]!.path, old = before(path), now = after(path), to = fix.changes[0]!.to, { label, parse } = IMAGES[ecosystem];
    if (old === null || now === null) return `${path} is missing.`;
    let current: ReturnType<typeof phpImage>;
    try { current = parse(old); } catch { return `the base's ${path} is not one Ludion updates.`; }
    if (!/^\d+\.\d+\.\d+$/.test(to) || !to.startsWith(`${current.branch}.`) || compare(to, current.version) <= 0) return `${label} ${to} is not a newer release of ${label} ${current.branch}.`;
    const head = old.slice(0, current.start), tail = old.slice(current.end), image = now.slice(head.length, now.length - tail.length);
    const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const official = new RegExp(`^(?:(?:docker\\.io/)?library/)?${ecosystem}:${escape(to)}${escape(current.flavor)}@sha256:[a-f0-9]{64}$`);
    if (!now.startsWith(head) || !now.endsWith(tail) || now.length < head.length + tail.length || !official.test(image)) return `${path} changes more than its FROM image to the official ${ecosystem}:${to}${current.flavor}, pinned by digest.`;
    return null;
  }
  // Composer and Maven: the update goes up (npm's downgrades stop at the judge, PHP's above). The versions come from the
  // receipt, so for Composer "from" must also be what the base's lock has; Maven's direct "from" is bound by changedManifest.
  if (ecosystem === "composer" || ecosystem === "maven") {
    for (const change of fix.changes) {
      const from = comparableVersion(change.from.replace(/^v(?=\d)/, ""), ecosystem), to = comparableVersion(change.to.replace(/^v(?=\d)/, ""), ecosystem);
      if (!from || !to || !semver.gt(to, from)) return `${fix.package} ${change.from} -> ${change.to} is not an update to a higher version Ludion can compare.`;
    }
  }
  const manifest = MANIFESTS[ecosystem][0], dir = mkdtempSync(join(tmpdir(), "ludion-manifest-"));
  try {
    for (const name of MANIFESTS[ecosystem]) { const content = before(name); if (content !== null) writeFileSync(join(dir, name), content); }
    let expected: string;
    try { expected = changedManifest(dir, ecosystem, fix.changes); } catch (error) { return `${manifest} at the base cannot take this fix (${plain(error instanceof Error ? error.message : String(error)).slice(0, 200)}).`; }
    const now = after(manifest) ?? "", lf = (s: string) => s.replace(/\r\n/g, "\n");
    let same = false;
    if (ecosystem === "maven") same = lf(now) === lf(expected);
    else try { same = isDeepStrictEqual(JSON.parse(now), JSON.parse(expected)); } catch { same = false; }
    if (!same) return `${manifest} is not what Ludion writes for ${fix.package} ${fix.changes.map(c => c.to).join(", ")}.`;
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // npm reads npm-shrinkwrap.json instead of package-lock.json when both are there, so a fix to package-lock.json would
  // install nothing of what the receipt says.
  if (ecosystem === "npm" && before("npm-shrinkwrap.json") !== null) return "the base has npm-shrinkwrap.json, which npm reads instead of package-lock.json.";
  if (ecosystem === "npm") return npmLockProblem(before("package-lock.json"), after("package-lock.json"), fix, { before: before("package.json"), after: after("package.json") });
  return ecosystem === "composer" ? composerLockProblem(before("composer.lock"), after("composer.lock"), fix) : null;
}

/**
 * The PR job's check of the artifact in `artifact`, against the commit this run checked out (`base`, from the run, not
 * from the artifact). Imports the bundle's objects into the repository only after its heads match the receipt. Throws
 * when anything does not match, so nothing is pushed.
 */
export function checkArtifact(dir: string, artifact: string, base: string): CheckedArtifact {
  if (!SHA.test(base)) throw new Error("The base must be a full commit SHA.");
  const root = rootPath(dir), { top, prefix } = workTree(root);
  if (git(top, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout.trim() !== base) throw new Error(`The checkout is not at the base ${base.slice(0, 12)}.`);
  const receiptFile = join(artifact, RECEIPT), bundleFile = join(artifact, BUNDLE);
  const size = (file: string) => { const stat = lstatSync(file); if (!stat.isFile()) refuse(`${file} is not a regular file.`); return stat.size; };
  if (!existsSync(receiptFile)) refuse("it has no receipt.json.");
  if (size(receiptFile) > RECEIPT_LIMIT) refuse(`receipt.json is larger than ${RECEIPT_LIMIT} bytes.`);
  let receipt: unknown;
  try { receipt = JSON.parse(readFileSync(receiptFile, "utf8")); } catch { refuse("receipt.json is not JSON."); }
  const policy = policyAt(top, prefix, base);
  const checked = checkedReceipt(receipt, policy, prefix, base);
  const hasBundle = existsSync(bundleFile);
  if (!checked.fixes.length) {
    if (hasBundle) refuse("it has a bundle, and the receipt applies no fix.");
    return { ...checked, base };
  }
  if (!hasBundle) refuse("the receipt applies fixes, and there is no bundle.");
  if (size(bundleFile) > BUNDLE_LIMIT) refuse(`fixes.bundle is larger than ${BUNDLE_LIMIT} bytes.`);
  // The bundle's heads, before any object is taken from it: one branch per applied fix, at its commit, and nothing else.
  const heads = git(top, ["bundle", "list-heads", bundleFile], { allowFail: true });
  if (heads.status !== 0) refuse("fixes.bundle is not a Git bundle.");
  const listed = heads.stdout.split("\n").filter(Boolean).sort(), expected = checked.fixes.map(f => `${f.commit} refs/heads/${f.branch}`).sort();
  if (listed.join("\n") !== expected.join("\n")) refuse(`the bundle's branches are not exactly the receipt's applied fixes (bundle: ${listed.length}, receipt: ${expected.length}${listed.some(l => !expected.includes(l)) ? `; not in the receipt: ${plain(listed.filter(l => !expected.includes(l)).slice(0, 3).join(", ")).slice(0, 300)}` : ""}).`);
  if (git(top, ["bundle", "verify", "--quiet", bundleFile], { allowFail: true }).status !== 0) refuse("the bundle needs commits other than the base, or is damaged.");
  git(top, ["bundle", "unbundle", bundleFile]);
  const where = (fix: CheckedFix) => `${fix.branch} (${fix.commit.slice(0, 12)})`;
  const commits = new Map(checked.fixes.map(fix => {
    const c = commitOf(top, fix.commit);
    if (c.parents.length !== 1 || c.parents[0] !== base) refuse(`${where(fix)} does not have the base ${base.slice(0, 12)} as its only parent.`);
    if (!c.inOrder) refuse(`${where(fix)}'s headers are not exactly tree, parent, author and committer, in that order.`);
    return [fix.commit, c];
  }));
  // Git's own check, so nothing the checks read past is malformed. It runs once: fsck reads every object in the
  // repository whatever heads it is given (review 6518582507, N-c). So an error in the base checkout itself refuses
  // every artifact of that repository, which fails closed.
  try { git(top, ["fsck", "--no-dangling", "--no-reflogs", "--no-progress", ...checked.fixes.map(f => f.commit)]); }
  catch (error) { refuse(`the base checkout with the bundle's objects does not pass git fsck (${plain(error instanceof Error ? error.message : String(error)).slice(0, 300)}).`); }
  const modes = new Map<string, string>();
  for (const line of git(top, ["ls-tree", "-r", "-z", "--full-tree", base]).stdout.split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t"), [mode, type] = line.slice(0, tab).split(" ");
    if (type === "blob") modes.set(line.slice(tab + 1), mode!);
  }
  for (const fix of checked.fixes) {
    const at = where(fix), c = commits.get(fix.commit)!;
    if (!IDENTITY.test(c.author) || !IDENTITY.test(c.committer)) refuse(`${at} is not authored and committed by Ludion.`);
    if (c.message.split("\n")[0] !== fix.subject) refuse(`${at}'s subject is not the receipt's change.`);
    // The whole message, so nothing (a "Closes #1", a trailer) rides along with the fix.
    if (c.message !== fix.message) refuse(`${at}'s message is not the one Ludion writes for the receipt ${checked.id}.`);
    fix.tree = c.tree;
    const changed = git(top, ["diff-tree", "-r", "-z", "--no-renames", base, fix.commit]).stdout.split("\0").filter(Boolean);
    const metas = changed.filter((_, i) => i % 2 === 0), paths = changed.filter((_, i) => i % 2 === 1);
    const wanted = fix.files.map(f => `${prefix}${f.path}`).sort();
    if ([...paths].sort().join("\0") !== wanted.join("\0")) refuse(`${at} changes ${paths.map(plain).slice(0, 5).join(", ") || "nothing"}, not exactly ${wanted.join(", ")}.`);
    for (const [i, meta] of metas.entries()) {
      const [oldMode, newMode, , , status] = meta.replace(/^:/, "").split(" ");
      if (status !== "M" || oldMode !== newMode || modes.get(paths[i]!) !== newMode || !/^100(644|755)$/.test(newMode!)) refuse(`${at} adds, removes or changes the mode of ${plain(paths[i]!)}.`);
      if (paths[i]!.split("/").some(part => part === ".github")) refuse(`${at} changes a file under .github/.`);
    }
    for (const file of fix.files) {
      // Sizes as Git stores them, before any blob is read.
      const bytes = (rev: string) => Number(git(top, ["cat-file", "-s", `${rev}:${prefix}${file.path}`]).stdout.trim());
      const limit = fileLimit(bytes(base));
      if (bytes(fix.commit) > limit) refuse(`${at}'s ${file.path} is larger than ${limit} bytes (twice the base's file and 1 MiB, at most ${FILE_LIMIT}).`);
      if (sha256(git(top, ["cat-file", "blob", `${fix.commit}:${prefix}${file.path}`]).stdout) !== file.after_hash) refuse(`${at}'s ${file.path} is not the receipt's file (after_hash).`);
    }
    // What the files say, not only which files change: the receipt's hashes come from the same untrusted artifact.
    const blob = (rev: string, path: string) => {
      const found = git(top, ["cat-file", "blob", `${rev}:${prefix}${path}`], { allowFail: true });
      return found.status === 0 ? found.stdout : null;
    };
    const problem = contentProblem(policy.ecosystem, fix, path => blob(base, path), path => blob(fix.commit, path));
    if (problem) refuse(`${at}: ${problem}`);
  }
  return { ...checked, base };
}

const PUBLISHED: Record<Ecosystem, string> = {
  npm: "registry.npmjs.org's publish time: the latest among the fix's planned versions",
  composer: "Packagist's release date, which its author sets: the latest among the fix's planned versions",
  maven: "not read: Ludion does not read Maven Central's publish times yet",
  php: "php.net's release day of the first newer security release, at 00:00 UTC",
  node: "nodejs.org's release day of the first newer security release of the line, at 00:00 UTC",
};

/** The body's Found row: the time, and which run saw the fix first, or why it is this run's lookup (LEXP). */
function foundRow(fix: CheckedFix): string {
  const code = (v: string) => `\`${v}\``, s = fix.seen, at = code(fix.found_at);
  if (!s) return `| Found | ${at} (this run's lookup; an earlier run may have seen it first) |`;
  // Our own message, never text from GitHub or the artifact; still kept out of the table's and Markdown's syntax.
  if (s.why !== undefined) return `| Found | ${at} (this run's lookup: earlier runs' records were not used: ${plain(s.why).replace(/[|`*_<>[\]@#~\\]/g, " ").slice(0, 300)}) |`;
  const read = `${code(String(s.read))} records read`;
  // Only numbers come from GitHub or the record here, each formatted by span().
  const stop = !s.stop ? "" : `; the walk stopped at run ${code(String(s.stop.run))}, whose times do not agree: ${s.stop.kind === "early"
    ? `its record's time is ${span(s.stop.ms, code)} before GitHub's start of that run`
    : s.stop.kind === "late" ? `its record's time is ${span(s.stop.ms, code)} after GitHub's upload time of its record`
    : `GitHub's time for that run is ${span(s.stop.ms, code)} later than the Date of GitHub's answer that gives it`}, so the runs before it were not read`;
  if (s.earlier) return `| Found | ${at} (this run's lookup, earlier than the record of every run that lists this fix; ${read}${stop}) |`;
  if (s.run === null) return `| Found | ${at} (this run's lookup: ${s.stop ? "no record read lists this fix" : "no record of this workflow's runs lists this fix"}; ${read}${stop}) |`;
  return `| Found | ${at} (the check of run ${code(String(s.run))}, the first of an unbroken row of this workflow's runs whose record lists this fix; ${read}${s.ended ? "" : "; the records read end there, so an earlier run may have seen it first"}${stop}) |`;
}

/** The PR's body, from checked fields only. Every value is in a code span; no free text from the artifact is used. */
export function pullRequestBody(artifact: CheckedArtifact, fix: CheckedFix): string {
  const ecosystem = artifact.ecosystem!, code = (v: string) => `\`${v}\``;
  const advisories = [...new Set(fix.changes.flatMap(c => c.advisories))];
  // An image move with no newer security release states only facts, and never calls itself a security release or fix
  // (docs/decisions/2026-10-31-limgv-image-newest-built-release.md, item 8).
  const newest = fix.waited_until !== undefined && isImage(ecosystem);
  return [
    "<!-- ludion-fix -->",
    "**プレビュー：マージは行わない。** Preview: Ludion does not merge this PR. Review it as you would any dependency update.",
    "",
    newest
      ? `Ludion's validation job moved the image to ${code(fix.changes[0]!.to)}, the newest release of its line: Docker rebuilds only the newest tag of a line, with its OS packages. No advisory names this move. By its receipt, it waited until ${code(fix.waited_until!)} (72 hours after the end of the release's day) and validated the move on its own against the base commit ${code(artifact.base.slice(0, 12))}. This PR holds that one change (one commit).`
      : `Ludion's validation job found a published security fix and, by its receipt, validated it on its own against the base commit ${code(artifact.base.slice(0, 12))}. This PR holds that one fix (one commit).`,
    "",
    "| | |",
    "|---|---|",
    `| Package | ${code(fix.package)} (${ecosystem}) |`,
    `| Change | ${fix.changes.map(c => `${code(c.from)} → ${code(c.to)}`).join(", ")} |`,
    `| Advisories | ${advisories.length ? advisories.map(code).join(", ") : newest ? "none (a move to the line's newest release)" : ecosystem === "php" ? "php.net's security release (no advisory ID read)" : ecosystem === "node" ? "nodejs.org's security release (no advisory ID read)" : "none listed"} |`,
    newest
      ? "| Fix published | none (no advisory; this move is not counted in exposure time) |"
      : `| Fix published | ${fix.fix_published_at ? code(fix.fix_published_at) : "unknown"} (${PUBLISHED[ecosystem]}) |`,
    foundRow(fix),
    `| Branch made | ${code(fix.applied_at)} |`,
    `| Receipt | ${code(artifact.id!)} (in this run's ludion-fixes artifact) |`,
    "",
    "The times and advisory IDs above are as the validation job recorded them in its receipt; the job that opened this PR checked their form, not their values.",
    "",
    "**What was checked**",
    "",
    `- By the validation job's receipt: the project's own test command passed on the base commit and on this change alone, built and run offline in Docker.`,
    `- This commit changes only ${fix.files.map(f => code(f.path)).join(", ")}, Git reads its only parent as the base commit, and ${code("git fsck")} finds no error in it. The job that opened this PR, which runs no project code, checked again that ${isImage(ecosystem) ? "only the FROM image changes, to the official image pinned by the digest Docker Hub gave for its tag" : ecosystem === "npm" ? "package.json is what Ludion writes for this change, that package-lock.json's `packages` section, which npm 7 and later read, moves this package (under its own name or an npm alias), at each install path where the base locks the version the fix replaces, to the fix's version, adds only packages that those paths (or packages so added) require by what the registry lists for them (an optional peer adds nothing, and where the lock has one it must be the package its spec names, in range), changes no other entry beyond its flags and nothing another package loads, and leaves no requirement unmet that the base meets, that each moved or added entry declares the requirements, os, cpu and libc the registry lists, and that a v2 lock's npm 6 `dependencies` section says the same as `packages`" : ecosystem === "composer" ? "composer.json is what Ludion writes for this change, that composer.lock moves only this package, up, from the version the base locks, and adds only packages it requires, none of them a plugin or installer, each as Packagist lists it, and that OSV lists no advisory for the version moved to" : "pom.xml is what Ludion writes for this change, that the version goes up, and that OSV lists no advisory for the version moved to"}.`,
    ecosystem === "npm"
      ? `- Ludion's judge on the lockfile change, in both jobs: ${code(fix.verdict!)}. It covers parts of gates 1, 2 and 4 and the wait table, not all four gates (docs/status.md in Ludion lists what it does not check).`
      : newest
        ? `- ${IMAGES[ecosystem as keyof typeof IMAGES].label} image updates do not go through Ludion's judge: no provenance, publisher, install-script, deprecation or withdrawal check. This move's 72-hour wait is the validation job's, by its receipt.`
        : `- ${isImage(ecosystem) ? `${IMAGES[ecosystem].label} image` : ecosystem === "composer" ? "Composer" : "Maven"} updates do not go through Ludion's judge: no provenance, publisher, install-script, deprecation or withdrawal check, and no wait.`,
    "",
    "**Not checked**",
    "",
    "- Gate 1's OS, SAPI and configuration matching; gate 2's inspection for obfuscated code or new network or process calls; gate 3's check that a changed package loads; the re-query when a wait ends.",
    ...(ecosystem === "npm" ? ["- In package-lock.json, a moved or added entry's `hasShrinkwrap`, `bin`, `hasInstallScript` and `engines` are not compared with the base or the registry, though npm reads them (npm 7 and later install a package's own shrinkwrap). Nor are its flags (`dev`, `optional`, `devOptional`, `peer`), which decide what a production install leaves out. Another entry's flags may differ from the base's, and are not checked against what npm computes from the lock's graph, so a forged lock could have a production install take a package the base locks for development only, or leave a production one out; the judge gives each entry whose flags alone changed gate 2's checks (OSV's malicious-package records, deprecation, withdrawal), not the rest of the gates."] : []),
    "- Your CI: GitHub starts no workflow for a PR opened with the workflow's own token. Start it (for example, close and reopen this PR) before merging.",
    "- Production: nothing is deployed.",
    "",
  ].join("\n");
}

type Api = { url: string; token: string; fetchFn: typeof fetch };
/** date: the answer's Date header (answerDate), or null. */
async function call(api: Api, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; date: number | null }> {
  const response = await api.fetchFn(`${api.url}${path}`, {
    method, headers: { authorization: `Bearer ${api.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let json: unknown = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  return { status: response.status, json, date: answerDate(response) };
}
const segments = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");
/** The repository and the API's address, checked before any request. */
function apiOf(options: { repo: string; api: string; token: string; fetchFn?: typeof fetch }): Api {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) throw new Error("--repo must be owner/name.");
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(\/[A-Za-z0-9._/-]*)?$/.test(options.api) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(options.api)) throw new Error("--api must be an https URL.");
  return { url: options.api.replace(/\/$/, ""), token: options.token, fetchFn: options.fetchFn ?? fetch };
}
const errorText = (error: unknown) => plain(error instanceof Error ? error.message : String(error)).slice(0, 300);

// found_at from the first run that saw the fix (docs/bench/lexp/definitions.md, section 3). Each run's check job uploads
// what it saw as the artifact ludion-seen; the PR job walks back through the workflow's runs and reads those records as
// untrusted data. The walk only measures: it decides no wait, no gate and no PR.
export const SEEN_ARTIFACT = "ludion-seen";
/** At most this many runs are read back, and a record (zipped or not) is at most this many bytes. */
export const SEEN_RUNS = 100, SEEN_BYTES = 1024 * 1024;
/** The walk asks nothing more once it has taken this long; each request also has its own 30-second limit (R252 N7). */
export const SEEN_WALK_MS = 5 * 60_000;
const SEEN_KEY = /^(?:php|node|(?:npm|composer|maven):[A-Za-z0-9@._/:~?-]{1,214})$/;
type SeenRecord = { checked_at: string; keys: { key: string; advisories: string[]; releases: string[]; candidate: string | null }[] };

/** At most `max` bytes of a response's body; null when it has more. */
async function boundedBytes(response: Response, max: number): Promise<Buffer | null> {
  if (Number(response.headers.get("content-length") ?? "0") > max) { await response.body?.cancel(); return null; }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/** One entry of a zip, read from its central directory (upload-artifact puts sizes in a data descriptor); stored or deflated only. */
export function unzipEntry(bytes: Buffer, name: string, max: number): Buffer | null {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (start + size > end) return null;
  for (let at = start, n = 0; n < count; n++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) return null;
    const method = bytes.readUInt16LE(at + 10), packed = bytes.readUInt32LE(at + 20), length = bytes.readUInt32LE(at + 24), offset = bytes.readUInt32LE(at + 42);
    const nameLength = bytes.readUInt16LE(at + 28), entry = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    if (entry !== name) continue;
    if (length > max || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) return null;
    const data = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    if (data + packed > bytes.length) return null;
    const body = bytes.subarray(data, data + packed);
    try {
      const out = method === 0 ? body : method === 8 ? inflateRawSync(body, { maxOutputLength: max }) : null;
      return out && out.length === length ? Buffer.from(out) : null;
    } catch { return null; }
  }
  return null;
}

/**
 * A record as the check job writes it, every value checked; null when it is not one. A valid record whose time is
 * outside its run (before GitHub's start of it, or after GitHub's upload time of its artifact) is not used: the walk
 * stops there, and says by how much (definitions.md, section 7).
 */
function seenRecordOf(bytes: Buffer, started: number, uploaded: number, ecosystem: Ecosystem): SeenRecord | Omit<ClockStop, "run"> | null {
  const entry = unzipEntry(bytes, "seen.json", SEEN_BYTES);
  if (!entry) return null;
  try {
    const r = object(JSON.parse(entry.toString("utf8")), "The record");
    if (r.schema !== 1 || r.kind !== "ludion-seen" || r.ecosystem !== ecosystem) return null;
    const checked = time(r.checked_at, "checked_at"), at = Date.parse(checked);
    if (!isDate(checked)) return null;
    if (r.commit !== null) text(r.commit, SHA, "commit");
    const keys = list(r.keys, 0, 500, "keys").map(k => {
      const item = object(k, "A key");
      return {
        key: text(item.key, SEEN_KEY, "A key"),
        advisories: item.advisories === undefined ? [] : list(item.advisories, 0, 100, "advisories").map(a => text(a, ADVISORY, "An advisory")),
        releases: item.releases === undefined ? [] : list(item.releases, 0, 100, "releases").map(v => text(v, VERSION, "A release")),
        candidate: item.candidate === undefined || item.candidate === null ? null : text(item.candidate, VERSION, "A candidate"),
      };
    });
    // No margin: GitHub's start of the run is before its check job's own time, and the upload after it.
    if (at < started) return { kind: "early", ms: started - at };
    if (at > uploaded) return { kind: "late", ms: at - uploaded };
    return { checked_at: new Date(at).toISOString(), keys };
  } catch { return null; }
}

/**
 * The run's ludion-seen record, or null: none, expired, not readable or not valid (the walk passes over such a run).
 * A ClockStop: the run's times do not agree (definitions.md, section 7), and the walk stops there. `dated`: the Date of
 * the answer that listed the run.
 */
async function seenOfRun(api: Api, repo: string, run: { id: number; started: number; dated: number | null }, ecosystem: Ecosystem): Promise<SeenRecord | ClockStop | null> {
  // GitHub's start of the run later than the answer that gives it: GitHub's clock does not agree with itself.
  const startAhead = pastAnswer(run.started, run.dated);
  if (startAhead) return { run: run.id, kind: "ahead", ms: startAhead };
  try {
    const listed = await call(api, "GET", `/repos/${repo}/actions/runs/${run.id}/artifacts?${new URLSearchParams({ name: SEEN_ARTIFACT, per_page: "100" })}`);
    const items = (listed.json as { artifacts?: unknown } | null)?.artifacts;
    if (listed.status !== 200 || !Array.isArray(items)) return null;
    const live = (items as { id?: unknown; name?: unknown; expired?: unknown; created_at?: unknown }[])
      .filter(a => a?.name === SEEN_ARTIFACT && a.expired === false && Number.isSafeInteger(a.id) && typeof a.created_at === "string" && Number.isFinite(Date.parse(a.created_at)))
      .sort((a, b) => Date.parse(b.created_at as string) - Date.parse(a.created_at as string));
    if (!live.length) return null;
    const uploadAhead = pastAnswer(Date.parse(live[0]!.created_at as string), listed.date);
    if (uploadAhead) return { run: run.id, kind: "ahead", ms: uploadAhead };
    // GitHub answers with a redirect to the zip's address, which is asked without the token.
    const first = await api.fetchFn(`${api.url}/repos/${repo}/actions/artifacts/${live[0]!.id}/zip`, {
      headers: { authorization: `Bearer ${api.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }, redirect: "manual", signal: AbortSignal.timeout(30_000),
    });
    const location = first.headers.get("location");
    await first.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(first.status) || !location || !/^https:\/\/[^/?#\s]+\//.test(location)) return null;
    const zip = await api.fetchFn(location, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (zip.status !== 200) { await zip.body?.cancel(); return null; }
    const bytes = await boundedBytes(zip, SEEN_BYTES);
    const record = bytes ? seenRecordOf(bytes, run.started, Date.parse(live[0]!.created_at as string), ecosystem) : null;
    return record && "kind" in record ? { run: run.id, ...record } : record;
  } catch { return null; }
}

/** Whether a record lists this fix: same package and a shared advisory; for an image, a shared security release, or the same candidate. */
function listsFix(record: SeenRecord, ecosystem: Ecosystem, fix: CheckedFix): boolean {
  if (isImage(ecosystem)) {
    const key = record.keys.find(k => k.key === ecosystem);
    if (!key) return false;
    return fix.releases?.length ? key.releases.some(v => fix.releases!.includes(v)) : key.candidate === fix.changes[0]!.to;
  }
  const key = record.keys.find(k => k.key === `${ecosystem}:${fix.package}`), ids = new Set(fix.changes.flatMap(c => c.advisories));
  return !!key && key.advisories.some(a => ids.has(a));
}

/**
 * For each fix (by branch), the first run that saw it: from this run back, newest first, through the workflow's runs on
 * the default branch started by schedule or workflow_dispatch (at most `limit`), a valid record that lists the fix moves
 * it to that run, one that does not ends the row, and a run with no valid record is passed over. Null: no record lists
 * it. Throws when this run or the workflow's runs cannot be read, when GitHub's start of this run does not agree with
 * this runner's clock or with the Date of its answer, or when the walk takes longer than SEEN_WALK_MS; the caller then
 * keeps the receipt's found_at. stopped: the run whose times do not agree, at which the walk stopped, and the fixes
 * whose row had not ended there (definitions.md, section 7).
 */
export async function firstSeen(options: { repo: string; runId: number; defaultBranch: string; ecosystem: Ecosystem; api: string; token: string; fetchFn?: typeof fetch; limit?: number; now?: () => number }, fixes: CheckedFix[]): Promise<{ read: number; seen: Map<string, { at: string; run: number; ended: boolean } | null>; stopped: (ClockStop & { branches: string[] }) | null }> {
  const api = apiOf(options), limit = options.limit ?? SEEN_RUNS, now = options.now ?? Date.now, until = now() + SEEN_WALK_MS;
  // Before each request: the PR job opens the PR after the walk, within the job's own time limit.
  const inTime = () => { if (now() > until) throw new Error(`the walk took longer than ${SEEN_WALK_MS / 60_000} minutes.`); };
  if (!Number.isSafeInteger(options.runId) || options.runId <= 0) throw new Error("this run's id is not a number.");
  const own = await call(api, "GET", `/repos/${options.repo}/actions/runs/${options.runId}`);
  const { workflow_id: workflow, run_started_at: ownStart } = (own.json ?? {}) as { workflow_id?: unknown; run_started_at?: unknown };
  if (own.status !== 200 || !Number.isSafeInteger(workflow)) throw new Error(`GitHub did not give this run (HTTP ${own.status}).`);
  // This job runs after its run started. GitHub's start later than this runner's clock, or than the answer that gives
  // it, means GitHub's times and the runner's (the records' checked_at) are not one clock now: nothing is compared.
  const ownAt = typeof ownStart === "string" && TIME.test(ownStart) && isDate(ownStart) ? Date.parse(ownStart) : NaN;
  if (!Number.isFinite(ownAt)) throw new Error("GitHub gave no start time of this run.");
  const clock = now();
  if (ownAt > clock) throw new Error(`GitHub's start of this run is ${span(ownAt - clock)} later than this runner's clock (GitHub's clock and the runner's do not agree).`);
  if (pastAnswer(ownAt, own.date)) throw new Error(`GitHub's start of this run is ${span(pastAnswer(ownAt, own.date))} later than the Date of GitHub's answer that gives it.`);
  const runs: { id: number; started: number; dated: number | null }[] = [];
  for (let page = 1; runs.length < limit && page <= 10; page++) {
    inTime();
    const query = new URLSearchParams({ branch: options.defaultBranch, per_page: "100", page: String(page) });
    const listed = await call(api, "GET", `/repos/${options.repo}/actions/workflows/${workflow}/runs?${query}`);
    const items = (listed.json as { workflow_runs?: unknown } | null)?.workflow_runs;
    if (listed.status !== 200 || !Array.isArray(items)) throw new Error(`GitHub did not list this workflow's runs (HTTP ${listed.status}).`);
    for (const r of items as { id?: unknown; event?: unknown; head_branch?: unknown; run_started_at?: unknown }[]) {
      const started = typeof r?.run_started_at === "string" ? Date.parse(r.run_started_at) : NaN;
      if (!Number.isSafeInteger(r?.id) || (r.id as number) > options.runId || !["schedule", "workflow_dispatch"].includes(r.event as string) || r.head_branch !== options.defaultBranch || !Number.isFinite(started)) continue;
      if (!runs.some(seen => seen.id === r.id)) runs.push({ id: r.id as number, started, dated: listed.date });
    }
    if (items.length < 100) break;
  }
  runs.sort((a, b) => b.id - a.id).splice(limit);
  const state = new Map(fixes.map(f => [f.branch, { found: null as { at: string; run: number } | null, ended: false }]));
  let read = 0, stopped: (ClockStop & { branches: string[] }) | null = null;
  for (const run of runs) {
    if ([...state.values()].every(s => s.ended)) break;
    inTime();
    const record = await seenOfRun(api, options.repo, run, options.ecosystem);
    if (!record) continue;
    // Its times do not agree: what it saw cannot be placed, so it neither lists the fix nor is passed over (which could
    // carry a row past a run that did not see it); the walk stops, and the rows still open say so (section 7).
    if ("kind" in record) { stopped = { ...record, branches: fixes.filter(f => !state.get(f.branch)!.ended).map(f => f.branch) }; break; }
    read++;
    for (const fix of fixes) {
      const s = state.get(fix.branch)!;
      if (s.ended) continue;
      // The earliest record time of the row (definitions.md, section 3), not the lowest run id's: a re-run of an older
      // run keeps its id and moves its start and its record later (R252 N4).
      if (listsFix(record, options.ecosystem, fix)) { if (!s.found || Date.parse(record.checked_at) < Date.parse(s.found.at)) s.found = { at: record.checked_at, run: run.id }; }
      else s.ended = true;
    }
  }
  return { read, seen: new Map(fixes.map(f => { const s = state.get(f.branch)!; return [f.branch, s.found ? { ...s.found, ended: s.ended } : null]; })), stopped };
}

/**
 * `git push` of one commit to a new branch, never forced, to the repository's own URL. The token reaches Git through
 * its environment (GIT_CONFIG_*), not .git/config. Only that URL's protocol is allowed; hooks and helpers are off.
 */
export function pushInvocation(top: string, remote: string, commit: string, branch: string, token: string | null, hooks: string, environment: NodeJS.ProcessEnv = process.env): { args: string[]; env: NodeJS.ProcessEnv } {
  const https = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._/-]+\.git$/.test(remote);
  if (!https && !(posix.isAbsolute(remote) || /^[A-Za-z]:[\\/]/.test(remote))) throw new Error("The remote must be an https URL or an absolute path.");
  if (!SHA.test(commit) || !/^ludion\/[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("Only a fix commit goes to a ludion/ branch.");
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(environment)) if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
  Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_ALLOW_PROTOCOL: https ? "https" : "file" });
  if (https && token) Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${remote}.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` });
  const config = [`core.hooksPath=${hooks}`, ...GIT_SETTINGS, `protocol.${https ? "https" : "file"}.allow=always`, "credential.helper=", "http.followRedirects=false", "push.recurseSubmodules=no"].flatMap(c => ["-c", c]);
  // A plain refspec: no "+", and no --force of any kind, so Git refuses to move a branch that is not a fast-forward.
  return { args: ["-C", top, "--no-pager", "--no-replace-objects", ...config, "push", "--no-verify", "--porcelain", remote, `${commit}:refs/heads/${branch}`], env };
}

export function pushBranch(top: string, remote: string, commit: string, branch: string, token: string | null): void {
  const program = gitProgram(top), hooks = mkdtempSync(join(tmpdir(), "ludion-no-hooks-"));
  try {
    const { args, env } = pushInvocation(top, remote, commit, branch, token, hooks);
    const result = spawnSync(program, args, { cwd: hooks, env, encoding: "utf8", timeout: 120_000, windowsHide: true });
    if (result.error) throw new Error(`Git could not run: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`git push failed: ${plain(`${result.stdout}\n${result.stderr}`).replaceAll(token ?? "\0", "***").trim().slice(-300)}`);
  } finally { rmSync(hooks, { recursive: true, force: true }); }
}

/**
 * npm: the judge (candidate-judge.ts, as `patch` runs it) on package.json and package-lock.json at the base and at the
 * fix's commit, read by Git into two private folders. Null when it says ready_except_build, else why not. It reads the
 * registry, OSV, CISA's catalog and FIRST's EPSS list, as `patch` does; nothing is installed or run.
 */
async function judgeAgain(top: string, prefix: string, base: string, fix: CheckedFix, judge: (before: string, after: string) => Promise<Judgement>): Promise<string | null> {
  const dirs = [mkdtempSync(join(tmpdir(), "ludion-judge-base-")), mkdtempSync(join(tmpdir(), "ludion-judge-fix-"))];
  try {
    for (const [i, rev] of [base, fix.commit].entries()) for (const name of MANIFESTS.npm) {
      writeFileSync(join(dirs[i]!, name), git(top, ["cat-file", "blob", `${rev}:${prefix}${name}`]).stdout);
    }
    const refusal = candidateRefusal(await judge(dirs[0]!, dirs[1]!));
    return refusal ? refusal.slice(0, 400) : null;
  } catch (error) {
    return `could not judge: ${plain(error instanceof Error ? error.message : String(error)).slice(0, 300)}`;
  } finally { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); }
}

/** A bounded JSON or header read from an official registry; at most `max` bytes of body. */
async function registryJson(fetchFn: typeof fetch, url: string, init: RequestInit = {}, max = 32 * 1024 * 1024): Promise<any> {
  const res = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(30_000), ...init, headers: { accept: "application/json", "user-agent": "Ludion-Security-Preview", ...(init.headers ?? {}) } });
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`${new URL(url).hostname} answered HTTP ${res.status}.`); }
  const reader = res.body?.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = reader ? await reader.read() : { done: true as const, value: undefined };
    if (part.done) break;
    size += part.value.length;
    if (size > max) { await reader?.cancel().catch(() => {}); throw new Error(`${new URL(url).hostname}'s answer is larger than ${max} bytes.`); }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** One tagged release as Packagist lists it (repo.packagist.org's p2 metadata, minified entries expanded). */
export type PackagistRelease = Record<string, unknown>;
export async function packagistRelease(name: string, version: string, fetchFn: typeof fetch = fetch): Promise<PackagistRelease | null> {
  // The name comes from the untrusted lock: a pattern without nested repetition, so it runs in linear time (no ReDoS).
  if (name.length > 214 || !/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(name)) throw new Error(`Invalid Composer package name: ${plain(name).slice(0, 100)}`);
  const doc = await registryJson(fetchFn, `https://repo.packagist.org/p2/${name}.json`);
  const list = doc?.packages?.[name];
  if (!Array.isArray(list)) throw new Error(`Invalid Packagist metadata for ${name}.`);
  let current: Record<string, unknown> = {};
  for (const entry of list) {
    if (!isObject(entry)) throw new Error(`Invalid Packagist metadata for ${name}.`);
    current = doc.minified === "composer/2.0" ? { ...current } : {};
    for (const [key, value] of Object.entries(entry)) { if (value === "__unset") delete current[key]; else current[key] = value; }
    if (String(current.version).replace(/^v(?=\d)/, "") === version.replace(/^v(?=\d)/, "")) return current;
  }
  return null;
}

/**
 * Composer: every composer.lock entry the fix adds or moves (the planned package and the new ones) must say what
 * Packagist lists for that name and version in every key Composer installs or runs from (COMPOSER_INSTALL): the archive
 * and commit, the requirements, autoload rules, binaries and type. A pinned archive from another repository, a fork's
 * commit served through the upstream's URL, or an added autoload file is refused. The new packages' requirements are
 * then Packagist's, so contentProblem's "required by the fixed version" rests on Packagist's data.
 */
async function composerAgain(top: string, prefix: string, base: string, fix: CheckedFix, release: (name: string, version: string) => Promise<PackagistRelease | null>): Promise<string | null> {
  const read = (rev: string) => JSON.parse(git(top, ["cat-file", "blob", `${rev}:${prefix}composer.lock`]).stdout) as Record<string, unknown>;
  const entries = (lock: Record<string, unknown>) => [...(Array.isArray(lock.packages) ? lock.packages : []), ...(Array.isArray(lock["packages-dev"]) ? lock["packages-dev"] : [])].filter(isObject);
  try {
    // Every entry that is not, apart from descriptive metadata, one the base already had: the planned package, new ones,
    // and anything else that differs (which contentProblem has refused already, unless it is one of those).
    const before = entries(read(base)).map(withoutMetadata);
    for (const entry of entries(read(fix.commit)).filter(e => !before.some(b => isDeepStrictEqual(b, withoutMetadata(e))))) {
      const name = String(entry.name), version = String(entry.version), at = `${plain(name).slice(0, 100)}@${plain(version).slice(0, 60)}`;
      const listed = await release(name, version);
      if (!listed) return `Packagist lists no ${at}.`;
      // Everything Composer installs or runs from the entry, as Packagist lists it: the archive and commit, and also the
      // requirements, autoload rules, binaries and type, so a forged entry cannot keep Packagist's archive and add code paths.
      for (const key of COMPOSER_INSTALL) {
        if (!isDeepStrictEqual(entry[key], listed[key])) return `composer.lock's ${key} for ${at} is not what Packagist lists.`;
      }
    }
    return null;
  } catch (error) {
    return `Packagist could not be read: ${plain(error instanceof Error ? error.message : String(error)).slice(0, 300)}`;
  }
}

/**
 * The IDs of OSV's advisories on one package version (api.osv.dev/v1/query; the name and version only are sent), not
 * counting withdrawn ones. `patch` applies a fix only when its re-scan finds nothing left on the package, so the version
 * a Composer or Maven fix moves to must have none.
 */
export async function osvAdvisories(ecosystem: "Packagist" | "Maven", name: string, version: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const doc = await registryJson(fetchFn, "https://api.osv.dev/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: { ecosystem, name }, version }) }, 16 * 1024 * 1024);
  const vulns = Array.isArray(doc?.vulns) ? doc.vulns : [];
  if (!isObject(doc) || (doc.vulns !== undefined && !Array.isArray(doc.vulns))) throw new Error("OSV's answer is not a list of advisories.");
  const ids = vulns.filter((v: unknown) => isObject(v) && !v.withdrawn).map((v: Record<string, unknown>) => plain(String(v.id)).slice(0, 100));
  if (!ids.length && typeof doc.next_page_token === "string") throw new Error("OSV's answer has more pages.");
  return ids;
}

/** The digest Docker Hub gives for an official PHP or Node.js image tag now: the manifest list's (what `docker pull` records). */
export async function dockerHubDigest(tag: string, fetchFn: typeof fetch = fetch, repository: keyof typeof IMAGES = "php"): Promise<string> {
  // The same HEAD the scan makes for a move's tag (php.ts, imageMove).
  const digest = await dockerHubTag(repository, tag, fetchFn);
  if (digest === null) throw new Error(`Docker Hub gave no digest for ${repository}:${tag} (HTTP 404).`);
  return digest;
}

/** PHP and Node.js: the digest the Dockerfile pins must be the one Docker Hub gives for the tag it names, so no other image hides under it. */
async function imageAgain(top: string, prefix: string, fix: CheckedFix, repository: keyof typeof IMAGES, digestOf: (tag: string) => Promise<string>): Promise<string | null> {
  try {
    const image = IMAGES[repository].parse(git(top, ["cat-file", "blob", `${fix.commit}:${prefix}${fix.files[0]!.path}`]).stdout).reference;
    const match = new RegExp(`(?:^|/)${repository}:([^@]+)@(sha256:[a-f0-9]{64})$`).exec(image);
    if (!match) return "the Dockerfile's image is not pinned by digest.";
    const listed = await digestOf(match[1]!);
    return listed === match[2] ? null : `${repository}:${match[1]} is pinned at ${match[2]}, and Docker Hub gives ${listed} for that tag now.`;
  } catch (error) {
    return `Docker Hub could not be read: ${plain(error instanceof Error ? error.message : String(error)).slice(0, 300)}`;
  }
}

/**
 * The PR job: checks the artifact, then for each fix, unless a PR from its branch exists, pushes the branch (never moving
 * one that exists at another commit) and opens one PR into the default branch. A fix that fails stops no other.
 */
export async function openFixes(options: { dir: string; artifact: string; base: string; repo: string; ref: string; api: string; remote: string; token: string; runId?: number; fetchFn?: typeof fetch; now?: () => number; push?: typeof pushBranch; judgeNpm?: (before: string, after: string) => Promise<Judgement>; npmManifest?: (name: string, version: string) => Promise<Record<string, unknown> | null>; packagist?: (name: string, version: string) => Promise<PackagistRelease | null>; phpDigest?: (tag: string) => Promise<string>; nodeDigest?: (tag: string) => Promise<string>; osv?: (ecosystem: "Packagist" | "Maven", name: string, version: string) => Promise<string[]> }): Promise<{ checked: CheckedArtifact; deliveries: Delivery[] }> {
  const api = apiOf(options);
  // Before the artifact is read: the run must be on the repository's default branch, where PRs go.
  const repository = await call(api, "GET", `/repos/${options.repo}`);
  const defaultBranch = (repository.json as { default_branch?: unknown } | null)?.default_branch;
  if (repository.status !== 200 || typeof defaultBranch !== "string") throw new Error(`GitHub did not give the repository's default branch (HTTP ${repository.status}).`);
  if (options.ref !== `refs/heads/${defaultBranch}`) throw new Error(`This run is on ${plain(options.ref)}, not on the default branch ${plain(defaultBranch)}; no PR is opened.`);
  const checked = checkArtifact(options.dir, options.artifact, options.base);
  const { top, prefix } = workTree(rootPath(options.dir)), owner = options.repo.split("/")[0]!, push = options.push ?? pushBranch;
  const deliveries: Delivery[] = [];
  // found_at's walk, once per run and only when a PR is about to be opened; a walk that fails stops no fix.
  let walked: Promise<Awaited<ReturnType<typeof firstSeen>> | { why: string }> | null = null;
  const walk = () => walked ??= options.runId === undefined
    ? Promise.resolve({ why: "this run's id was not given." })
    : firstSeen({ repo: options.repo, runId: options.runId, defaultBranch, ecosystem: checked.ecosystem!, api: options.api, token: options.token, fetchFn: options.fetchFn, now: options.now }, checked.fixes).catch(error => ({ why: errorText(error) }));
  for (const fix of checked.fixes) {
    const done = (d: Omit<Delivery, "package" | "branch">) => deliveries.push({ package: fix.package, branch: fix.branch, ...d });
    try {
      // Gate 4: one PR per fix. Any PR from this branch, open or closed, means this fix is not opened again.
      const query = new URLSearchParams({ state: "all", head: `${owner}:${fix.branch}`, per_page: "100" });
      const pulls = await call(api, "GET", `/repos/${options.repo}/pulls?${query}`);
      if (pulls.status !== 200 || !Array.isArray(pulls.json)) throw new Error(`GitHub did not list the PRs from ${fix.branch} (HTTP ${pulls.status}).`);
      const same = (pulls.json as { number?: unknown; state?: unknown; head?: { ref?: unknown } }[]).filter(p => p.head?.ref === fix.branch);
      const open = same.find(p => p.state === "open"), closed = same.find(p => p.state === "closed");
      if (open) { done({ outcome: "open_pr_exists", pr: Number(open.number) }); continue; }
      if (closed) { done({ outcome: "closed_pr_exists", pr: Number(closed.number), reason: "A PR from this branch was closed; it is not opened again." }); continue; }
      const ref = await call(api, "GET", `/repos/${options.repo}/git/ref/heads/${segments(fix.branch)}`);
      const remoteSha = ref.status === 200 ? (ref.json as { ref?: unknown; object?: { sha?: unknown } } | null) : null;
      if (ref.status === 200 && remoteSha?.ref !== `refs/heads/${fix.branch}`) throw new Error(`GitHub's answer for the branch ${fix.branch} is not that branch.`);
      if (ref.status !== 200 && ref.status !== 404) throw new Error(`GitHub did not say whether ${fix.branch} exists (HTTP ${ref.status}).`);
      const remoteCommit = remoteSha?.object?.sha;
      if (remoteSha && (typeof remoteCommit !== "string" || !SHA.test(remoteCommit))) throw new Error(`GitHub's answer for the branch ${fix.branch} names no commit.`);
      if (remoteSha && remoteCommit !== fix.commit) {
        // A branch an earlier run pushed before its PR could not be opened (for example, while the repository did not let
        // Actions open PRs) holds this same fix when its commit has this commit's tree and the same only parent: the PR is
        // opened from it. Any other commit is left alone, and the fix fails, saying what to do.
        const earlier = await call(api, "GET", `/repos/${options.repo}/git/commits/${remoteCommit}`);
        const e = earlier.json as { tree?: { sha?: unknown }; parents?: { sha?: unknown }[] } | null;
        if (!(earlier.status === 200 && e?.tree?.sha === fix.tree && Array.isArray(e.parents) && e.parents.length === 1 && e.parents[0]?.sha === checked.base)) {
          done({ outcome: "branch_differs", reason: "The branch exists on GitHub at another commit with another change or base, and no PR is from it. Ludion never moves a branch (no force push): delete it, and the next run pushes this fix and opens its PR." });
          continue;
        }
      }
      // The lockfile's content, which only the registry can confirm: each moved or added entry's requirements as the
      // registry lists them, then the judge again, here, on the base and this commit.
      if (checked.ecosystem === "npm") {
        const problem = await npmAgain(top, prefix, checked.base, fix, options.npmManifest ?? ((name, version) => registryManifest(name, version)));
        if (problem) throw new Error(`Not pushed: ${problem}`);
        const refusal = await judgeAgain(top, prefix, checked.base, fix, options.judgeNpm ?? ((before, after) => judgeNpmCandidate(before, after)));
        if (refusal) throw new Error(`Not pushed: the judge was run again on this commit's lockfile. ${refusal}`);
      }
      // Composer and PHP: what the lockfile or the Dockerfile pins, against the official registry, here.
      if (checked.ecosystem === "composer") {
        const problem = await composerAgain(top, prefix, checked.base, fix, options.packagist ?? ((name, version) => packagistRelease(name, version)));
        if (problem) throw new Error(`Not pushed: ${problem}`);
      }
      // Composer and Maven: the version moved to has no OSV advisory now (npm's judge does this for npm).
      if (checked.ecosystem === "composer" || checked.ecosystem === "maven") {
        const ask = options.osv ?? ((ecosystem, name, version) => osvAdvisories(ecosystem, name, version));
        for (const change of fix.changes) {
          let ids: string[];
          try { ids = await ask(checked.ecosystem === "composer" ? "Packagist" : "Maven", fix.package, change.to.replace(/^v(?=\d)/, "")); }
          catch (error) { throw new Error(`Not pushed: OSV could not be read: ${plain(error instanceof Error ? error.message : String(error)).slice(0, 300)}`); }
          if (ids.length) throw new Error(`Not pushed: OSV lists ${ids.slice(0, 5).join(", ")} for ${fix.package}@${change.to}, the version this fix moves to.`);
        }
      }
      if (isImage(checked.ecosystem)) {
        const repository = checked.ecosystem, given = repository === "node" ? options.nodeDigest : options.phpDigest;
        const problem = await imageAgain(top, prefix, fix, repository, given ?? (tag => dockerHubDigest(tag, undefined, repository)));
        if (problem) throw new Error(`Not pushed: ${problem}`);
      }
      if (!remoteSha) push(top, options.remote, fix.commit, fix.branch, options.token);
      const w = await walk();
      if ("why" in w) fix.seen = { at: fix.found_at, run: null, read: 0, ended: false, why: w.why };
      else {
        const s = w.seen.get(fix.branch) ?? null;
        // The walk stopped at a run whose times do not agree while this fix's row was open (definitions.md, section 7).
        const stop: { stop?: ClockStop } = w.stopped?.branches.includes(fix.branch) ? { stop: { run: w.stopped.run, kind: w.stopped.kind, ms: w.stopped.ms } } : {};
        if (!s) fix.seen = { at: fix.found_at, run: null, read: w.read, ended: !stop.stop, ...stop };
        else if (Date.parse(s.at) <= Date.parse(fix.found_at)) { fix.seen = { at: s.at, run: s.run, read: w.read, ended: s.ended, ...stop }; fix.found_at = s.at; }
        else fix.seen = { at: fix.found_at, run: null, read: w.read, ended: s.ended, earlier: true, ...stop };
      }
      const created = await call(api, "POST", `/repos/${options.repo}/pulls`, { title: fix.subject, head: fix.branch, base: defaultBranch, body: pullRequestBody(checked, fix), maintainer_can_modify: false });
      const pr = created.json as { number?: unknown; html_url?: unknown } | null;
      if (created.status !== 201 || typeof pr?.number !== "number") throw new Error(`GitHub did not open the PR (HTTP ${created.status}${typeof (created.json as { message?: unknown } | null)?.message === "string" ? `: ${plain((created.json as { message: string }).message).slice(0, 200)}` : ""}). The branch ${fix.branch} is on GitHub; the next run opens the PR from it while the default branch has not moved.`);
      done({ outcome: "opened", pr: pr.number, url: typeof pr.html_url === "string" ? pr.html_url : undefined });
    } catch (error) {
      done({ outcome: "failed", reason: plain(error instanceof Error ? error.message : String(error)).slice(0, 500) });
    }
  }
  return { checked, deliveries };
}

/**
 * A closed PR is not opened again, so it silences its fix for good. Every fix the PR job sees was applied by the
 * validation job to this run's commit, so the default branch still lacks it: each run says so as a warning annotation
 * (a workflow command, on stderr so that the step summary, which takes stdout, stays plain), and the run stays green.
 */
export function closedWarnings(deliveries: Delivery[]): string[] {
  const escape = (value: string) => plain(value).replace(/%/g, "%25");
  return deliveries.filter(d => d.outcome === "closed_pr_exists").map(d => `::warning::${escape(`Ludion: the fix of ${d.package} (branch ${d.branch}) is still not on the default branch, and its PR #${d.pr} was closed, so Ludion does not open it again. Reopen #${d.pr} or apply the fix yourself.`)}`);
}

// The end of exposure time (docs/bench/lexp/definitions.md, sections 1 and 2): the merge of the PR Ludion opened for a
// fix, recorded on that PR by the template's merged job, which holds pull-requests: write only and checks out nothing.
/**
 * recorded_at: this job's clock when it read the PR; answer_date: the Date of GitHub's answer that gave merged_at, or
 * null; merged_at_doubt: why merged_at is not used as the end (later than that Date or than this job's clock), or null
 * (definitions.md, sections 2 and 7).
 */
export type MergeRecord = { schema: 1; pr: number; branch: string; merged_at: string; merge_commit_sha: string; fix_published_at: string | null; found_at: string | null; applied_at: string | null; recorded_at: string; answer_date: string | null; merged_at_doubt: string | null };
const MERGED_MARK = "<!-- ludion-merged", BOT = "github-actions[bot]";

/** A time in the code span of one row of the PR body Ludion wrote (pullRequestBody), or null. */
function bodyTime(body: string, row: string): string | null {
  const line = body.split("\n").find(l => l.startsWith(`| ${row} | `));
  const m = line ? /^\| [^|]+ \| `([^`]*)`/.exec(line) : null;
  // The form of a time is not enough: 2026-13-45T00:00:00Z and 2026-02-30T00:00:00Z have it and are no date (R252 N3, R252b N9).
  return m && TIME.test(m[1]!) && isDate(m[1]!) ? new Date(m[1]!).toISOString() : null;
}
function hours(from: string | null, to: string | null, what: string): string {
  if (from === null || to === null) return "unknown";
  const ms = Date.parse(to) - Date.parse(from);
  return ms < 0 ? `not computed: ${what}` : `\`${(ms / 3_600_000).toFixed(1)}\` hours`;
}

/** Records the merge of PR `pr`, once, when it is a merged Ludion fix into the default branch; says why otherwise. */
export async function recordMerge(options: { repo: string; pr: number; api: string; token: string; fetchFn?: typeof fetch; now?: () => number }): Promise<{ outcome: "recorded" | "already_recorded" | "not_recorded"; reason?: string; record?: MergeRecord; comment?: string }> {
  const api = apiOf(options);
  if (!Number.isSafeInteger(options.pr) || options.pr <= 0) throw new Error("--pr must be a PR number.");
  const repository = await call(api, "GET", `/repos/${options.repo}`);
  const defaultBranch = (repository.json as { default_branch?: unknown } | null)?.default_branch;
  if (repository.status !== 200 || typeof defaultBranch !== "string") throw new Error(`GitHub did not give the repository's default branch (HTTP ${repository.status}).`);
  const pulled = await call(api, "GET", `/repos/${options.repo}/pulls/${options.pr}`);
  // This job's clock just after GitHub's answer for the PR.
  const ran = (options.now ?? Date.now)();
  if (pulled.status !== 200 || !isObject(pulled.json)) throw new Error(`GitHub did not give PR #${options.pr} (HTTP ${pulled.status}).`);
  const p = pulled.json as { merged?: unknown; merged_at?: unknown; merge_commit_sha?: unknown; body?: unknown; user?: { login?: unknown }; head?: { ref?: unknown; repo?: { full_name?: unknown } | null }; base?: { ref?: unknown } };
  const no = (reason: string) => ({ outcome: "not_recorded" as const, reason: `PR #${options.pr}: ${reason}` });
  const body = typeof p.body === "string" ? p.body.replace(/\r\n/g, "\n") : "";
  if (p.merged !== true) return no("the PR is not merged.");
  if (typeof p.merged_at !== "string" || !TIME.test(p.merged_at) || !isDate(p.merged_at)) return no("its merged_at is not a time.");
  if (typeof p.merge_commit_sha !== "string" || !SHA.test(p.merge_commit_sha)) return no("its merge commit is not a full SHA.");
  if (p.user?.login !== BOT) return no(`the PR was not opened by ${BOT}.`);
  if (p.head?.repo?.full_name !== options.repo) return no("its head is in another repository.");
  if (typeof p.head?.ref !== "string" || !/^ludion\/[A-Za-z0-9._/-]+$/.test(p.head.ref)) return no("its head is not a Ludion branch.");
  if (p.base?.ref !== defaultBranch) return no("its base is not the default branch.");
  if (!body.startsWith("<!-- ludion-fix -->\n")) return no("its body does not start with Ludion's marker.");
  for (let page = 1; page <= 10; page++) {
    const listed = await call(api, "GET", `/repos/${options.repo}/issues/${options.pr}/comments?${new URLSearchParams({ per_page: "100", page: String(page) })}`);
    if (listed.status !== 200 || !Array.isArray(listed.json)) throw new Error(`GitHub did not list PR #${options.pr}'s comments (HTTP ${listed.status}).`);
    const comments = listed.json as { user?: { login?: unknown }; body?: unknown }[];
    if (comments.some(c => c?.user?.login === BOT && typeof c.body === "string" && c.body.startsWith(MERGED_MARK))) return { outcome: "already_recorded" };
    if (comments.length < 100) break;
  }
  // GitHub cannot have merged the PR after its own answer about it, nor after this job, which runs after the merge,
  // read it. Either means GitHub's merged_at is not on the same clock as the rest: it is kept, and not used as the end.
  const merged = Date.parse(p.merged_at), pastDate = pastAnswer(merged, pulled.date);
  const doubt = pastDate ? `GitHub's merged_at is ${span(pastDate)} later than the Date of GitHub's answer that gives it`
    : merged > ran ? `GitHub's merged_at is ${span(merged - ran)} later than this job's clock` : null;
  const record: MergeRecord = {
    schema: 1, pr: options.pr, branch: p.head.ref, merged_at: new Date(merged).toISOString(), merge_commit_sha: p.merge_commit_sha,
    fix_published_at: bodyTime(body, "Fix published"), found_at: bodyTime(body, "Found"), applied_at: bodyTime(body, "Branch made"),
    recorded_at: new Date(ran).toISOString(), answer_date: pulled.date === null ? null : new Date(pulled.date).toISOString(), merged_at_doubt: doubt,
  };
  const end = doubt === null ? record.merged_at : null;
  const lag = (ran - merged) / 3_600_000;
  const notCounted = body.split("\n").some(l => l.startsWith("| Fix published | none ("));
  const code = (v: string | null) => v === null ? "unknown" : `\`${v}\``;
  const branchName = /^[A-Za-z0-9._/-]{1,200}$/.test(defaultBranch) ? code(defaultBranch) : "branch";
  const comment = [
    `${MERGED_MARK} ${JSON.stringify(record)} -->`,
    `**Ludion: merge recorded.** This PR, which Ludion opened for one fix, was merged into the default ${branchName}. The merge is the end of the fix's exposure time: the fix is now in the project's configuration on its default branch. It is not deployed by this, and when production gets it is not recorded.${doubt === null ? "" : ` **GitHub's merged_at is not used as the end:** ${doubt}, so the hours that end at the merge are not computed.`}`,
    "",
    "| | |",
    "|---|---|",
    `| Fix published | ${notCounted ? "none (no advisory; this move is not counted in exposure time)" : code(record.fix_published_at)} |`,
    `| Found | ${code(record.found_at)} |`,
    `| Branch made | ${code(record.applied_at)} |`,
    `| Merged | ${code(record.merged_at)} (GitHub's merged_at), merge commit ${code(record.merge_commit_sha.slice(0, 12))} |`,
    `| Recorded | ${code(record.recorded_at)} (this job's clock), ${code(Math.abs(lag).toFixed(1))} hours ${lag < 0 ? "before" : "after"} GitHub's merged_at; ${record.answer_date === null ? "GitHub's answer had no Date header that is a date" : `GitHub's answer was dated ${code(record.answer_date)}`} |`,
    `| Exposure time (published → merged) | ${notCounted ? "not counted" : doubt !== null ? `not computed: ${doubt}` : hours(record.fix_published_at, end, "the publication time is later than the merge")} |`,
    `| Published → found | ${notCounted ? "not counted" : hours(record.fix_published_at, record.found_at, "the publication time is later than the found time")} |`,
    `| Found → merged | ${doubt !== null ? `not computed: ${doubt}` : hours(record.found_at, end, "the found time is later than the merge")} |`,
    "",
    "The publication, found and branch times are this PR's body as Ludion's PR job wrote it, checked for form only: anyone who can edit this PR could have changed them. The merge time and the merge commit are GitHub's.",
    "",
  ].join("\n");
  const posted = await call(api, "POST", `/repos/${options.repo}/issues/${options.pr}/comments`, { body: comment });
  if (posted.status !== 201) throw new Error(`GitHub did not post the record on PR #${options.pr} (HTTP ${posted.status}).`);
  return { outcome: "recorded", record, comment };
}

/** `ludion deliver pack|open|merged`: the scheduled workflow's steps (action.yml). */
export async function deliverCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [step, ...rest] = args;
  const { values } = parseArgs({ args: rest, options: { dir: { type: "string", default: "." }, result: { type: "string" }, out: { type: "string" }, artifact: { type: "string" }, base: { type: "string" }, repo: { type: "string" }, ref: { type: "string" }, api: { type: "string" }, remote: { type: "string" }, "run-id": { type: "string" }, pr: { type: "string" }, json: { type: "boolean" } } });
  const number = (value: string | undefined, what: string) => {
    if (value === undefined) return undefined;
    if (!/^[1-9]\d{0,15}$/.test(value)) throw new Error(`${what} must be a number.`);
    return Number(value);
  };
  if (step === "merged") {
    const token = env.GH_TOKEN;
    if (!values.repo || !values.pr || !values.api || !token) throw new Error("deliver merged needs --repo, --pr, --api and GH_TOKEN.");
    const result = await recordMerge({ repo: values.repo, pr: number(values.pr, "--pr")!, api: values.api, token });
    if (values.json) console.log(JSON.stringify(result.record ? { outcome: result.outcome, record: result.record } : { outcome: result.outcome, reason: result.reason ?? null }, null, 2));
    else console.log(result.outcome === "recorded" ? `Recorded the merge of PR #${values.pr} at ${result.record!.merged_at} (${result.record!.merged_at_doubt === null ? "the end of its fix's exposure time" : `not used as the end: ${result.record!.merged_at_doubt}`}).` : result.outcome === "already_recorded" ? `PR #${values.pr}'s merge is already recorded.` : `Not recorded: ${result.reason}`);
    return 0;
  }
  if (step === "pack") {
    if (!values.result || !values.out) throw new Error("deliver pack needs --result <patch --json output> and --out <folder>.");
    const { fixes } = packFixes(values.dir!, values.result, values.out);
    console.log(`Packed ${fixes} applied fix${fixes === 1 ? "" : "es"} into ${values.out}.`);
    return 0;
  }
  if (step !== "open") throw new Error("Usage: ludion deliver pack|open|merged (the scheduled workflow's steps; see action.yml).");
  const token = env.GH_TOKEN;
  if (!values.artifact || !values.base || !values.repo || !values.ref || !values.api || !values.remote || !token) throw new Error("deliver open needs --artifact, --base, --repo, --ref, --api, --remote and GH_TOKEN.");
  const { checked, deliveries } = await openFixes({ dir: values.dir!, artifact: values.artifact, base: values.base, repo: values.repo, ref: values.ref, api: values.api, remote: values.remote, token, runId: number(values["run-id"], "--run-id") });
  if (values.json) console.log(JSON.stringify({ base: checked.base, receipt: checked.id, not_applied: checked.notApplied, deliveries }, null, 2));
  else {
    console.log(`Receipt ${checked.id ?? "none"} on ${checked.base.slice(0, 12)}: ${checked.fixes.length} applied fix${checked.fixes.length === 1 ? "" : "es"}${Object.keys(checked.notApplied).length ? `; not applied: ${Object.entries(checked.notApplied).map(([k, n]) => `${n} ${k}`).join(", ")}` : ""}.`);
    for (const d of deliveries) console.log(`  ${d.package} (${d.branch}): ${d.outcome}${d.pr ? ` #${d.pr}` : ""}${d.reason ? ` — ${d.reason}` : ""}`);
  }
  for (const line of closedWarnings(deliveries)) console.error(line);
  // A branch that holds another commit needs someone to act, so it fails the job as a failed fix does.
  return deliveries.some(d => d.outcome === "failed" || d.outcome === "branch_differs") ? 2 : 0;
}

