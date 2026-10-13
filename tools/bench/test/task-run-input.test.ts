import { describe, expect, it } from "vitest";
import { nextRunBudget, reportedCost, resumeRows, runBounds } from "../src/task-run-input.ts";

const identity = { label: "C-project", model: "opus", sync: false, site: null, offline: false, sync_cli_sha256: null, harness_sha: "a".repeat(40), inputs_sha256: "d".repeat(64) };
const summary = () => ({ format: 2, ...identity, rows: [{ id: "vitest-5-0-0-13-c", trial: 1, costUsd: 0.1 }] });
describe("measurement bounds and resume identity", () => {
  it.each(["NaN", "Infinity", "-1", "", "not-a-number"])("refuses invalid spending limits (%s)", (cap) => {
    expect(() => runBounds("C-project", "1", cap, true)).toThrow();
  });
  it.each(["0", "1.5", "NaN", "Infinity", "", "9007199254740992"])("refuses invalid trial counts (%s)", (trials) => {
    expect(() => runBounds("C-project", trials, "1", true)).toThrow();
  });
  it("rejects path labels and retains a valid zero spending cap", () => {
    expect(() => runBounds("../../escape", "1", "1", true)).toThrow("without paths");
    expect(runBounds("C-project", "1", "0", true)).toEqual({ trials: 1, cap: 0 });
  });
  it("passes only the remaining cap instead of another full per-run cap", () => {
    expect(nextRunBudget(2, 1.9)).toBeCloseTo(0.1);
    expect(nextRunBudget(1, 1)).toBe(0);
    expect(nextRunBudget(40, 0)).toBe(2);
    expect(() => nextRunBudget(1, NaN)).toThrow("unknown");
  });
  it("keeps legacy or mixed-condition summaries intact instead of guessing missing identity", () => {
    const data = summary();
    expect(resumeRows(data, identity)).toEqual(data.rows);
    expect(() => resumeRows({ ...data, format: 1 }, identity)).toThrow("Legacy");
    for (const extra of [{ model: "sonnet" }, { sync: true }, { offline: true }, { site: "http://127.0.0.1:8791" }, { harness_sha: "b".repeat(40) }, { sync_cli_sha256: "c".repeat(64) }]) expect(() => resumeRows({ ...data, ...extra }, identity)).toThrow("condition differs");
    expect(data).toEqual(summary());
  });
  it("does not treat unknown, negative, or duplicate saved costs as zero", () => {
    for (const costUsd of [undefined, NaN, -1, "0.1"]) expect(() => resumeRows({ ...summary(), rows: [{ ...summary().rows[0], costUsd }] }, identity)).toThrow("unknown");
    expect(() => resumeRows({ ...summary(), rows: [...summary().rows, ...summary().rows] }, identity)).toThrow("Duplicate");
  });
  it("requires an actual final cost report; missing metadata is unknown, not zero", () => {
    expect(reportedCost(['{"type":"result","total_cost_usd":0}'])).toBe(0);
    expect(reportedCost(['{"type":"result","total_cost_usd":0.1}'])).toBe(0.1);
    expect(reportedCost(['{"type":"result"}'])).toBeUndefined();
    expect(reportedCost(['{"type":"result","total_cost_usd":"0.1"}'])).toBeUndefined();
    expect(reportedCost(['{"type":"result","total_cost_usd":0.1}', '{"type":"result"}'])).toBeUndefined();
  });
});
