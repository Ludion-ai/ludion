// The required check "protected-paths" (.github/workflows/protected-paths.yml), its script run by bash as the runner
// runs it, against a stand-in for gh that answers from files. Every review ends with reviewed-sha whatever its verdict,
// so the check passes only when the latest review of the current head, by the owner, a member or a collaborator, has
// that line last and a first line that begins with APPROVE without NOT or REQUEST (#166's review, B1; LP-core).
// Needs bash and jq (GitHub's ubuntu runners have both; in CI these always run).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const CHECK = readFileSync(new URL("../../../.github/workflows/protected-paths.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** A `key: |` block scalar from the workflow, without its indentation. */
function block(yaml: string, key: string): string {
  const lines = yaml.split("\n");
  const at = lines.findIndex(l => new RegExp(`^\\s+${key}: \\|$`).test(l));
  if (at < 0) throw new Error(`no ${key} block`);
  const indent = lines[at]!.search(/\S/), body: string[] = [];
  for (const line of lines.slice(at + 1)) { if (line.trim() && line.search(/\S/) <= indent) break; body.push(line); }
  const strip = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)));
  return body.map(l => l.slice(strip)).join("\n").trimEnd() + "\n";
}

const has = (program: string, arg = "--version") => spawnSync(program, [arg]).status === 0;
const HEAD = "a".repeat(40), OLD = "b".repeat(40);
// Answers each API path from a file. FAIL names a path whose call fails; EMPTY one that answers nothing.
const GH = [
  "#!/bin/sh",
  "path= filter=",
  "while [ $# -gt 0 ]; do",
  '  case "$1" in',
  "    api|--paginate) ;;",
  "    --jq) filter=$2; shift ;;",
  "    *) path=$1 ;;",
  "  esac",
  "  shift",
  "done",
  'if [ "$path" = "${FAIL:-}" ]; then echo "stand-in gh: HTTP 502" >&2; exit 1; fi',
  'if [ "$path" = "${EMPTY:-}" ]; then exit 0; fi',
  'case "$path" in',
  '  repos/o/r/pulls/7) file=pull.json ;;',
  '  repos/o/r/pulls/7/files) file=files.json ;;',
  '  repos/o/r/issues/7/labels) file=labels.json ;;',
  '  repos/o/r/issues/7/comments) file=comments.json ;;',
  '  *) echo "stand-in gh: unexpected $path" >&2; exit 1 ;;',
  "esac",
  'jq -r "$filter" "$FAKE/$file"',
  "",
].join("\n");

type Comment = { body?: string | null; author_association?: string };
const temp = mkdtempSync(join(tmpdir(), "ludion-protected-paths-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let count = 0;
function check(comments: (string | Comment)[], over: { files?: string[]; labels?: string[]; fail?: string; empty?: string } = {}) {
  const fake = join(temp, `pp-${++count}`), bin = join(fake, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), GH, { mode: 0o755 });
  writeFileSync(join(fake, "pull.json"), JSON.stringify({ head: { sha: HEAD } }));
  writeFileSync(join(fake, "files.json"), JSON.stringify((over.files ?? ["CLAUDE.md"]).map(filename => ({ filename }))));
  writeFileSync(join(fake, "labels.json"), JSON.stringify((over.labels ?? ["review-approved"]).map(name => ({ name }))));
  writeFileSync(join(fake, "comments.json"), JSON.stringify(comments.map(c => typeof c === "string" ? { body: c, author_association: "OWNER" } : c)));
  const r = spawnSync("bash", ["-c", block(CHECK, "run")], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, FAKE: fake, GH_TOKEN: "x", REPO: "o/r", PR: "7", LABEL: "review-approved", REVIEWS: block(CHECK, "REVIEWS"), FAIL: over.fail ?? "", EMPTY: over.empty ?? "" },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}
const review = (verdict: string, sha: string) => `${verdict}\n\nFindings.\n\nreviewed-sha: ${sha}`;
const APPROVED = `Approved for head ${HEAD}.`, NOT_APPROVED = `The latest review whose last line is "reviewed-sha: ${HEAD}"`;
const passes = (r: { status: number | null; out: string }) => { expect(r.status, r.out).toBe(0); expect(r.out).toContain(APPROVED); };
const fails = (r: { status: number | null; out: string }, message = NOT_APPROVED) => { expect(r.status, r.out).toBe(1); expect(r.out).toContain(message); expect(r.out).not.toContain(APPROVED); };

describe.skipIf(!(has("jq") && has("bash")) && !process.env.CI)("protected-paths.yml's script, against a stand-in for gh", () => {
  it("passes on an approving review of the current head with the label, whatever the case or decoration", () => {
    for (const verdict of ["APPROVE: the merge of main is clean", "**APPROVE**, with non-blocking findings:", "approve", "Approve — round 2", "## APPROVE", "> __APPROVE__", "`APPROVE` (fresh context, full diff at x)", "  APPROVE"]) passes(check([review(verdict, HEAD)]));
  });
  it("fails without the label, then passes once it is added, for the same review", () => {
    const comments = [review("APPROVE: fine", HEAD)];
    fails(check(comments, { labels: [] }), 'It needs an independent review and the "review-approved" label');
    fails(check(comments, { labels: ["reviewed", "approved"] }), 'the "review-approved" label');
    passes(check(comments));
  });
  it("fails when no review covers the current head", () => {
    fails(check([]));
    fails(check([review("APPROVE", OLD)]));
    fails(check(["APPROVE, looks good"]));
  });
  it("fails, red, when any call to gh fails or the label answer is empty", () => {
    const comments = [review("APPROVE", HEAD)];
    for (const fail of ["repos/o/r/pulls/7", "repos/o/r/pulls/7/files", "repos/o/r/issues/7/labels", "repos/o/r/issues/7/comments"]) {
      const r = check(comments, { fail });
      expect(r.status, `${fail}: ${r.out}`).not.toBe(0);
      expect(r.out).toContain("stand-in gh: HTTP 502");
      // It stops at the failed call, not later on what that call left empty.
      for (const later of [APPROVED, "No protected paths changed.", "::error::"]) expect(r.out).not.toContain(later);
    }
    fails(check(comments, { empty: "repos/o/r/issues/7/labels" }), 'the "review-approved" label');
    fails(check(comments, { empty: "repos/o/r/issues/7/comments" }));
  });
  it("does not approve on a first line that says not to, asks for changes, or does not begin with APPROVE", () => {
    for (const verdict of [
      "do NOT APPROVE", "APPROVE, but NOT yet", "Approve? not until B1 is fixed", "APPROVE (request changes on B1 first)", "APPROVE_REQUEST", "REQUEST CHANGES", "**Request changes**", "Not approve",
      "Review of #7 (fresh context, full diff at x): APPROVE", "APPROVED", "APPROVES", "~~APPROVE~~", "- APPROVE", "Not a review", "",
    ]) fails(check([review(verdict, HEAD)]));
  });
  it("does not count an APPROVE that is not on the first line", () => {
    fails(check([review("Review of #7 (fresh context, full diff at x)", HEAD).replace("Findings.", "APPROVE")]));
    for (const body of [`\nAPPROVE\n\nreviewed-sha: ${HEAD}`, `**Verdict**\nAPPROVE\n\nreviewed-sha: ${HEAD}`]) fails(check([body]));
  });
  it("reads reviewed-sha only on the last line, after trailing blanks and \\r", () => {
    passes(check([`APPROVE\r\n\r\nFindings.\r\n\r\nreviewed-sha: ${HEAD}\r\n`]));
    passes(check([`APPROVE\n\nreviewed-sha:${HEAD}  \n\n  \n`]));
    fails(check([`APPROVE\n\nreviewed-sha: ${HEAD}\n\nThanks.`]));
    fails(check([`APPROVE\n\nreviewed-sha: ${HEAD} (and ${OLD})`]));
    fails(check([`APPROVE\n\nreviewed-sha: ${HEAD.toUpperCase()}`]));
    fails(check([`APPROVE\n\nsee reviewed-sha: ${HEAD}`]));
    // A comment that ends with another head reviews that head, whatever SHA it names in its middle.
    fails(check([`APPROVE\n\nreviewed-sha: ${HEAD}\n\nreviewed-sha: ${OLD}`]));
    passes(check([review("APPROVE", HEAD), `REQUEST CHANGES\n\nreviewed-sha: ${HEAD}\n\nreviewed-sha: ${OLD}`]));
  });
  it("reads only comments by the owner, a member or a collaborator", () => {
    for (const author_association of ["OWNER", "MEMBER", "COLLABORATOR"]) passes(check([{ body: review("APPROVE", HEAD), author_association }]));
    for (const author_association of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE", "MANNEQUIN", "owner", undefined]) {
      fails(check([{ body: review("APPROVE", HEAD), author_association }]));
    }
    // An outside account can neither approve after an owner's request for changes nor undo an owner's approval.
    fails(check([review("REQUEST CHANGES", HEAD), { body: review("APPROVE", HEAD), author_association: "NONE" }]));
    passes(check([review("APPROVE", HEAD), { body: review("REQUEST CHANGES", HEAD), author_association: "CONTRIBUTOR" }]));
  });
  it("treats an empty or missing body as no review, without breaking the check", () => {
    for (const body of ["", null, undefined, "\n\n"]) {
      fails(check([{ body, author_association: "OWNER" }]));
      passes(check([review("APPROVE", HEAD), { body, author_association: "OWNER" }]));
    }
  });
  it("lets the latest review of the current head decide", () => {
    const approve = review("APPROVE", HEAD), request = review("REQUEST CHANGES", HEAD);
    fails(check([approve, request, review("APPROVE", OLD)]));
    passes(check([request, approve]));
    fails(check([approve, review("approve, but not yet", HEAD)]));
  });
  it("treats action/ and action.yml as protected paths, and passes a PR that touches none", () => {
    for (const file of ["action/comment.sh", "action/dist/record.js", "action.yml"]) fails(check([], { files: [file], labels: [] }), 'the "review-approved" label');
    for (const file of ["packages/action/x.ts", "actions.yml", "docs/action/x.md", "README.md"]) {
      const r = check([], { files: [file], labels: [] });
      expect(r.status, `${file}: ${r.out}`).toBe(0);
      expect(r.out).toContain("No protected paths changed.");
    }
  });
});
