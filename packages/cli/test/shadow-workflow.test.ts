// The shadow's recorder on GitHub Actions (.github/workflows/shadow.yml, .github/shadow/record.ts): the recording job
// can only read and has no secret, the writing job runs no Node, npm or Docker, every action is pinned by commit SHA,
// the recorder is the PC's pinned commit with the frozen watched list, and the driver ends at its deadline or limit.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(write).toContain('if [ "$head" != "$DATA_SHA" ]; then');
    expect(write).toContain(`allowed="^(state\\.json|known/(created/)?\${hex}{2}/\${hex}{64}\\.json|runs/\${STAMP}/(captures|osv|status)/\${day}\\.jsonl)$"`);
    expect(write).toContain("if grep -qv '^-' listing.txt; then");
  });
  it("never creates the data branch", () => {
    expect(code(SHADOW)).not.toMatch(/--orphan|checkout -b|switch -c|git init/);
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
  });
});

describe("watchedList (.github/shadow/record.ts)", () => {
  it("accepts the frozen list and refuses any other", () => {
    expect(watchedList(RECORDER).sha256).toBe(WATCHED_SHA256);
    expect(Object.keys(watchedList(RECORDER).names)).toHaveLength(7660);
    expect(() => watchedList(RECORDER, "0".repeat(64))).toThrow(/not the frozen/);
  });
});
