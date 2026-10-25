import { describe, expect, it } from "vitest";
import { checkReceiptReuse, evaluateGuard, GuardResult, validateReceipt, type GuardResultT, type ReceiptT } from "../src/index.ts";
import { applicableFiles, exampleRecord, executedReceipt, guardInput, reuseCurrent } from "./fixtures.ts";

function judge(files: Record<string, string>): GuardResultT {
  const result = evaluateGuard(exampleRecord(), guardInput({ files }));
  expect(GuardResult.safeParse(result).success).toBe(true);
  return result;
}

function executed(): { rec: ReturnType<typeof exampleRecord>; receipt: ReceiptT } {
  const rec = exampleRecord();
  const guard = evaluateGuard(rec, guardInput());
  expect(guard.status).toBe("applicable");
  return { rec, receipt: executedReceipt(rec, guard) };
}

describe("audit P1 regressions", () => {
  it("refuses a regexp and keeps clear division (B5)", () => {
    const hidden = judge({
      "src/history.test.ts": 'import { vi } from "vitest"; const ready=true;const text=""; if (ready) /vi.restoreAllMocks()/.test(text);',
    });
    expect(hidden.status).not.toBe("applicable");
    expect(hidden).toMatchObject({ status: "unknown", reason: "parse_failed" });

    const keyword = judge({
      "src/history.test.ts": 'import { vi } from "vitest"; afterEach(() => { vi.restoreAllMocks(); return /vi.restoreAllMocks()/.test(""); });\n',
    });
    expect(keyword.status).not.toBe("applicable");
    expect(keyword).toMatchObject({ status: "unknown", reason: "parse_failed" });

    const half = judge({
      "src/history.test.ts": 'import { vi } from "vitest"; const total = 4; const half = total / 2; afterEach(() => { vi.restoreAllMocks(); });\n',
    });
    expect(half).toMatchObject({ status: "applicable", reason: "all_conditions_met" });

    const indexed = judge({
      "src/history.test.ts": 'import { vi } from "vitest"; const a = [4]; const b = 2; const q = a[0] / b; afterEach(() => { vi.restoreAllMocks(); });\n',
    });
    expect(indexed).toMatchObject({ status: "applicable", reason: "all_conditions_met" });

    const paren = judge({
      "src/history.test.ts": 'import { vi } from "vitest"; const a = 4; const q = (a) / 2; afterEach(() => { vi.restoreAllMocks(); });\n',
    });
    expect(paren.status).not.toBe("applicable");
    expect(paren).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("treats an ASI const as an unresolved shadow (B6)", () => {
    const asi = [
      'import { vi as v } from "vitest"',
      "function cleanup(){",
      "const x=1",
      "const v={restoreAllMocks(){}}",
      "v.restoreAllMocks()",
      "}",
    ].join("\n");
    const aliased = judge({ "src/history.test.ts": asi });
    expect(aliased.status).not.toBe("applicable");
    expect(aliased).toMatchObject({ status: "unknown", reason: "binding_unresolved" });

    const before = [
      'import { vi as v } from "vitest"',
      "function cleanup(){",
      "v.restoreAllMocks()",
      "const x=1",
      "const v={restoreAllMocks(){}}",
      "}",
    ].join("\n");
    const early = judge({ "src/history.test.ts": before });
    expect(early.status).not.toBe("applicable");
    expect(early).toMatchObject({ status: "unknown", reason: "binding_unresolved" });

    const unaliased = [
      'import { vi } from "vitest"',
      "function cleanup(){",
      "const x=1",
      "const vi={restoreAllMocks(){}}",
      "vi.restoreAllMocks()",
      "}",
    ].join("\n");
    const localVi = judge({ "src/history.test.ts": unaliased });
    expect(localVi.status).not.toBe("applicable");
    expect(localVi).toMatchObject({ status: "unknown", reason: "binding_unresolved" });

    const semis = [
      'import { vi as v } from "vitest";',
      "function cleanup(){",
      "const x=1;",
      "const v={restoreAllMocks(){}};",
      "v.restoreAllMocks();",
      "}",
    ].join("\n");
    const punctuated = judge({ "src/history.test.ts": semis });
    expect(punctuated.status).not.toBe("applicable");
    expect(punctuated).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
  });

  it("trusts defineConfig only from vitest/config or vite (B7)", () => {
    const wrapped = judge({
      ...applicableFiles(),
      "vitest.config.ts": 'import {makeConfig as defineConfig} from "./custom"; export default defineConfig({test:{clearMocks:false}});',
    });
    expect(wrapped.status).not.toBe("applicable");
    expect(wrapped).toMatchObject({ status: "unknown", reason: "config_not_static" });

    const otherModule = judge({
      ...applicableFiles(),
      "vitest.config.ts": 'import { defineConfig } from "./custom"; export default defineConfig({test:{clearMocks:false}});',
    });
    expect(otherModule.status).not.toBe("applicable");
    expect(otherModule).toMatchObject({ status: "unknown", reason: "config_not_static" });

    const noImport = judge({
      ...applicableFiles(),
      "vitest.config.ts": "export default defineConfig({test:{clearMocks:false}});",
    });
    expect(noImport.status).not.toBe("applicable");
    expect(noImport).toMatchObject({ status: "unknown", reason: "config_not_static" });

    const local = [
      'import { defineConfig } from "vitest/config";',
      "const defineConfig = (config) => config;",
      "export default defineConfig({ test: { clearMocks: false } });",
      "",
    ].join("\n");
    const declared = judge({ ...applicableFiles(), "vitest.config.ts": local });
    expect(declared.status).not.toBe("applicable");
    expect(declared).toMatchObject({ status: "unknown", reason: "config_not_static" });

    const otherCall = [
      'import { defineConfig } from "vitest/config";',
      "export default mergeConfig({ test: { clearMocks: false } });",
      "",
    ].join("\n");
    const merged = judge({ ...applicableFiles(), "vitest.config.ts": otherCall });
    expect(merged.status).not.toBe("applicable");
    expect(merged).toMatchObject({ status: "unknown", reason: "config_not_static" });

    const fromVite = [
      'import { mergeConfig, defineConfig } from "vite";',
      "export default defineConfig({ test: { clearMocks: true } });",
      "",
    ].join("\n");
    expect(judge({ ...applicableFiles(), "vite.config.ts": fromVite })).toMatchObject({
      status: "inapplicable",
      reason: "config_excludes",
    });

    const plain = ["export default {", "  test: { clearMocks: true },", "};", ""].join("\n");
    expect(judge({ ...applicableFiles(), "vitest.config.ts": plain })).toMatchObject({
      status: "inapplicable",
      reason: "config_excludes",
    });
  });

  it("rejects verifier counts that do not add up (B8)", () => {
    const { rec, receipt } = executed();
    expect(validateReceipt(receipt).success).toBe(true);
    expect(checkReceiptReuse(receipt, rec, reuseCurrent(rec))).toEqual({ reusable: true });
    if (receipt.outcome !== "executed") throw new Error("expected an executed receipt");

    const low = {
      ...receipt,
      verifier: { ...receipt.verifier, tests: { ...receipt.verifier.tests, total: 0 } },
    };
    expect(low.verifier.tests).toMatchObject({ total: 0, passed: 3, failed: 0, skipped: 0, todo: 0 });
    expect(validateReceipt(low).success).toBe(false);
    expect(checkReceiptReuse(low, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "invalid_receipt" });

    const high = {
      ...receipt,
      verifier: { ...receipt.verifier, tests: { ...receipt.verifier.tests, total: 4 } },
    };
    expect(validateReceipt(high).success).toBe(false);
    expect(checkReceiptReuse(high, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "invalid_receipt" });

    const summed = {
      ...receipt,
      verifier: {
        ...receipt.verifier,
        status: "failed" as const,
        exit_code: 1,
        tests: { total: 3, passed: 3, failed: 1, skipped: 0, todo: 0 },
        required_passed: ["history-cleared"],
      },
    };
    expect(validateReceipt(summed).success).toBe(false);
    expect(checkReceiptReuse(summed, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "invalid_receipt" });

    const balanced = {
      ...receipt,
      verifier: {
        ...receipt.verifier,
        status: "failed" as const,
        exit_code: 1,
        tests: { total: 4, passed: 2, failed: 1, skipped: 1, todo: 0 },
        required_passed: ["history-cleared"],
      },
    };
    expect(validateReceipt(balanced).success).toBe(true);
    expect(checkReceiptReuse(balanced, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "not_verified" });

    const longer = {
      ...receipt,
      verifier: {
        ...receipt.verifier,
        tests: { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0 },
        required_passed: ["history-cleared", "spy-restored", "impl-kept"],
      },
    };
    expect(validateReceipt(longer).success).toBe(false);
    expect(checkReceiptReuse(longer, rec, reuseCurrent(rec))).toMatchObject({ reusable: false, reason: "invalid_receipt" });
  });

  it("returns invalid_record for a lone surrogate and does not throw (B9)", () => {
    const rec = exampleRecord();
    const ok = evaluateGuard(rec, guardInput());
    expect(ok.status).toBe("applicable");
    const bad = structuredClone(rec);
    bad.artifact.contract.intent += "\uD800";

    const guard = evaluateGuard(bad, guardInput());
    expect(guard.status).not.toBe("applicable");
    expect(guard).toMatchObject({ status: "unknown", reason: "parse_failed" });

    const reuse = checkReceiptReuse(executedReceipt(rec, ok), bad, reuseCurrent(rec));
    expect(reuse).toMatchObject({ reusable: false, reason: "invalid_record" });
    if (!("reusable" in reuse) || reuse.reusable || !("detail" in reuse)) throw new Error("expected invalid_record");
    expect(reuse.detail).toContain("well-formed");
  });
});
