// The root action (action.yml, action/): its comment job does what judge-comment.yml does, in the same order (#166's
// N6); its read step and judge.yml's copy each changed */package.json on the sides that have it; and the npm package
// carries its license, runs on Node 22 and later, and packs the same bytes from any checkout.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { recordOf, type Meta } from "../../../.github/judge/record.ts";
import { judge, renderJudgement, type Change, type VersionFacts } from "../src/security/judge.ts";

const root = new URL("../../../", import.meta.url);
const path = (p: string) => fileURLToPath(new URL(p, root));
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const COMMENT = read(".github/workflows/judge-comment.yml"), JUDGE = read(".github/workflows/judge.yml");
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
/** A jq program without its comment lines. */
const program = (text: string) => text.split("\n").filter(l => !l.startsWith("#")).join("\n").trim();
function at(text: string, part: string): number {
  const i = text.indexOf(part);
  expect(i, part).toBeGreaterThanOrEqual(0);
  return i;
}

describe("action/ follows judge-comment.yml", () => {
  it("uses judge-comment.yml's schema, PR pick and refusal programs unchanged", () => {
    expect(program(read("action/valid.jq"))).toBe(program(block(COMMENT, "VALID")));
    expect(program(read("action/pick.jq"))).toBe(program(block(COMMENT, "PICK")));
    expect(program(read("action/refuse.jq"))).toBe(program(block(COMMENT, "REFUSE")));
  });
  it("renders judge-comment.yml's comment, with only the preview line its own", () => {
    const mine = program(read("action/body.jq")).split("\n"), theirs = program(block(COMMENT, "BODY")).split("\n");
    expect(mine).toHaveLength(theirs.length);
    const differ = mine.flatMap((l, i) => (l === theirs[i] ? [] : [l]));
    expect(differ).toEqual(['  "**プレビュー：コメントのみ。マージは行わない。** Preview: comments only; nothing is merged.",']);
  });
  it("finds the PR from GitHub and decides the refusal before it reads the artifact (#166's N6)", () => {
    const script = read("action/comment.sh");
    expect(at(script, '"repos/${REPO}/pulls"')).toBeLessThan(at(script, 'refused=$(jq'));
    expect(at(script, 'if [ "$current" != "$RUN_HEAD" ]')).toBeLessThan(at(script, 'refused=$(jq'));
    expect(at(script, 'refused=$(jq')).toBeLessThan(at(script, "/artifacts?name=ludion-judgement"));
    expect(script).toContain('if [ "$recorded" != "${pr} ${RUN_HEAD}" ]; then');
    const action = read("action.yml");
    expect(action).toContain("RUN_OWNER: ${{ github.event.workflow_run.head_repository.owner.login }}\n");
    expect(action).toContain("DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}\n");
  });
});

const meta: Meta = { pr: 7, head_sha: "a".repeat(40), base_sha: "b".repeat(40), merge_sha: "c".repeat(40), started_at: "2026-10-28T10:00:00.000Z" };
const NOW = new Date("2026-10-28T10:01:30.000Z");
const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
const fact = (over: Partial<VersionFacts> = {}): VersionFacts => ({ published_at: "2026-10-01T00:00:00Z", present: true, deprecated: null, publisher: "alice", shared_publisher: false, provenance: null, install_scripts: [], dependencies: [], integrity: INTEGRITY, malicious: [], advisories: [], package_created: "2020-01-01T00:00:00Z", ...over });
const change: Change = { path: "node_modules/lib", name: "lib", from: "1.0.0", to: "1.0.1", dev: false, resolved: "https://registry.npmjs.org/lib/-/lib-1.0.1.tgz", integrity: INTEGRITY, replaced: null };
const judgement = () => judge({ changes: [change], facts: new Map([["lib@1.0.0", fact({ published_at: "2026-09-01T00:00:00Z" })], ["lib@1.0.1", fact()]]), fixes: [], files: ["package-lock.json"], now: new Date("2026-10-28T10:00:00Z"), direct: ["lib"] });
const ready = () => recordOf(meta, { exitCode: 0, stdout: JSON.stringify(judgement()), stderr: "", seconds: 4.2 }, NOW, renderJudgement);

const temp = mkdtempSync(join(tmpdir(), "ludion-action-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const has = (p: string, arg = "--version") => spawnSync(p, [arg]).status === 0;
const tools = has("jq") && has("bash") && has("unzip", "-v");

// action/comment.sh, run by bash, against a stand-in for gh that answers from files and logs every call: the cases of
// judge-comment.yml's script test (judge-workflow.test.ts), with the action's artifact name and inputs.
describe.skipIf(!tools && !process.env.CI)("action/comment.sh, against a stand-in for gh", () => {
  const RUN_HEAD = meta.head_sha;
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
    '  "GET repos/o/r/actions/runs/11/artifacts?name=ludion-judgement") file=artifacts.json ;;',
    '  "GET repos/o/r/actions/artifacts/5/zip") cat "$FAKE/artifact.zip"; exit 0 ;;',
    '  "GET repos/o/r/issues/7/comments") file=comments.json ;;',
    '  "POST repos/o/r/issues/7/comments") cp "$input" "$FAKE/posted.json"; exit 0 ;;',
    '  "PATCH repos/o/r/issues/comments/99") cp "$input" "$FAKE/patched.json"; exit 0 ;;',
    '  *) echo "stand-in gh: unexpected $method $path" >&2; exit 1 ;;',
    "esac",
    'if [ -n "$filter" ]; then jq -r "$filter" "$FAKE/$file"; else cat "$FAKE/$file"; fi',
    "",
  ].join("\n");
  type Case = { pulls?: unknown; files?: string[]; record?: unknown; artifacts?: unknown; comments?: unknown; conclusion?: string; runPath?: string };
  let count = 0;
  function comment(c: Case) {
    const fake = join(temp, `gh-${++count}`), bin = join(fake, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), GH, { mode: 0o755 });
    const pr = { number: 7, head: { sha: RUN_HEAD, ref: "dependabot/npm_and_yarn/lib-1.0.1", repo: { full_name: "o/r" } } };
    writeFileSync(join(fake, "pulls.json"), JSON.stringify(c.pulls ?? [pr]));
    writeFileSync(join(fake, "compare.json"), JSON.stringify({ files: (c.files ?? ["package-lock.json"]).map(filename => ({ filename })) }));
    writeFileSync(join(fake, "artifacts.json"), JSON.stringify(c.artifacts ?? { artifacts: [{ id: 5, size_in_bytes: 1000, expired: false, created_at: "2026-10-28T10:00:00Z" }] }));
    writeFileSync(join(fake, "artifact.zip"), zip("judgement.json", Buffer.from(JSON.stringify(c.record ?? ready()))));
    writeFileSync(join(fake, "comments.json"), JSON.stringify(c.comments ?? []));
    writeFileSync(join(fake, "calls.log"), "");
    const r = spawnSync("bash", [path("action/comment.sh")], {
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, FAKE: fake, RUNNER_TEMP: join(fake, "runner"), GH_TOKEN: "x", REPO: "o/r", JUDGE_WORKFLOW: ".github/workflows/ludion-judge.yml", RUN_EVENT: "pull_request", RUN_PATH: c.runPath ?? ".github/workflows/ludion-judge.yml", RUN_ID: "11", RUN_HEAD, RUN_REPO: "o/r", RUN_OWNER: "o", RUN_BRANCH: "dependabot/npm_and_yarn/lib-1.0.1", DEFAULT_BRANCH: "main", RUN_URL: "https://github.com/o/r/actions/runs/11", CONCLUSION: c.conclusion ?? "success" },
    });
    const posted = (file: string) => { try { return JSON.parse(readFileSync(join(fake, file), "utf8")).body as string; } catch { return null; } };
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: readFileSync(join(fake, "calls.log"), "utf8"), posted: posted("posted.json"), patched: posted("patched.json") };
  }
  it("posts the judgement on the PR at the run's head, and updates its own comment the next time", () => {
    const first = comment({});
    expect(first.status, first.stderr).toBe(0);
    expect(first.posted!.split("\n").slice(0, 2)).toEqual(["<!-- ludion-judge -->", "**プレビュー：コメントのみ。マージは行わない。** Preview: comments only; nothing is merged."]);
    expect(first.posted).toContain("判定: **可（関門3は未実施のため、適用してよいという判定ではない）**");
    expect(first.posted).toContain(`判定した head \`${RUN_HEAD}\``);
    expect(first.calls).toContain("api -X GET repos/o/r/pulls -f state=open -f head=o:dependabot/npm_and_yarn/lib-1.0.1 -f base=main\n");
    expect(at(first.calls, "/compare/main...")).toBeLessThan(at(first.calls, "/artifacts?name=ludion-judgement"));
    const again = comment({ comments: [{ id: 98, user: { login: "Ludion-ai" }, body: "<!-- ludion-judge --> copied" }, { id: 99, user: { login: "github-actions[bot]" }, body: "<!-- ludion-judge -->\nold" }] });
    expect(again.status, again.stderr).toBe(0);
    expect([again.posted, again.patched?.split("\n")[0]]).toEqual([null, "<!-- ludion-judge -->"]);
  });
  it("never downloads or reads the artifact of a head that changes .github/ (#166's N6)", () => {
    for (const files of [["package-lock.json", ".github/workflows/ludion-judge.yml"], Array.from({ length: 300 }, (_, i) => `f${i}`)]) {
      const r = comment({ files, record: "not even json" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.calls).not.toContain("artifacts");
      expect(r.posted).toContain("判定: **判定不能**（`undecidable`） · この PR の head は .github/ を変更している");
      expect(r.posted).toContain(`head \`${RUN_HEAD}\``);
      expect(r.posted).not.toContain("Ludion judgement");
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
  it("fails, posting nothing, when the record does not match the schema or names another PR or head, or the run is another workflow's", () => {
    const r0 = ready();
    for (const bad of [{ ...r0, pr: 8 }, { ...r0, head_sha: "e".repeat(40) }, { ...r0, verdict: "stop" }, "not json"]) {
      const r = comment({ record: bad });
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/^::error::.*Nothing posted\.$/m);
      expect([r.posted, r.patched]).toEqual([null, null]);
    }
    const cancelled = comment({ artifacts: { artifacts: [] }, conclusion: "cancelled" });
    expect([cancelled.status, cancelled.posted]).toEqual([0, null]);
    const lost = comment({ artifacts: { artifacts: [] } });
    expect([lost.status, lost.posted]).toEqual([1, null]);
    const other = comment({ runPath: ".github/workflows/other.yml" });
    expect([other.status, other.posted, other.calls]).toEqual([1, null, ""]);
  });
});

// action/read.sh against a stand-in for gh that serves files per commit: each changed */package.json lands on the
// sides whose commit has it, as the compare answer's status says.
describe.skipIf(!(has("jq") && has("bash")) && !process.env.CI)("action/read.sh, against a stand-in for gh", () => {
  const BASE = "b".repeat(40), MERGE = "c".repeat(40), HEAD = "a".repeat(40);
  const GH = [
    "#!/bin/sh",
    'printf "%s\\n" "$*" >> "$FAKE/calls.log"',
    "path= filter=",
    "while [ $# -gt 0 ]; do",
    '  case "$1" in',
    "    api) ;;",
    "    -H) shift ;;",
    "    --jq) filter=$2; shift ;;",
    "    *) path=$1 ;;",
    "  esac",
    "  shift",
    "done",
    'case "$path" in',
    `  repos/o/r/commits/${MERGE}) file=commit.json ;;`,
    `  repos/o/r/compare/${BASE}...main) file=status.json ;;`,
    `  repos/o/r/compare/${BASE}...${MERGE}) file=compare.json ;;`,
    '  repos/o/r/contents/*) p=${path#repos/o/r/contents/}; ref=${p##*\\?ref=}; p=${p%\\?ref=*}; [ -f "$FAKE/tree/$ref/$p" ] || { echo "stand-in gh: 404 $path" >&2; exit 1; }; cat "$FAKE/tree/$ref/$p"; exit 0 ;;',
    '  *) echo "stand-in gh: unexpected $path" >&2; exit 1 ;;',
    "esac",
    'if [ -n "$filter" ]; then jq -r "$filter" "$FAKE/$file"; else cat "$FAKE/$file"; fi',
    "",
  ].join("\n");
  let count = 0;
  function readPr(files: object[], trees: Record<string, Record<string, string>>) {
    const fake = join(temp, `read-${++count}`), bin = join(fake, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), GH, { mode: 0o755 });
    writeFileSync(join(fake, "commit.json"), JSON.stringify({ parents: [{ sha: BASE }, { sha: HEAD }] }));
    writeFileSync(join(fake, "status.json"), JSON.stringify({ status: "identical" }));
    writeFileSync(join(fake, "compare.json"), JSON.stringify({ files }));
    writeFileSync(join(fake, "calls.log"), "");
    for (const [ref, tree] of Object.entries(trees)) for (const [p, text] of Object.entries(tree)) {
      mkdirSync(dirname(join(fake, "tree", ref, p)), { recursive: true });
      writeFileSync(join(fake, "tree", ref, p), text);
    }
    const input = join(fake, "input"), output = join(fake, "output");
    writeFileSync(output, "");
    const r = spawnSync("bash", [path("action/read.sh")], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, FAKE: fake, GH_TOKEN: "x", REPO: "o/r", INPUT: input, HEAD_SHA: HEAD, MERGE_SHA: MERGE, BASE_REF: "main", GITHUB_OUTPUT: output } });
    const got = (side: string, p: string) => (existsSync(join(input, side, p)) ? readFileSync(join(input, side, p), "utf8") : null);
    return { status: r.status, stderr: r.stderr, stdout: r.stdout, got, output: readFileSync(output, "utf8") };
  }
  const roots = (ref: string) => ({ "package.json": `root ${ref}`, "package-lock.json": `lock ${ref}` });
  it("copies each changed */package.json on the sides whose commit has it, and nothing else", () => {
    const r = readPr(
      [{ filename: "package-lock.json", status: "modified" }, { filename: "apps/site/package.json", status: "modified" }, { filename: "apps/new/package.json", status: "added" },
        { filename: "apps/old/package.json", status: "removed" }, { filename: "b/package.json", previous_filename: "a/package.json", status: "renamed" }, { filename: "apps/site/src/x.ts", status: "modified" }],
      { [BASE]: { ...roots("base"), "apps/site/package.json": "site base", "apps/old/package.json": "old base", "a/package.json": "a base", "apps/site/src/x.ts": "x" },
        [MERGE]: { ...roots("merge"), "apps/site/package.json": "site merge", "apps/new/package.json": "new merge", "b/package.json": "b merge", "apps/site/src/x.ts": "y" } });
    expect(r.status, r.stderr).toBe(0);
    expect([r.got("before", "package.json"), r.got("after", "package-lock.json")]).toEqual(["root base", "lock merge"]);
    expect([r.got("before", "apps/site/package.json"), r.got("after", "apps/site/package.json")]).toEqual(["site base", "site merge"]);
    expect([r.got("before", "apps/new/package.json"), r.got("after", "apps/new/package.json")]).toEqual([null, "new merge"]);
    expect([r.got("before", "apps/old/package.json"), r.got("after", "apps/old/package.json")]).toEqual(["old base", null]);
    expect([r.got("before", "a/package.json"), r.got("after", "a/package.json"), r.got("before", "b/package.json"), r.got("after", "b/package.json")]).toEqual(["a base", null, null, "b merge"]);
    expect([r.got("before", "apps/site/src/x.ts"), r.got("after", "apps/site/src/x.ts")]).toEqual([null, null]);
    expect(r.output).toBe(`base=${BASE}\n`);
  });
  it("stops on a path that cannot be copied as data, a file the API does not give, or 300 changed files", () => {
    // Each is refused by the path check itself (its message, one workflow command), not by a file the stand-in lacks.
    for (const bad of ["x/../package.json", "./package.json", "a//package.json", "x/../\n::notice::injected/package.json"]) {
      const r = readPr([{ filename: bad, status: "modified" }], { [BASE]: roots("base"), [MERGE]: roots("merge") });
      expect(r.status).toBe(1);
      expect(r.output).toBe("");
      expect(r.stdout.split("\n").filter(l => l.startsWith("::"))).toEqual([`::error::The changed path ${bad.replace(/\n/g, "")} cannot be copied as data.`]);
    }
    const missing = readPr([{ filename: "apps/site/package.json", status: "modified" }], { [BASE]: roots("base"), [MERGE]: { ...roots("merge"), "apps/site/package.json": "m" } });
    expect([missing.status, missing.output]).toEqual([1, ""]);
    const many = readPr(Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}`, status: "added" })), { [BASE]: roots("base"), [MERGE]: roots("merge") });
    expect([many.status, many.output]).toEqual([1, ""]);
  });
});

// judge.yml's loop over the changed files, run by bash in a git repository with two commits.
describe.skipIf(!(has("git") && has("bash")) && !process.env.CI)("judge.yml's copy of the changed */package.json files", () => {
  const lines = JUDGE.split("\n");
  const from = lines.findIndex(l => l.trim() === "while IFS= read -r -d '' file; do"), to = lines.findIndex(l => l.trim() === 'done < "$INPUT/files"');
  const loop = lines.slice(from, to + 1).map(l => l.slice(lines[from]!.search(/\S/))).join("\n");
  it("is in judge.yml's read step", () => expect([from > 0, to > from]).toEqual([true, true]));
  const repo = join(temp, "git"), git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).stdout.trim();
  mkdirSync(join(repo, "apps", "site"), { recursive: true });
  mkdirSync(join(repo, "apps", "old"), { recursive: true });
  git("init", "-q");
  git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t");
  writeFileSync(join(repo, "apps", "site", "package.json"), "site base");
  writeFileSync(join(repo, "apps", "old", "package.json"), "old base");
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(repo, "apps", "site", "package.json"), "site merge");
  rmSync(join(repo, "apps", "old"), { recursive: true });
  mkdirSync(join(repo, "apps", "new"), { recursive: true });
  writeFileSync(join(repo, "apps", "new", "package.json"), "new merge");
  git("add", "-A"); git("commit", "-qm", "merge");
  const merge = git("rev-parse", "HEAD");
  function copy(files: string[]) {
    const input = mkdtempSync(join(temp, "input-"));
    mkdirSync(join(input, "before")); mkdirSync(join(input, "after"));
    writeFileSync(join(input, "files"), files.map(f => `${f}\0`).join(""));
    const r = spawnSync("bash", ["-c", `set -euo pipefail\n${loop}`], { cwd: repo, encoding: "utf8", env: { ...process.env, INPUT: input, base, MERGE_SHA: merge } });
    const got = (side: string, p: string) => (existsSync(join(input, side, p)) ? readFileSync(join(input, side, p), "utf8") : null);
    return { status: r.status, stderr: r.stderr, stdout: r.stdout, got };
  }
  it("copies each side that has the file", () => {
    const r = copy(["apps/new/package.json", "apps/old/package.json", "apps/site/package.json", "package-lock.json"]);
    expect(r.status, r.stderr).toBe(0);
    expect([r.got("before", "apps/site/package.json"), r.got("after", "apps/site/package.json")]).toEqual(["site base", "site merge"]);
    expect([r.got("before", "apps/new/package.json"), r.got("after", "apps/new/package.json")]).toEqual([null, "new merge"]);
    expect([r.got("before", "apps/old/package.json"), r.got("after", "apps/old/package.json")]).toEqual(["old base", null]);
  });
  it("stops on a path that cannot be copied as data", () => {
    for (const bad of ["apps/../package.json", "./package.json", "apps//package.json", "apps/../\n::notice::injected/package.json"]) {
      const r = copy([bad]);
      expect(r.status).toBe(1);
      expect(r.stdout.split("\n").filter(l => l.startsWith("::"))).toEqual([`::error::The changed path ${bad.replace(/\n/g, "")} cannot be copied as data.`]);
    }
  });
});

describe("the npm package", () => {
  const pkg = JSON.parse(read("packages/cli/package.json"));
  it("carries the license, runs on Node 22 and later, and builds for it", () => {
    expect(read("packages/cli/LICENSE")).toBe(read("LICENSE"));
    expect(pkg.files).toEqual(["dist/cli.js", "LICENSE", "README.md"]);
    expect(pkg.engines).toEqual({ node: ">=22" });
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.packages["packages/cli"].engines).toEqual({ node: ">=22" });
    for (const build of ["packages/cli/build.ts", "action/build.ts"]) expect(read(build)).toContain('target: "node22",');
    expect(read("action/start.sh")).toContain('split(".")[0]) < 22)');
  });
  it("sets every packed file to 0644 when it builds, so any checkout packs the same bytes", () => {
    expect(read("packages/cli/build.ts")).toContain('for (const file of ["dist/cli.js", "LICENSE", "README.md", "package.json"]) chmodSync(file, 0o644);');
    if (process.platform !== "win32" && existsSync(path("packages/cli/dist/cli.js"))) {
      for (const f of ["dist/cli.js", "LICENSE", "README.md", "package.json"]) expect(statSync(path(`packages/cli/${f}`)).mode & 0o777, f).toBe(0o644);
    }
  });
});
