// C6's table of rule and check (docs/status.md; docs/decisions/2026-11-02-definition-of-complete-final.md, C6): every row
// says when its rule first applies, a row that names its check names a file that is there and the tests it quotes are in
// that file, a row is one of three kinds (a check that runs, a hand-run record, no check) and no kind passes as another,
// and every rule of CLAUDE.md's "Ludion must not become the attack path" has a row. Also here: the two rows whose
// check is a search of the source text, pr-mode-has-no-merge-call and pr-job-pushes-only-its-branch, and the line of
// action.yml that writing-job-cli-is-in-the-action reads.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const isFile = (path: string) => { try { return statSync(new URL(path, root)).isFile(); } catch { return false; } };
const cells = (line: string) => line.replace(/^\|\s*/, "").replace(/\s*\|\s*$/, "").split(/\s*\|\s*/);

const HEADER = "| Check | Rule | 効く時 | Test |";
const EFFECTS = ["PR モード", "自動マージ"];
const NOT_YET = ["Not written", "未実装"];
const HAND_RUN_OPENS = "Hand-run record";
/** A hand-run record's Test cell: the record, then the version and the full SHA the run was at. */
const HAND_RUN = /^Hand-run record \(one run, version and SHA\): `([^`]+)`, ludion-ai (\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?), ([0-9a-f]{40})$/;

type Kind = "check" | "hand_run" | "none";
/** The kind a Test cell says it is, by its form alone; null when it is none of the three. */
function kindOf(test: string): Kind | null {
  if (NOT_YET.includes(test)) return "none";
  if (test.startsWith(HAND_RUN_OPENS)) return "hand_run";
  return test.startsWith("`") ? "check" : null;
}

/** The rows of each kind, given the text of docs/status.md. */
function rowsByKind(status: string): Record<Kind | "other", string[]> {
  const out: Record<Kind | "other", string[]> = { check: [], hand_run: [], none: [], other: [] };
  for (const row of tableLines(status) ?? []) {
    const [check = "", , , test = ""] = cells(row);
    out[kindOf(test) ?? "other"].push(check);
  }
  return out;
}

/** What is wrong with a hand-run record's Test cell: the form, the record's place, that it is there, and that it names both. */
function handRunProblems(check: string, test: string, exists: (path: string) => boolean, text: (path: string) => string): string[] {
  const match = HAND_RUN.exec(test);
  if (!match) return [`${check}: not a hand-run record's form: "${test}"`];
  const [, path, version, sha] = match as unknown as [string, string, string, string];
  if (!/^docs\/progress\/[^/]+\.md$/.test(path)) return [`${check}: a hand-run record is under docs/progress/, not at ${path}`];
  if (!exists(path)) return [`${check}: the record ${path} is not there`];
  const words = text(path).split(/[\s`(),;:]+/);
  return [version, sha].filter(word => !words.includes(word)).map(word => `${check}: the record ${path} does not name ${word}`);
}

/** The table's lines after its header and separator, or null when no table has the 効く時 column. */
function tableLines(status: string): string[] | null {
  const lines = status.replace(/\r\n/g, "\n").split("\n"), at = lines.indexOf(HEADER);
  if (at < 0) return null;
  const end = lines.findIndex((line, i) => i > at && !line.startsWith("|"));
  return lines.slice(at + 2, end < 0 ? undefined : end);
}

/** What is wrong with the table, given the text of docs/status.md. Empty when nothing is. */
function problems(status: string, exists: (path: string) => boolean = isFile, text: (path: string) => string = read): string[] {
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
    if (kindOf(test) === "hand_run") { out.push(...handRunProblems(check, test, exists, text)); continue; }
    // `a.ts` ("a test"; "another"); `b.ts` ("a third"): each file, and the names after it up to the next file.
    const parts = test.split("`"), paths = test.startsWith("`") ? parts.filter((_, i) => i % 2 === 1) : [];
    // A file under docs/ is a record, which nothing runs: written as a check it would count as one.
    const record = paths.find(path => path.startsWith("docs/"));
    if (record) out.push(`${check}: ${record} is a record, not a check`);
    else if (paths.length ? !paths.every(exists) : !NOT_YET.includes(test)) out.push(`${check}: test is "${test}"`);
    else parts.forEach((path, i) => {
      if (i % 2 === 1) for (const [, name] of (parts[i + 1] ?? "").matchAll(/"([^"]+)"/g)) if (!text(path).includes(name!)) out.push(`${check}: "${name}" is not in ${path}`);
    });
  }
  return out;
}

const ATTACK_PATH = "## Ludion must not become the attack path";

/** The section's rules: its top-level bullets, one line each. A sub-bullet is part of the rule above it. */
function attackPathRules(claude: string): string[] {
  const lines = claude.split("\n"), at = lines.indexOf(ATTACK_PATH);
  if (at < 0) return [];
  const end = lines.findIndex((line, i) => i > at && line.startsWith("## "));
  return lines.slice(at + 1, end < 0 ? undefined : end).filter(line => line.startsWith("- ")).map(line => line.slice(2));
}

/**
 * What is wrong with the table's pointers to those rules. A row points at a rule by writing (attack path: "<words>") in its
 * Rule cell, the words being the rule's opening: two words or more, ending where a word ends, and opening that rule alone.
 * So a rule added to the section with no row fails, and so does a row left behind when a rule's opening changes.
 * A row that says Not written or 未実装 points at its rule all the same: this says each rule has a row, not that it has a check.
 */
function ruleProblems(status: string, claude: string): string[] {
  const rules = attackPathRules(claude), pointed = new Set<string>(), out: string[] = [];
  if (!rules.length) return ["no rules found in the section"];
  for (const row of tableLines(status) ?? []) {
    const [check = "", rule = ""] = cells(row);
    for (const [, words] of rule.matchAll(/\(attack path: "([^"]+)"\)/g)) {
      const opens = rules.filter(text => text.startsWith(words!) && !/^[\p{L}\p{N}]/u.test(text.slice(words!.length)));
      if (!/\S\s+\S/.test(words!)) out.push(`${check}: "${words}" is not two words`);
      else if (opens.length !== 1) out.push(`${check}: "${words}" opens ${opens.length} rules`);
      else pointed.add(opens[0]!);
    }
  }
  return [...out, ...rules.filter(text => !pointed.has(text)).map(text => `no row points at: ${text.slice(0, 40)}`)];
}

describe("C6's table (docs/status.md)", () => {
  const status = read("docs/status.md");

  it("c6-table-has-every-rule: every rule of the section has a row that points at it", () => {
    expect(attackPathRules(read("CLAUDE.md")).map(rule => rule.slice(0, 15))).toEqual([
      "No tokens: publ", "No runtime depe", "Workflows writt", "Updates to ludi", "A job that runs", "No Ludion-opera", "Send only packa",
    ]);
    expect(ruleProblems(status, read("CLAUDE.md"))).toEqual([]);
  });

  it("c6-table-has-every-rule: fails a rule with no row, and a row whose words open no rule, or more than one", () => {
    const claude = [ATTACK_PATH, "", "- No tokens: never.", "- No runtime dependencies at all.", "  - A sub-bullet, not a rule.", "", "## Next", "", "- Not in the section."].join("\n");
    const table = (...rows: string[]) => [HEADER, "|---|---|---|---|", ...rows].join("\n");
    const row = (name: string, words: string) => `| \`${name}\` | rule (attack path: "${words}") | PR モード | 未実装 |`;
    const both = [row("a", "No tokens"), row("b", "No runtime")];
    expect(attackPathRules(claude)).toEqual(["No tokens: never.", "No runtime dependencies at all."]);
    expect(ruleProblems(table(...both), claude)).toEqual([]);
    expect(ruleProblems(table(...both, row("c", "No tokens")), claude)).toEqual([]);
    expect(ruleProblems(table(both[0]!), claude)).toEqual(["no row points at: No runtime dependencies at all."]);
    expect(ruleProblems(table("| `a` | rule | PR モード | 未実装 |", both[1]!), claude)).toEqual(["no row points at: No tokens: never."]);
    expect(ruleProblems(table(...both, row("c", "No secrets")), claude)).toEqual(['`c`: "No secrets" opens 0 rules']);
    expect(ruleProblems(table(...both, row("c", "No toke")), claude)).toEqual(['`c`: "No toke" opens 0 rules']);
    expect(ruleProblems(table(...both, row("c", "Not in")), claude)).toEqual(['`c`: "Not in" opens 0 rules']);
    expect(ruleProblems(table(...both, row("c", "No")), claude)).toEqual(['`c`: "No" is not two words']);
    expect(ruleProblems(table(...both), "- No section here.")).toEqual(["no rules found in the section"]);
    const twins = [ATTACK_PATH, "- No tokens here.", "- No tokens there."].join("\n");
    expect(ruleProblems(table(row("a", "No tokens")), twins)).toEqual(['`a`: "No tokens" opens 2 rules', "no row points at: No tokens here.", "no row points at: No tokens there."]);
  });

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
    const held = (...rows: string[]) => problems(table(...rows), () => true, () => 'it("a test", () => {});');
    expect(held('| `a` | rule | PR モード | `x.ts` ("a test") |')).toEqual([]);
    expect(held('| `a` | rule | PR モード | `x.ts` ("a test"; "gone") |')).toEqual(['`a`: "gone" is not in x.ts']);
    expect(held('| `a` | rule | PR モード | `x.ts` ("a test"); `y.ts` ("a test") |')).toEqual([]);
    expect(held('| `a` | rule | PR モード | `x.ts` ("a test"); `y.ts` ("gone") |')).toEqual(['`a`: "gone" is not in y.ts']);
    const secondGone = '| `a` | rule | PR モード | `x.ts` ("a test"); `gone.ts` ("a test") |';
    expect(problems(table(secondGone), path => path === "x.ts", () => 'it("a test", () => {});')).toEqual(['`a`: test is "`x.ts` ("a test"); `gone.ts` ("a test")"']);
  });

  it("c6-row-kinds: every row is a check that runs, a hand-run record or no check, and the hand-run records are these", () => {
    const kinds = rowsByKind(status);
    expect(kinds.other).toEqual([]);
    expect(kinds.check.length + kinds.hand_run.length + kinds.none.length).toBe(tableLines(status)!.length);
    expect(kinds.check.length).toBeGreaterThan(0);
    expect(kinds.none.length).toBeGreaterThan(0);
    // A new hand-run record is a choice to count a row on one run: it changes this list, so it is seen.
    expect(kinds.hand_run).toEqual(["`real-run-opens-one-pr-and-no-second`"]);
  });

  it("c6-row-kinds: counts the three kinds apart, and a hand-run record is not a check", () => {
    const SHA = "3d143fe2a17bf06d9c03292b3bfe57e1b3178617";
    const RECORD = "docs/progress/x.md";
    const cell = (path = RECORD, version = "0.3.0-preview.1", sha = SHA) => `Hand-run record (one run, version and SHA): \`${path}\`, ludion-ai ${version}, ${sha}`;
    const table = (...tests: string[]) => [HEADER, "|---|---|---|---|", ...tests.map((test, i) => `| \`r${i}\` | rule | PR モード | ${test} |`), ""].join("\n");
    const named = `Run at \`${SHA}\` (ludion-ai 0.3.0-preview.1, from the build).`;
    const held = (test: string, text = named, exists = (path: string) => path === RECORD || path === "x.ts") => problems(table(test), exists, () => text);

    expect(rowsByKind(table("`x.ts`", cell(), "Not written", "未実装", "`y.ts` (a case); `z.ts`", "Passes"))).toEqual({
      check: ["`r0`", "`r4`"], hand_run: ["`r1`"], none: ["`r2`", "`r3`"], other: ["`r5`"],
    });

    expect(held(cell())).toEqual([]);
    expect(held("`x.ts`")).toEqual([]);
    // The record is gone, or is not where a record is.
    expect(held(cell("docs/progress/gone.md"))).toEqual(["`r0`: the record docs/progress/gone.md is not there"]);
    expect(held(cell("x.ts"))).toEqual(["`r0`: a hand-run record is under docs/progress/, not at x.ts"]);
    expect(held(cell("docs/progress/a/x.md"))).toEqual(["`r0`: a hand-run record is under docs/progress/, not at docs/progress/a/x.md"]);
    // The version or the SHA is missing from the cell, or is not in that form.
    for (const test of [
      `Hand-run record (one run, version and SHA): \`${RECORD}\``,
      `Hand-run record (one run, version and SHA): \`${RECORD}\`, ${SHA}`,
      `Hand-run record (one run, version and SHA): \`${RECORD}\`, ludion-ai 0.3.0-preview.1`,
      cell(RECORD, "main"),
      cell(RECORD, "0.3.0-preview.1", SHA.slice(0, 7)),
      cell(RECORD, "0.3.0-preview.1", SHA.toUpperCase()),
      `Hand-run record: \`${RECORD}\`, ludion-ai 0.3.0-preview.1, ${SHA}`,
      `${cell()} and more`,
    ]) expect(held(test)).toEqual([`\`r0\`: not a hand-run record's form: "${test}"`]);
    // The record does not name what the cell says. A longer version or SHA that holds it is not the same one.
    expect(held(cell(), `Run at \`${SHA}\`.`)).toEqual(["`r0`: the record docs/progress/x.md does not name 0.3.0-preview.1"]);
    expect(held(cell(), "ludion-ai 0.3.0-preview.1.")).toEqual(["`r0`: the record docs/progress/x.md does not name 0.3.0-preview.1", `\`r0\`: the record docs/progress/x.md does not name ${SHA}`]);
    expect(held(cell(RECORD, "0.3.0"), named)).toEqual(["`r0`: the record docs/progress/x.md does not name 0.3.0"]);
    // A record written as a check does not count as one, in any place in the cell, and "hand-run" in another case is no kind.
    expect(held(`\`${RECORD}\``)).toEqual([`\`r0\`: ${RECORD} is a record, not a check`]);
    expect(held(`\`x.ts\`; \`${RECORD}\``)).toEqual([`\`r0\`: ${RECORD} is a record, not a check`]);
    expect(held(`hand-run record (one run, version and SHA): \`${RECORD}\`, ludion-ai 0.3.0-preview.1, ${SHA}`)).toEqual([`\`r0\`: test is "hand-run record (one run, version and SHA): \`${RECORD}\`, ludion-ai 0.3.0-preview.1, ${SHA}"`]);
  });

  it("c6-row-has-effect-column: a row's 効く時 is not changed unnoticed", () => {
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
      "`c6-no-row-without-check`": "PR モード",
      "`action-does-not-comment-on-dependabot-pr`": "PR モード",
      "`pr-mode-has-no-merge-call`": "PR モード",
      "`pr-changes-no-workflow-file`": "PR モード",
      "`v1-stops-on-other-lockfile`": "PR モード",
      "`pr-job-pushes-only-its-branch`": "PR モード",
      "`publish-only-by-oidc`": "PR モード",
      "`package-is-one-bundled-file`": "PR モード",
      "`package-has-no-dependencies-or-install-scripts`": "PR モード",
      "`user-workflow-pins-actions-by-sha`": "PR モード",
      "`action-carries-the-cli`": "PR モード",
      "`local-install-is-a-pinned-dev-dependency`": "PR モード",
      "`self-update-same-wait-and-provenance`": "PR モード",
      "`candidate-job-has-no-write-or-secret`": "PR モード",
      "`writing-job-runs-no-dependency-code`": "PR モード",
      "`npm-cache-off-across-the-split`": "PR モード",
      "`no-ludion-operated-host`": "PR モード",
      "`cli-hosts-are-named`": "PR モード",
      "`lock-entry-from-the-registry-by-hash`": "PR モード",
      "`image-move-pinned-by-digest`": "PR モード",
      "`gate3-images-pinned-by-digest`": "PR モード",
      "`osv-query-is-name-and-version`": "PR モード",
      "`cve-ids-not-sent`": "PR モード",
      "`only-returned-ids-go-back-to-osv`": "PR モード",
      "`no-source-or-usage-sent`": "PR モード",
      "`real-run-opens-one-pr-and-no-second`": "PR モード",
    });
  });
});

const GAP = String.raw`(?:\s|\\\s)+`; // Between two words of a command: blanks and shell line continuations.
const ARG = String.raw`(?:"[^"\n]*"|'[^'\n]*'|\S+)`; // One argument of a command: quoted, or with no blank in it.
const MERGE_CALLS = [
  /\/pulls\/[^\s"'`]*\/merge\b/, // REST: PUT /repos/{owner}/{repo}/pulls/{n}/merge
  /\/merges\b/, // REST: POST /repos/{owner}/{repo}/merges
  /\b(?:pulls|repos)\.merge\b/, // Octokit
  new RegExp(String.raw`\bpr(?:${GAP}(?:-R|--repo)(?:=|${GAP})${ARG})*${GAP}merge\b`), // gh, whatever stands before "pr": gh -R x, "$GH"
  new RegExp(String.raw`\bgit(?:${GAP}(?:-[cC]${GAP}${ARG}|--\S+))*${GAP}merge\b(?!-)`), // git merge, git -C x merge, git --no-pager merge
  /["'`]merge["'`]/, // an argument list: ["pr", "merge", …], ["merge", …]
  /\b(?:mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|mergeBranch)\b/, // GraphQL
  /\b(?:merge_method|auto_merge)\b/,
  /^\s*(?:-\s+)?uses:[^\n]*merge/im, // a workflow step whose action's name says merge, automerge or auto-merge
];
const mergeCalls = (text: string) => MERGE_CALLS.filter(pattern => pattern.test(text)).map(String);

function files(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, root), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}

// What is bundled into the Action and the CLI, from source: the built file exists only in a release commit.
// .github/judge/record.ts is action/build.ts's entry point, so action/dist/record.js holds it.
const shipped = ["action.yml", ".github/judge/record.ts", ...files("action"), ...files("packages/cli/src"), ...files("packages/sandbox/src")];

describe("pr-mode-has-no-merge-call", () => {
  it("the source of the Action and the CLI has none of these forms", () => {
    for (const path of ["action.yml", ".github/judge/record.ts", "action/build.ts", "action/patch.sh", "action/patch-workflow.yml", "packages/cli/src/security/deliver.ts", "packages/sandbox/src/docker.ts"]) expect(shipped).toContain(path);
    expect(read("action/build.ts")).toContain('entryPoints: [".github/judge/record.ts"]');
    expect(shipped.map(path => [path, mergeCalls(read(path))]).filter(([, found]) => found!.length)).toEqual([]);
  });

  it("finds these forms, and not the words the preview's notices and records use", () => {
    for (const call of [
      'gh -R "$REPO" pr merge "$pr" --squash',
      'gh --repo "$REPO" pr merge "$pr"',
      '"$GH" pr merge "$pr"',
      'gh pr \\\n  merge "$pr"',
      'gh pr -R "$REPO" merge "$pr"',
      'git -C "$GITHUB_WORKSPACE" merge --ff-only x',
      "git -c user.name=x merge x",
      'git -C "a b" \\\n  merge x',
      "git --no-pager merge x",
      "octokit.rest.repos.merge({ base, head })",
      "uses: pascalgn/automerge-action@abc",
      "uses: peter-evans/enable-pull-request-automerge@abc",
      "      - uses: owner/auto-merge@abc",
      "      - uses: owner/merge-me-action@abc",
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
      'git -C "$GITHUB_WORKSPACE" merge-base a b',
      'git -C "$GITHUB_WORKSPACE" log -1 --format=%cI "$GITHUB_SHA"',
      "gh pr view 1 --json mergeable",
      "the PR's merge base",
      'jq -n --arg merge "$MERGE_SHA"',
      'merge_sha: sha("MERGE_SHA")',
      "MERGE_SHA: ${{ github.sha }}",
      "# Nothing is merged. PRs opened with the workflow's token start no CI; start it before merging.",
      "uses: actions/checkout@abc",
    ]) expect([word, mergeCalls(word)]).toEqual([word, []]);
  });

  it("does not find these forms, which the row names as what it does not see", () => {
    for (const form of [
      'const verb = "mer" + "ge"; execFileSync("gh", ["pr", verb]);',
      '"$GIT" merge x',
      "git pull origin main",
      "gh repo sync",
      "uses: owner/some-action@abc",
    ]) expect([form, mergeCalls(form)]).toEqual([form, []]);
  });
});

describe("the step of mode pull-request that holds the token", () => {
  const steps = read("action.yml").split(/\n    - /).slice(1);

  it("writing-job-cli-is-in-the-action: takes its CLI from the action's own path, not from the project", () => {
    const holding = steps.filter(step => step.includes("github.token") && step.includes("deliver open"));
    expect(holding).toHaveLength(1);
    expect(holding[0]).toContain('node "$CLI" deliver open');
    expect(holding[0]!.split("\n").filter(line => /^\s*CLI:/.test(line)).map(line => line.trim())).toEqual(["CLI: ${{ github.action_path }}/packages/cli/dist/cli.js"]);
  });
});

const PUSH_CALLS = [
  new RegExp(String.raw`\bgit(?:${GAP}(?:-[cC]${GAP}${ARG}|--\S+))*${GAP}push\b`), // git push, git -C x push, git --no-pager push
  /["'`]push["'`]/, // an argument list: ["-C", top, "push", …]
  /\/git\/(?:refs|commits|trees|blobs)\b/, // REST: what makes a commit or moves a branch without Git
  /\b(?:createRef|updateRef|createCommitOnBranch|createOrUpdateFileContents)\b/, // GraphQL and Octokit
  /\b(?:updateBranch|update-branch)\b/, // REST and Octokit: merges the base into a PR's branch
  /(?:-X\s+|--method[\s=]+|["'`])PUT\b/, // REST: PUT /repos/{owner}/{repo}/contents/{path} writes a commit
  /^\s*(?:-\s+)?uses:[^\n]*push/im, // a workflow step whose action's name says push
];
const pushCalls = (text: string) => PUSH_CALLS.flatMap(pattern => [...text.matchAll(new RegExp(pattern, `${pattern.flags}g`))].map(match => match[0].trim()));

describe("pr-job-pushes-only-its-branch", () => {
  const DELIVER = "packages/cli/src/security/deliver.ts", TIME_CAP = "packages/cli/src/security/time-cap.ts";

  it("pr-job-pushes-only-its-branch: the source of the Action and the CLI pushes in one place, behind its guard", () => {
    expect(shipped).toEqual(expect.arrayContaining([DELIVER, TIME_CAP, "action/patch.sh", "action.yml"]));
    const found = Object.fromEntries(shipped.map(path => [path, pushCalls(read(path)).sort()]).filter(([, calls]) => calls!.length));
    expect(found).toEqual({
      // The call, the GET that reads an earlier run's branch, and the words "git push" in the call's comment and error message.
      [DELIVER]: ['"push"', "/git/commits", "git push", "git push"],
      // Not a call: the GitHub events a package may be published from.
      [TIME_CAP]: ['"push"'],
    });
    expect(read(TIME_CAP)).toContain('PUBLISH_EVENTS = ["push", "release", "workflow_dispatch"]');
    const deliver = read(DELIVER);
    expect(deliver).toContain('call(api, "GET", `/repos/${options.repo}/git/commits/${remoteCommit}`)');
    expect(deliver).toContain('"push", "--no-verify", "--porcelain", remote, `${commit}:refs/heads/${branch}`]');
    expect(deliver).toContain('!/^ludion\\/[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("Only a fix commit goes to a ludion/ branch.")');
    expect(deliver).toContain("if (!remoteSha) push(top, options.remote, fix.commit, fix.branch, options.token);");
  });

  it("finds these forms, and not the words the source uses for other things", () => {
    for (const call of [
      "git push origin main",
      'git -C "$GITHUB_WORKSPACE" push origin HEAD:main',
      "git -c user.name=x push origin main",
      "git --no-pager push origin main",
      'git -C "a b" \\\n  push origin main',
      'execFileSync("git", ["push", "origin", "main"])',
      'gh api -X PATCH "repos/$REPO/git/refs/heads/main" -f sha=$SHA',
      'gh api repos/o/r/git/commits --input x',
      "octokit.rest.git.updateRef({ ref: 'heads/main', sha })",
      "mutation { createCommitOnBranch(input: {}) { clientMutationId } }",
      "octokit.rest.repos.createOrUpdateFileContents({ path, content })",
      'gh api -X PUT "repos/$REPO/pulls/$PR/update-branch"',
      'gh api -X PUT "repos/$REPO/contents/package.json" --input x',
      'gh api --method PUT "repos/$REPO/contents/package.json"',
      'fetch(url, { method: "PUT", body })',
      "uses: ad-m/github-push-action@abc",
      "      - uses: owner/force-push@abc",
    ]) expect([call, pushCalls(call).length > 0]).toEqual([call, true]);
    for (const word of [
      "out.push(finding);",
      "so a push while this job runs",
      'args: ["-c", "push.recurseSubmodules=no"]',
      "on: push",
      'gh api -X PATCH "repos/${REPO}/issues/comments/${id}"',
      'gh api -H "Accept: application/vnd.github.raw+json" "repos/${REPO}/contents/${path}?ref=$2"',
      "uses: actions/checkout@abc",
    ]) expect([word, pushCalls(word)]).toEqual([word, []]);
  });

  it("does not find these forms, which the row names as what it does not see", () => {
    for (const form of [
      'const verb = "pu" + "sh"; execFileSync("git", [verb]);',
      '"$GIT" push origin main',
      "uses: owner/some-action@abc",
    ]) expect([form, pushCalls(form)]).toEqual([form, []]);
  });
});
