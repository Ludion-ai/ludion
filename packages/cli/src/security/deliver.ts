import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { parseArgs } from "node:util";
import { branchName, git, gitProgram, GIT_SETTINGS } from "./branch.ts";
import { MANIFESTS } from "./inventory.ts";
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
const RECEIPT = "receipt.json", BUNDLE = "fixes.bundle";

const plain = (text: string) => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Every value that reaches a branch name, a commit subject or a PR body matches one of these. None allows a backtick,
// "<", "]" or a line break, so in a code span nothing becomes Markdown, HTML or a mention.
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const NAME = /^@?[A-Za-z0-9][A-Za-z0-9._~/:-]{0,213}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_~-]{0,99}$/;
const ADVISORY = /^[A-Za-z][A-Za-z0-9]{1,15}-[A-Za-z0-9._:-]{1,100}$/;
const PATH = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,499}$/;
const IDENTITY = /^Ludion <ludion@ludion\.invalid> \d{1,12} [+-]\d{4}$/;
const VERDICTS = ["stop", "wait", "ready_except_build", "undecidable"] as const;

type Ecosystem = "npm" | "composer" | "maven" | "php";
/** One applied fix, as the PR job takes it from the receipt after checking every field it uses. */
export type CheckedFix = {
  package: string; changes: { from: string; to: string; advisories: string[] }[];
  branch: string; commit: string; subject: string; files: { path: string; after_hash: string }[];
  fix_published_at: string | null; found_at: string; applied_at: string; verdict: (typeof VERDICTS)[number] | null;
};
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

/** The branch `patch --apply` names for a fix (dependency-patch.ts and patch.ts). */
function fixBranchName(prefix: string, ecosystem: Ecosystem, pkg: string, tos: string[]): string {
  return branchName("ludion", ...(prefix ? [prefix] : []), ecosystem, ecosystem === "php" ? tos[0]! : `${pkg}-${[...new Set(tos)].join("-")}`);
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
    return { ecosystem: "php", dockerfile: config.dockerfile as string, allowed: [dockerfile] };
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
  if (policy.ecosystem === "php") {
    if (r.schema !== 1 || r.scope !== "dockerfile_only_not_deployed") refuse("the receipt is not a PHP Dockerfile receipt, and the project's policy is PHP.");
    if (r.outcome !== "applied") { count(r.outcome); return { id, ecosystem: "php", fixes: [], notApplied }; }
    if (r.baseline_passed !== true || r.candidate_passed !== true) refuse("the receipt applies an update whose tests did not pass.");
    if (text(r.base_commit, SHA, "base_commit") !== base) refuse("the receipt's base_commit is not the commit this run checked out.");
    const scan = object(r.scan, "The receipt's scan"), current = object(scan.current, "scan.current"), candidate = object(scan.candidate, "scan.candidate");
    const from = text(current.version, VERSION, "The current PHP version"), to = text(candidate.version, VERSION, "The candidate PHP version");
    const fix: CheckedFix = {
      package: "php", changes: [{ from, to, advisories: [] }],
      branch: text(r.branch, /^ludion\/[A-Za-z0-9._/-]+$/, "The branch"), commit: text(r.commit, SHA, "The commit"),
      subject: `ludion: PHP ${from} -> ${to} in ${policy.dockerfile}`,
      files: [{ path: policy.allowed[0]!, after_hash: text(r.dockerfile_after, HEX64, "dockerfile_after") }],
      fix_published_at: timeOrNull(r.fix_published_at, "fix_published_at"), found_at: time(r.found_at, "found_at"), applied_at: time(r.applied_at, "applied_at"), verdict: null,
    };
    if (fix.branch !== fixBranchName(prefix, "php", "php", [to])) refuse(`the branch ${fix.branch} is not the one Ludion names for PHP ${to}.`);
    return { id, ecosystem: "php", fixes: [fix], notApplied };
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
      return { from: text(change.from, VERSION, "A change's from"), to: text(change.to, VERSION, "A change's to"), advisories: list(change.advisories, 0, 100, "A change's advisories").map(a => text(a, ADVISORY, "An advisory")) };
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
    const fix: CheckedFix = {
      package: pkg, changes, files, verdict,
      branch: text(f.branch, /^ludion\/[A-Za-z0-9._/-]+$/, "A fix's branch"), commit: text(f.commit, SHA, "A fix's commit"),
      subject: `ludion: ${pkg} ${changes.map(c => `${c.from} -> ${c.to}`).join(", ")} (${policy.ecosystem})`,
      fix_published_at: timeOrNull(f.fix_published_at, "fix_published_at"), found_at: time(f.found_at, "found_at"), applied_at: time(f.applied_at, "applied_at"),
    };
    if (fix.branch !== fixBranchName(prefix, policy.ecosystem, pkg, changes.map(c => c.to))) refuse(`the branch ${fix.branch} is not the one Ludion names for ${pkg}.`);
    fixes.push(fix);
  }
  if (new Set(fixes.map(f => f.branch)).size !== fixes.length) refuse("two applied fixes name the same branch.");
  return { id, ecosystem: policy.ecosystem, fixes, notApplied };
}

/** The commit's headers and message, from Git. Only tree, one parent, author and committer are allowed. */
function commitOf(top: string, commit: string): { tree: string; parents: string[]; author: string; committer: string; message: string; other: string[] } {
  const body = git(top, ["cat-file", "commit", commit]).stdout, split = body.indexOf("\n\n");
  const headers = (split < 0 ? body : body.slice(0, split)).split("\n");
  const value = (key: string) => headers.filter(h => h.startsWith(`${key} `)).map(h => h.slice(key.length + 1));
  return {
    tree: value("tree")[0] ?? "", parents: value("parent"), author: value("author").join("\n"), committer: value("committer").join("\n"),
    message: split < 0 ? "" : body.slice(split + 2), other: headers.filter(h => !/^(tree|parent|author|committer) /.test(h)),
  };
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
  const modes = new Map<string, string>();
  for (const line of git(top, ["ls-tree", "-r", "-z", "--full-tree", base]).stdout.split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t"), [mode, type] = line.slice(0, tab).split(" ");
    if (type === "blob") modes.set(line.slice(tab + 1), mode!);
  }
  for (const fix of checked.fixes) {
    const at = `${fix.branch} (${fix.commit.slice(0, 12)})`;
    const c = commitOf(top, fix.commit);
    if (c.parents.length !== 1 || c.parents[0] !== base) refuse(`${at} does not have the base ${base.slice(0, 12)} as its only parent.`);
    if (c.other.length) refuse(`${at} carries headers other than tree, parent, author and committer.`);
    if (!IDENTITY.test(c.author) || !IDENTITY.test(c.committer)) refuse(`${at} is not authored and committed by Ludion.`);
    if (c.message.split("\n")[0] !== fix.subject) refuse(`${at}'s subject is not the receipt's change.`);
    if (!c.message.includes(`Ludion receipt ${checked.id}:`)) refuse(`${at}'s message does not name the receipt ${checked.id}.`);
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
      if (sha256(git(top, ["cat-file", "blob", `${fix.commit}:${prefix}${file.path}`]).stdout) !== file.after_hash) refuse(`${at}'s ${file.path} is not the receipt's file (after_hash).`);
    }
  }
  return { ...checked, base };
}

const PUBLISHED: Record<Ecosystem, string> = {
  npm: "registry.npmjs.org's publish time of the fixed version",
  composer: "Packagist's release date of the fixed version, which its author sets",
  maven: "not read: Ludion does not read Maven Central's publish times yet",
  php: "php.net's release day of the first newer security release, at 00:00 UTC",
};

/** The PR's body, from checked fields only. Every value is in a code span; no free text from the artifact is used. */
export function pullRequestBody(artifact: CheckedArtifact, fix: CheckedFix): string {
  const ecosystem = artifact.ecosystem!, code = (v: string) => `\`${v}\``;
  const advisories = [...new Set(fix.changes.flatMap(c => c.advisories))];
  return [
    "<!-- ludion-fix -->",
    "**プレビュー：マージは行わない。** Preview: Ludion does not merge this PR. Review it as you would any dependency update.",
    "",
    `Ludion found a published security fix and validated it on its own against the base commit ${code(artifact.base.slice(0, 12))}. This PR holds that one fix (one commit).`,
    "",
    "| | |",
    "|---|---|",
    `| Package | ${code(fix.package)} (${ecosystem}) |`,
    `| Change | ${fix.changes.map(c => `${code(c.from)} → ${code(c.to)}`).join(", ")} |`,
    `| Advisories | ${advisories.length ? advisories.map(code).join(", ") : ecosystem === "php" ? "php.net's security release (no advisory ID read)" : "none listed"} |`,
    `| Fix published | ${fix.fix_published_at ? code(fix.fix_published_at) : "unknown"} (${PUBLISHED[ecosystem]}) |`,
    `| Found | ${code(fix.found_at)} (this run's lookup; an earlier run may have seen it first) |`,
    `| Branch made | ${code(fix.applied_at)} |`,
    `| Receipt | ${code(artifact.id!)} (in this run's ludion-fixes artifact) |`,
    "",
    "**What was checked**",
    "",
    `- The project's own test command passed on the base commit and on this change alone, built and run offline in Docker.`,
    `- This commit changes only ${fix.files.map(f => code(f.path)).join(", ")}, and its only parent is the base commit (checked again by the job that opened this PR).`,
    ecosystem === "npm"
      ? `- Ludion's judge on the lockfile change: ${code(fix.verdict!)}. It covers parts of gates 1, 2 and 4 and the wait table, not all four gates (docs/status.md in Ludion lists what it does not check).`
      : `- ${ecosystem === "php" ? "PHP image" : ecosystem === "composer" ? "Composer" : "Maven"} updates do not go through Ludion's judge: no provenance, publisher, install-script, deprecation or withdrawal check, and no wait.`,
    "",
    "**Not checked**",
    "",
    "- Gate 1's OS, SAPI and configuration matching; gate 2's inspection for obfuscated code or new network or process calls; gate 3's check that a changed package loads; the re-query when a wait ends.",
    "- Your CI: GitHub starts no workflow for a PR opened with the workflow's own token. Start it (for example, close and reopen this PR) before merging.",
    "- Production: nothing is deployed.",
    "",
  ].join("\n");
}

type Api = { url: string; token: string; fetchFn: typeof fetch };
async function call(api: Api, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const response = await api.fetchFn(`${api.url}${path}`, {
    method, headers: { authorization: `Bearer ${api.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let json: unknown = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  return { status: response.status, json };
}
const segments = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

/**
 * `git push` of one commit to a new branch, never forced, to the repository's own URL. The token reaches Git through
 * its environment (GIT_CONFIG_*), not .git/config. Only that URL's protocol is allowed; hooks and helpers are off.
 */
export function pushBranch(top: string, remote: string, commit: string, branch: string, token: string | null): void {
  const https = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._/-]+\.git$/.test(remote);
  if (!https && !(posix.isAbsolute(remote) || /^[A-Za-z]:[\\/]/.test(remote))) throw new Error("The remote must be an https URL or an absolute path.");
  const program = gitProgram(top), hooks = mkdtempSync(join(tmpdir(), "ludion-no-hooks-"));
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
    Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_ALLOW_PROTOCOL: https ? "https" : "file" });
    if (https && token) Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${remote}.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` });
    const config = [`core.hooksPath=${hooks}`, ...GIT_SETTINGS, `protocol.${https ? "https" : "file"}.allow=always`, "credential.helper=", "http.followRedirects=false", "push.recurseSubmodules=no"].flatMap(c => ["-c", c]);
    const result = spawnSync(program, ["-C", top, "--no-pager", "--no-replace-objects", ...config, "push", "--no-verify", "--porcelain", remote, `${commit}:refs/heads/${branch}`], { cwd: hooks, env, encoding: "utf8", timeout: 120_000, windowsHide: true });
    if (result.error) throw new Error(`Git could not run: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`git push failed: ${plain(`${result.stdout}\n${result.stderr}`).replaceAll(token ?? "\0", "***").trim().slice(-300)}`);
  } finally { rmSync(hooks, { recursive: true, force: true }); }
}

/**
 * The PR job: checks the artifact, then for each fix, unless a PR from its branch exists, pushes the branch (never moving
 * one that exists at another commit) and opens one PR into the default branch. A fix that fails stops no other.
 */
export async function openFixes(options: { dir: string; artifact: string; base: string; repo: string; ref: string; api: string; remote: string; token: string; fetchFn?: typeof fetch; push?: typeof pushBranch }): Promise<{ checked: CheckedArtifact; deliveries: Delivery[] }> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) throw new Error("--repo must be owner/name.");
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(\/[A-Za-z0-9._/-]*)?$/.test(options.api) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(options.api)) throw new Error("--api must be an https URL.");
  const api: Api = { url: options.api.replace(/\/$/, ""), token: options.token, fetchFn: options.fetchFn ?? fetch };
  // Before the artifact is read: the run must be on the repository's default branch, where PRs go.
  const repository = await call(api, "GET", `/repos/${options.repo}`);
  const defaultBranch = (repository.json as { default_branch?: unknown } | null)?.default_branch;
  if (repository.status !== 200 || typeof defaultBranch !== "string") throw new Error(`GitHub did not give the repository's default branch (HTTP ${repository.status}).`);
  if (options.ref !== `refs/heads/${defaultBranch}`) throw new Error(`This run is on ${plain(options.ref)}, not on the default branch ${plain(defaultBranch)}; no PR is opened.`);
  const checked = checkArtifact(options.dir, options.artifact, options.base);
  const { top } = workTree(rootPath(options.dir)), owner = options.repo.split("/")[0]!, push = options.push ?? pushBranch;
  const deliveries: Delivery[] = [];
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
      if (remoteSha && remoteSha.object?.sha !== fix.commit) { done({ outcome: "branch_differs", reason: `The branch exists on GitHub at another commit; it was not changed (Ludion never force-pushes).` }); continue; }
      if (!remoteSha) push(top, options.remote, fix.commit, fix.branch, options.token);
      const created = await call(api, "POST", `/repos/${options.repo}/pulls`, { title: fix.subject, head: fix.branch, base: defaultBranch, body: pullRequestBody(checked, fix), maintainer_can_modify: false });
      const pr = created.json as { number?: unknown; html_url?: unknown } | null;
      if (created.status !== 201 || typeof pr?.number !== "number") throw new Error(`GitHub did not open the PR (HTTP ${created.status}${typeof (created.json as { message?: unknown } | null)?.message === "string" ? `: ${plain((created.json as { message: string }).message).slice(0, 200)}` : ""}).`);
      done({ outcome: "opened", pr: pr.number, url: typeof pr.html_url === "string" ? pr.html_url : undefined });
    } catch (error) {
      done({ outcome: "failed", reason: plain(error instanceof Error ? error.message : String(error)).slice(0, 500) });
    }
  }
  return { checked, deliveries };
}

/** `ludion deliver pack|open`: the scheduled workflow's two steps (action.yml). */
export async function deliverCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [step, ...rest] = args;
  const { values } = parseArgs({ args: rest, options: { dir: { type: "string", default: "." }, result: { type: "string" }, out: { type: "string" }, artifact: { type: "string" }, base: { type: "string" }, repo: { type: "string" }, ref: { type: "string" }, api: { type: "string" }, remote: { type: "string" }, json: { type: "boolean" } } });
  if (step === "pack") {
    if (!values.result || !values.out) throw new Error("deliver pack needs --result <patch --json output> and --out <folder>.");
    const { fixes } = packFixes(values.dir!, values.result, values.out);
    console.log(`Packed ${fixes} applied fix${fixes === 1 ? "" : "es"} into ${values.out}.`);
    return 0;
  }
  if (step !== "open") throw new Error("Usage: ludion deliver pack|open (the scheduled workflow's steps; see action.yml).");
  const token = env.GH_TOKEN;
  if (!values.artifact || !values.base || !values.repo || !values.ref || !values.api || !values.remote || !token) throw new Error("deliver open needs --artifact, --base, --repo, --ref, --api, --remote and GH_TOKEN.");
  const { checked, deliveries } = await openFixes({ dir: values.dir!, artifact: values.artifact, base: values.base, repo: values.repo, ref: values.ref, api: values.api, remote: values.remote, token });
  if (values.json) console.log(JSON.stringify({ base: checked.base, receipt: checked.id, not_applied: checked.notApplied, deliveries }, null, 2));
  else {
    console.log(`Receipt ${checked.id ?? "none"} on ${checked.base.slice(0, 12)}: ${checked.fixes.length} applied fix${checked.fixes.length === 1 ? "" : "es"}${Object.keys(checked.notApplied).length ? `; not applied: ${Object.entries(checked.notApplied).map(([k, n]) => `${n} ${k}`).join(", ")}` : ""}.`);
    for (const d of deliveries) console.log(`  ${d.package} (${d.branch}): ${d.outcome}${d.pr ? ` #${d.pr}` : ""}${d.reason ? ` — ${d.reason}` : ""}`);
  }
  return deliveries.some(d => d.outcome === "failed") ? 2 : 0;
}

