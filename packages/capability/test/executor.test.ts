import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { alreadyFixedTest, applicableTest, CONTRACT_ID, exampleArtifact, exampleRecord, FIXTURE_IMAGE, globalsTest, guardInput, localFunctionTest, packageLock, reseal } from "./fixtures.ts";
import { lockfileVersions } from "../src/executor.ts";

const RESOLVED_VERSIONS = { vitest: PINNED_VERSION_SET.vitest, vite: PINNED_VERSION_SET.vite };
/** The work copy's own lockfile. The executor reads versions only from this file. */
const LOCK = packageLock(RESOLVED_VERSIONS);
const NODE_VERSION = "v24.8.0";

// it.skipIf reads its flag while this file is imported, which is before beforeAll.
// File symlinks throw EPERM without Developer Mode on Windows. Directory junctions do not.
const symlinkProbe = probeSymlinks();

const temps: string[] = [];

// Vitest runs test files in parallel workers that share the OS temp directory. Give this file its own
// temp root (os.tmpdir() reads these variables on every call) so the "no ludion-snapshot-/ludion-program-
// directory left behind" checks only see directories created by this file.
const savedTempEnv = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
let privateTempRoot = "";
beforeAll(() => {
  privateTempRoot = realpathSync(mkdtempSync(join(tmpdir(), "ludion-testroot-")));
  process.env.TMPDIR = privateTempRoot;
  process.env.TMP = privateTempRoot;
  process.env.TEMP = privateTempRoot;
});
afterAll(() => {
  for (const [key, value] of Object.entries(savedTempEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(privateTempRoot, { recursive: true, force: true });
});

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

function snapshotDirs(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("ludion-snapshot-")));
}

function newSince(before: Set<string>, now: Set<string>): string[] {
  return [...now].filter((name) => !before.has(name));
}

/** Host path of the read-only /work mount in a docker argv. Undoes the Windows `/c/...` rewrite. */
function mountedWork(req: DockerRunRequest): string {
  const spec = req.args.find((arg) => arg.endsWith(":/work:ro"));
  if (spec === undefined) throw new Error("no /work mount");
  const source = spec.slice(0, -":/work:ro".length);
  const drive = /^\/([a-z])\/(.*)$/.exec(source);
  if (process.platform === "win32" && drive) return `${drive[1]!.toUpperCase()}:\\${drive[2]!.replace(/\//g, "\\")}`;
  return source;
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
  writeFileSync(join(root, "src", "a.test.ts"), applicableTest);
  writeFileSync(join(root, "src", "b.test.ts"), "export const b = 1;\n");
  writeFileSync(join(root, "src", "other.ts"), "export const other = 1;\n");
  writeFileSync(join(root, "package-lock.json"), LOCK);
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
  it("has no guard input: an untyped caller's applicable guard is ignored on a non-applicable tree", async () => {
    const work = keep(mkdtempSync(join(tmpdir(), "ludion-work-")));
    mkdirSync(join(work, "src"));
    writeFileSync(join(work, "src", "nope.test.ts"), "export const x = 1;\n");
    writeFileSync(join(work, "package-lock.json"), LOCK);
    const forged = applicableGuard();
    const callerResults: unknown[] = [
      forged,
      { status: "applicable" },
      { status: "inapplicable", reason: "target_absent", detail: "no target", checks: [] },
      undefined,
    ];
    for (const guard of callerResults) {
      const beforePrograms = programDirs();
      const beforeSnapshots = snapshotDirs();
      const runner = vi.fn<DockerRunner>(async () => {
        throw new Error("docker must not start");
      });
      const preRepair = vi.fn(async () => {
        throw new Error("pre-repair must not run");
      });
      // ExecuteProgramInput has no guard field; an untyped (JS) caller can still pass one.
      const untyped = { record: pinnedRecord(), guard, contract_id: CONTRACT_ID, workDir: work, runner, preRepair, node_version: NODE_VERSION };
      const result = await executeProgram(untyped);
      expect(result).toMatchObject({
        outcome: "not_executed",
        reason: "guard_not_applicable",
        guard_status: "inapplicable",
        guard: { status: "inapplicable" },
        docker_invoked: false,
        pre_repair: null,
        model_calls: { count: 0 },
      });
      expect(result.wall_ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result.wall_ms)).toBe(true);
      expect(runner).not.toHaveBeenCalled();
      expect(preRepair).not.toHaveBeenCalled();
      expect(newSince(beforePrograms, programDirs())).toEqual([]);
      expect(newSince(beforeSnapshots, snapshotDirs())).toEqual([]);
    }
  });

  it.each([
    ["a local restoreAllMocks function", { "src/local.test.ts": localFunctionTest }, CONTRACT_ID, "inapplicable"],
    ["clearAllMocks already present", { "src/fixed.test.ts": alreadyFixedTest }, CONTRACT_ID, "inapplicable"],
    ["vi without a vitest import", { "src/global.test.ts": globalsTest }, CONTRACT_ID, "unknown"],
    ["a missing contract id", { "src/a.test.ts": applicableTest }, undefined, "unknown"],
    ["an unrelated contract id", { "src/a.test.ts": applicableTest }, "other.contract", "inapplicable"],
  ] as const)("evaluates the guard itself on the tree: %s is not executed", async (_name, files, contractId, status) => {
    const work = keep(mkdtempSync(join(tmpdir(), "ludion-work-")));
    mkdirSync(join(work, "src"));
    writeFileSync(join(work, "package-lock.json"), LOCK);
    for (const [rel, text] of Object.entries(files)) writeFileSync(join(work, ...rel.split("/")), text);
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const result = await executeProgram({
      record: pinnedRecord(),
      ...(contractId !== undefined ? { contract_id: contractId } : {}),
      workDir: work,
      runner,
      node_version: NODE_VERSION,
    });
    const expected = evaluateGuard(pinnedRecord(), guardInput({ contract_id: contractId, files: { ...files, "package-lock.json": LOCK } }));
    expect(expected.status).toBe(status);
    expect(result).toMatchObject({ outcome: "not_executed", reason: "guard_not_applicable", guard_status: expected.status, docker_invoked: false });
    if (result.outcome === "not_executed") expect(result.guard?.status).toBe(expected.status);
    expect(runner).not.toHaveBeenCalled();
  });

  it("runs an applicable program and reports the file it changed", async () => {
    const work = makeWork();
    const record = pinnedRecord();
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
    const beforeSnapshots = snapshotDirs();
    const beforeA = applicableTest;
    const afterA = applicableTest.replace("  vi.restoreAllMocks();", "  vi.clearAllMocks();\n  vi.restoreAllMocks();");
    const runner: DockerRunner = async (req) => {
      calls.push(req);
      const live = [...programDirs()].filter((name) => !beforeDirs.has(name));
      expect(live).toHaveLength(1);
      expect(readFileSync(join(tmpdir(), live[0]!, "insert-clear.ts"), "utf8")).toContain("vi.clearAllMocks");
      const mounted = mountedWork(req);
      expect(newSince(beforeSnapshots, snapshotDirs())).toHaveLength(1);
      expect(realpathSync(mounted)).not.toBe(realpathSync(work));
      expect(mounted.includes("ludion-snapshot-")).toBe(true);
      expect(readFileSync(join(mounted, "src", "a.test.ts"), "utf8")).toBe(applicableTest);
      writeFileSync(join(mounted, "src", "a.test.ts"), afterA);
      return { kind: "exited", exitCode: 0, stdout: "done\n", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      now,
      containerName: "ludion-program-apply",
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
    const snapshotSource = mountedWork(req);
    expect(req.args).toEqual(buildProgramDockerArgs({
      containerName: "ludion-program-apply",
      image: record.artifact.dependencies.image,
      workDirSource: snapshotSource,
      programDirSource,
      entry: record.artifact.program.entry,
      writableFiles: ["src/b.test.ts", "src/a.test.ts"],
    }));
    const unchanged = "export const b = 1;\n";
    const ownGuard = evaluateGuard(record, guardInput({
      files: { "package-lock.json": LOCK, "src/a.test.ts": beforeA, "src/b.test.ts": unchanged, "src/other.ts": "export const other = 1;\n" },
    }));
    expect(ownGuard.status).toBe("applicable");
    expect(result).toEqual({
      outcome: "executed",
      status: "ok",
      guard: ownGuard,
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
    // The snapshot is gone and the caller's tree was never written.
    expect(newSince(beforeSnapshots, snapshotDirs())).toEqual([]);
    expect(existsSync(snapshotSource)).toBe(false);
    expect(readFileSync(join(work, "src", "a.test.ts"), "utf8")).toBe(beforeA);
  });

  it("maps timeout, spawn errors, daemon failures, and non-zero exits", async () => {
    const work = makeWork();
    const record = pinnedRecord();
    const run = async (outcome: DockerRunOutcome) => {
      const runner: DockerRunner = async () => outcome;
      return executeProgram({
        record,
        contract_id: CONTRACT_ID,
        workDir: work,
        runner,
        containerName: "ludion-program-case",
        now: () => 0,
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
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const before = programDirs();
    const base = { contract_id: CONTRACT_ID, runner, node_version: NODE_VERSION };
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
  'import { afterEach, expect, it, test, vi } from "vitest";',
  "afterEach(() => {",
  "  vi.restoreAllMocks();",
  "});",
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
  writeFileSync(join(root, "package-lock.json"), LOCK);
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
    const runner: DockerRunner = async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false });
    const result = await executeProgram({
      record,
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
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
    const runner: DockerRunner = async (req) => {
      writeFileSync(join(mountedWork(req), "src", "a.test.ts"), `${TEST_SOURCE}const garbage = "unrelated";\n`);
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
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
    const runner: DockerRunner = async (req) => {
      writeFileSync(join(mountedWork(req), "src", "a.test.ts"), 'import { expect } from "vitest";\nexpect(1).toBe(1);\n');
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
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
    const runner: DockerRunner = async (req) => {
      writeFileSync(join(mountedWork(req), "src", "a.test.ts"), "");
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
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
    const runner: DockerRunner = async (req) => {
      writeFileSync(join(mountedWork(req), "src", "a.test.ts"), [
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
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
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
    const stdout = 'VERIFIED\nPASS\n{"status":"verified"}\n';
    const runner: DockerRunner = async (req) => {
      writeFileSync(join(mountedWork(req), "src", "a.test.ts"), `${TEST_SOURCE}// touched\n`);
      return { kind: "exited", exitCode: 0, stdout, stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
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
    // The guard reads at most 64 KiB per file, so an applicable "before" stays under the cap; "after" exceeds it.
    const before = `${TEST_SOURCE}// ${"a".repeat(60_000)}\n`;
    const after = `${"あ".repeat(40_000)}\n`;
    const work = caseWork(before);
    const record = pinnedRecord();
    const runner: DockerRunner = async (req) => {
      writeFileSync(join(mountedWork(req), "src", "a.test.ts"), after);
      return { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
    };
    const result = await executeProgram({
      record,
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
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
    expect(diff.before).toBe(before);
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
    // The versions come from the work copy's lockfile.
    writeFileSync(join(work, "package-lock.json"), packageLock({ ...resolved }));
    const before = programDirs();
    const runner = vi.fn<DockerRunner>(async () => {
      throw new Error("docker must not start");
    });
    const preRepair = vi.fn(async () => {
      throw new Error("pre-repair must not run");
    });
    const result = await executeProgram({
      record: recordOf(),
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      preRepair,
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
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      preRepair,
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
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      preRepair: async () => evidence,
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
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      preRepair: async () => evidence,
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
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      preRepair: async () => {
        throw new Error("verifier down");
      },
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
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      preRepair: async () => evidence,
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
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      require_pre_repair: true,
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
      record: pinnedRecord(),
      contract_id: CONTRACT_ID,
      workDir: caseWork(localFunctionTest),
      runner,
      preRepair,
      node_version: NODE_VERSION,
    });
    expect(result).toMatchObject({ outcome: "not_executed", reason: "guard_not_applicable", pre_repair: null, docker_invoked: false });
    expect(preRepair).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("private snapshot", () => {
  const okRun: DockerRunOutcome = { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };

  async function runOn(work: string, runner: DockerRunner, extra: Partial<Parameters<typeof executeProgram>[0]> = {}) {
    return executeProgram({
      record: pinnedRecord(),
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      node_version: NODE_VERSION,
      ...extra,
    });
  }

  function expectRefused(result: ProgramExecution, detail: RegExp): void {
    expect(result).toMatchObject({ outcome: "rejected", reason: "unsafe_work_tree", docker_invoked: false, model_calls: { count: 0 } });
    if (result.outcome === "rejected") expect(result.detail).toMatch(detail);
  }

  it("changes to the original tree after the snapshot do not reach the mount", async () => {
    const work = makeWork();
    const moved = `${work}-moved`;
    keep(moved);
    const beforeSnapshots = snapshotDirs();
    const seen: Record<string, string | null> = {};
    // preRepair is caller code that runs after the snapshot and the guard, and before the container.
    const preRepair = async () => {
      writeFileSync(join(work, "src", "a.test.ts"), "export const swapped = true;\n");
      writeFileSync(join(work, "src", "new.test.ts"), "export const added = true;\n");
      unlinkSync(join(work, "src", "b.test.ts"));
      // Swap the whole directory for a different one at the same path.
      renameSync(work, moved);
      mkdirSync(join(work, "src"), { recursive: true });
      writeFileSync(join(work, "src", "a.test.ts"), "export const replaced = true;\n");
      return { ran: true as const, exit_code: 1, failed_tests: ["history-cleared"], passed_tests: [] };
    };
    const runner = vi.fn<DockerRunner>(async (req) => {
      const mounted = mountedWork(req);
      for (const rel of ["src/a.test.ts", "src/b.test.ts", "src/new.test.ts"]) {
        const path = join(mounted, ...rel.split("/"));
        seen[rel] = existsSync(path) ? readFileSync(path, "utf8") : null;
      }
      return okRun;
    });
    const result = await runOn(work, runner, { preRepair });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ "src/a.test.ts": applicableTest, "src/b.test.ts": "export const b = 1;\n", "src/new.test.ts": null });
    expect(result).toMatchObject({ outcome: "executed", status: "ok", writable_files: ["src/a.test.ts", "src/b.test.ts"], changed_files: [] });
    if (result.outcome === "executed") {
      expect(result.evidence.files.map((file) => file.before_sha256)).toEqual([fileDigest(applicableTest), fileDigest("export const b = 1;\n")]);
    }
    expect(newSince(beforeSnapshots, snapshotDirs())).toEqual([]);
    // The caller's (swapped) tree is left exactly as the caller left it.
    expect(readFileSync(join(work, "src", "a.test.ts"), "utf8")).toBe("export const replaced = true;\n");
  });

  it("copies only regular files and skips node_modules and .git", async () => {
    const work = makeWork();
    mkdirSync(join(work, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(work, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
    mkdirSync(join(work, ".git"));
    writeFileSync(join(work, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(work, "docs", "deep"), { recursive: true });
    writeFileSync(join(work, "docs", "deep", "note.md"), "note\n");
    let listing: string[] = [];
    const runner: DockerRunner = async (req) => {
      const mounted = mountedWork(req);
      const walk = (dir: string, rel: string): string[] =>
        readdirSync(dir).sort().flatMap((name) => {
          const childRel = rel ? `${rel}/${name}` : name;
          return lstatSync(join(dir, name)).isDirectory() ? walk(join(dir, name), childRel) : [childRel];
        });
      listing = walk(mounted, "");
      return okRun;
    };
    const result = await runOn(work, runner);
    expect(result.outcome).toBe("executed");
    expect(listing).toEqual(["docs/deep/note.md", "package-lock.json", "src/a.test.ts", "src/b.test.ts", "src/other.ts"]);
  });

  it.skipIf(!symlinkProbe.file)("refuses a file symlink anywhere in the tree and never starts Docker", async () => {
    const outside = keep(mkdtempSync(join(tmpdir(), "ludion-outside-")));
    writeFileSync(join(outside, "secret.txt"), "secret\n");
    for (const rel of ["src/link.ts", "src/c.test.ts"]) {
      const work = makeWork();
      symlinkSync(join(outside, "secret.txt"), join(work, ...rel.split("/")));
      const beforeSnapshots = snapshotDirs();
      const runner = vi.fn<DockerRunner>(async () => okRun);
      const preRepair = vi.fn(async () => ({ ran: true as const, exit_code: 1, failed_tests: ["x"], passed_tests: [] }));
      const result = await runOn(work, runner, { preRepair });
      expectRefused(result, new RegExp(`symlink in work tree: ${rel}`));
      expect(runner).not.toHaveBeenCalled();
      expect(preRepair).not.toHaveBeenCalled();
      expect(newSince(beforeSnapshots, snapshotDirs())).toEqual([]);
    }
  });

  it.skipIf(!symlinkProbe.junction)("refuses a directory junction or symlink in the tree", async () => {
    const outside = keep(mkdtempSync(join(tmpdir(), "ludion-outside-")));
    writeFileSync(join(outside, "x.test.ts"), applicableTest);
    const work = makeWork();
    symlinkSync(outside, join(work, "linked"), "junction");
    const runner = vi.fn<DockerRunner>(async () => okRun);
    const result = await runOn(work, runner);
    expectRefused(result, /symlink in work tree: linked/);
    expect(runner).not.toHaveBeenCalled();
  });

  it.skipIf(!symlinkProbe.junction)("skips a node_modules junction without following it", async () => {
    const outside = keep(mkdtempSync(join(tmpdir(), "ludion-outside-")));
    writeFileSync(join(outside, "x.test.ts"), "export const x = 1;\n");
    const work = makeWork();
    symlinkSync(outside, join(work, "node_modules"), "junction");
    const runner = vi.fn<DockerRunner>(async () => okRun);
    const result = await runOn(work, runner);
    expect(result.outcome).toBe("executed");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("refuses a hardlinked write target and allows a hardlinked non-target", async () => {
    const outside = keep(mkdtempSync(join(tmpdir(), "ludion-outside-")));
    const target = makeWork();
    linkSync(join(target, "src", "b.test.ts"), join(outside, "b-alias.ts"));
    expect(lstatSync(join(target, "src", "b.test.ts")).nlink).toBe(2);
    const runner = vi.fn<DockerRunner>(async () => okRun);
    const refused = await runOn(target, runner);
    expectRefused(refused, /hardlinked write target \(nlink 2\): src\/b\.test\.ts/);
    expect(runner).not.toHaveBeenCalled();

    const other = makeWork();
    linkSync(join(other, "src", "other.ts"), join(outside, "other-alias.ts"));
    const allowed = await runOn(other, runner);
    expect(allowed.outcome).toBe("executed");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.platform === "win32")("refuses a FIFO in the tree without opening it", async () => {
    const work = makeWork();
    execFileSync("mkfifo", [join(work, "src", "pipe.test.ts")]);
    const runner = vi.fn<DockerRunner>(async () => okRun);
    const result = await runOn(work, runner);
    expectRefused(result, /not a regular file: src\/pipe\.test\.ts/);
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("versions come from the work copy's lockfile", () => {
  const okRun: DockerRunOutcome = { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };

  it("a lockfile with vitest 3.2.4 never runs, even when the caller passes pinned versions", async () => {
    const work = makeWork();
    writeFileSync(join(work, "package-lock.json"), packageLock({ vitest: "3.2.4", vite: "7.1.11" }));
    const runner = vi.fn<DockerRunner>(async () => okRun);
    const preRepair = vi.fn(async () => ({ ran: true as const, exit_code: 1, failed_tests: ["x"], passed_tests: [] }));
    // resolved_versions is not part of ExecuteProgramInput; an untyped caller's value is ignored.
    const untyped = { record: pinnedRecord(), contract_id: CONTRACT_ID, workDir: work, runner, preRepair, node_version: NODE_VERSION, resolved_versions: RESOLVED_VERSIONS };
    const result = await executeProgram(untyped);
    expect(result).toMatchObject({ outcome: "rejected", reason: "version_set_mismatch", docker_invoked: false, model_calls: { count: 0 } });
    if (result.outcome === "rejected") expect(result.detail).toContain("vitest");
    expect(runner).not.toHaveBeenCalled();
    expect(preRepair).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "{ not json"],
    ["lockfileVersion 1", JSON.stringify({ lockfileVersion: 1, dependencies: { vitest: { version: "4.0.0" }, vite: { version: "7.1.11" } } })],
    ["packages is an array", JSON.stringify({ lockfileVersion: 3, packages: [] })],
  ] as const)("a %s lockfile is unknown/lockfile_unreadable and does not run", async (_name, text) => {
    const work = makeWork();
    if (text === undefined) unlinkSync(join(work, "package-lock.json"));
    else writeFileSync(join(work, "package-lock.json"), text);
    const runner = vi.fn<DockerRunner>(async () => okRun);
    const result = await executeProgram({ record: pinnedRecord(), contract_id: CONTRACT_ID, workDir: work, runner, node_version: NODE_VERSION });
    expect(result).toMatchObject({
      outcome: "not_executed",
      reason: "guard_not_applicable",
      guard_status: "unknown",
      guard: { status: "unknown", reason: "lockfile_unreadable" },
      docker_invoked: false,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("a lockfile without vite is rejected by the pin check", async () => {
    const work = makeWork();
    writeFileSync(join(work, "package-lock.json"), packageLock({ vitest: "4.0.0" }));
    const runner = vi.fn<DockerRunner>(async () => okRun);
    const result = await executeProgram({ record: pinnedRecord(), contract_id: CONTRACT_ID, workDir: work, runner, node_version: NODE_VERSION });
    expect(result).toMatchObject({ outcome: "rejected", reason: "version_set_mismatch", docker_invoked: false });
    expect(runner).not.toHaveBeenCalled();
  });

  it("lockfileVersions reads top-level entries only", () => {
    const text = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "x" },
        "node_modules/vitest": { version: "4.0.0" },
        "node_modules/@scope/pkg": { version: "1.2.3" },
        "node_modules/a/node_modules/vitest": { version: "3.2.4" },
        "node_modules/bad": { version: 7 },
        "packages/local": { version: "9.9.9" },
      },
    });
    expect(lockfileVersions(text)).toEqual({ vitest: "4.0.0", "@scope/pkg": "1.2.3" });
    expect(lockfileVersions(JSON.stringify({ lockfileVersion: 2, packages: {} }))).toEqual({});
    expect(lockfileVersions(undefined)).toBeNull();
    expect(lockfileVersions("null")).toBeNull();
  });
});

describe("swap after the snapshot (TOCTOU)", () => {
  const okRun: DockerRunOutcome = { kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false };
  const evidence = { ran: true as const, exit_code: 1, failed_tests: ["history-cleared"], passed_tests: [] };

  async function runSwap(work: string, swap: () => void, outsideFile: string) {
    let mountedReal = "";
    let mountedIsFile = false;
    let mountedText = "";
    const runner = vi.fn<DockerRunner>(async (req) => {
      const mountedTarget = join(mountedWork(req), "src", "a.test.ts");
      mountedReal = realpathSync(mountedTarget);
      mountedIsFile = lstatSync(mountedTarget).isFile();
      mountedText = readFileSync(mountedTarget, "utf8");
      // The program "writes" its target. It must land in the private snapshot, never outside.
      writeFileSync(mountedTarget, `${applicableTest}// written by the program\n`);
      expect(req.args.some((arg) => arg.endsWith(":/work/src/a.test.ts:rw"))).toBe(true);
      return okRun;
    });
    const result = await executeProgram({
      record: pinnedRecord(),
      contract_id: CONTRACT_ID,
      workDir: work,
      runner,
      preRepair: async () => {
        swap();
        return evidence;
      },
      node_version: NODE_VERSION,
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(mountedIsFile).toBe(true);
    expect(mountedText).toBe(applicableTest);
    // The :rw mount source resolved inside this file's private temp root (the executor's snapshot), not outside.
    expect(mountedReal.toLowerCase().startsWith(privateTempRoot.toLowerCase())).toBe(true);
    expect(mountedReal.toLowerCase().startsWith(realpathSync(outsideFile).toLowerCase())).toBe(false);
    expect(readFileSync(outsideFile, "utf8")).toBe("outside\n");
    expect(result).toMatchObject({ outcome: "executed", changed_files: ["src/a.test.ts"] });
    if (result.outcome === "executed") expect(result.evidence.diff[0]?.after).toBe(`${applicableTest}// written by the program\n`);
  }

  it.skipIf(!symlinkProbe.file)("a write target swapped for a symlink after lstat does not redirect the read or the :rw mount", async () => {
    const outside = keep(mkdtempSync(join(tmpdir(), "ludion-outside-")));
    const outsideFile = join(outside, "victim.ts");
    writeFileSync(outsideFile, "outside\n");
    const work = makeWork();
    await runSwap(work, () => {
      unlinkSync(join(work, "src", "a.test.ts"));
      symlinkSync(outsideFile, join(work, "src", "a.test.ts"));
    }, outsideFile);
    expect(readFileSync(join(work, "src", "a.test.ts"), "utf8")).toBe("outside\n");
  });

  it.skipIf(!symlinkProbe.junction)("a directory swapped for a junction after lstat does not redirect the read or the :rw mount", async () => {
    const outside = keep(mkdtempSync(join(tmpdir(), "ludion-outside-")));
    const outsideFile = join(outside, "a.test.ts");
    writeFileSync(outsideFile, "outside\n");
    const work = makeWork();
    const parked = keep(mkdtempSync(join(tmpdir(), "ludion-parked-")));
    await runSwap(work, () => {
      renameSync(join(work, "src"), join(parked, "src"));
      symlinkSync(outside, join(work, "src"), "junction");
    }, outsideFile);
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
