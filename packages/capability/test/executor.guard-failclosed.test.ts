// The executor's own guard call fails closed. evaluateGuard is replaced here so it can throw or
// return null, undefined, or a malformed value; the real guard never does.
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const guardMock = vi.hoisted(() => ({ impl: undefined as undefined | ((record: unknown, input: unknown) => unknown), calls: [] as unknown[] }));

vi.mock("../src/guard.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/guard.ts")>();
  return {
    ...actual,
    evaluateGuard: (record: unknown, input: unknown) => {
      guardMock.calls.push(input);
      if (guardMock.impl === undefined) return actual.evaluateGuard(record, input as Parameters<typeof actual.evaluateGuard>[1]);
      return guardMock.impl(record, input);
    },
  };
});

const { executeProgram, PINNED_VERSION_SET } = await import("../src/index.ts");
const { applicableTest, CONTRACT_ID, exampleArtifact, packageLock, reseal } = await import("./fixtures.ts");
type DockerRunner = import("../src/index.ts").DockerRunner;

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
  guardMock.impl = undefined;
  guardMock.calls.length = 0;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pinnedRecord() {
  const base = exampleArtifact();
  return reseal({ ...base, dependencies: { ...base.dependencies, image: PINNED_VERSION_SET.image } });
}

function applicableWork(): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-work-"));
  temps.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.test.ts"), applicableTest);
  writeFileSync(join(root, "package-lock.json"), packageLock());
  return root;
}

function ludionTemps(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("ludion-program-") || name.startsWith("ludion-snapshot-")));
}

async function run(work: string) {
  const runner = vi.fn<DockerRunner>(async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "", timedOut: false }));
  const preRepair = vi.fn(async () => ({ ran: true as const, exit_code: 1, failed_tests: ["history-cleared"], passed_tests: [] }));
  const result = await executeProgram({
    record: pinnedRecord(),
    contract_id: CONTRACT_ID,
    workDir: work,
    runner,
    preRepair,
    node_version: "v24.8.0",
  });
  return { result, runner, preRepair };
}

describe("guard evaluation fails closed", () => {
  it("the unmocked guard path executes (control)", async () => {
    const { result, runner } = await run(applicableWork());
    expect(result).toMatchObject({ outcome: "executed", guard: { status: "applicable" } });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(guardMock.calls).toHaveLength(1);
  });

  type Impl = () => unknown;
  it.each<[string, Impl, RegExp]>([
    ["null", () => null, /returned null/],
    ["undefined", () => undefined, /returned undefined/],
    ["a throw", (): unknown => {
      throw new Error("guard exploded");
    }, /threw: guard exploded/],
    ["a status-only object", () => ({ status: "applicable" }), /not a guard result/],
    ["applicable with no matches", () => ({ status: "applicable", reason: "all_conditions_met", matches: [], checks: [] }), /not a guard result/],
    ["an unknown status", () => ({ status: "maybe", reason: "x", detail: "x", checks: [] }), /not a guard result/],
    ["a bare string", () => "applicable", /not a guard result/],
  ])("%s returns not_executed and never starts Docker", async (_name, impl, detail) => {
    guardMock.impl = impl;
    const before = ludionTemps();
    const { result, runner, preRepair } = await run(applicableWork());
    expect(guardMock.calls).toHaveLength(1);
    expect(result).toMatchObject({
      outcome: "not_executed",
      reason: "guard_failed",
      guard_status: "unknown",
      guard: null,
      docker_invoked: false,
      pre_repair: null,
      model_calls: { count: 0 },
    });
    if (result.outcome === "not_executed") expect(result.detail).toMatch(detail);
    expect(runner).not.toHaveBeenCalled();
    expect(preRepair).not.toHaveBeenCalled();
    expect([...ludionTemps()].filter((name) => !before.has(name))).toEqual([]);
  });

  it("the guard sees the snapshot's files and the versions from its lockfile", async () => {
    const work = applicableWork();
    writeFileSync(join(work, "src", "other.ts"), "export const other = 1;\n");
    await run(work);
    expect(guardMock.calls).toHaveLength(1);
    expect(guardMock.calls[0]).toMatchObject({
      contract_id: CONTRACT_ID,
      files: { "package-lock.json": packageLock(), "src/a.test.ts": applicableTest, "src/other.ts": "export const other = 1;\n" },
      resolved_versions: { vitest: "4.0.0", vite: "7.1.11" },
    });
  });
});
