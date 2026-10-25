import { EventEmitter } from "node:events";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildProgramDockerArgs,
  createDockerRunner,
  evaluateGuard,
  executeProgram,
  fileDigest,
  imageDigest,
  PINNED_VERSION_SET,
  resolveSandboxUser,
  resolveWritableFiles,
  toDockerMountSource,
  validateWriteGlobs,
  type DockerRunOutcome,
  type DockerRunRequest,
  type DockerRunner,
  type GuardResultT,
  type ProgramExecution,
} from "../src/index.ts";
import { exampleArtifact, exampleRecord, FIXTURE_IMAGE, guardInput, reseal } from "./fixtures.ts";

const RESOLVED_VERSIONS = { vitest: PINNED_VERSION_SET.vitest, vite: PINNED_VERSION_SET.vite };
const NODE_VERSION = "v24.8.0";

// it.skipIf reads its flag while this file is imported, which is before beforeAll.
// File symlinks throw EPERM without Developer Mode on Windows. Directory junctions do not.
const symlinkProbe = probeSymlinks();

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function keep(dir: string): string {
  temps.push(dir);
  return dir;
}

function programDirs(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("ludion-program-")));
}

function applicableGuard(): GuardResultT {
  const guard = evaluateGuard(exampleRecord(), guardInput());
  expect(guard.status).toBe("applicable");
  return guard;
}

function pinnedRecord() {
  const base = exampleArtifact();
  return reseal({ ...base, dependencies: { ...base.dependencies, image: PINNED_VERSION_SET.image } });
}

function recordWithNodeMajor(nodeMajorList: string[]) {
  const base = exampleArtifact();
  return reseal({
    ...base,
    guard: { ...base.guard, runtime: { node_major: nodeMajorList } },
    dependencies: { ...base.dependencies, image: PINNED_VERSION_SET.image },
  });
}

function makeWork(): string {
  const root = keep(mkdtempSync(join(tmpdir(), "ludion-work-")));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "src", "a.test.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "src", "b.test.ts"), "export const b = 1;\n");
  writeFileSync(join(root, "src", "other.ts"), "export const other = 1;\n");
  return root;
}

function walkTree(): string {
  const root = keep(mkdtempSync(join(tmpdir(), "ludion-walk-")));
  mkdirSync(join(root, "src", ".hidden"), { recursive: true });
  mkdirSync(join(root, "src", "node_modules"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, "src", "a.test.ts"), "a");
  writeFileSync(join(root, "src", "b.test.ts"), "b");
  writeFileSync(join(root, "src", "other.ts"), "o");
  writeFileSync(join(root, "src", ".hidden", "h.test.ts"), "h");
  writeFileSync(join(root, "src", "node_modules", "x.test.ts"), "x");
  writeFileSync(join(root, "test", "c.test.ts"), "c");
  writeFileSync(join(root, "node_modules", "pkg", "n.test.ts"), "n");
  writeFileSync(join(root, ".git", "g.test.ts"), "g");
  return root;
}

function probeSymlinks(): { file: boolean; junction: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "ludion-symlink-probe-"));
  let file = false;
  let junction = false;
  try {
    writeFileSync(join(dir, "t"), "x");
    try {
      symlinkSync(join(dir, "t"), join(dir, "l"));
      file = true;
    } catch {
      // EPERM on Windows when the process may not create file symlinks.
      file = false;
    }
    try {
      mkdirSync(join(dir, "d"));
      symlinkSync(join(dir, "d"), join(dir, "j"), "junction");
      junction = lstatSync(join(dir, "j")).isSymbolicLink();
    } catch {
      junction = false;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { file, junction };
}

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.emit("close", null, "SIGTERM");
    return true;
  };
  return child;
}

const baseArgs = {
  containerName: "ludion-program-test",
  image: FIXTURE_IMAGE,
  workDirSource: "C:\\Temp\\w",
  programDirSource: "C:\\Temp\\p",
  entry: "insert-clear.ts",
  writableFiles: ["src/b.test.ts", "src/a.test.ts"],
  user: "1000:1000",
};

describe("docker args", () => {
  it("builds the hardened argv and rewrites Windows mount sources", () => {
    expect(toDockerMountSource("C:\\Temp\\w")).toBe("/c/Temp/w");
    expect(toDockerMountSource("C:\\Temp\\p")).toBe("/c/Temp/p");
    const args = buildProgramDockerArgs(baseArgs);
    expect(args).toEqual([
      "run", "--rm", "--name", "ludion-program-test",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--read-only",
      "--memory", "512m",
      "--cpus", "1",
      "--pids-limit", "256",
      "--user", "1000:1000",
      "--network", "none",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
      "-v", "/c/Temp/w:/work:ro",
      "-v", "/c/Temp/w/src/a.test.ts:/work/src/a.test.ts:rw",
      "-v", "/c/Temp/w/src/b.test.ts:/work/src/b.test.ts:rw",
      "-v", "/c/Temp/p:/program:ro",
      "-w", "/work",
      "-e", "HOME=/tmp",
      FIXTURE_IMAGE,
      "node", "/program/insert-clear.ts",
    ]);
    expect(args.filter((part) => part === "--tmpfs")).toEqual(["--tmpfs"]);
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args).toContain("--read-only");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(args[args.indexOf("--security-opt") + 1]).toBe("no-new-privileges");
    expect(args[args.indexOf("--pids-limit") + 1]).toBe("256");
    const user = args[args.indexOf("--user") + 1];
    expect(user).toMatch(/^[1-9][0-9]*:[1-9][0-9]*$/);
    expect(args.at(-3)).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(args.filter((part) => part === "-e")).toEqual(["-e"]);
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--add-host");
    expect(args).not.toContain("-p");
    const { user: _user, ...withoutUser } = baseArgs;
    void _user;
    const fallback = buildProgramDockerArgs(withoutUser)[buildProgramDockerArgs(withoutUser).indexOf("--user") + 1];
    expect(fallback).toMatch(/^[1-9][0-9]*:[1-9][0-9]*$/);
    expect(resolveSandboxUser(undefined, undefined)).toBe("1000:1000");
    expect(resolveSandboxUser(0, 0)).toBe("1000:1000");
    expect(resolveSandboxUser(1001, 100)).toBe("1001:100");
  });

  it("throws for an unpinned image, a bad name, and an unsafe writable path", () => {
    expect(() => buildProgramDockerArgs({ ...baseArgs, image: "node:24-slim" })).toThrow(/digest/);
    expect(() => buildProgramDockerArgs({ ...baseArgs, containerName: "bad name" })).toThrow(/name/i);
    expect(() => buildProgramDockerArgs({ ...baseArgs, writableFiles: ["../x"] })).toThrow(/relative/);
    expect(() => buildProgramDockerArgs({ ...baseArgs, writableFiles: ["src/.hidden/a.ts"] })).toThrow(/relative/);
    expect(() => buildProgramDockerArgs({ ...baseArgs, entry: "../evil.js" })).toThrow(/relative/);
    expect(() => buildProgramDockerArgs({ ...baseArgs, workDirSource: "/tmp/a,b" })).toThrow(/mount/);
  });
});

describe("validateWriteGlobs", () => {
  it("rejects absolute, parent, dot, backslash, and protected globs", () => {
    for (const glob of ["/etc/passwd", "C:/x", "..\\x", "../x", "src/../../x", ".git/config", "src/.hidden/*.ts", ".env", "package.json", "**/package.json", "src\\a.ts"]) {
      expect(validateWriteGlobs([glob]).ok, glob).toBe(false);
    }
    expect(validateWriteGlobs(["src/*.test.ts"])).toEqual({ ok: true });
    expect(validateWriteGlobs(["src/*.test.ts", "test/*.test.ts"])).toEqual({ ok: true });
  });
});

describe("resolveWritableFiles", () => {
  it("matches only glob files and skips node_modules and dot directories", () => {
    const root = walkTree();
    expect(resolveWritableFiles(root, ["**/*.test.ts"])).toEqual({
      ok: true,
      files: ["src/a.test.ts", "src/b.test.ts", "test/c.test.ts"],
    });
  });

  it.skipIf(!symlinkProbe.file)("rejects a symlinked file that matches a write glob", () => {
    const root = keep(mkdtempSync(join(tmpdir(), "ludion-walk-")));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.test.ts"), "a");
    symlinkSync(join(root, "src", "a.test.ts"), join(root, "src", "b.test.ts"));
    const result = resolveWritableFiles(root, ["src/*.test.ts"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("symlink out");
  });

  it.skipIf(!symlinkProbe.junction)("rejects a junction the glob would traverse and ignores one it would not", () => {
    const ignored = keep(mkdtempSync(join(tmpdir(), "ludion-walk-")));
    mkdirSync(join(ignored, "src"));
    writeFileSync(join(ignored, "src", "a.test.ts"), "a");
    const elsewhere = keep(mkdtempSync(join(tmpdir(), "ludion-walk-")));
    writeFileSync(join(elsewhere, "a.test.ts"), "nope");
    symlinkSync(elsewhere, join(ignored, "extra"), "junction");
    expect(resolveWritableFiles(ignored, ["src/*.test.ts"])).toEqual({ ok: true, files: ["src/a.test.ts"] });

    const traversed = keep(mkdtempSync(join(tmpdir(), "ludion-walk-")));
    const target = keep(mkdtempSync(join(tmpdir(), "ludion-walk-")));
    writeFileSync(join(target, "a.test.ts"), "a");
    symlinkSync(target, join(traversed, "src"), "junction");
    const result = resolveWritableFiles(traversed, ["src/*.test.ts"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("symlink out");
  });
});

describe("executeProgram", () => {
  it("does not start Docker for inapplicable, unknown, or stale guards", async () => {
    const missed = evaluateGuard(exampleRecord(), guardInput({ files: { "src/nope.test.ts": "export const x = 1;\n" } }));
    expect(missed.status).toBe("inapplicable");
    const guards: GuardResultT[] = [
      { status: "inapplicable", reason: "target_absent", detail: "no target", checks: [] },
      { status: "unknown", reason: "intent_missing", detail: "no contract", checks: [] },
      { status: "stale", reason: "program_changed", detail: "program moved", checks: [] },
      missed,
    ];
    for (const guard of guards) {
      const before = programDirs();
      const runner = vi.fn<DockerRunner>(async () => {
        throw new Error("docker must not start");
      });
      const result = await executeProgram({
        record: exampleRecord(),
        guard,
        workDir: process.cwd(),
        runner,
        resolved_versions: RESOLVED_VERSIONS,
        node_version: NODE_VERSION,
      });
      expect(result).toMatchObject({
        outcome: "not_executed",
        reason: "guard_not_applicable",
        guard_status: guard.status,
        docker_invoked: false,
        model_calls: { count: 0 },
      });
      expect(result.wall_ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result.wall_ms)).toBe(true);
      expect(runner).not.toHaveBeenCalled();
      expect([...programDirs()].filter((name) => !before.has(name))).toEqual([]);
    }
  });

  it("runs an applicable program and reports the file it changed", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const stamps = [5_000, 5_600];
    let ticks = 0;
    const now = () => {
      const value = stamps[ticks];
      ticks += 1;
      if (value === undefined) throw new Error(`now() called ${ticks} times`);
      return value;
    };
    const calls: DockerRunRequest[] = [];
    const beforeDirs = programDirs();
    const runner: DockerRunner = async (req) => {
      calls.push(req);
      const live = [...programDirs()].filter((name) => !beforeDirs.has(name));
      expect(live).toHaveLength(1);
      expect(readFileSync(join(tmpdir(), live[0]!, "insert-clear.ts"), "utf8")).toContain("vi.clearAllMocks");
      writeFileSync(join(work, "src", "a.test.ts"), "export const a = 2;\n");
      return { kind: "exited", exitCode: 0, stdout: "done\n", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      now,
      containerName: "ludion-program-apply",
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(ticks).toBe(2);
    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req).toBeDefined();
    if (req === undefined) return;
    expect(req.timeoutMs).toBe(record.artifact.program.timeout_ms);
    expect(req.containerName).toBe("ludion-program-apply");
    const programMount = req.args.find((arg) => arg.endsWith(":/program:ro"));
    expect(programMount).toBeDefined();
    const programDirSource = programMount?.slice(0, -":/program:ro".length) ?? "";
    expect(req.args).toEqual(buildProgramDockerArgs({
      containerName: "ludion-program-apply",
      image: record.artifact.dependencies.image,
      workDirSource: realpathSync(work),
      programDirSource,
      entry: record.artifact.program.entry,
      writableFiles: ["src/b.test.ts", "src/a.test.ts"],
    }));
    const beforeA = "export const a = 1;\n";
    const afterA = "export const a = 2;\n";
    const unchanged = "export const b = 1;\n";
    expect(result).toEqual({
      outcome: "executed",
      status: "ok",
      writable_files: ["src/a.test.ts", "src/b.test.ts"],
      changed_files: ["src/a.test.ts"],
      docker_args: req.args,
      evidence: {
        exit_code: 0,
        timed_out: false,
        wall_ms: 600,
        image: PINNED_VERSION_SET.image,
        image_digest: imageDigest(PINNED_VERSION_SET.image),
        versions: { node: "24", vitest: "4.0.0", vite: "7.1.11" },
        files: [
          {
            path: "src/a.test.ts",
            before_sha256: fileDigest(beforeA),
            after_sha256: fileDigest(afterA),
            before_bytes: Buffer.byteLength(beforeA),
            after_bytes: Buffer.byteLength(afterA),
            changed: true,
          },
          {
            path: "src/b.test.ts",
            before_sha256: fileDigest(unchanged),
            after_sha256: fileDigest(unchanged),
            before_bytes: Buffer.byteLength(unchanged),
            after_bytes: Buffer.byteLength(unchanged),
            changed: false,
          },
        ],
        diff: [{ path: "src/a.test.ts", before: beforeA, after: afterA, truncated: false }],
        no_op: false,
        red_flags: [],
        stdout_tail: "done\n",
        stderr_tail: "",
      },
      pre_repair: null,
      wall_ms: 600,
      model_calls: { count: 0 },
    });
    expect([...programDirs()].filter((name) => !beforeDirs.has(name))).toEqual([]);
  });

  it("maps timeout, spawn errors, daemon failures, and non-zero exits", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const run = async (outcome: DockerRunOutcome) => {
      const runner: DockerRunner = async () => outcome;
      return executeProgram({
        record,
        guard,
        workDir: work,
        runner,
        containerName: "ludion-program-case",
        now: () => 0,
        resolved_versions: RESOLVED_VERSIONS,
        node_version: NODE_VERSION,
      });
    };
    const timed = await run({ kind: "exited", exitCode: 137, stdout: "", stderr: "", timedOut: true });
    expect(timed).toMatchObject({ outcome: "executed", status: "timeout", model_calls: { count: 0 } });
    if (timed.outcome === "executed") {
      expect(timed.evidence.exit_code).toBe(137);
      expect(timed.evidence.timed_out).toBe(true);
    }
    const missing = await run({ kind: "spawn_error", message: "spawn docker ENOENT" });
    expect(missing).toMatchObject({ outcome: "environment_unavailable", detail: "spawn docker ENOENT", docker_invoked: true, model_calls: { count: 0 } });
    for (const stderr of ["Cannot connect to the Docker daemon at npipe:////./pipe/docker_engine", "error during connect: this error"]) {
      const daemon = await run({ kind: "exited", exitCode: 125, stdout: "", stderr, timedOut: false });
      expect(daemon).toMatchObject({ outcome: "environment_unavailable", docker_invoked: true });
    }
    const other125 = await run({ kind: "exited", exitCode: 125, stdout: "", stderr: "container failed", timedOut: false });
    expect(other125).toMatchObject({ outcome: "executed", status: "failed" });
    if (other125.outcome === "executed") {
      expect(other125.evidence.exit_code).toBe(125);
      expect(other125.evidence.timed_out).toBe(false);
    }
    const stderr = `${"x".repeat(5_000)}TAIL`;
    const failed = await run({ kind: "exited", exitCode: 1, stdout: "", stderr, timedOut: false });
    expect(failed).toMatchObject({ outcome: "executed", status: "failed", model_calls: { count: 0 } });
    if (failed.outcome === "executed") expect(failed.evidence.exit_code).toBe(1);
    if (failed.outcome === "executed") {
      expect(failed.evidence.stderr_tail).toHaveLength(4_000);
      expect(failed.evidence.stderr_tail.endsWith("TAIL")).toBe(true);
    }
  });

  it("rejects an invalid record and a work directory outside the temp roots", async () => {
    const work = makeWork();
    const guard = applicableGuard();
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const before = programDirs();
    const base = { guard, runner, resolved_versions: RESOLVED_VERSIONS, node_version: NODE_VERSION };
    const invalid = await executeProgram({ ...base, record: { id: "nope" }, workDir: work });
    expect(invalid).toMatchObject({ outcome: "rejected", reason: "invalid_record", docker_invoked: false, model_calls: { count: 0 } });
    const rec = pinnedRecord();
    const last = rec.id.at(-1);
    const tampered = { ...rec, id: rec.id.slice(0, -1) + (last === "0" ? "1" : "0") };
    const mismatch = await executeProgram({ ...base, record: tampered, workDir: work });
    expect(mismatch).toMatchObject({ outcome: "rejected", reason: "invalid_record", docker_invoked: false });
    const outside = await executeProgram({ ...base, record: rec, workDir: process.cwd() });
    expect(outside).toMatchObject({ outcome: "rejected", reason: "invalid_work_dir", docker_invoked: false, model_calls: { count: 0 } });
    expect(runner).not.toHaveBeenCalled();
    expect([...programDirs()].filter((name) => !before.has(name))).toEqual([]);
  });
});

const TEST_SOURCE = [
  'import { expect, it, test } from "vitest";',
  'it("keeps history", () => {',
  "  expect(1).toBe(1);",
  "});",
  'test("keeps the other", () => {',
  "  expect(2).toBe(2);",
  "});",
  "",
].join("\n");

function caseWork(source = TEST_SOURCE): string {
  const root = keep(mkdtempSync(join(tmpdir(), "ludion-work-")));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.test.ts"), source);
  return root;
}

function assertNeverVerified(result: ProgramExecution): void {
  expect(["executed", "not_executed", "rejected", "environment_unavailable"]).toContain(result.outcome);
  if (result.outcome === "executed") {
    // status is the container process exit status, not verification.
    expect(["ok", "failed", "timeout"]).toContain(result.status);
  }
  const bannedKeys = new Set(["verified", "verifier"]);
  const bannedStatus = new Set(["verified", "pass", "passed"]);
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      expect(bannedKeys.has(key), key).toBe(false);
      if ((key === "status" || key === "outcome") && typeof child === "string") {
        expect(bannedStatus.has(child), `${key}=${child}`).toBe(false);
      }
      walk(child);
    }
  };
  walk(JSON.parse(JSON.stringify(result)) as unknown);
}

function _rejectVerifiedOutcome(result: ProgramExecution): void {
  // @ts-expect-error ProgramExecution has no outcome "verified"
  if (result.outcome === "verified") throw new Error("verified");
}

describe("negative cases never verify", () => {
  it("empty program is executed with no changed files and evidence.no_op", async () => {
    const work = caseWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const runner: DockerRunner = async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false });
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    assertNeverVerified(result);
    expect(result).toMatchObject({ outcome: "executed", changed_files: [], model_calls: { count: 0 } });
    if (result.outcome !== "executed") return;
    expect(result.evidence.no_op).toBe(true);
    expect(result.evidence.red_flags).toEqual([]);
  });

  it("wrong repair records the garbage change and does not claim success", async () => {
    const work = caseWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const runner: DockerRunner = async () => {
      writeFileSync(join(work, "src", "a.test.ts"), `${TEST_SOURCE}const garbage = "unrelated";\n`);
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    assertNeverVerified(result);
    expect(result.outcome).toBe("executed");
    if (result.outcome !== "executed") return;
    expect(result.changed_files).toEqual(["src/a.test.ts"]);
    expect(result.evidence.no_op).toBe(false);
    const file = result.evidence.files.find((item) => item.path === "src/a.test.ts");
    expect(file?.changed).toBe(true);
    expect(file?.before_sha256).not.toBe(file?.after_sha256);
    expect(result.evidence.diff.some((item) => item.path === "src/a.test.ts" && item.after.includes("unrelated"))).toBe(true);
    expect(result.evidence.red_flags).toEqual([]);
  });

  it("removing test blocks raises tests_removed", async () => {
    const work = caseWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const runner: DockerRunner = async () => {
      writeFileSync(join(work, "src", "a.test.ts"), 'import { expect } from "vitest";\nexpect(1).toBe(1);\n');
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    assertNeverVerified(result);
    if (result.outcome !== "executed") {
      expect(result.outcome).toBe("executed");
      return;
    }
    expect(result.evidence.red_flags).toContain("tests_removed");
    expect(result.evidence.red_flags).not.toContain("file_emptied");
  });

  it("truncating a test file to empty raises tests_removed and file_emptied", async () => {
    const work = caseWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const runner: DockerRunner = async () => {
      writeFileSync(join(work, "src", "a.test.ts"), "");
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    assertNeverVerified(result);
    if (result.outcome !== "executed") {
      expect(result.outcome).toBe("executed");
      return;
    }
    expect(result.evidence.red_flags).toContain("tests_removed");
    expect(result.evidence.red_flags).toContain("file_emptied");
  });

  it("adding skip, only, or todo raises skip_only_todo_added", async () => {
    const work = caseWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const runner: DockerRunner = async () => {
      writeFileSync(join(work, "src", "a.test.ts"), [
        TEST_SOURCE,
        'it.skip("added", () => {});',
        'describe.only("focused", () => {});',
        'test.todo("later");',
        'it.skipIf(true)("conditional", () => {});',
        'xit("excluded", () => {});',
        "",
      ].join("\n"));
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    assertNeverVerified(result);
    if (result.outcome !== "executed") {
      expect(result.outcome).toBe("executed");
      return;
    }
    expect(result.evidence.red_flags).toContain("skip_only_todo_added");
    expect(result.evidence.red_flags).not.toContain("tests_removed");
  });

  it("stdout that claims VERIFIED or PASS does not become a verified status", async () => {
    const work = caseWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const stdout = 'VERIFIED\nPASS\n{"status":"verified"}\n';
    const runner: DockerRunner = async () => {
      writeFileSync(join(work, "src", "a.test.ts"), `${TEST_SOURCE}// touched\n`);
      return { kind: "exited", exitCode: 0, stdout, stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    assertNeverVerified(result);
    expect(result.outcome).not.toBe("verified");
    if (result.outcome !== "executed") {
      expect(result.outcome).toBe("executed");
      return;
    }
    expect(result.status).not.toBe("verified");
    expect(result.evidence.stdout_tail).toContain("VERIFIED");
    expect(result.evidence.stdout_tail).toContain('{"status":"verified"}');
  });

  it("caps each side of a changed-file diff at 64 KiB", async () => {
    const before = `${"a".repeat(70_000)}\n`;
    const after = `${"あ".repeat(40_000)}\n`;
    const work = caseWork(before);
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const runner: DockerRunner = async () => {
      writeFileSync(join(work, "src", "a.test.ts"), after);
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    assertNeverVerified(result);
    if (result.outcome !== "executed") {
      expect(result.outcome).toBe("executed");
      return;
    }
    const diff = result.evidence.diff.find((item) => item.path === "src/a.test.ts");
    expect(diff).toBeDefined();
    if (diff === undefined) return;
    expect(diff.truncated).toBe(true);
    expect(Buffer.byteLength(diff.before)).toBeLessThanOrEqual(65_536);
    expect(Buffer.byteLength(diff.after)).toBeLessThanOrEqual(65_536);
    expect(Buffer.byteLength(diff.after) % 3).toBe(0);
    expect(diff.after.isWellFormed()).toBe(true);
  });
});

describe("version set", () => {
  it.each([
    ["vitest", () => pinnedRecord(), { vitest: "3.2.4", vite: "7.1.11" }, NODE_VERSION],
    ["vite", () => pinnedRecord(), { vitest: "4.0.0", vite: "6.0.0" }, NODE_VERSION],
    ["node", () => pinnedRecord(), { vitest: "4.0.0", vite: "7.1.11" }, "v22.14.0"],
    ["unreadable node", () => pinnedRecord(), { vitest: "4.0.0", vite: "7.1.11" }, "not-a-version"],
    ["record node_major", () => recordWithNodeMajor(["22"]), { vitest: "4.0.0", vite: "7.1.11" }, NODE_VERSION],
    ["image", () => exampleRecord(), { vitest: "4.0.0", vite: "7.1.11" }, NODE_VERSION],
  ] as const)("rejects a %s mismatch with version_set_mismatch and does not start Docker", async (_name, recordOf, resolved, nodeVersion) => {
    const work = makeWork();
    const before = programDirs();
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const preRepair = vi.fn(async () => {
      throw new Error("pre-repair must not run");
    });
    const result = await executeProgram({
      record: recordOf(),
      guard: applicableGuard(),
      workDir: work,
      runner,
      preRepair,
      resolved_versions: { ...resolved },
      node_version: nodeVersion,
    });
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "version_set_mismatch",
      docker_invoked: false,
      pre_repair: null,
      model_calls: { count: 0 },
    });
    expect(runner).not.toHaveBeenCalled();
    expect(preRepair).not.toHaveBeenCalled();
    expect([...programDirs()].filter((name) => !before.has(name))).toEqual([]);
  });
});

describe("pre-repair", () => {
  it("runs the program when the contract test failed and records pre_repair", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const guard = evaluateGuard(record, guardInput());
    expect(guard.status).toBe("applicable");
    const order: string[] = [];
    const evidence = { ran: true as const, exit_code: 1, failed_tests: ["history-cleared"], passed_tests: ["spy-restored"] };
    const preRepair = async () => {
      order.push("pre");
      return evidence;
    };
    const runner: DockerRunner = async () => {
      order.push("run");
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      guard,
      workDir: work,
      runner,
      preRepair,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(order).toEqual(["pre", "run"]);
    expect(result).toMatchObject({ outcome: "executed", pre_repair: evidence, model_calls: { count: 0 } });
  });

  it("rejects a pre-repair that did not fail and does not start Docker", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const before = programDirs();
    const evidence = { ran: true as const, exit_code: 0, failed_tests: [] as string[], passed_tests: ["history-cleared"] };
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const result = await executeProgram({
      record,
      guard: evaluateGuard(record, guardInput()),
      workDir: work,
      runner,
      preRepair: async () => evidence,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "pre_repair_not_failing",
      docker_invoked: false,
      pre_repair: evidence,
      model_calls: { count: 0 },
    });
    expect(runner).not.toHaveBeenCalled();
    expect([...programDirs()].filter((name) => !before.has(name))).toEqual([]);
  });

  it("rejects a pre-repair that exited 0 even if it lists failed tests", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const evidence = { ran: true as const, exit_code: 0, failed_tests: ["history-cleared"], passed_tests: [] as string[] };
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const result = await executeProgram({
      record,
      guard: evaluateGuard(record, guardInput()),
      workDir: work,
      runner,
      preRepair: async () => evidence,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(result).toMatchObject({ outcome: "rejected", reason: "pre_repair_not_failing", docker_invoked: false, pre_repair: evidence });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects when pre-repair throws", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const result = await executeProgram({
      record,
      guard: evaluateGuard(record, guardInput()),
      workDir: work,
      runner,
      preRepair: async () => {
        throw new Error("verifier down");
      },
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "pre_repair_unavailable",
      docker_invoked: false,
      pre_repair: null,
      model_calls: { count: 0 },
    });
    expect(result.outcome === "rejected" && result.detail).toContain("verifier down");
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects when pre-repair returns ran false", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const evidence = { ran: false as const, reason: "no container" };
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const result = await executeProgram({
      record,
      guard: evaluateGuard(record, guardInput()),
      workDir: work,
      runner,
      preRepair: async () => evidence,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "pre_repair_unavailable",
      docker_invoked: false,
      pre_repair: evidence,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects when pre-repair is required and missing", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const result = await executeProgram({
      record,
      guard: evaluateGuard(record, guardInput()),
      workDir: work,
      runner,
      require_pre_repair: true,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "pre_repair_unavailable",
      docker_invoked: false,
      pre_repair: null,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not call pre-repair or Docker when the guard is not applicable", async () => {
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const preRepair = vi.fn(async () => {
      throw new Error("pre-repair must not run");
    });
    const result = await executeProgram({
      record: exampleRecord(),
      guard: { status: "inapplicable", reason: "target_absent", detail: "no target", checks: [] },
      workDir: process.cwd(),
      runner,
      preRepair,
      resolved_versions: RESOLVED_VERSIONS,
      node_version: NODE_VERSION,
    });
    expect(result).toMatchObject({ outcome: "not_executed", reason: "guard_not_applicable", pre_repair: null, docker_invoked: false });
    expect(preRepair).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("createDockerRunner", () => {
  it("kills only the named container when the child does not exit", async () => {
    const name = "ludion-program-timeout";
    const calls: Array<{ cmd: string; args: readonly string[]; options: unknown }> = [];
    const children: FakeChild[] = [];
    const spawnFn = ((cmd: string, args: readonly string[] = [], options?: unknown) => {
      calls.push({ cmd, args, options });
      const child = fakeChild();
      if (args[0] !== "kill") children.push(child);
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const runner = createDockerRunner({ spawn: spawnFn });
    const pending = runner({ args: ["run", "--name", name], containerName: name, timeoutMs: 20 });
    await vi.waitFor(() => {
      expect(calls.filter((call) => call.args[0] === "kill")).toHaveLength(1);
    });
    expect(calls.map((call) => [call.cmd, ...call.args])).toEqual([
      ["docker", "run", "--name", name],
      ["docker", "kill", name],
    ]);
    expect(calls[0]?.options).toEqual({ stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    expect(calls[1]?.options).toEqual({ stdio: "ignore" });
    children[0]?.emit("close", 137, null);
    await expect(pending).resolves.toEqual({ kind: "exited", exitCode: 137, stdout: "", stderr: "", timedOut: true });
    expect(calls.filter((call) => call.args[0] === "kill")).toHaveLength(1);
  });

  it("returns spawn_error when docker emits error", async () => {
    const child = fakeChild();
    const spawnFn = (() => child) as unknown as typeof import("node:child_process").spawn;
    const runner = createDockerRunner({ spawn: spawnFn });
    const pending = runner({ args: ["run"], containerName: "ludion-program-err", timeoutMs: 1_000 });
    child.emit("error", new Error("spawn docker ENOENT"));
    await expect(pending).resolves.toEqual({ kind: "spawn_error", message: "spawn docker ENOENT" });
  });
});
