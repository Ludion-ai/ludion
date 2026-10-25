import { describe, expect, it, vi } from "vitest";
import {
  capabilityId,
  checkReceiptReuse,
  counterexamplesHash,
  evaluateGuard,
  EXECUTABLE,
  programHash,
  runIfExecutable,
  sha256Hex,
  imageDigest,
  validateReceipt,
  verifierHash,
  type GuardResultT,
} from "../src/index.ts";
import { exampleCounterexamples, exampleRecord, executedReceipt, guardInput, notExecutedReceipt, receiptDraft, reseal, reuseCurrent } from "./fixtures.ts";

function applicable(): GuardResultT {
  const result = evaluateGuard(exampleRecord(), guardInput());
  expect(result.status).toBe("applicable");
  return result;
}

const inapplicable: GuardResultT = { status: "inapplicable", reason: "target_absent", detail: "no target", checks: [] };
const unknown: GuardResultT = { status: "unknown", reason: "intent_missing", detail: "no contract", checks: [] };
const stale: GuardResultT = { status: "stale", reason: "program_changed", detail: "program moved", checks: [] };

describe("execution gate", () => {
  it("never runs unknown, stale, or inapplicable results", () => {
    const runner = vi.fn(() => "ran");
    expect(EXECUTABLE(inapplicable)).toBe(false);
    expect(EXECUTABLE(unknown)).toBe(false);
    expect(EXECUTABLE(stale)).toBe(false);
    expect(runIfExecutable(inapplicable, runner)).toBeUndefined();
    expect(runIfExecutable(unknown, runner)).toBeUndefined();
    expect(runIfExecutable(stale, runner)).toBeUndefined();
    expect(runner).not.toHaveBeenCalled();

    const ok = applicable();
    expect(EXECUTABLE(ok)).toBe(true);
    expect(runIfExecutable(ok, runner)).toBe("ran");
    expect(runner).toHaveBeenCalledOnce();
  });

  it("rejects a receipt that executes when the guard is not applicable", () => {
    const rec = exampleRecord();
    const ok = applicable();
    expect(validateReceipt(executedReceipt(rec, ok)).success).toBe(true);
    for (const guard of [inapplicable, unknown, stale]) {
      expect(validateReceipt(receiptDraft(rec, guard, { outcome: "executed" })).success).toBe(false);
      expect(validateReceipt(receiptDraft(rec, guard, {
        outcome: "not_executed",
        verifier: { status: "failed", exit_code: 1, tests: { total: 1, passed: 0, failed: 1, skipped: 0, todo: 0 }, required_passed: [], protected_paths_modified: [] },
      })).success).toBe(false);
      expect(validateReceipt(receiptDraft(rec, guard, {
        outcome: "not_executed",
        diff: { ref: "changes.patch", hash: sha256Hex("diff"), files_changed: 1 },
      })).success).toBe(false);
    }
    const idle = receiptDraft(rec, inapplicable, {
      outcome: "not_executed",
      runtime: null,
      verifier: null,
      verifier_runtime: null,
      diff: null,
    });
    expect(validateReceipt(idle).success).toBe(true);
  });
});

describe("verified receipt", () => {
  it("rejects skip, todo, failed, bad exit, zero passes, protected edits, and an empty diff", () => {
    const rec = exampleRecord();
    const guard = applicable();
    const base = executedReceipt(rec, guard);
    const verifier = base.verifier;
    if (!verifier) throw new Error("fixture verifier missing");
    expect(validateReceipt({ ...base, verifier: { ...verifier, tests: { ...verifier.tests, skipped: 1, total: 4 } } }).success).toBe(false);
    expect(validateReceipt({ ...base, verifier: { ...verifier, tests: { ...verifier.tests, todo: 1, total: 4 } } }).success).toBe(false);
    expect(validateReceipt({ ...base, verifier: { ...verifier, tests: { ...verifier.tests, failed: 1, passed: 2 } } }).success).toBe(false);
    expect(validateReceipt({ ...base, verifier: { ...verifier, exit_code: 1 } }).success).toBe(false);
    expect(validateReceipt({ ...base, verifier: { ...verifier, tests: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 } } }).success).toBe(false);
    expect(validateReceipt({ ...base, verifier: { ...verifier, protected_paths_modified: [".ludion-verify/contract.test.mjs"] } }).success).toBe(false);
    expect(validateReceipt({ ...base, diff: null }).success).toBe(false);
    expect(validateReceipt({ ...base, diff: { ref: "changes.patch", hash: sha256Hex("diff"), files_changed: 0 } }).success).toBe(false);
    expect(validateReceipt({ ...base, verifier_runtime: null }).success).toBe(false);
    expect(validateReceipt({ ...base, runtime: null }).success).toBe(false);
  });
});

describe("receipt reuse", () => {
  it("stays reusable across a node patch and goes stale for each recorded change", () => {
    const rec = exampleRecord();
    const receipt = executedReceipt(rec, applicable());
    expect(checkReceiptReuse(receipt, rec, reuseCurrent(rec, "v24.11.0"))).toEqual({ reusable: true });
    expect(checkReceiptReuse(receipt, rec, reuseCurrent(rec, "v24.0.1"))).toEqual({ reusable: true });

    const program = structuredClone(rec.artifact);
    const source = program.program.files["insert-clear.ts"] ?? "";
    program.program.files["insert-clear.ts"] = `${source}\n// changed\n`;
    const programRec = reseal(program, rec.lineage);
    expect(checkReceiptReuse(receipt, programRec, reuseCurrent(programRec))).toMatchObject({ status: "stale", reason: "program_changed" });
    expect(programHash(programRec.artifact.program)).not.toBe(receipt.program_hash);

    const verifier = structuredClone(rec.artifact);
    verifier.verifier.files["contract.test.mjs"] = "/* edited */\n";
    const verifierRec = reseal(verifier, rec.lineage);
    expect(checkReceiptReuse(receipt, verifierRec, reuseCurrent(verifierRec))).toMatchObject({ status: "stale", reason: "verifier_changed" });
    expect(verifierHash(verifierRec.artifact.verifier)).not.toBe(receipt.verifier_hash);

    expect(checkReceiptReuse(receipt, rec, { ...reuseCurrent(rec), lockfile_hash: sha256Hex("other-lock") })).toMatchObject({
      status: "stale",
      reason: "lockfile_changed",
    });
    expect(checkReceiptReuse(receipt, rec, { ...reuseCurrent(rec), source_tree_hash: sha256Hex("other-src") })).toMatchObject({
      status: "stale",
      reason: "source_changed",
    });

    const dep = `cap:${sha256Hex("dependency")}`;
    const withDep = reseal({
      ...structuredClone(rec.artifact),
      dependencies: { capabilities: [dep], image: rec.artifact.dependencies.image },
    }, rec.lineage);
    expect(checkReceiptReuse(receipt, withDep, { ...reuseCurrent(rec), dependency_ids: [] })).toMatchObject({
      status: "stale",
      reason: "dependency_changed",
    });
    expect(checkReceiptReuse(receipt, rec, { ...reuseCurrent(rec), dependency_ids: [dep] })).toMatchObject({
      status: "stale",
      reason: "dependency_changed",
    });

    expect(checkReceiptReuse(receipt, rec, reuseCurrent(rec, "v22.14.0"))).toMatchObject({ status: "stale", reason: "runtime_changed" });
    expect(capabilityId(rec.artifact)).toBe(rec.id);
  });

  it("compares omitted dependency ids with an empty array", () => {
    const rec = exampleRecord();
    const receipt = executedReceipt(rec, applicable());
    const { dependency_ids: _ids, ...omitted } = reuseCurrent(rec);
    expect(checkReceiptReuse(receipt, rec, omitted)).toEqual({ reusable: true });

    const dep = `cap:${sha256Hex("omitted-dependency")}`;
    const withDep = reseal({
      ...structuredClone(rec.artifact),
      dependencies: { capabilities: [dep], image: rec.artifact.dependencies.image },
    }, rec.lineage);
    const { dependency_ids: _drop, ...omittedDep } = reuseCurrent(withDep);
    expect(checkReceiptReuse(receipt, withDep, omittedDep)).toMatchObject({
      status: "stale",
      reason: "dependency_changed",
    });
  });

  it("goes stale when a counterexample is added and does not change the capability id", () => {
    const rec = exampleRecord();
    const receipt = executedReceipt(rec, applicable());
    const added = { ...rec, counterexamples: exampleCounterexamples() };
    expect(added.id).toBe(rec.id);
    expect(counterexamplesHash(added.counterexamples)).not.toBe(receipt.counterexamples_hash);
    expect(checkReceiptReuse(receipt, added, reuseCurrent(added))).toMatchObject({ status: "stale", reason: "counterexample_added" });
  });

  it("requires an executed verified receipt, every required test, and the same image", () => {
    const rec = exampleRecord();
    const guard = applicable();
    const good = executedReceipt(rec, guard);
    expect(checkReceiptReuse(good, rec, reuseCurrent(rec, "v24.11.0"))).toEqual({ reusable: true });
    expect(checkReceiptReuse(good, rec, reuseCurrent(rec, "v24.0.1"))).toEqual({ reusable: true });
    expect(checkReceiptReuse(good, rec, reuseCurrent(rec, "v22.14.0"))).toMatchObject({ status: "stale", reason: "runtime_changed" });

    const idle = notExecutedReceipt(rec, inapplicable);
    expect(checkReceiptReuse(idle, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "not_executed" });

    if (good.outcome !== "executed") throw new Error("fixture receipt was not executed");
    const failed = executedReceipt(rec, guard, {
      verifier: {
        ...good.verifier,
        status: "failed",
        exit_code: 1,
        tests: { total: 3, passed: 2, failed: 1, skipped: 0, todo: 0 },
        required_passed: [],
      },
    });
    expect(checkReceiptReuse(failed, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "not_verified" });

    const missing = executedReceipt(rec, guard, {
      verifier: { ...good.verifier, required_passed: ["history-cleared", "spy-restored"] },
    });
    expect(checkReceiptReuse(missing, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "required_tests_missing" });

    const other = `node@sha256:${"b".repeat(64)}`;
    const mismatched = executedReceipt(rec, guard, {
      runtime: { ...good.runtime, image: other, image_digest: imageDigest(other) },
    });
    expect(checkReceiptReuse(mismatched, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "image_mismatch" });

    expect(checkReceiptReuse({ outcome: "executed" }, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "invalid_receipt" });
    expect(checkReceiptReuse(good, { ...rec, id: "not-an-id" }, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "invalid_record" });
  });

  it("rejects a not_executed receipt that still carries a verifier and a verified result with no required_passed", () => {
    const rec = exampleRecord();
    const guard = applicable();
    const good = executedReceipt(rec, guard);
    if (good.outcome !== "executed") throw new Error("fixture receipt was not executed");
    expect(validateReceipt(receiptDraft(rec, inapplicable, {
      outcome: "not_executed",
      runtime: null,
      verifier: good.verifier,
      verifier_runtime: null,
      diff: null,
    })).success).toBe(false);
    expect(validateReceipt({ ...good, verifier: { ...good.verifier, required_passed: [] } }).success).toBe(false);
  });
});
