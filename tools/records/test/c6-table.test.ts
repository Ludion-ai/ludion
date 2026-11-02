// C6's table of rule and check (docs/status.md; docs/decisions/2026-11-02-definition-of-complete-final.md, C6) is what the
// release of 2026-11-30 is measured by, so every row says when it takes effect, and a row that names its check names a file
// that is there. Also here: the one row whose check is a search of the source text, pr-mode-has-no-merge-call.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const isFile = (path: string) => { try { return statSync(new URL(path, root)).isFile(); } catch { return false; } };
const cells = (line: string) => line.replace(/^\|\s*/, "").replace(/\s*\|\s*$/, "").split(/\s*\|\s*/);

const HEADER = "| Check | Rule | 効く時 | Test |";
const EFFECTS = ["PR モード", "自動マージ"];
const NOT_YET = ["Not written", "未実装"];

/** The table's lines after its header and separator, or null when no table has the 効く時 column. */
function tableLines(status: string): string[] | null {
  const lines = status.replace(/\r\n/g, "\n").split("\n"), at = lines.indexOf(HEADER);
  if (at < 0) return null;
  const end = lines.findIndex((line, i) => i > at && !line.startsWith("|"));
  return lines.slice(at + 2, end < 0 ? undefined : end);
}

/** What is wrong with the table, given the text of docs/status.md. Empty when nothing is. */
function problems(status: string, exists: (path: string) => boolean = isFile): string[] {
  const rows = tableLines(status);
  if (rows === null) return ["no table has the column 効く時"];
  if (!rows.length) return ["the table has no rows"];
  const out: string[] = [], seen = new Set<string>();
  for (const row of rows) {
    const [check = "", , effect = "", test = ""] = cells(row);
    if (cells(row).length !== 4) out.push(`${check}: not four cells`);
    if (seen.has(check)) out.push(`${check}: twice`);
    seen.add(check);
    if (!EFFECTS.includes(effect)) out.push(`${check}: 効く時 is "${effect}"`);
    const path = /^`([^`]+)`/.exec(test)?.[1];
    if (path ? !exists(path) : !NOT_YET.includes(test)) out.push(`${check}: test is "${test}"`);
  }
  return out;
}

describe("C6's table (docs/status.md)", () => {
  const status = read("docs/status.md");

  it("c6-row-has-effect-column: every row has 効く時, and its test is a file that is there or says it is not there yet", () => {
    expect(problems(status)).toEqual([]);
  });

  it("c6-row-has-effect-column: fails a row with no value, another value, or a check file that is gone", () => {
    const table = (...rows: string[]) => [HEADER, "|---|---|---|---|", ...rows, "", "Next paragraph | with a bar"].join("\n");
    expect(problems("| Check | Rule | Test |\n|---|---|---|\n| `a` | rule | Not written |")).toEqual(["no table has the column 効く時"]);
    expect(problems(table())).toEqual(["the table has no rows"]);
    expect(problems(table("| `a` | rule | PR モード | Not written |"))).toEqual([]);
    expect(problems(table("| `a` | rule | 自動マージ | 未実装 |"))).toEqual([]);
    expect(problems(table("| `a` | rule |  | Not written |"))).toEqual(['`a`: 効く時 is ""']);
    expect(problems(table("| `a` | rule | 不明 | Not written |"))).toEqual(['`a`: 効く時 is "不明"']);
    expect(problems(table("| `a` | rule | Not written |"))).toEqual(["`a`: not four cells", '`a`: 効く時 is "Not written"', '`a`: test is ""']);
    expect(problems(table("| `a` | rule | PR モード | Passes |"))).toEqual(['`a`: test is "Passes"']);
    expect(problems(table("| `a` | rule | PR モード | `tools/records/test/gone.test.ts` |"))).toEqual(['`a`: test is "`tools/records/test/gone.test.ts`"']);
    expect(problems(table("| `a` | rule | PR モード | `x.ts` (a case) |"), () => true)).toEqual([]);
    expect(problems(table("| `a` | r | PR モード | 未実装 |", "| `a` | r | PR モード | 未実装 |"))).toEqual(["`a`: twice"]);
  });

  it("c6-row-has-effect-column: a row the release of 2026-11-30 depends on is not moved to 自動マージ unnoticed", () => {
    const effect = Object.fromEntries((tableLines(status) ?? []).map(cells).map(([check, , value]) => [check, value]));
    expect(effect).toMatchObject({
      "`stop-file-owner-only`": "自動マージ",
      "`stop-file-unreadable-holds`": "自動マージ",
      "`crawl-failure-does-not-revert`": "自動マージ",
      "`self-update-never-auto-merged`": "自動マージ",
      "`action-runs-npm-only`": "PR モード",
      "`candidate-cache-not-read-from-main`": "PR モード",
      "`public-sentences-match-scope`": "PR モード",
      "`c6-table-has-every-rule`": "PR モード",
      "`action-does-not-comment-on-dependabot-pr`": "PR モード",
      "`pr-mode-has-no-merge-call`": "PR モード",
      "`pr-changes-no-workflow-file`": "PR モード",
      "`v1-stops-on-other-lockfile`": "PR モード",
    });
  });
});

const MERGE_CALLS = [
  /\/pulls\/[^\s"'`]*\/merge\b/, // REST: PUT /repos/{owner}/{repo}/pulls/{n}/merge
  /\/merges\b/, // REST: POST /repos/{owner}/{repo}/merges
  /\bpulls\.merge\b/,
  /\bgh\s+pr\s+merge\b/,
  /\bgit\s+merge\b(?!-)/,
  /["'`]merge["'`]/, // an argument list: ["pr", "merge", …], ["merge", …]
  /\b(?:mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|mergeBranch)\b/, // GraphQL
  /\b(?:merge_method|auto_merge)\b/,
];
const mergeCalls = (text: string) => MERGE_CALLS.filter(pattern => pattern.test(text)).map(String);

function files(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, root), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}

describe("pr-mode-has-no-merge-call", () => {
  // What is bundled into the Action and the CLI, from source: the built file exists only in a release commit.
  const shipped = ["action.yml", ...files("action"), ...files("packages/cli/src"), ...files("packages/sandbox/src")];

  it("the source of the Action and the CLI calls no merge API", () => {
    for (const path of ["action.yml", "action/patch.sh", "action/patch-workflow.yml", "packages/cli/src/security/deliver.ts", "packages/sandbox/src/docker.ts"]) expect(shipped).toContain(path);
    expect(shipped.map(path => [path, mergeCalls(read(path))]).filter(([, found]) => found!.length)).toEqual([]);
  });

  it("finds each way of calling one, and not the words the preview's notices and records use", () => {
    for (const call of [
      'gh api -X PUT "repos/$REPO/pulls/$PR/merge"',
      "`/repos/${repo}/pulls/${number}/merge`",
      "gh api repos/o/r/merges -f base=main",
      "octokit.pulls.merge({ pull_number: 1 })",
      'gh pr merge --auto --squash "$PR"',
      "gh  pr  merge 1",
      "git merge --ff-only ludion/npm/x",
      'execFileSync("gh", ["pr", "merge", "1"])',
      "mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }",
      "mutation { mergePullRequest(input: {}) { clientMutationId } }",
      '{ "merge_method": "squash" }',
    ]) expect([call, mergeCalls(call).length > 0]).toEqual([call, true]);
    for (const word of [
      "**プレビュー：マージは行わない。** Preview: Ludion does not merge this PR.",
      "Ludion opens PRs and merges nothing.",
      "branchName's cleaning merges names",
      "the merge base",
      "merge_sha",
      ".merge_base_commit.sha",
      "merged_at",
      "merge_commit_sha",
      "refs/pull/1/merge",
      "git merge-base HEAD main",
    ]) expect([word, mergeCalls(word)]).toEqual([word, []]);
  });
});
