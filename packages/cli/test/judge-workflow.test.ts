// The judge on this repository's own PRs (.github/workflows/judge.yml, judge-comment.yml, .github/judge/record.ts):
// the read-only job builds the judge from the base commit and never runs the PR; the commenting job checks out and
// runs nothing; every action is pinned by commit SHA; a failed judge is recorded as undecidable.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { filesArgument, fit, printInert, printRecord, REASON_LIMIT, recordOf, shownSize, TEXT_LIMIT, type Meta, type Run } from "../../../.github/judge/record.ts";
import { judge, renderJudgement, type Change, type VersionFacts } from "../src/security/judge.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const JUDGE = read(".github/workflows/judge.yml"), COMMENT = read(".github/workflows/judge-comment.yml");
const code = (yaml: string) => yaml.split("\n").filter(l => !l.trim().startsWith("#")).join("\n");

/** A `key: |` block scalar from a workflow, without its indentation. */
function block(yaml: string, key: string): string {
  const lines = yaml.split("\n");
  const at = lines.findIndex(l => new RegExp(`^\\s+${key}: \\|$`).test(l));
  if (at < 0) throw new Error(`no ${key} block`);
  const indent = lines[at]!.search(/\S/), body: string[] = [];
  for (const line of lines.slice(at + 1)) { if (line.trim() && line.search(/\S/) <= indent) break; body.push(line); }
  const strip = Math.min(...body.filter(l => l.trim()).map(l => l.search(/\S/)));
  return body.map(l => l.slice(strip)).join("\n").trimEnd() + "\n";
}
/** Every permission a workflow grants, as "scope: level", wherever it is set. */
function permissions(yaml: string): string[] {
  const lines = code(yaml).split("\n"), out: string[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)permissions:\s*(.*)$/.exec(line);
    if (!m) return;
    if (m[2]) { out.push(m[2]); return; }
    for (const next of lines.slice(i + 1)) {
      if (next.trim() && next.search(/\S/) <= m[1]!.length) break;
      if (next.trim()) out.push(next.trim());
    }
  });
  return out;
}
const uses = (yaml: string) => code(yaml).split("\n").filter(l => /^\s*(-\s+)?uses:/.test(l)).map(l => l.replace(/^\s*(-\s+)?uses:\s*/, ""));
/** Where a part is in a text, failing when it is not there, so that an order check cannot pass on -1 (#156's review, N1). */
function at(text: string, part: string): number {
  const i = text.indexOf(part);
  expect(i, part).toBeGreaterThanOrEqual(0);
  return i;
}

describe("judge.yml (pull_request, read-only)", () => {
  it("runs only for lockfile changes, with read access to contents and nothing else", () => {
    expect(JUDGE).toMatch(/on:\n  pull_request:\n    paths:\n      - package-lock.json\n\n/);
    expect(permissions(JUDGE)).toEqual(["contents: read", "contents: read"]);
    expect(JUDGE).not.toMatch(/secrets\.|github\.token|GH_TOKEN|pull_request_target/);
  });
  it("builds the judge from the base commit and reads the PR's dependency files only as data", () => {
    const steps = code(JUDGE);
    expect(uses(JUDGE).filter(u => u.startsWith("actions/checkout@"))).toHaveLength(1);
    expect(steps).toMatch(/actions\/checkout@\w+ # v[\d.]+\n        with:\n          ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n          persist-credentials: false\n/);
    // npm runs twice, both on the base commit: an install with no scripts, then the build.
    expect(steps.match(/^.*\bnpm\b.*$/gm)!.map(l => l.trim())).toEqual(["npm ci --ignore-scripts --no-audit --no-fund", "npm run build --workspace ludion-ai"]);
    expect(steps).not.toMatch(/\bnpx\b|\byarn\b|\bpnpm\b|npm install/);
    // The build runs on the base commit's tree. The only checkouts are the event's base (replaced by the read step)
    // and the base the read step found: none names the PR's head, its test merge commit or their refs.
    const checkoutBase = 'git checkout --quiet --detach "$base"\n';
    expect(at(steps, "npm ci")).toBeGreaterThan(at(steps, checkoutBase));
    expect(steps.match(/^.*\bcheckout\b.*$/gm)!.map(l => l.trim())).toEqual(["- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1", 'git checkout --quiet --detach "$base"']);
    expect(steps).not.toMatch(/checkout[^\n]*(HEAD_SHA|MERGE_SHA|refs\/ludion\/merge|head\.sha|github\.sha)/);
    // Node comes from the base commit's .node-version too, so it is set up after that checkout (#156's review, N4).
    expect(at(steps, "actions/setup-node@")).toBeGreaterThan(at(steps, checkoutBase));
    expect(steps).toMatch(/- uses: actions\/setup-node@\w+ # v[\d.]+\n        if: \$\{\{ !cancelled\(\) \}\}\n        with:\n          node-version-file: \.node-version\n/);
    // The PR's tree is never checked out: two files and each changed */package.json are copied out of it with git show,
    // and its file list is read.
    expect(steps.match(/^.*\bgit\b.*$/gm)!.map(l => l.trim().split(" ").slice(0, 2).join(" "))).toEqual(["git fetch", "read -r", "git fetch", "if !", "git show", "git show", "git diff", "if git", "if git", "git checkout"]);
    expect(steps).toContain('for file in package.json package-lock.json; do');
    expect(steps).toContain('case "$file" in */package.json) ;; *) continue ;; esac');
    expect(steps).toContain('if git cat-file -e "${MERGE_SHA}:${file}" 2> /dev/null; then git show "${MERGE_SHA}:${file}" > "$INPUT/after/${file}"; fi');
    // The only program started after that is the record script, which runs the base commit's build of the judge.
    expect(steps.match(/^\s+run: node .*$/gm)!.map(l => l.trim())).toEqual(["run: node .github/judge/record.ts"]);
    expect(read(".github/judge/record.ts")).toContain('["packages/cli/dist/cli.js", "judge", "--before"');
  });
  it("takes the base from the test merge commit, not the event's base SHA, which goes stale when the base branch moves", () => {
    const steps = code(JUDGE);
    expect(steps).toContain('read -r _ base second rest <<< "$(git rev-list --parents -n 1 "$MERGE_SHA")"');
    expect(steps).toContain('if [ "$second" != "$HEAD_SHA" ] || [ -n "${rest:-}" ]; then');
    // The base must be on the base branch before anything is read from it or built from it. The branch is fetched by
    // its own name, so the check cannot be made against the PR's head (#156's review, N1).
    expect(steps).toContain("BASE_REF: ${{ github.event.pull_request.base.ref }}\n");
    expect(steps).toContain('git fetch --no-tags --depth=50 origin "+refs/heads/${BASE_REF}:refs/ludion/base"\n');
    expect(steps).toContain('if ! git merge-base --is-ancestor "$base" refs/ludion/base; then');
    expect(at(steps, "--is-ancestor")).toBeLessThan(at(steps, 'git show "${base}:${file}"'));
    expect(steps).toContain('git show "${base}:${file}" > "$INPUT/before/${file}"');
    expect(steps).toContain('git diff --no-renames --name-only -z "$base" "$MERGE_SHA" > "$INPUT/files"');
    expect(steps).not.toMatch(/(show|diff|checkout)[^\n]*BASE_SHA/);
    expect(steps).toContain("BASE_SHA: ${{ steps.read.outputs.base || github.event.pull_request.base.sha }}");
  });
  it('records "undecidable" before anything runs, and uploads the record even when a step fails', () => {
    const steps = code(JUDGE);
    expect(at(steps, 'Record "undecidable"')).toBeLessThan(at(steps, "actions/checkout@"));
    expect(steps).toMatch(/- name: Judge\n        if: \$\{\{ !cancelled\(\) \}\}/);
    expect(steps).toMatch(/actions\/upload-artifact@\w+ # v[\d.]+\n        if: always\(\)\n        with:\n          name: judgement\n/);
  });
});

describe("judge-comment.yml (workflow_run, writes comments)", () => {
  it("can read artifacts and commits and write PR comments, and nothing else", () => {
    expect(COMMENT).toMatch(/on:\n  workflow_run:\n    workflows: \[judge\]\n    types: \[completed\]\n/);
    expect(permissions(COMMENT)).toEqual(["actions: read", "contents: read", "pull-requests: write", "actions: read", "contents: read", "pull-requests: write"]);
    expect(COMMENT).not.toMatch(/secrets\./);
  });
  it("checks out nothing and runs no code from the PR or the repository", () => {
    expect(uses(COMMENT)).toEqual([]);
    expect(code(COMMENT).match(/^\s+run: /gm)).toHaveLength(1);
    const script = code(block(COMMENT, "run"));
    for (const word of ["checkout", "git", "npm", "npx", "node", "bash", "sh", "source", "eval", "exec", "curl", "wget"]) expect(script, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    // The programs it runs are gh, jq, unzip and head, and shell builtins; the rest is data.
    const commands = script.split("\n").map(l => l.trim()).filter(l => l && !/^(if \[ |then$|else$|fi$|exit [01]$|echo "|read -r |id=\$\{|dir="|mkdir -p )/.test(l));
    for (const line of commands) expect(line).toMatch(/^(set -euo pipefail$|[a-z_]+=\$\((gh|jq) |gh api |unzip -p |jq |--jq |if ! jq )/);
  });
  it("comments only for the judge workflow's own pull_request runs, on the open PR at the run's head, when the record names both", () => {
    const script = code(block(COMMENT, "run"));
    expect(COMMENT).toContain("if: github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.path == '.github/workflows/judge.yml'");
    // The PR comes from GitHub, by the run's repository and branch, into the default branch, not from the artifact.
    expect(script).toContain('gh api -X GET "repos/${REPO}/pulls" -f state=open -f "head=${RUN_OWNER}:${RUN_BRANCH}" -f "base=${DEFAULT_BRANCH}" > "$dir/pulls.json"\n');
    expect(script).toContain('found=$(jq -r --arg repo "$RUN_REPO" --arg ref "$RUN_BRANCH" "$PICK" "$dir/pulls.json")\n');
    expect(script).toContain('if [ "$current" != "$RUN_HEAD" ]; then');
    expect(script).toContain('if [ "$recorded" != "${pr} ${RUN_HEAD}" ]; then');
    expect(at(script, 'jq -e -s "$VALID"')).toBeLessThan(at(script, "recorded=$(jq"));
    expect(COMMENT).toContain("DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}\n");
  });
  it("decides the .github/ refusal from what the run's own head changes, read by its SHA, before reading the artifact", () => {
    const script = code(block(COMMENT, "run"));
    // Not the PR's file list, which a push during this job could change.
    expect(script).not.toContain("/files");
    expect(script).toContain('gh api "repos/${REPO}/compare/${DEFAULT_BRANCH}...${RUN_HEAD}" > "$dir/compare.json"\nrefused=$(jq -r "$REFUSE" "$dir/compare.json")\n');
    // A refused head's artifact is never listed, downloaded or parsed (#156's review, N6).
    expect(at(script, "refused=$(")).toBeGreaterThan(at(script, 'if [ "$current" != "$RUN_HEAD" ]'));
    expect(at(script, "refused=$(")).toBeLessThan(at(script, "/artifacts"));
    expect(script).toContain('if [ "$refused" = "true" ]; then\n  jq -r -n --arg run "$RUN_URL" --arg head "$RUN_HEAD" --argjson refused true "$BODY" > "$dir/body.md"\nelse\n');
    expect(script).toContain('--argjson refused false "$BODY" "$dir/record.json"');
  });
  it("fails, rather than posting nothing quietly, when a finished run left no record", () => {
    const script = code(block(COMMENT, "run"));
    expect(script).toContain('if [ "$CONCLUSION" = "cancelled" ]; then');
    expect(script).toContain('echo "::error::Run ${RUN_ID} (${CONCLUSION}) has no judgement artifact. Nothing posted."\n    exit 1');
    expect(JUDGE).toMatch(/if-no-files-found: error\n\s+# .*\n\s+overwrite: true\n/);
  });
  it("keeps one comment per PR and updates it", () => {
    expect(COMMENT).toContain('select(.user.login == "github-actions[bot]" and (.body | startswith("<!-- ludion-judge -->")))');
    expect(COMMENT).toContain('gh api -X PATCH "repos/${REPO}/issues/comments/${id}"');
  });
});

describe("both workflows", () => {
  it("pin every action by commit SHA", () => {
    const all = [...uses(JUDGE), ...uses(COMMENT)];
    expect(all).toHaveLength(3);
    for (const u of all) expect(u).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});

const meta: Meta = { pr: 7, head_sha: "a".repeat(40), base_sha: "b".repeat(40), merge_sha: "c".repeat(40), started_at: "2026-10-28T10:00:00.000Z" };
const NOW = new Date("2026-10-28T10:01:30.000Z");
const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
const fact = (over: Partial<VersionFacts> = {}): VersionFacts => ({ published_at: "2026-10-01T00:00:00Z", present: true, deprecated: null, publisher: "alice", shared_publisher: false, provenance: null, install_scripts: [], dependencies: [], integrity: INTEGRITY, malicious: [], advisories: [], package_created: "2020-01-01T00:00:00Z", ...over });
const change: Change = { path: "node_modules/lib", name: "lib", from: "1.0.0", to: "1.0.1", dev: false, resolved: "https://registry.npmjs.org/lib/-/lib-1.0.1.tgz", integrity: INTEGRITY, replaced: null };
const judgement = (next: Partial<VersionFacts> = {}, now = "2026-10-28T10:00:00Z") => judge({ changes: [change], facts: new Map([["lib@1.0.0", fact({ published_at: "2026-09-01T00:00:00Z" })], ["lib@1.0.1", fact(next)]]), fixes: [], files: ["package-lock.json"], now: new Date(now), direct: ["lib"] });
const ran = (exitCode: number | null, stdout: string, more: { stderr?: string; error?: string } = {}) => ({ exitCode, stdout, stderr: more.stderr ?? "", error: more.error, seconds: 4.2 });
const record = (run: Run | string, now = NOW) => recordOf(meta, run, now, renderJudgement);

describe("the record (.github/judge/record.ts)", () => {
  it("keeps the judge's verdict when its exit code matches", () => {
    const stop = judgement({ malicious: ["MAL-2026-1"] }), ready = judgement();
    expect(stop.verdict).toBe("stop");
    expect(ready.verdict).toBe("ready_except_build");
    const r = record(ran(1, JSON.stringify(stop)), NOW);
    expect(r).toMatchObject({ verdict: "stop", reason: null, judge_exit_code: 1, judge_seconds: 4.2, job_seconds: 90, pr: 7, head_sha: meta.head_sha });
    expect(r.text).toContain("Ludion judgement: STOP");
    expect(record(ran(0, JSON.stringify(ready)), NOW).verdict).toBe("ready_except_build");
    expect(record(ran(3, JSON.stringify(judgement({ published_at: "2026-10-28T09:00:00Z" }))), NOW).verdict).toBe("wait");
  });
  it("is undecidable whenever the judge did not finish with a judgement", () => {
    const ready = JSON.stringify(judgement());
    const failures = [
      record("The judge could not be built from the base commit; see the run log.", NOW),
      record(ran(2, "", { stderr: "ludion: package-lock.json: Expected a regular project file." }), NOW),
      record(ran(null, "", { error: "spawnSync node ETIMEDOUT" }), NOW),
      record(ran(0, ready.slice(0, 50)), NOW),
      record(ran(0, JSON.stringify({ schema: 1, verdict: "ok" })), NOW),
      record(ran(0, JSON.stringify({ ...judgement(), schema: 2 })), NOW),
      // A "ready" judgement with the exit code of a stop, or the other way round, is not trusted either way.
      record(ran(1, ready), NOW),
      record(ran(0, JSON.stringify(judgement({ malicious: ["MAL-2026-1"] }))), NOW),
    ];
    for (const r of failures) expect(r).toMatchObject({ verdict: "undecidable", judgement: null, text: null });
    expect(failures.map(r => r.reason)).toEqual([
      "The judge could not be built from the base commit; see the run log.",
      "The judge exited 2 without a judgement: ludion: package-lock.json: Expected a regular project file.",
      "The judge did not finish: spawnSync node ETIMEDOUT",
      "The judge exited 0 without a judgement: no output",
      "The judge exited 0 with output that is not a judgement.",
      "The judge exited 0 with output that is not a judgement.",
      'The judge exited 1, which does not match its verdict "ready_except_build".',
      'The judge exited 0, which does not match its verdict "stop".',
    ]);
  });
  it("cuts a text to what judge-comment accepts once each line is indented", () => {
    const long = judgement(), many = judgement();
    long.findings.push({ gate: 1, effect: "info", message: "x".repeat(TEXT_LIMIT) });
    // Many short lines: under the limit by length, over it once indented (#156's first review).
    for (let i = 0; i < 3_000; i++) many.findings.push({ gate: 2, effect: "info", message: "y" });
    expect(renderJudgement(many).length).toBeLessThanOrEqual(TEXT_LIMIT);
    expect(shownSize(renderJudgement(many))).toBeGreaterThan(TEXT_LIMIT);
    for (const big of [long, many]) {
      const r = record(ran(0, JSON.stringify(big)), NOW);
      expect(shownSize(r.text!)).toBeLessThanOrEqual(TEXT_LIMIT);
      expect(r.text).toMatch(/\n… \(cut here; the full judgement is in the run's judgement artifact\)$/);
    }
    expect(shownSize(record(ran(2, "", { stderr: "e\n".repeat(5000) }), NOW).reason!)).toBeLessThanOrEqual(REASON_LIMIT);
    expect(fit("a\nb", 100, "cut")).toBe("a\nb");
  });
  it("refuses file names that the judge's comma-separated --files cannot carry", () => {
    expect(filesArgument(["package.json", "package-lock.json"])).toBe("package.json,package-lock.json");
    for (const odd of ["package.json,package-lock.json", " package.json", "package-lock.json "]) expect(() => filesArgument(["package-lock.json", odd])).toThrow(/cannot carry/);
  });
});

// The schema check and the comment are jq programs inside judge-comment.yml; run them with jq as the runner does.
// GitHub's ubuntu runners have jq; elsewhere these run only when jq is installed (and in CI, always).
const hasJq = spawnSync("jq", ["--version"]).status === 0;
const jq = (args: string[], input: string) => spawnSync("jq", args, { input, encoding: "utf8" });
const valid = (value: unknown) => jq(["-e", "-s", block(COMMENT, "VALID")], typeof value === "string" ? value : JSON.stringify(value)).status === 0;
/** The comment, as judge-comment.yml renders it: from the record, or with no record for a refused head. */
const body = (value: unknown, refused = false) => {
  const args = ["-r", "--arg", "run", "https://github.com/Ludion-ai/ludion/actions/runs/1", "--arg", "head", meta.head_sha, "--argjson", "refused", String(refused), block(COMMENT, "BODY")];
  const r = refused ? jq(["-n", ...args], "") : jq(["-s", ...args], JSON.stringify(value));
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
};

describe.skipIf(!hasJq && !process.env.CI)("judge-comment.yml's jq programs", () => {
  const stop = record(ran(1, JSON.stringify(judgement({ malicious: ["MAL-2026-1"] }))), NOW);
  const failed = record(ran(2, "", { stderr: "ludion: boom" }), NOW);
  it("accept every record the record script writes, and judge.yml's first record", () => {
    expect(valid(stop)).toBe(true);
    expect(valid(failed)).toBe(true);
    expect(valid(record(ran(0, JSON.stringify(judgement())), NOW))).toBe(true);
    const initial = jq(["-n", "--argjson", "pr", "7", "--arg", "head", meta.head_sha, "--arg", "base", meta.base_sha, "--arg", "merge", meta.merge_sha, "--arg", "at", meta.started_at, block(JUDGE, "INITIAL")], "");
    expect(initial.status, initial.stderr).toBe(0);
    expect(JSON.parse(initial.stdout)).toMatchObject({ verdict: "undecidable", judgement: null, pr: 7 });
    expect(valid(initial.stdout)).toBe(true);
  });
  it("reject a record that is not exactly the schema", () => {
    const bad: unknown[] = [
      { ...stop, extra: 1 },
      { ...stop, schema: 2 },
      { ...stop, pr: "7" },
      { ...stop, pr: 7.5 },
      { ...stop, head_sha: "A".repeat(40) },
      { ...stop, merge_sha: null },
      { ...stop, verdict: "ready" },
      { ...stop, verdict: "ready_except_build" },
      { ...stop, judgement: null },
      { ...stop, reason: "x" },
      { ...stop, text: "" },
      { ...stop, text: "x".repeat(60_001) },
      // Under 60,000 characters, but not once each line is indented.
      { ...stop, text: "x\n".repeat(11_000) },
      // A SHA or a time followed by a newline: jq's `$` matches before a final newline.
      { ...stop, head_sha: `${"a".repeat(40)}\n` },
      { ...stop, head_sha: `${"a".repeat(39)}\n` },
      { ...stop, started_at: `${meta.started_at}\n` },
      { ...stop, judge_seconds: -1 },
      { ...stop, started_at: "yesterday" },
      { ...failed, verdict: "stop" },
      { ...failed, text: "Ludion judgement: gates 1, 2 and 4 found nothing" },
      { ...failed, reason: "x".repeat(2001) },
      [stop],
    ];
    for (const value of bad) expect(valid(value), JSON.stringify(value).slice(0, 120)).toBe(false);
    expect(valid(`${JSON.stringify(stop)}\n${JSON.stringify(stop)}`)).toBe(false);
    expect(valid("not json")).toBe(false);
  });
  it("write the preview line first and say what v0 does not judge", () => {
    const text = body(stop);
    expect(text.split("\n").slice(0, 2)).toEqual(["<!-- ludion-judge -->", "**プレビュー：コメントのみ。この判定でマージは行われない。**"]);
    expect(text).toContain("判定するのは関門1・2・4の一部と待機だけで（実装した範囲と「Not checked」は判定役の出力にある）、関門3（旧版と新版のビルド・テスト）は未実装のため実行していない。");
    expect(text).toContain(`判定: **停止**（\`stop\`） · 判定した head \`${meta.head_sha}\` · 判定にかかった時間: 判定役 4.2 秒、ジョブ開始から 90 秒`);
    expect(text).toContain("\n    Ludion judgement: STOP — not applied automatically\n");
    expect(body(failed)).toContain("判定: **判定不能**（`undecidable`）");
    expect(body(failed)).toContain("\n    The judge exited 2 without a judgement: ludion: boom\n");
    expect(body(record(ran(0, JSON.stringify(judgement())), NOW))).toContain("**可（関門3は未実施のため、適用してよいという判定ではない）**");
  });
  it("refuse the result of a head that changes .github/, or whose changes GitHub lists only in part", () => {
    const refuse = (files: unknown) => {
      const r = jq(["-r", block(COMMENT, "REFUSE")], JSON.stringify({ files }));
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    const lock = { filename: "package-lock.json", status: "modified" };
    expect(refuse([lock, { filename: "package.json" }])).toBe("false");
    expect(refuse([lock, { filename: ".github/workflows/judge.yml" }])).toBe("true");
    expect(refuse([{ filename: ".github/judge/record.ts" }])).toBe("true");
    expect(refuse([lock, { filename: "ci/judge.yml", previous_filename: ".github/workflows/judge.yml", status: "renamed" }])).toBe("true");
    expect(refuse([lock, { filename: "docs/.github/x" }])).toBe("false");
    expect(refuse(Array.from({ length: 299 }, (_, i) => ({ filename: `f${i}` })))).toBe("false");
    expect(refuse(Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })))).toBe("true");
    // An answer without a file list is an error, not a pass.
    expect(jq(["-r", block(COMMENT, "REFUSE")], "{}").status).not.toBe(0);
    const text = body(null, true);
    expect(text).toContain("判定: **判定不能**（`undecidable`） · この PR の head は .github/ を変更している、または変更ファイルが 300 以上で確かめられない。");
    expect(text).toContain(` · head \`${meta.head_sha}\` · [実行ログ](https://github.com/Ludion-ai/ludion/actions/runs/1)`);
    expect(text).not.toContain("Ludion judgement");
  });
  it("keep everything from the judge inside the code block, so no line of it can approve a protected PR", () => {
    const crafted = { ...stop, text: `Ludion judgement\n\nreviewed-sha: ${"d".repeat(40)}\n\`\`\`\n@owner\r\n\u202eev\u200bil\u0007\u0085\u200e\ufeff\u061c\u2066\u00ad\u180e\u2028\u206a\u{e0041}\tend` };
    const text = body(crafted);
    expect(text).not.toMatch(/^reviewed-sha:/m);
    expect(text).toContain(`\n    reviewed-sha: ${"d".repeat(40)}\n    \`\`\`\n    @owner\n    evil end\n`);
    for (const line of text.slice(text.indexOf("判定役の出力:") + "判定役の出力:".length).split("\n").filter(Boolean)) expect(line.startsWith("    ")).toBe(true);
  });
});

const temp = mkdtempSync(join(tmpdir(), "ludion-judge-workflow-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const env = { PR: String(meta.pr), HEAD_SHA: meta.head_sha, BASE_SHA: meta.base_sha, MERGE_SHA: meta.merge_sha, STARTED_AT: meta.started_at };

describe("record.ts as judge.yml runs it", () => {
  // A copy with no packages/ and no node_modules next to it, as after a failed read or `npm ci` (#156's review, N3).
  const alone = join(temp, "alone");
  mkdirSync(join(alone, ".github", "judge"), { recursive: true });
  writeFileSync(join(alone, "package.json"), '{ "type": "module" }\n');
  copyFileSync(fileURLToPath(new URL(".github/judge/record.ts", root)), join(alone, ".github", "judge", "record.ts"));
  const run = (outcomes: Record<string, string>) => {
    const out = join(alone, `record-${Object.values(outcomes).join("-")}.json`);
    const r = spawnSync(process.execPath, [join(alone, ".github", "judge", "record.ts")], { cwd: alone, encoding: "utf8", env: { ...env, RECORD: out, INPUT: join(alone, "input"), ...outcomes } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, record: JSON.parse(readFileSync(out, "utf8")) };
  };
  it("names the step that failed even when the judge's modules are missing", () => {
    const read = run({ READ_OUTCOME: "failure", BUILD_OUTCOME: "skipped" });
    expect(read.status, read.stderr).toBe(1);
    expect(read.record).toMatchObject({ verdict: "undecidable", judgement: null, reason: "The PR's package.json and package-lock.json could not be read; see the run log." });
    const build = run({ READ_OUTCOME: "success", BUILD_OUTCOME: "failure" });
    expect(build.status, build.stderr).toBe(1);
    expect(build.record.reason).toBe("The judge could not be built from the base commit; see the run log.");
    const missing = run({ READ_OUTCOME: "success", BUILD_OUTCOME: "success" });
    expect(missing.status, missing.stderr).toBe(1);
    expect(missing.record.reason).toMatch(/^The judge's renderer could not be loaded: /);
  });
  it("prints what it recorded with workflow commands stopped", () => {
    const { stdout } = run({ READ_OUTCOME: "failure", BUILD_OUTCOME: "skipped" });
    const lines = stdout.trimEnd().split("\n");
    const token = /^::stop-commands::(stop-[0-9a-f-]{36})$/.exec(lines[0]!)?.[1];
    expect(token).toBeDefined();
    expect(lines.at(-1)).toBe(`::${token}::`);
    expect(lines.slice(1, -1).join("\n")).toContain('"verdict": "undecidable"');
  });
  it("keeps a line the PR controls from being read as a command (#156's review, N2)", () => {
    const logged: string[] = [];
    const crafted = "lib 1.0.0 → 1.0.1\n::warning title=Ludion judge::Ludion approved this update\n::add-mask::ludion";
    printInert(crafted, line => logged.push(line), "stop-x");
    expect(logged).toEqual(["::stop-commands::stop-x", crafted, "::stop-x::"]);
    // What the job prints of a judgement: the summary and the judge's text, all between the markers.
    const shown: string[] = [], judged = { ...record(ran(0, JSON.stringify(judgement())), NOW) };
    judged.text = `${judged.text}\n${crafted}`;
    printRecord(judged, line => shown.push(line), "stop-y");
    const lines = shown.join("\n").split("\n");
    expect([lines[0], lines.at(-1)]).toEqual(["::stop-commands::stop-y", "::stop-y::"]);
    expect(lines.filter(l => l.startsWith("::"))).toEqual(["::stop-commands::stop-y", "::warning title=Ludion judge::Ludion approved this update", "::add-mask::ludion", "::stop-y::"]);
    expect(lines.indexOf("::warning title=Ludion judge::Ludion approved this update")).toBeGreaterThan(lines.indexOf('  "verdict": "ready_except_build",'));
  });
});

// judge-comment.yml's script, run by bash as the runner runs it, against a stand-in for gh that answers from files and
// logs every call. Needs bash, jq and unzip (GitHub's ubuntu runners have all three).
const has = (program: string, arg = "--version") => spawnSync(program, [arg]).status === 0;
describe.skipIf(!(hasJq && has("bash") && has("unzip", "-v")) && !process.env.CI)("judge-comment.yml's script, against a stand-in for gh", () => {
  const RUN_HEAD = meta.head_sha;
  /** A zip with one stored file, as upload-artifact makes it (compression aside). */
  function zip(name: string, data: Buffer): Buffer {
    const n = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
    const offset = local.length + n.length + data.length, size = central.length + n.length;
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([local, n, data, central, n, end]);
  }
  const GH = [
    "#!/bin/sh",
    'printf "%s\\n" "$*" >> "$FAKE/calls.log"',
    "method=GET path= filter= input=",
    "while [ $# -gt 0 ]; do",
    '  case "$1" in',
    "    api|--paginate) ;;",
    "    -X) method=$2; shift ;;",
    "    -f) shift ;;",
    "    --jq) filter=$2; shift ;;",
    "    --input) input=$2; shift ;;",
    "    *) path=$1 ;;",
    "  esac",
    "  shift",
    "done",
    'case "$method $path" in',
    '  "GET repos/o/r/pulls") file=pulls.json ;;',
    '  "GET repos/o/r/compare/"*) file=compare.json ;;',
    '  "GET repos/o/r/actions/runs/11/artifacts?name=judgement") file=artifacts.json ;;',
    '  "GET repos/o/r/actions/artifacts/5/zip") cat "$FAKE/artifact.zip"; exit 0 ;;',
    '  "GET repos/o/r/issues/7/comments") file=comments.json ;;',
    '  "POST repos/o/r/issues/7/comments") cp "$input" "$FAKE/posted.json"; exit 0 ;;',
    '  "PATCH repos/o/r/issues/comments/99") cp "$input" "$FAKE/patched.json"; exit 0 ;;',
    '  *) echo "stand-in gh: unexpected $method $path" >&2; exit 1 ;;',
    "esac",
    'if [ -n "$filter" ]; then jq -r "$filter" "$FAKE/$file"; else cat "$FAKE/$file"; fi',
    "",
  ].join("\n");
  type Case = { pulls?: unknown; files?: string[]; record?: unknown; artifacts?: unknown; comments?: unknown; conclusion?: string };
  let count = 0;
  function comment(c: Case) {
    const fake = join(temp, `gh-${++count}`), bin = join(fake, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), GH, { mode: 0o755 });
    const pr = { number: 7, head: { sha: RUN_HEAD, ref: "dependabot/npm_and_yarn/lib-1.0.1", repo: { full_name: "o/r" } } };
    writeFileSync(join(fake, "pulls.json"), JSON.stringify(c.pulls ?? [pr]));
    writeFileSync(join(fake, "compare.json"), JSON.stringify({ files: (c.files ?? ["package-lock.json"]).map(filename => ({ filename })) }));
    writeFileSync(join(fake, "artifacts.json"), JSON.stringify(c.artifacts ?? { artifacts: [{ id: 5, size_in_bytes: 1000, expired: false, created_at: "2026-10-28T10:00:00Z" }] }));
    writeFileSync(join(fake, "artifact.zip"), zip("judgement.json", Buffer.from(JSON.stringify(c.record ?? record(ran(0, JSON.stringify(judgement())), NOW)))));
    writeFileSync(join(fake, "comments.json"), JSON.stringify(c.comments ?? []));
    writeFileSync(join(fake, "calls.log"), "");
    const programs = Object.fromEntries(["VALID", "PICK", "REFUSE", "BODY"].map(k => [k, block(COMMENT, k)]));
    const r = spawnSync("bash", ["-c", block(COMMENT, "run")], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, FAKE: fake, RUNNER_TEMP: join(fake, "runner"), GH_TOKEN: "x", REPO: "o/r", RUN_ID: "11", RUN_HEAD, RUN_REPO: "o/r", RUN_OWNER: "o", RUN_BRANCH: "dependabot/npm_and_yarn/lib-1.0.1", DEFAULT_BRANCH: "main", RUN_URL: "https://github.com/o/r/actions/runs/11", CONCLUSION: c.conclusion ?? "success", ...programs },
    });
    const posted = (file: string) => { try { return JSON.parse(readFileSync(join(fake, file), "utf8")).body as string; } catch { return null; } };
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: readFileSync(join(fake, "calls.log"), "utf8"), posted: posted("posted.json"), patched: posted("patched.json") };
  }
  it("posts the judgement on the PR at the run's head, and updates its own comment the next time", () => {
    const first = comment({});
    expect(first.status, first.stderr).toBe(0);
    expect(first.posted).toContain("判定: **可（関門3は未実施のため、適用してよいという判定ではない）**");
    expect(first.posted).toContain(`判定した head \`${RUN_HEAD}\``);
    expect(first.calls).toContain("api -X GET repos/o/r/pulls -f state=open -f head=o:dependabot/npm_and_yarn/lib-1.0.1 -f base=main\n");
    expect(at(first.calls, "/compare/main...")).toBeLessThan(at(first.calls, "/artifacts?name=judgement"));
    const again = comment({ comments: [{ id: 98, user: { login: "Ludion-ai" }, body: "<!-- ludion-judge --> copied" }, { id: 99, user: { login: "github-actions[bot]" }, body: "<!-- ludion-judge -->\nold" }] });
    expect(again.status, again.stderr).toBe(0);
    expect([again.posted, again.patched?.split("\n")[0]]).toEqual([null, "<!-- ludion-judge -->"]);
  });
  it("never downloads or reads the artifact of a head that changes .github/ (#156's review, N6)", () => {
    for (const files of [["package-lock.json", ".github/workflows/judge.yml"], Array.from({ length: 300 }, (_, i) => `f${i}`)]) {
      const r = comment({ files, record: "not even json" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.calls).not.toContain("artifacts");
      expect(r.posted).toContain("判定: **判定不能**（`undecidable`） · この PR の head は .github/ を変更している");
      expect(r.posted).toContain(`head \`${RUN_HEAD}\``);
    }
  });
  it("posts nothing when the PR is not at the run's head, or no PR is open from the run's branch", () => {
    const pr = (over: object) => [{ number: 7, head: { sha: RUN_HEAD, ref: "dependabot/npm_and_yarn/lib-1.0.1", repo: { full_name: "o/r" }, ...over } }];
    for (const pulls of [[], pr({ sha: "e".repeat(40) }), pr({ repo: { full_name: "fork/r" } }), pr({ ref: "other" }), [...pr({}), ...pr({})]]) {
      const r = comment({ pulls });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/Nothing posted\.\n$/);
      expect([r.posted, r.patched]).toEqual([null, null]);
      expect(r.calls).not.toContain("compare");
    }
  });
  it("fails, posting nothing, when the record does not match the schema or names another PR or head", () => {
    const ready = record(ran(0, JSON.stringify(judgement())), NOW);
    for (const bad of [{ ...ready, pr: 8 }, { ...ready, head_sha: "e".repeat(40) }, { ...ready, verdict: "stop" }, "not json"]) {
      const r = comment({ record: bad });
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/^::error::.*Nothing posted\.$/m);
      expect([r.posted, r.patched]).toEqual([null, null]);
    }
    const cancelled = comment({ artifacts: { artifacts: [] }, conclusion: "cancelled" });
    expect([cancelled.status, cancelled.posted]).toEqual([0, null]);
    const lost = comment({ artifacts: { artifacts: [] } });
    expect([lost.status, lost.posted]).toEqual([1, null]);
  });
});
