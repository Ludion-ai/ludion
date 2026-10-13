import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readState, resumeState, saveState, withMeasurementLock, type MeasurementState } from "../src/measurement-state.ts";
import { nextRunBudget } from "../src/task-run-input.ts";
import { preparedInputsHash } from "../src/prepared-inputs.ts";

const identity = { label: "C-project", model: "opus", sync: false, site: null, offline: false, sync_cli_sha256: null, harness_sha: "a".repeat(40), inputs_sha256: "d".repeat(64) };
const state = (): MeasurementState => ({ format: 2, ...identity, trials: 1, correct: 0, runs: 0, spentUsd: 1.9, rows: [], attempts: [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", task_id: "vitest-5-0-0-13-c", trial: 1, status: "complete", costUsd: 1.9 }] });
describe("durable attempt charges", () => {
  it("allows only one same-label invocation until the entire batch completes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-state-lock-"));
    const path = join(dir, "state.json");
    let release!: () => void;
    const held = withMeasurementLock(path, () => new Promise<void>((resolve) => { release = resolve; }));
    let entered = false;
    await expect(withMeasurementLock(path, async () => { entered = true; })).rejects.toThrow("locked");
    expect(entered).toBe(false);
    release();
    await held;
    await withMeasurementLock(path, async () => { entered = true; });
    expect(entered).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });
  it("refuses stale locks and releases ownership after a failed batch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-stale-lock-"));
    const path = join(dir, "state.json");
    writeFileSync(`${path}.lock`, "stale");
    await expect(withMeasurementLock(path, async () => {})).rejects.toThrow("reconcile pending charges");
    const other = join(dir, "other.json");
    await expect(withMeasurementLock(other, async () => { throw new Error("batch failed"); })).rejects.toThrow("batch failed");
    expect(readdirSync(dir)).toEqual(["state.json.lock"]);
  });
  it("does not remove a replacement lock", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-replaced-lock-"));
    const path = join(dir, "state.json");
    await expect(withMeasurementLock(path, async () => { writeFileSync(`${path}.lock`, "replacement"); })).rejects.toThrow("ownership changed");
    expect(readdirSync(dir)).toEqual(["state.json.lock"]);
  });
  it("retains a failed ungraded attempt's cost when resumed", () => {
    const resumed = resumeState(state(), identity);
    expect(resumed.rows).toEqual([]);
    expect(resumed.spent).toBe(1.9);
    expect(nextRunBudget(2, resumed.spent)).toBeCloseTo(0.1);
  });
  it.each(["pending", "unknown"] as const)("blocks an unfinished/unknown-cost attempt (%s)", (status) => {
    const input = state();
    input.spentUsd = 0;
    input.attempts[0] = { ...input.attempts[0]!, status, costUsd: null };
    expect(() => resumeState(input, identity)).toThrow("spending state is unknown");
  });
  it("does not infer zero spend from missing attempts, corrupted totals or unmatched grades", () => {
    expect(() => resumeState({ ...state(), attempts: undefined }, identity)).toThrow("ledger is missing");
    expect(() => resumeState({ ...state(), spentUsd: 0 }, identity)).toThrow("disagrees");
    const row = { id: "vitest-5-0-0-13-c", trial: 1, costUsd: 1.9, attempt_id: "unknown" };
    expect(() => resumeState({ ...state(), rows: [row] }, identity)).toThrow("matching charged attempt");
  });
  it("atomically retains pending state before work and complete charges before grades", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-attempt-state-"));
    const path = join(dir, "state.json");
    const pending = state();
    pending.spentUsd = 0;
    pending.attempts[0] = { ...pending.attempts[0]!, status: "pending", costUsd: null };
    saveState(path, pending);
    expect(() => readState(path, identity)).toThrow("unknown");
    saveState(path, state());
    expect(readState(path, identity).spent).toBe(1.9);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });
});
describe("prepared cache identity", () => {
  it("binds source, assistant instructions and lockfile bytes before allowing resume", () => {
    const cache = mkdtempSync(join(tmpdir(), "ludion-cache-identity-"));
    const project = join(cache, "vitest");
    mkdirSync(project);
    writeFileSync(join(project, "package.json"), '{}');
    writeFileSync(join(project, "source.js"), "unexecuted original");
    const original = preparedInputsHash(cache, ["vitest"]);
    writeFileSync(join(project, "source.js"), "unexecuted changed");
    expect(preparedInputsHash(cache, ["vitest"])).not.toBe(original);
    writeFileSync(join(project, "source.js"), "unexecuted original");
    writeFileSync(join(project, "CLAUDE.md"), "original instructions");
    const withInstructions = preparedInputsHash(cache, ["vitest"]);
    writeFileSync(join(project, "CLAUDE.md"), "changed instructions");
    expect(preparedInputsHash(cache, ["vitest"])).not.toBe(withInstructions);
    writeFileSync(join(project, "package-lock.json"), '{"version":1}');
    const withLock = preparedInputsHash(cache, ["vitest"]);
    writeFileSync(join(project, "package-lock.json"), '{"version":2}');
    expect(preparedInputsHash(cache, ["vitest"])).not.toBe(withLock);
  });
  it("refuses inherited assistant state rather than loading project hooks", () => {
    const cache = mkdtempSync(join(tmpdir(), "ludion-cache-hooks-"));
    mkdirSync(join(cache, "vitest/.claude"), { recursive: true });
    expect(() => preparedInputsHash(cache, ["vitest"])).toThrow("assistant state");
  });
});
