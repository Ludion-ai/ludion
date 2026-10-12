import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boundedText, filesHash, makeArtifact, readArtifact, saveArtifact, taskHash, validateArtifact } from "../src/bench-artifacts.ts";
import { snapshotProject } from "../src/project-snapshot.ts";
import { gradeArtifact } from "../src/runtime-replay.ts";
import { loadRuleTasks } from "../src/rule-tasks.ts";

const tasks = loadRuleTasks(fileURLToPath(new URL("../tasks-c/", import.meta.url)));
const task = tasks.find((t) => t.id === "vitest-5-0-0-13-c")!;
const base = { ...snapshotProject(fileURLToPath(new URL("../projects/vitest/", import.meta.url))), ...snapshotProject(task.overlay) };
const artifact = () => makeArtifact({ task_id: task.id, task_sha256: taskHash(task), trial: 1, model: "fixture", sync: false, site: null, offline: false, sync_cli_sha256: null, harness_sha: "a".repeat(40), inputs_sha256: filesHash(base), base_files: base, candidate_files: { ...base, ...task.examples.correct[0], "src/helper.js": "export const neverRunOnHost = 1;" } }, null);

describe("source artifact integrity and replay", () => {
  it("saves the complete supported source profile outside the score record and round-trips byte identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-artifact-"));
    const input = artifact();
    const ref = saveArtifact(input, dir);
    expect(Object.keys(ref).sort()).toEqual(["id", "sha256", "source_profile"]);
    const path = join(dir, `${ref.id}.json`);
    expect(readArtifact(path, ref.sha256)).toEqual(input);
    expect(readArtifact(path, ref.sha256).candidate_files["src/helper.js"]).toContain("neverRunOnHost");
    expect(readdirSync(dir)).toEqual([`${ref.id}.json`]);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]));
    expect(() => readArtifact(path, ref.sha256)).toThrow("file digest mismatch");
    writeFileSync(path, JSON.stringify({ ...input, trial: 2 }));
    expect(() => readArtifact(path, ref.sha256)).toThrow("file digest mismatch");
  });
  it("rejects source changes even when the metadata shape remains valid", () => {
    const input = artifact();
    input.candidate_files = { ...input.candidate_files, "src/helper.js": "modified" };
    expect(() => validateArtifact(input)).toThrow("source digest mismatch");
  });
  it("keeps delivery text in the private artifact and binds it to the condition/CLI bytes", () => {
    const input = makeArtifact({ ...artifact(), sync: true, site: "http://127.0.0.1:8791", sync_cli_sha256: "c".repeat(64) }, "private delivery sentinel");
    expect(input.delivery!.sha256).toHaveLength(64);
    expect(() => validateArtifact({ ...input, delivery: null })).toThrow("condition mismatch");
    expect(() => validateArtifact({ ...input, sync_cli_sha256: null })).toThrow("CLI delivery identity");
  });
  it("rejects oversize, nonregular and invalid UTF-8 file input", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-bounded-file-"));
    const path = join(dir, "file.json");
    writeFileSync(path, "12345");
    expect(() => boundedText(path, 4)).toThrow("too large");
    expect(() => boundedText(dir)).toThrow("regular file");
    writeFileSync(path, Buffer.from([0xff]));
    expect(() => boundedText(path)).toThrow();
  });
  it("does not silently lose an unsupported asset while claiming capture succeeded", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-profile-"));
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "image.png"), "unexecuted data");
    expect(() => snapshotProject(dir)).toThrow("Unsupported source file");
  });
  it("refuses invalid source encoding instead of hashing replacement characters", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-source-encoding-"));
    writeFileSync(join(dir, "bad.js"), Buffer.from([0xff]));
    expect(() => snapshotProject(dir)).toThrow();
    writeFileSync(join(dir, "bad.js"), Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
    expect(snapshotProject(dir)["bad.js"]).toBe("\ufeffa");
  });
  it("hashes task/source keys canonically, independent of insertion order", () => {
    expect(filesHash({ "b.js": "b", "a.js": "a" })).toBe(filesHash({ "a.js": "a", "b.js": "b" }));
    expect(taskHash({ ...task, overlay: "different path" })).toBe(taskHash(task));
  });
  it("refuses a wrong task or baseline before invoking Docker", async () => {
    let calls = 0;
    const run = async () => { calls++; throw new Error("Should not execute"); };
    expect((await gradeArtifact({ ...artifact(), task_sha256: "b".repeat(64) }, task, base, run)).verdict).toBe("error");
    expect((await gradeArtifact(artifact(), task, { ...base, "src/cart.js": "different baseline" }, run)).verdict).toBe("error");
    expect(calls).toBe(0);
  });
  it("accepts CRLF snapshots against the same LF task base without changing captured bytes", async () => {
    const input = makeArtifact({ ...artifact(), base_files: Object.fromEntries(Object.entries(base).map(([p, t]) => [p, t.replace(/\r?\n/g, "\r\n")])) }, null);
    let calls = 0;
    const grade = await gradeArtifact(input, task, base, async () => { calls++; return { kind: "done", exitCode: 1, timedOut: false, stdout: "", stderr: "observed failure" }; });
    expect(grade.verdict).toBe("failed");
    expect(calls).toBe(1);
  });
  it("reports a corrupted artifact as unscored without pulling images or needing Docker", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-replay-cli-"));
    const input = join(dir, "artifact.json");
    const out = join(dir, "result.json");
    writeFileSync(input, "{}");
    let error: unknown;
    try { execFileSync(process.execPath, [fileURLToPath(new URL("../src/runtime-tasks-cli.ts", import.meta.url)), "--artifact", input, "--sha256", "a".repeat(64), "--out", out], { stdio: "pipe" }); }
    catch (err) { error = err; }
    expect(error).toBeDefined();
    expect(boundedText(out)).toContain("Artifact file digest mismatch");
  });
  it("requires explicit opt-in before a model process or output directory is created", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-no-model-"));
    const out = join(dir, "not-created");
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL("../src/tasks-run.ts", import.meta.url)), "missing-cache", out, "safe-label"], { stdio: "pipe" })).toThrow("Model measurement is opt-in");
    expect(existsSync(out)).toBe(false);
  });
});
