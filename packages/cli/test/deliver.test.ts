// The scheduled workflow's two jobs (packages/cli/src/security/deliver.ts): the validation job packs the applied fixes,
// and the PR job opens one PR per fix only after the artifact passes every check. Each refusal below is an artifact the
// validation job would not write, and nothing is pushed or opened for it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixBranch, gitBase } from "../src/security/branch.ts";
import { BUNDLE_LIMIT, checkArtifact, openFixes, packFixes, pullRequestBody } from "../src/security/deliver.ts";
import { snapshot } from "../src/security/project.ts";
import { commit, git } from "./git.ts";

const ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const LOCK = "{\n  \"name\": \"app\",\n  \"lockfileVersion\": 3,\n  \"packages\": { \"node_modules/lodash\": { \"version\": \"4.17.20\" } }\n}\n";
const FIXED = LOCK.replace("4.17.20", "4.17.21");
const SUBJECT = "ludion: lodash 4.17.20 -> 4.17.21 (npm)";
const BRANCH = "ludion/npm/lodash-4.17.21";
const message = (subject = SUBJECT, id = ID) => `${subject}\n\nFixes GHSA-35jh-r3h4-6jhm.\n\nLudion receipt ${id}: the project's test passed on the base and on this change alone, offline in Docker.\n`;

/** A project (npm policy) with two commits, and an origin it was pushed to. `base` is the second commit. */
function project() {
  const work = mkdtempSync(join(tmpdir(), "ludion-deliver-work-"));
  writeFileSync(join(work, "ludion.security.json"), `${JSON.stringify({ schema: 1, ecosystem: "npm", image: "node:24-slim", test: ["npm", "test"], timeout_seconds: 60 })}\n`);
  writeFileSync(join(work, "package.json"), "{\"name\":\"app\",\"dependencies\":{\"lodash\":\"4.17.20\"}}\n");
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
function applied(work: string, options: { content?: string; subject?: string } = {}) {
  const copy = mkdtempSync(join(tmpdir(), "ludion-deliver-copy-"));
  snapshot(work, copy);
  const base = gitBase(work, copy), content = options.content ?? FIXED;
  const made = fixBranch(base, BRANCH, [{ path: "package-lock.json", content }], message(options.subject));
  return { commit: made, receipt: receiptFor(base.commit, made, content) };
}
function receiptFor(base: string, made: string, content = FIXED): Record<string, unknown> {
  return {
    schema: 2, id: ID, ecosystem: "npm", scope: "dependency_files_only_not_deployed", outcome: "partial", baseline_passed: true, base_commit: base,
    fixes: [
      {
        package: "lodash", changes: [{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: ["GHSA-35jh-r3h4-6jhm", "CVE-2021-23337"] }],
        outcome: "applied", branch: BRANCH, commit: made, candidate_passed: true,
        files: [{ path: "package-lock.json", before_hash: sha256(LOCK), after_hash: sha256(content) }],
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
/** The PR job's checkout: a fresh clone of origin at the base, with no fix branch. */
function checkout(origin: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ludion-deliver-pr-"));
  git(dir, "clone", "-q", origin, ".");
  return dir;
}

/** A commit made by hand in `work`: any parent, files, file mode and author, on a branch. */
function forge(work: string, branch: string, parent: string, files: Record<string, string>, options: { mode?: string; author?: string; subject?: string } = {}): string {
  const index = join(mkdtempSync(join(tmpdir(), "ludion-deliver-index-")), "index"), env = { ...process.env, GIT_INDEX_FILE: index };
  const run = (args: string[], input?: string) => {
    const r = spawnSync("git", args, { cwd: work, env: { ...env, GIT_AUTHOR_NAME: options.author ?? "Ludion", GIT_AUTHOR_EMAIL: "ludion@ludion.invalid", GIT_COMMITTER_NAME: "Ludion", GIT_COMMITTER_EMAIL: "ludion@ludion.invalid" }, input, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  run(["read-tree", parent]);
  for (const [path, content] of Object.entries(files)) run(["update-index", "--add", "--cacheinfo", options.mode ?? "100644", run(["hash-object", "-w", "--stdin"], content), path]);
  const made = run(["commit-tree", run(["write-tree"]), "-p", parent, "-F", "-"], message(options.subject));
  run(["update-ref", `refs/heads/${branch}`, made]);
  return made;
}

/** A stand-in for GitHub's API: the repository, PRs by head branch, branches read from the origin, and new PRs. */
function github(origin: string, pulls: { number: number; state: string; head: { ref: string } }[] = []) {
  const calls: string[] = [], opened: Record<string, unknown>[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url)), method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}${u.search}`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t0ken");
    if (u.pathname === "/repos/o/r") return reply(200, { default_branch: "main" });
    if (u.pathname === "/repos/o/r/pulls" && method === "GET") return reply(200, pulls.filter(p => `o:${p.head.ref}` === u.searchParams.get("head")));
    if (u.pathname.startsWith("/repos/o/r/git/ref/heads/")) {
      const branch = decodeURIComponent(u.pathname.slice("/repos/o/r/git/ref/heads/".length));
      const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: origin, encoding: "utf8" });
      return r.status === 0 ? reply(200, { ref: `refs/heads/${branch}`, object: { sha: r.stdout.trim() } }) : reply(404, { message: "Not Found" });
    }
    if (u.pathname === "/repos/o/r/pulls" && method === "POST") {
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
const open = (dir: string, out: string, base: string, origin: string, gh: ReturnType<typeof github>, ref = "refs/heads/main") =>
  openFixes({ dir, artifact: out, base, repo: "o/r", ref, api: "https://api.github.invalid", remote: origin, token: "t0ken", fetchFn: gh.fetchFn });
const branchAt = (origin: string, branch: string) => spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: origin, encoding: "utf8" }).stdout.trim();

describe("the validation job packs the applied fixes", () => {
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

describe("the PR job opens one PR per fix", () => {
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
    for (const part of ["`lodash` (npm)", "`4.17.20` → `4.17.21`", "`GHSA-35jh-r3h4-6jhm`, `CVE-2021-23337`", "`2021-02-20T15:42:16.891Z`", "`2026-10-30T01:00:00.000Z`", "`2026-10-30T01:05:00.000Z`", `\`${ID}\``, "`ready_except_build`", "not all four gates", "Ludion does not merge this PR"]) expect(body).toContain(part);
    expect(body).not.toMatch(/passed the four gates|minimist/);
    // The next scheduled run validates the same fix again; its PR is open, so nothing is pushed or opened.
    const again = await open(checkout(origin), out, base, origin, gh);
    expect(again.deliveries).toEqual([{ package: "lodash", branch: BRANCH, outcome: "open_pr_exists", pr: 100 }]);
    expect(gh.opened).toHaveLength(1);
    expect(gh.calls.filter(c => c.startsWith("POST"))).toHaveLength(1);
  });
  it("does not open a fix again whose PR was closed, nor move a branch that holds another commit", async () => {
    const { work, origin, base } = project(), fix = applied(work);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    const closed = github(origin, [{ number: 7, state: "closed", head: { ref: BRANCH } }]);
    expect((await open(checkout(origin), out, base, origin, closed)).deliveries).toEqual([{ package: "lodash", branch: BRANCH, outcome: "closed_pr_exists", pr: 7, reason: "A PR from this branch was closed; it is not opened again." }]);
    expect(closed.opened).toHaveLength(0);
    expect(branchAt(origin, BRANCH)).toBe("");
    // The branch exists on GitHub at another commit (an older base): it is left alone, and no PR is opened.
    git(work, "push", "-q", origin, `${base}:refs/heads/${BRANCH}`);
    const gh = github(origin), result = await open(checkout(origin), out, base, origin, gh);
    expect(result.deliveries[0]).toMatchObject({ outcome: "branch_differs" });
    expect(branchAt(origin, BRANCH)).toBe(base);
    expect(gh.opened).toHaveLength(0);
  });
  it("opens the PR without pushing when the branch is already at the fix's commit, and a failed push stops only that fix", async () => {
    const { work, origin, base } = project(), fix = applied(work);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    git(work, "push", "-q", origin, `${fix.commit}:refs/heads/${BRANCH}`);
    const pushes: string[] = [], gh = github(origin);
    const result = await openFixes({ dir: checkout(origin), artifact: out, base, repo: "o/r", ref: "refs/heads/main", api: "https://api.github.invalid", remote: origin, token: "t0ken", fetchFn: gh.fetchFn, push: (_t, _r, c) => { pushes.push(c); } });
    expect(result.deliveries[0]).toMatchObject({ outcome: "opened" });
    expect(pushes).toEqual([]);
    const fresh = project(), second = applied(fresh.work), gh2 = github(fresh.origin);
    const failing = await openFixes({ dir: checkout(fresh.origin), artifact: artifact(fresh.work, second.receipt, [`refs/heads/${BRANCH}`], fresh.base), base: fresh.base, repo: "o/r", ref: "refs/heads/main", api: "https://api.github.invalid", remote: fresh.origin, token: "t0ken", fetchFn: gh2.fetchFn, push: () => { throw new Error("git push failed: rejected"); } });
    expect(failing.deliveries[0]).toMatchObject({ outcome: "failed", reason: "git push failed: rejected" });
    expect(gh2.opened).toHaveLength(0);
  });
  it("opens nothing for a run that is not on the default branch, before reading the artifact", async () => {
    const { work, origin, base } = project(), fix = applied(work), gh = github(origin);
    const out = artifact(work, fix.receipt, [`refs/heads/${BRANCH}`], base);
    await expect(open(checkout(origin), out, base, origin, gh, "refs/heads/feature")).rejects.toThrow("not on the default branch main");
    expect(gh.calls).toEqual(["GET /repos/o/r"]);
    expect(branchAt(origin, BRANCH)).toBe("");
  });
});

describe("the PR job refuses an artifact the validation job would not write", () => {
  /** Runs the PR job on a forged artifact: it must throw `why`, push nothing and open nothing. */
  async function refused(setup: (p: ReturnType<typeof project>) => { receipt: unknown; refs: string[]; base?: string; tamper?: (out: string) => void }, why: string | RegExp) {
    const p = project(), s = setup(p), out = artifact(p.work, s.receipt, s.refs, p.base);
    s.tamper?.(out);
    const gh = github(p.origin);
    await expect(open(checkout(p.origin), out, s.base ?? p.base, p.origin, gh)).rejects.toThrow(why);
    expect(gh.calls).toEqual(["GET /repos/o/r"]);
    expect(git(p.origin, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  }
  it("a commit whose parent is not the base", () => refused(p => {
    const made = forge(p.work, BRANCH, p.first, { "package-lock.json": FIXED });
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, /does not have the base [0-9a-f]{12} as its only parent|needs commits other than the base/));
  it("two commits on the base, not one", () => refused(p => {
    const middle = forge(p.work, "ludion/x", p.base, { "package-lock.json": LOCK.replace("app", "app2") });
    const made = forge(p.work, BRANCH, middle, { "package-lock.json": FIXED });
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, "does not have the base"));
  it("a file outside the plan, beside the planned one", () => refused(p => {
    const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED, "README.md": "changed\n" });
    return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
  }, "not exactly package-lock.json"));
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
    const receipt = receiptFor(p.base, fix.commit, "something else");
    return { receipt, refs: [`refs/heads/${BRANCH}`] };
  }, "is not the receipt's file (after_hash)"));
  it("a subject that is not the receipt's change, and an author that is not Ludion", async () => {
    await refused(p => {
      const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED }, { subject: "ludion: lodash 4.17.20 -> 4.17.21 (npm) @everyone" });
      return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
    }, "subject is not the receipt's change");
    await refused(p => {
      const made = forge(p.work, BRANCH, p.base, { "package-lock.json": FIXED }, { author: "Mallory" });
      return { receipt: receiptFor(p.base, made), refs: [`refs/heads/${BRANCH}`] };
    }, "is not authored and committed by Ludion");
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

describe("the policy at the base decides what a fix may change", () => {
  it("PHP: only the Dockerfile ludion.security.json names, with the subject and branch patch.ts gives", () => {
    const work = mkdtempSync(join(tmpdir(), "ludion-deliver-php-"));
    writeFileSync(join(work, "ludion.security.json"), `${JSON.stringify({ schema: 1, dockerfile: "./Dockerfile", test: ["php", "tests/smoke.php"], timeout_seconds: 60 })}\n`);
    writeFileSync(join(work, "Dockerfile"), "FROM php:8.4.26-cli-alpine\n");
    const base = commit(work), copy = mkdtempSync(join(tmpdir(), "ludion-deliver-copy-"));
    snapshot(work, copy);
    const after = "FROM php:8.4.27-cli-alpine@sha256:" + "1".repeat(64) + "\n";
    const made = fixBranch(gitBase(work, copy), "ludion/php/8.4.27", [{ path: "Dockerfile", content: after }], message("ludion: PHP 8.4.26 -> 8.4.27 in ./Dockerfile"));
    const receipt = {
      schema: 1, id: ID, scope: "dockerfile_only_not_deployed", outcome: "applied", baseline_passed: true, candidate_passed: true, base_commit: base,
      scan: { current: { version: "8.4.26" }, candidate: { version: "8.4.27" } }, dockerfile_after: sha256(after),
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
});
