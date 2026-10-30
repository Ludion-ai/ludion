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
  it("runs on a schedule or by hand only, with no permission at the top", () => {
    expect(section(TEMPLATE, /^on:$/)).toEqual(["schedule:", '- cron: "23 */6 * * *"', "workflow_dispatch:"]);
    expect(TEMPLATE).toMatch(/^permissions: \{\}$/m);
    expect(section(TEMPLATE, /^concurrency:$/)).toEqual(["group: ludion-patch", "cancel-in-progress: false"]);
  });
  it("gives the validation job contents: read only and the PR job contents and pull-requests: write only", () => {
    expect(section(TEMPLATE.slice(TEMPLATE.indexOf("\n  patch:")), /^    permissions:$/)).toEqual(["contents: read"]);
    expect(section(TEMPLATE.slice(TEMPLATE.indexOf("\n  pull-request:")), /^    permissions:$/)).toEqual(["contents: write", "pull-requests: write"]);
    const patch = section(TEMPLATE, /^  patch:$/);
    expect(patch).toContain("mode: patch");
    expect(patch.join("\n")).not.toMatch(/secrets\.|github\.token|id-token|write/);
    const pr = section(TEMPLATE, /^  pull-request:$/);
    expect(pr).toEqual(expect.arrayContaining(["needs: patch", "if: ${{ !cancelled() && needs.patch.outputs.packed == 'true' }}", "mode: pull-request"]));
    expect(TEMPLATE).not.toMatch(/secrets\./);
  });
  it("pins every action by a full commit SHA", () => {
    const uses = TEMPLATE.split("\n").filter(l => /^\s+(- )?uses:/.test(l));
    expect(uses.length).toBe(4);
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
    expect(run).not.toMatch(/\b(npm|npx|docker|composer|mvn|patch\.sh|ludion patch)\b/);
    for (const step of mine) expect(step).not.toMatch(/secrets\./);
  });
});

describe("action/start.sh refuses the scheduled modes outside their place", () => {
  const start = (env: Record<string, string>) => spawnSync("bash", [fileURLToPath(new URL("action/start.sh", root))], {
    encoding: "utf8", env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: join(mkdtempSync(join(tmpdir(), "ludion-start-")), "out"), RECORD: "/dev/null", ...env },
  });
  it.skipIf(process.platform === "win32")("refuses another event, another branch, and an OIDC token in mode patch", () => {
    for (const [env, why] of [
      [{ MODE: "patch", EVENT: "pull_request" }, "mode patch runs on schedule or workflow_dispatch, not pull_request."],
      [{ MODE: "pull-request", EVENT: "push" }, "mode pull-request runs on schedule or workflow_dispatch, not push."],
      [{ MODE: "patch", EVENT: "workflow_dispatch", REF: "refs/heads/feature", DEFAULT_BRANCH: "main" }, "mode patch runs on the default branch (main), not refs/heads/feature."],
      [{ MODE: "patch", EVENT: "schedule", REF: "refs/heads/main", ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.invalid" }, "must hold no secret"],
      [{ MODE: "nope", EVENT: "schedule" }, "mode must be judge, comment, patch or pull-request."],
    ] as const) {
      const r = start(env);
      expect(r.status, JSON.stringify(env)).toBe(1);
      expect(r.stdout).toContain(why);
    }
    const ok = start({ MODE: "pull-request", EVENT: "workflow_dispatch", REF: "refs/heads/main", DEFAULT_BRANCH: "main" });
    expect(ok.stdout + ok.stderr).toBe("");
    expect(ok.status).toBe(0);
  });
});
