// The scheduled workflow's permissions (CLAUDE.md, "Ludion must not become the attack path"): the job that runs
// candidate code (mode patch) can only read and holds no secret; the job that writes (mode pull-request) runs no
// dependency code. Checked in the template users copy (action/patch-workflow.yml), in action.yml's steps for each mode,
// and in action/start.sh's refusals.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const TEMPLATE = read("action/patch-workflow.yml"), ACTION = read("action.yml");

/** The lines of a top-level key or of a job in a workflow, without comments. */
function section(yaml: string, header: RegExp): string[] {
  const lines = yaml.split("\n"), at = lines.findIndex(l => header.test(l));
  if (at < 0) throw new Error(`no ${header}`);
  const indent = lines[at]!.search(/\S/), body: string[] = [];
  for (const line of lines.slice(at + 1)) { if (line.trim() && line.search(/\S/) <= indent) break; if (line.trim() && !line.trim().startsWith("#")) body.push(line.trim()); }
  return body;
}
/** action.yml's steps, each as its text. */
const steps = ACTION.slice(ACTION.indexOf("\n  steps:\n")).split(/\n    - /).slice(1);
const forMode = (mode: string) => steps.filter(s => new RegExp(`inputs\\.mode (==|!=) '`).test(s) ? s.includes(`inputs.mode == '${mode}'`) || (/inputs\.mode != 'comment'/.test(s) && mode !== "comment") : true);

describe("the template users copy", () => {
  it("runs on a schedule, by hand, and when a PR is closed, with no permission at the top", () => {
    expect(section(TEMPLATE, /^on:$/)).toEqual(["schedule:", '- cron: "23 */6 * * *"', "workflow_dispatch:", "pull_request:", "types: [closed]"]);
    expect(TEMPLATE).toMatch(/^permissions: \{\}$/m);
    // A merge's run has its own group, so it neither waits behind nor cancels a pending scheduled run (LEXP X6).
    expect(section(TEMPLATE, /^concurrency:$/)).toEqual(["group: ludion-${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.number || 'scheduled' }}", "cancel-in-progress: false"]);
  });
  it("gives the validation job contents: read only and the PR job contents and pull-requests: write and actions: read only", () => {
    expect(section(TEMPLATE.slice(TEMPLATE.indexOf("\n  patch:")), /^    permissions:$/)).toEqual(["contents: read"]);
    // actions: read lets it read earlier runs' ludion-seen records for found_at (docs/bench/lexp/definitions.md, section 3).
    expect(section(TEMPLATE.slice(TEMPLATE.indexOf("\n  pull-request:")), /^    permissions:$/)).toEqual(["contents: write", "pull-requests: write", "actions: read"]);
    const patch = section(TEMPLATE, /^  patch:$/);
    expect(patch).toContain("mode: patch");
    expect(patch.join("\n")).not.toMatch(/secrets\.|github\.token|id-token|write/);
    const pr = section(TEMPLATE, /^  pull-request:$/);
    expect(pr).toEqual(expect.arrayContaining(["needs: patch", "if: ${{ !cancelled() && needs.patch.outputs.packed == 'true' }}", "mode: pull-request"]));
    expect(TEMPLATE).not.toMatch(/secrets\./);
  });
  it("runs a check job first, which reads only, and patch unless it answers work=false (docs/bench/lb2b-next1/definitions.md)", () => {
    const jobs = TEMPLATE.slice(TEMPLATE.indexOf("\njobs:\n")).split("\n").filter(l => /^  [a-z-]+:$/.test(l)).map(l => l.trim());
    expect(jobs).toEqual(["check:", "patch:", "pull-request:", "merged:"]);
    expect(section(TEMPLATE.slice(TEMPLATE.indexOf("\n  check:")), /^    permissions:$/)).toEqual(["contents: read", "pull-requests: read"]);
    const check = section(TEMPLATE, /^  check:$/);
    expect(check).toEqual(expect.arrayContaining(["mode: check", "work: ${{ steps.ludion.outputs.work }}", "if: ${{ github.event_name != 'pull_request' }}"]));
    expect(check.join("\n")).not.toMatch(/secrets\.|github\.token|id-token|write|needs:/);
    // A failed check job starts patch too: only a proven work=false skips it. A closed PR's run starts none of the three.
    expect(section(TEMPLATE, /^  patch:$/)).toEqual(expect.arrayContaining(["needs: check", "if: ${{ github.event_name != 'pull_request' && !cancelled() && needs.check.outputs.work != 'false' }}"]));
  });
  it("runs the merged job only for a merged PR from a ludion/ branch, with pull-requests: write only and no checkout (LEXP X6)", () => {
    const merged = section(TEMPLATE, /^  merged:$/);
    expect(merged).toEqual(expect.arrayContaining(["if: ${{ github.event_name == 'pull_request' && github.event.pull_request.merged == true && startsWith(github.event.pull_request.head.ref, 'ludion/') }}", "mode: merged"]));
    expect(section(TEMPLATE.slice(TEMPLATE.indexOf("\n  merged:")), /^    permissions:$/)).toEqual(["pull-requests: write"]);
    expect(merged.join("\n")).not.toMatch(/secrets\.|github\.token|id-token|contents:|needs:|actions\/checkout/);
  });
  it("turns setup-node's npm cache off in every job", () => {
    // A cache restored in the job that writes and saved by the job that runs candidate code would cross the split.
    for (const job of ["check", "patch", "pull-request", "merged"]) {
      const lines = section(TEMPLATE, new RegExp(`^  ${job}:$`)), at = lines.findIndex(l => l.includes("actions/setup-node@"));
      expect(lines.slice(at, at + 4), job).toEqual(expect.arrayContaining(["package-manager-cache: false"]));
    }
  });
  it("pins every action by a full commit SHA", () => {
    const uses = TEMPLATE.split("\n").filter(l => /^\s+(- )?uses:/.test(l));
    expect(uses.length).toBe(8);
    for (const line of uses) expect(line).toMatch(/uses: [A-Za-z0-9-]+\/[A-Za-z0-9-]+@[0-9a-f]{40} # /);
  });
});

describe("action.yml's steps for each mode", () => {
  it("mode patch: no step names the token or a secret, and the checkout leaves no credential", () => {
    const mine = forMode("patch");
    expect(mine.map(s => s.split("\n")[0])).toEqual([
      "name: Check the mode, the event and the tools", "name: Check that this commit of the action carries the bundled judge",
      "name: Check out the run's commit", "name: Validate each fix and commit it on its own branch",
      "uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2", "name: Fail the job when a fix failed",
    ]);
    for (const step of mine) expect(step).not.toMatch(/github\.token|secrets\.|GH_TOKEN/);
    const checkout = mine.find(s => s.includes("actions/checkout@"))!;
    expect(checkout).toContain("persist-credentials: false");
    expect(checkout).toContain("ref: ${{ github.sha }}");
  });
  it("mode pull-request: one step holds the token, and it runs only the bundled CLI's deliver open", () => {
    const mine = forMode("pull-request");
    expect(mine.map(s => s.split("\n")[0])).toEqual([
      "name: Check the mode, the event and the tools", "name: Check that this commit of the action carries the bundled judge",
      "name: Check out the run's commit", "uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2",
      "name: Check the fixes as untrusted data and open one PR per fix",
    ]);
    const holding = mine.filter(s => s.includes("github.token"));
    expect(holding).toHaveLength(1);
    const run = holding[0]!.slice(holding[0]!.indexOf("run: |"));
    expect(run).toContain('node "$CLI" deliver open');
    // This run's id: the walk back through earlier runs' ludion-seen records starts here (LEXP).
    expect(run).toContain('--run-id "$GITHUB_RUN_ID"');
    expect(run).not.toMatch(/\b(npm|npx|docker|composer|mvn|patch\.sh|ludion patch)\b/);
    for (const step of mine) expect(step).not.toMatch(/secrets\./);
  });
  it("mode check: one step holds the token, runs action/check.sh, reads no artifact, and uploads what it saw as ludion-seen", () => {
    const mine = forMode("check");
    expect(mine.map(s => s.split("\n")[0])).toEqual([
      "name: Check the mode, the event and the tools", "name: Check that this commit of the action carries the bundled judge",
      "name: Check out the run's commit", "name: Decide, before Docker, whether this run has anything to do",
      "uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2",
    ]);
    const holding = mine.filter(s => /github\.token|GH_TOKEN/.test(s));
    expect(holding.map(s => s.split("\n")[0])).toEqual(["name: Decide, before Docker, whether this run has anything to do"]);
    expect(holding[0]).toContain('run: bash "$GITHUB_ACTION_PATH/action/check.sh"');
    for (const step of mine) expect(step).not.toMatch(/secrets\.|download-artifact/);
    const upload = mine.find(s => s.includes("upload-artifact"))!;
    for (const part of ["if: ${{ inputs.mode == 'check' && !cancelled() && steps.check.outputs.seen == 'true' }}", "name: ludion-seen", "path: ${{ runner.temp }}/ludion/seen", "retention-days: 90", "overwrite: true"]) expect(upload).toContain(part);
    expect(mine.find(s => s.includes("actions/checkout@"))).toContain("persist-credentials: false");
    expect(ACTION).toMatch(/^  work:\n    description: .*\n    value: \$\{\{ steps\.check\.outputs\.work \}\}$/m);
  });
  it("mode merged: no checkout, and one step holds the token and runs only the bundled CLI's deliver merged (LEXP X6)", () => {
    const mine = forMode("merged");
    expect(mine.map(s => s.split("\n")[0])).toEqual([
      "name: Check the mode, the event and the tools", "name: Check that this commit of the action carries the bundled judge",
      "name: Record the merge of Ludion's PR, the end of its fix's exposure time",
    ]);
    const holding = mine.filter(s => /github\.token|GH_TOKEN/.test(s));
    expect(holding).toHaveLength(1);
    const run = holding[0]!.slice(holding[0]!.indexOf("run: "));
    expect(run).toContain('node "$CLI" deliver merged');
    expect(run).not.toMatch(/\b(npm|npx|docker|composer|mvn|git|patch\.sh)\b/);
    for (const step of mine) expect(step).not.toMatch(/secrets\.|artifact/);
  });
});

describe("action/start.sh refuses the scheduled modes outside their place", () => {
  const start = (env: Record<string, string>) => spawnSync("bash", [fileURLToPath(new URL("action/start.sh", root))], {
    encoding: "utf8", env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: join(mkdtempSync(join(tmpdir(), "ludion-start-")), "out"), RECORD: "/dev/null", ...env },
  });
  it.skipIf(process.platform === "win32")("refuses another event, another branch, a runner that is not GitHub-hosted, and an OIDC token in mode patch", () => {
    for (const [env, why] of [
      [{ MODE: "patch", EVENT: "pull_request" }, "mode patch runs on schedule or workflow_dispatch, not pull_request."],
      [{ MODE: "pull-request", EVENT: "push" }, "mode pull-request runs on schedule or workflow_dispatch, not push."],
      [{ MODE: "patch", EVENT: "workflow_dispatch", REF: "refs/heads/feature", DEFAULT_BRANCH: "main" }, "mode patch runs on the default branch (main), not refs/heads/feature."],
      [{ MODE: "patch", EVENT: "schedule", REF: "refs/heads/main", RUNNER_ENVIRONMENT: "self-hosted" }, "mode patch runs only on GitHub-hosted runners (a fresh machine per job), not on self-hosted."],
      [{ MODE: "pull-request", EVENT: "workflow_dispatch", REF: "refs/heads/main", DEFAULT_BRANCH: "main", RUNNER_ENVIRONMENT: "self-hosted" }, "mode pull-request runs only on GitHub-hosted runners"],
      [{ MODE: "pull-request", EVENT: "schedule", REF: "refs/heads/main" }, "not on an unknown runner."],
      [{ MODE: "patch", EVENT: "schedule", REF: "refs/heads/main", RUNNER_ENVIRONMENT: "github-hosted", ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.invalid" }, "must hold no secret"],
      [{ MODE: "check", EVENT: "pull_request" }, "mode check runs on schedule or workflow_dispatch, not pull_request."],
      [{ MODE: "check", EVENT: "schedule", REF: "refs/heads/main", RUNNER_ENVIRONMENT: "self-hosted" }, "mode check runs only on GitHub-hosted runners"],
      [{ MODE: "nope", EVENT: "schedule" }, "mode must be judge, comment, patch, pull-request, check or merged."],
      [{ MODE: "merged", EVENT: "schedule" }, "mode merged runs on pull_request, not schedule."],
      [{ MODE: "merged", EVENT: "pull_request_target" }, "mode merged runs on pull_request, not pull_request_target."],
    ] as const) {
      const r = start(env);
      expect(r.status, JSON.stringify(env)).toBe(1);
      expect(r.stdout).toContain(why);
    }
    const ok = start({ MODE: "pull-request", EVENT: "workflow_dispatch", REF: "refs/heads/main", DEFAULT_BRANCH: "main", RUNNER_ENVIRONMENT: "github-hosted" });
    expect(ok.stdout + ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    const merged = start({ MODE: "merged", EVENT: "pull_request" });
    expect(merged.stdout + merged.stderr).toBe("");
    expect(merged.status).toBe(0);
  });
});
