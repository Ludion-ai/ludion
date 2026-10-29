// The shadow's recorder on GitHub Actions (.github/workflows/shadow.yml, .github/shadow/record.ts): the recording job
// can only read and has no secret, the writing job runs no Node, npm or Docker, every action is pinned by commit SHA,
// the recorder is the PC's pinned commit with the frozen watched list, and the driver ends at its deadline or limit.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { drive, exitCode, main, watchedList, WATCHED_SHA256, type RecorderLike } from "../../../.github/shadow/record.ts";
import { Recorder } from "../../../tools/shadow/src/recorder.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const SHADOW = read(".github/workflows/shadow.yml");
const RECORDER = fileURLToPath(new URL("tools/shadow/src/recorder.ts", root));
const status = (dir: string) => readdirSync(join(dir, "status")).flatMap(f => readFileSync(join(dir, "status", f), "utf8").trim().split("\n").map(l => JSON.parse(l)));
const code = (yaml: string) => yaml.split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
/** One job's text, from its key to the next job. */
const job = (name: string) => { const text = code(SHADOW); const from = text.indexOf(`\n  ${name}:\n`); expect(from).toBeGreaterThan(0); const rest = text.slice(from + 1); const next = rest.slice(1).search(/\n  [a-z]+:\n/); return next < 0 ? rest : rest.slice(0, next + 1); };
const permissionsOf = (text: string) => { const m = /\n    permissions:\n((?:      .*\n|\s*#.*\n)+)/.exec(text); return m ? m[1]!.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")) : []; };
const uses = (yaml: string) => code(yaml).split("\n").filter(l => /^\s*(-\s+)?uses:/.test(l)).map(l => l.replace(/^\s*(-\s+)?uses:\s*/, ""));

describe("shadow.yml", () => {
  it("runs only on its hourly schedule, one run at a time, with no permission at the top", () => {
    expect(SHADOW).toMatch(/\non:\n  schedule:\n(?:    #.*\n)*    - cron: "17 \* \* \* \*"\n\npermissions: \{\}\n/);
    expect(code(SHADOW)).not.toMatch(/pull_request|workflow_dispatch|workflow_run|push:|repository_dispatch/);
    expect(SHADOW).toMatch(/\nconcurrency:\n  group: shadow\n  cancel-in-progress: false\n/);
  });
  it("uses no secret, and pins every action by commit SHA", () => {
    expect(code(SHADOW)).not.toMatch(/secrets\./);
    const all = uses(SHADOW);
    expect(all.length).toBeGreaterThan(0);
    for (const u of all) expect(u).toMatch(/^actions\/(checkout|upload-artifact)@[0-9a-f]{40} # v[\d.]+$/);
  });
  it("pins the PC's recorder commit and image, and twice the PC's storage limit", () => {
    expect(SHADOW).toContain("RECORDER_COMMIT: 8a78b55940def8463a2401e7bdd38d7e6c7b604d\n");
    expect(SHADOW).toContain("IMAGE: node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205\n");
    expect(SHADOW).toContain('MAX_BYTES: "3800000000"\n');
  });
  it("gives the recording job read access to contents only, and never persists a credential there", () => {
    const record = job("record");
    expect(permissionsOf(record)).toEqual(["contents: read"]);
    const checkouts = record.split("- uses: actions/checkout@").slice(1);
    expect(checkouts).toHaveLength(3);
    for (const c of checkouts) expect(c).toMatch(/\n          persist-credentials: false\n/);
    expect(record).toMatch(/ref: \$\{\{ env\.RECORDER_COMMIT \}\}/);
    expect(record).toMatch(/ref: \$\{\{ env\.DATA_BRANCH \}\}/);
    // The container: the PC's flags, no host environment, and the code read-only.
    expect(record).toContain('docker run -d --name ludion-shadow --read-only --tmpfs /tmp --user "$(id -u):$(id -g)" \\\n            --memory 2g --cpus 1 --cap-drop ALL --security-opt no-new-privileges -e HOME=/tmp \\\n');
    expect(record).toContain('-v "$GITHUB_WORKSPACE/app:/app:ro" -v "$GITHUB_WORKSPACE/ludion/.github/shadow:/driver:ro"');
    expect(record).not.toMatch(/--env-file|-e GH_TOKEN|--privileged|docker\.sock/);
    // The only dependency added to the pinned code is semver, checked against the lockfile's integrity.
    expect(record).toContain('if [ "$got" != "$integrity" ]; then');
    expect(record).not.toMatch(/\bnpm\b|\bnpx\b/);
  });
  it("gives the writing job only the artifact read and the push, and runs no Node, npm or Docker there", () => {
    const write = job("write");
    expect(permissionsOf(write)).toEqual(["actions: read", "contents: write"]);
    expect(write).not.toMatch(/\bnode\b|\bnpm\b|\bnpx\b|\bdocker\b|setup-node|\.github\/shadow/);
    expect(uses(write)).toEqual(["actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1"]);
    // It pushes only to the data branch, and only on top of the commit the recording job read.
    expect(write.match(/git push.*$/gm)).toEqual(['git push --quiet origin "HEAD:refs/heads/${DATA_BRANCH}"']);
  });
  it("has no step that makes a branch; the checkouts and the guard below refuse a missing or foreign one", () => {
    expect(code(SHADOW)).not.toMatch(/--orphan|checkout -b|switch -c|git init|git branch/);
  });
});

/** A step's run: script, without its indentation. */
function step(name: string): string {
  const lines = SHADOW.split("\n"), from = lines.indexOf(`      - name: ${name}`);
  expect(from, name).toBeGreaterThan(0);
  const at = lines.findIndex((l, i) => i > from && /^ +run: \|$/.test(l)), indent = lines[at]!.search(/\S/), body: string[] = [];
  for (const line of lines.slice(at + 1)) { if (line.trim() && line.search(/\S/) <= indent) break; body.push(line.slice(indent + 2)); }
  return body.join("\n") + "\n";
}
const has = (program: string, arg = "--version") => spawnSync(program, [arg]).status === 0;
const sh = (script: string, cwd: string, env: Record<string, string> = {}) => {
  const r = spawnSync("bash", ["-c", script], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const ok = (script: string, cwd: string) => { const r = sh(`set -euo pipefail\n${script}`, cwd); expect(r.status, r.out).toBe(0); return r.out.trim(); };
/** A zip with one stored file, as upload-artifact makes it (compression aside). */
function zip(name: string, data: Buffer): Buffer {
  const n = Buffer.from(name), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  const offset = local.length + n.length + data.length, size = central.length + n.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}
// A stand-in for gh: the tree listing from the local repository (or a truncated one), and the run's artifact.
// "$[" stands for a shell "${", which a template literal would take for its own.
const GH = String.raw`#!/bin/bash
set -euo pipefail
case "$*" in
  api\ */git/trees/*)
    if [ -n "$[TRUNCATED:-}" ]; then echo '{"truncated": true, "tree": []}'; exit 0; fi
    sha=$[2#*/git/trees/}; sha=$[sha%%\?*}
    git -C "$FAKE/remote.git" ls-tree -r -l "$sha" | jq -R -s '{truncated: false, tree: [split("\n")[] | select(length > 0)
      | capture("^(?<mode>[0-9]+) (?<type>[a-z]+) (?<sha>[0-9a-f]+) +(?<size>[0-9]+)\t(?<path>.*)$") | .size |= tonumber]}' ;;
  api\ *"artifacts?name=shadow-run"*) echo "1 $(wc -c < "$FAKE/artifact.zip")" ;;
  api\ */actions/artifacts/1/zip) cat "$FAKE/artifact.zip" ;;
  *) echo "gh stand-in: unexpected call: $*" >&2; exit 1 ;;
esac
`.replaceAll("$[", "${");
const KNOWN = `known/aa/${"a".repeat(64)}.json`, STATE = '{"seq":"5","feed_started_at":"2026-10-28T15:51:48.394Z","pending":[]}';
const STAMP = "2026-10-30/101500Z-777-1";

// The workflow's own scripts, run by bash against a local bare repository, as the runner runs them. Needs bash, git,
// jq, tar and unzip (GitHub's ubuntu runners have all of them); in CI a missing one fails instead of skipping.
describe.skipIf(!["bash", "git", "jq", "tar"].every(p => has(p)) || !has("unzip", "-v") ? !process.env.CI : false)("shadow.yml's scripts, against a local data branch", () => {
  /** A data branch as the seed script leaves it, plus `extra` files at their paths. */
  function branch(extra: Record<string, string> = {}, state = STATE) {
    const fake = mkdtempSync(join(tmpdir(), "shadow-branch-")), seed = join(fake, "seed");
    const files: Record<string, string> = { "state.json": state, [KNOWN]: "{}", "runs/pc-8a78b55/status/2026-10-28.jsonl": '{"type":"poll"}\n', ...extra };
    for (const [path, text] of Object.entries(files)) { mkdirSync(join(seed, path, ".."), { recursive: true }); writeFileSync(join(seed, path), text); }
    mkdirSync(join(fake, "bin")); writeFileSync(join(fake, "bin", "gh"), GH); chmodSync(join(fake, "bin", "gh"), 0o755);
    ok(`git init -q --bare remote.git && git -C remote.git config uploadpack.allowFilter true
      git -C seed init -q -b shadow-data && git -C seed add -A
      git -C seed -c user.name=t -c user.email=t@example.invalid commit -q -m seed && git -C seed push -q "file://${fake}/remote.git" shadow-data`, fake);
    return { fake, url: `file://${fake}/remote.git`, head: () => ok("git -C remote.git rev-parse shadow-data", fake), env: { PATH: `${join(fake, "bin")}:${process.env.PATH}`, FAKE: fake, GH_TOKEN: "x", REPO: "Ludion-ai/ludion" } };
  }

  describe("the write job's step", () => {
    /** Packs `files` (text, or { link } for a symbolic link) as the artifact and runs the step on a writer checkout. */
    function write(b: ReturnType<typeof branch>, files: Record<string, string | { link: string }>, opts: { stamp?: string; runId?: string; dataSha?: string } = {}) {
      const src = mkdtempSync(join(b.fake, "src-"));
      for (const [path, v] of Object.entries(files)) {
        mkdirSync(join(src, path, ".."), { recursive: true });
        if (typeof v === "string") writeFileSync(join(src, path), v); else symlinkSync(v.link, join(src, path));
      }
      ok(`tar -C '${src}' -cf shadow.tar ${Object.keys(files).map(f => `'${f}'`).join(" ")}`, b.fake);
      writeFileSync(join(b.fake, "artifact.zip"), zip("shadow.tar", readFileSync(join(b.fake, "shadow.tar"))));
      const w = mkdtempSync(join(b.fake, "w-"));
      ok(`git clone -q --depth 1 --filter=blob:none --no-checkout --branch shadow-data ${b.url} data
        git -C data sparse-checkout set --no-cone /state.json && git -C data checkout -q shadow-data`, w);
      return sh(step("Check the run's files and commit them"), w, { ...b.env, RUN_ID: opts.runId ?? "777", STAMP: opts.stamp ?? STAMP, DATA_SHA: opts.dataSha ?? b.head(), DATA_BRANCH: "shadow-data" });
    }
    const tree = (b: ReturnType<typeof branch>) => ok("git -C remote.git ls-tree -r --name-only shadow-data", b.fake).split("\n");

    it("commits the recorder's own files for this run on top of the branch, keeping what was there", () => {
      const b = branch();
      const r = write(b, { "state.json": '{"seq":"9","feed_started_at":"2026-10-28T15:51:48.394Z"}', [KNOWN]: '{"time":{}}', [`runs/${STAMP}/captures/2026-10-30.jsonl`]: "{}\n", [`runs/${STAMP}/status/2026-10-30.jsonl`]: "{}\n" });
      expect(r.status, r.out).toBe(0);
      expect(tree(b)).toEqual([KNOWN, "runs/2026-10-30/101500Z-777-1/captures/2026-10-30.jsonl", "runs/2026-10-30/101500Z-777-1/status/2026-10-30.jsonl", "runs/pc-8a78b55/status/2026-10-28.jsonl", "state.json"]);
      expect(ok(`git -C remote.git show shadow-data:${KNOWN}; echo; git -C remote.git log -1 --format=%s shadow-data`, b.fake)).toBe('{"time":{}}\nshadow: run 2026-10-30/101500Z-777-1');
    });
    it("commits an hour's lines when state.json did not change", () => {
      const b = branch();
      const r = write(b, { "state.json": STATE, [`runs/${STAMP}/status/2026-10-30.jsonl`]: '{"type":"error"}\n' });
      expect(r.status, r.out).toBe(0);
      expect(tree(b)).toContain(`runs/${STAMP}/status/2026-10-30.jsonl`);
    });
    it.each([
      ["a path the recorder never writes", { "state.json": STATE, ".github/workflows/x.yml": "on: push" }, /a path the recorder does not write/],
      ["another run's directory", { "state.json": STATE, "runs/2026-10-30/101500Z-778-1/status/2026-10-30.jsonl": "{}\n" }, /a path the recorder does not write/],
      ["a .tmp leftover", { "state.json": STATE, "state.json.tmp": "{}" }, /a path the recorder does not write/],
      ["a symbolic link at a known/ path", { "state.json": STATE, [KNOWN]: { link: "/etc/passwd" } }, /something other than regular files/],
      ["no state.json", { [`runs/${STAMP}/status/2026-10-30.jsonl`]: "{}\n" }, /^/],
      ["a state.json without a feed position", { "state.json": "[]" }, /^/],
    ] as const)("refuses an artifact holding %s, and leaves the branch as it was", (_, files, message) => {
      const b = branch(), before = b.head();
      const r = write(b, files as Record<string, string | { link: string }>);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(message);
      expect(b.head()).toBe(before);
    });
    it("refuses a run directory that is not this run's, and a branch that moved after the record job read it", () => {
      const b = branch(), before = b.head();
      expect(write(b, { "state.json": STATE }, { runId: "778" }).out).toMatch(/Unexpected run directory/);
      expect(write(b, { "state.json": STATE }, { dataSha: "0".repeat(40) }).out).toMatch(/moved from 0{40}/);
      expect(b.head()).toBe(before);
    });
  });

  describe("the record job's check of the data branch", () => {
    function check(b: ReturnType<typeof branch>, env: Record<string, string> = {}) {
      const w = mkdtempSync(join(b.fake, "r-"));
      ok(`git clone -q --depth 1 --filter=blob:none --sparse --branch shadow-data ${b.url} data && git -C data sparse-checkout set known`, w);
      writeFileSync(join(w, "out"), "");
      const r = sh(step("Check the data branch and read the size of its runs"), w, { ...b.env, GITHUB_OUTPUT: join(w, "out"), ...env });
      return { ...r, output: readFileSync(join(w, "out"), "utf8"), w };
    }
    it("counts the bytes under runs/ and moves the repository out of the data directory", () => {
      const b = branch({ "runs/2026-10-30/000000Z-1-1/captures/2026-10-30.jsonl": "x".repeat(1000) });
      const r = check(b);
      expect(r.status, r.out).toBe(0);
      expect(r.output).toBe(`data_sha=${b.head()}\nbytes=${1000 + '{"type":"poll"}\n'.length}\n`);
      expect(existsSync(join(r.w, "data", ".git"))).toBe(false);
      expect(existsSync(join(r.w, "data.git"))).toBe(true);
    });
    it.each([
      ["a branch with anything else at its root", { "README.md": "x" }, STATE, {}, /root holds 'README.md known runs state.json '/],
      ["a state.json without a feed start", {}, '{"seq":"5","feed_started_at":null}', {}, /no feed position and feed start/],
      ["a truncated listing of runs/", {}, STATE, { TRUNCATED: "1" }, /truncated/],
    ] as const)("refuses %s", (_, extra, state, env, message) => {
      const r = check(branch(extra, state), env);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(message);
      expect(r.output).toBe("");
    });
  });
});

/** A recorder stand-in: each poll takes `pollMs` of a fake clock; `fail` polls throw. */
function fake(opts: { pollMs?: number; fail?: boolean; stopAfter?: number } = {}) {
  let t = Date.parse("2026-10-30T00:00:00Z"), polls = 0;
  const lines: any[] = [];
  const rec: RecorderLike = {
    state: { stopped: null, pending: [] },
    bytes: 10,
    async poll() {
      t += opts.pollMs ?? 500; polls++;
      if (opts.fail) throw new Error("network down");
      if (opts.stopAfter !== undefined && polls >= opts.stopAfter) rec.state.stopped = "the data directory would pass 1 bytes";
      return { entries: 1, watched: 0, seq: String(polls) };
    },
    async osv() { return 0; },
    append(_kind, record) { lines.push(record); return true; },
  };
  return { rec, lines, now: () => t, sleep: async (ms: number) => { t += ms; }, start: t };
}

describe("drive (.github/shadow/record.ts)", () => {
  it("polls every minute and starts no poll that would begin after the deadline", async () => {
    const f = fake();
    const out = await drive(f.rec, { run: "1-1" }, { until: f.start + 5 * 60_000, now: f.now, sleep: f.sleep });
    expect(out).toEqual({ ended: "deadline", polls: 5, failed_polls: 0 });
    expect(exitCode(out)).toBe(0);
    expect(f.lines[0]).toMatchObject({ type: "start", run: "1-1", bytes: 10, until: "2026-10-30T00:05:00.000Z" });
    expect(f.lines.filter(l => l.type === "poll").map(l => l.at)).toEqual(["2026-10-30T00:00:00.500Z", "2026-10-30T00:01:00.500Z", "2026-10-30T00:02:00.500Z", "2026-10-30T00:03:00.500Z", "2026-10-30T00:04:00.500Z"]);
  });
  it("lets a poll running at the deadline finish, then ends", async () => {
    const f = fake({ pollMs: 90_000 });
    const out = await drive(f.rec, {}, { until: f.start + 60_000, now: f.now, sleep: f.sleep });
    expect(out).toEqual({ ended: "deadline", polls: 1, failed_polls: 0 });
  });
  it("ends at once when the recorder stops at its limit, with exit code 3", async () => {
    const f = fake({ stopAfter: 2 });
    const out = await drive(f.rec, {}, { until: f.start + 60 * 60_000, now: f.now, sleep: f.sleep });
    expect(out).toEqual({ ended: "stopped", polls: 2, failed_polls: 0 });
    expect(exitCode(out)).toBe(3);
  });
  it("records each failed poll as an error line and exits 4 when none succeeded", async () => {
    const f = fake({ fail: true });
    const out = await drive(f.rec, {}, { until: f.start + 3 * 60_000, now: f.now, sleep: f.sleep });
    expect(out).toEqual({ ended: "deadline", polls: 0, failed_polls: 3 });
    expect(f.lines.filter(l => l.type === "error").map(l => l.error)).toEqual(["network down", "network down", "network down"]);
    expect(exitCode(out)).toBe(4);
  });
  it("counts the bytes stored on the data branch against the recorder's limit, before reading anything", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-actions-"));
    // 900 bytes stored elsewhere and a 1,000-byte limit: the start line does not fit, so nothing is fetched.
    const out = await main([RECORDER, dir, "1000", "900", "60", "8a78b55940def8463a2401e7bdd38d7e6c7b604d", "1-1"]);
    expect(out).toEqual({ ended: "stopped", polls: 0, failed_polls: 0 });
    expect(exitCode(out)).toBe(3);
    expect(status(dir)).toEqual([expect.objectContaining({ type: "stopped", reason: "the data directory would pass 1000 bytes", bytes: 900 })]);
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).stopped).toMatch(/would pass 1000 bytes/);
  });
  it("records a start line naming the run and the stored bytes when they fit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-actions-"));
    const rec = new Recorder({ dir, maxBytes: 100_000, watched: {}, fetchFn: (async () => new Response(JSON.stringify({ update_seq: 5 }))) as typeof fetch });
    rec.bytes += 50_000;
    const t = Date.parse("2026-10-30T00:00:00Z");
    await drive(rec, { run: "7-2", stored_bytes: 50_000 }, { until: t + 1, now: () => t, sleep: async () => {} });
    expect(status(dir)[0]).toMatchObject({ type: "start", run: "7-2", stored_bytes: 50_000, bytes: 50_000 });
  });
  it("refuses arguments that are not whole numbers", async () => {
    await expect(main([RECORDER, "/tmp/x", "1.5", "0", "60", "c", "r"])).rejects.toThrow(/usage/);
    await expect(main([RECORDER, "/tmp/x", "1000", "-1", "60", "c", "r"])).rejects.toThrow(/usage/);
    // An empty or missing size is not zero bytes stored.
    await expect(main([RECORDER, "/tmp/x", "1000", "", "60", "c", "r"])).rejects.toThrow(/usage/);
    await expect(main([RECORDER, "/tmp/x", "1000", " 7", "60", "c", "r"])).rejects.toThrow(/usage/);
    await expect(main([RECORDER, "/tmp/x", "1000"])).rejects.toThrow(/usage/);
  });
});

describe("watchedList (.github/shadow/record.ts)", () => {
  it("accepts the frozen list and refuses any other", () => {
    expect(watchedList(RECORDER).sha256).toBe(WATCHED_SHA256);
    expect(Object.keys(watchedList(RECORDER).names)).toHaveLength(7660);
    expect(() => watchedList(RECORDER, "0".repeat(64))).toThrow(/not the frozen/);
  });
});
