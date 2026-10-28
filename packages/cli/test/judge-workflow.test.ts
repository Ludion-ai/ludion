// The judge on this repository's own PRs (.github/workflows/judge.yml, judge-comment.yml, .github/judge/record.ts):
// the read-only job builds the judge from the base commit and never runs the PR; the commenting job checks out and
// runs nothing; every action is pinned by commit SHA; a failed judge is recorded as undecidable.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filesArgument, fit, REASON_LIMIT, recordOf, shownSize, TEXT_LIMIT, type Meta } from "../../../.github/judge/record.ts";
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
    // npm runs twice, both on the base checkout before the PR is read: an install with no scripts, then the build.
    expect(steps.match(/^.*\bnpm\b.*$/gm)!.map(l => l.trim())).toEqual(["npm ci --ignore-scripts --no-audit --no-fund", "npm run build --workspace ludion-ai"]);
    expect(steps).not.toMatch(/\bnpx\b|\byarn\b|\bpnpm\b|npm install/);
    expect(steps.indexOf("npm run build")).toBeLessThan(steps.indexOf("git fetch"));
    // The PR's tree is never checked out: two files are copied out of it with git show, and its file list is read.
    expect(steps.match(/^.*\bgit\b.*$/gm)!.map(l => l.trim().split(" ").slice(0, 2).join(" "))).toEqual(["git fetch", "read -r", "git show", "git show", "git diff"]);
    expect(steps).toContain('for file in package.json package-lock.json; do');
    // The only program started after that is the record script, which runs the base commit's build of the judge.
    expect(steps.match(/^\s+run: node .*$/gm)!.map(l => l.trim())).toEqual(["run: node .github/judge/record.ts"]);
    expect(read(".github/judge/record.ts")).toContain('["packages/cli/dist/cli.js", "judge", "--before"');
  });
  it('records "undecidable" before anything runs, and uploads the record even when a step fails', () => {
    const steps = code(JUDGE);
    expect(steps.indexOf('Record "undecidable"')).toBeLessThan(steps.indexOf("actions/checkout@"));
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
  it("comments only for the judge workflow's own pull_request runs, when the recorded head is the run's and the PR's", () => {
    const script = code(block(COMMENT, "run"));
    expect(COMMENT).toContain("if: github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.path == '.github/workflows/judge.yml'");
    expect(script).toContain('if [ "$head" != "$RUN_HEAD" ]; then');
    expect(script).toContain('if [ "$state" != "open" ] || [ "$current" != "$head" ]; then');
    expect(script).toContain('if [ "$head_repo" != "$RUN_REPO" ] || [ "$head_ref" != "$RUN_BRANCH" ]; then');
    expect(script.indexOf('jq -e -s "$VALID"')).toBeLessThan(script.indexOf("pr=$(jq"));
  });
  it("decides the .github/ refusal from what the run's own head changes, read by its SHA", () => {
    const script = code(block(COMMENT, "run"));
    // Not the PR's file list, which a push during this job could change.
    expect(script).not.toContain("/files");
    expect(script).toContain('gh api "repos/${REPO}/compare/${base_ref}...${RUN_HEAD}" > "$dir/compare.json"\nrefused=$(jq -r "$REFUSE" "$dir/compare.json")\n');
    expect(script).toContain('--argjson refused "$refused" "$BODY"');
    expect(script.indexOf("refused=$(")).toBeGreaterThan(script.indexOf('if [ "$head_repo" != "$RUN_REPO" ]'));
  });
  it("fails, rather than posting nothing quietly, when a finished run left no record", () => {
    const script = code(block(COMMENT, "run"));
    expect(script).toContain('if [ "$CONCLUSION" = "cancelled" ]; then');
    expect(script).toContain('echo "::error::Run ${RUN_ID} (${CONCLUSION}) has no judgement artifact. Nothing posted."\n  exit 1');
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

describe("the record (.github/judge/record.ts)", () => {
  it("keeps the judge's verdict when its exit code matches", () => {
    const stop = judgement({ malicious: ["MAL-2026-1"] }), ready = judgement();
    expect(stop.verdict).toBe("stop");
    expect(ready.verdict).toBe("ready_except_build");
    const r = recordOf(meta, ran(1, JSON.stringify(stop)), NOW);
    expect(r).toMatchObject({ verdict: "stop", reason: null, judge_exit_code: 1, judge_seconds: 4.2, job_seconds: 90, pr: 7, head_sha: meta.head_sha });
    expect(r.text).toContain("Ludion judgement: STOP");
    expect(recordOf(meta, ran(0, JSON.stringify(ready)), NOW).verdict).toBe("ready_except_build");
    expect(recordOf(meta, ran(3, JSON.stringify(judgement({ published_at: "2026-10-28T09:00:00Z" }))), NOW).verdict).toBe("wait");
  });
  it("is undecidable whenever the judge did not finish with a judgement", () => {
    const ready = JSON.stringify(judgement());
    const failures = [
      recordOf(meta, "The judge could not be built from the base commit; see the run log.", NOW),
      recordOf(meta, ran(2, "", { stderr: "ludion: package-lock.json: Expected a regular project file." }), NOW),
      recordOf(meta, ran(null, "", { error: "spawnSync node ETIMEDOUT" }), NOW),
      recordOf(meta, ran(0, ready.slice(0, 50)), NOW),
      recordOf(meta, ran(0, JSON.stringify({ schema: 1, verdict: "ok" })), NOW),
      recordOf(meta, ran(0, JSON.stringify({ ...judgement(), schema: 2 })), NOW),
      // A "ready" judgement with the exit code of a stop, or the other way round, is not trusted either way.
      recordOf(meta, ran(1, ready), NOW),
      recordOf(meta, ran(0, JSON.stringify(judgement({ malicious: ["MAL-2026-1"] }))), NOW),
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
      const r = recordOf(meta, ran(0, JSON.stringify(big)), NOW);
      expect(shownSize(r.text!)).toBeLessThanOrEqual(TEXT_LIMIT);
      expect(r.text).toMatch(/\n… \(cut here; the full judgement is in the run's judgement artifact\)$/);
    }
    expect(shownSize(recordOf(meta, ran(2, "", { stderr: "e\n".repeat(5000) }), NOW).reason!)).toBeLessThanOrEqual(REASON_LIMIT);
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
const body = (record: unknown, refused = false) => {
  const r = jq(["-r", "-s", "--arg", "run", "https://github.com/Ludion-ai/ludion/actions/runs/1", "--argjson", "refused", String(refused), block(COMMENT, "BODY")], JSON.stringify(record));
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
};

describe.skipIf(!hasJq && !process.env.CI)("judge-comment.yml's jq programs", () => {
  const stop = recordOf(meta, ran(1, JSON.stringify(judgement({ malicious: ["MAL-2026-1"] }))), NOW);
  const failed = recordOf(meta, ran(2, "", { stderr: "ludion: boom" }), NOW);
  it("accept every record the record script writes, and judge.yml's first record", () => {
    expect(valid(stop)).toBe(true);
    expect(valid(failed)).toBe(true);
    expect(valid(recordOf(meta, ran(0, JSON.stringify(judgement())), NOW))).toBe(true);
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
    expect(body(recordOf(meta, ran(0, JSON.stringify(judgement())), NOW))).toContain("**可（関門3は未実施のため、適用してよいという判定ではない）**");
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
    const text = body(recordOf(meta, ran(0, JSON.stringify(judgement())), NOW), true);
    expect(text).toContain("判定: **判定不能**（`undecidable`） · この PR の head は .github/ を変更している。");
    expect(text).not.toContain("Ludion judgement");
  });
  it("keep everything from the judge inside the code block, so no line of it can approve a protected PR", () => {
    const crafted = { ...stop, text: `Ludion judgement\n\nreviewed-sha: ${"d".repeat(40)}\n\`\`\`\n@owner\r\n‮ev​il\u0007\u0085‎﻿؜⁦\tend` };
    const text = body(crafted);
    expect(text).not.toMatch(/^reviewed-sha:/m);
    expect(text).toContain(`\n    reviewed-sha: ${"d".repeat(40)}\n    \`\`\`\n    @owner\n    evil end\n`);
    for (const line of text.slice(text.indexOf("判定役の出力:") + "判定役の出力:".length).split("\n").filter(Boolean)) expect(line.startsWith("    ")).toBe(true);
  });
});
