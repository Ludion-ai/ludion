import { describe, expect, it } from "vitest";
import { canonicalJson, evaluateGuard, GuardResult, sha256Hex } from "../src/index.ts";
import {
  aliasTest,
  alreadyFixedTest,
  applicableFiles,
  applicableTest,
  clearMocksConfig,
  CONTRACT_ID,
  exampleCounterexamples,
  exampleRecord,
  functionConfig,
  globalsTest,
  guardInput,
  localFunctionTest,
} from "./fixtures.ts";

function judge(overrides: Parameters<typeof guardInput>[0] = {}) {
  const result = evaluateGuard(exampleRecord(), guardInput(overrides));
  expect(GuardResult.safeParse(result).success).toBe(true);
  return result;
}

describe("evaluateGuard", () => {
  it("accepts an imported restoreAllMocks call on node 24", () => {
    for (const node_version of ["v24.0.0", "v24.11.1", "24.8.12"]) {
      const result = judge({ node_version });
      expect(result).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
      if (result.status === "applicable") expect(result.matches[0]).toMatchObject({ via: "import", file: "src/history.test.ts" });
    }
  });

  it("does not change the result when similarity changes", () => {
    const low = judge({ similarity: 0 });
    const high = judge({ similarity: 0.99 });
    const omitted = judge();
    expect(high).toEqual(low);
    expect(omitted).toEqual(low);
    expect(low.status).toBe("applicable");

    const missed = judge({ files: { "src/local.test.ts": localFunctionTest }, similarity: 1 });
    expect(missed).toMatchObject({ status: "inapplicable", reason: "target_absent" });
    expect(judge({ files: { "src/local.test.ts": localFunctionTest } })).toEqual(missed);
  });

  it("distinguishes alias, local name, globals, and an existing clearAllMocks", () => {
    const alias = judge({ files: { "src/alias.test.ts": aliasTest } });
    expect(alias).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    if (alias.status === "applicable") expect(alias.matches[0]?.via).toBe("alias");

    expect(judge({ files: { "src/local.test.ts": localFunctionTest } })).toMatchObject({ status: "inapplicable", reason: "target_absent" });
    expect(judge({ files: { "src/global.test.ts": globalsTest } })).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    expect(judge({ files: { "src/fixed.test.ts": alreadyFixedTest } })).toMatchObject({ status: "inapplicable", reason: "already_fixed" });
  });

  it("keeps clearAllMocks in another block applicable and ignores dot-directories", () => {
    const otherBlock = [
      'import { vi } from "vitest";',
      "afterEach(() => {",
      "  vi.restoreAllMocks();",
      "});",
      "beforeEach(() => {",
      "  vi.clearAllMocks();",
      "});",
      "",
    ].join("\n");
    expect(judge({ files: { "src/split.test.ts": otherBlock } }).status).toBe("applicable");

    const hidden = { ".hidden/a.test.ts": applicableTest, "src/.private/a.test.ts": applicableTest };
    expect(judge({ files: hidden })).toMatchObject({ status: "inapplicable", reason: "target_absent" });
  });

  it("resolves a namespace import and rejects a shadowed or type-only binding", () => {
    const ns = [
      'import * as V from "vitest";',
      "afterEach(() => {",
      "  V.vi.restoreAllMocks();",
      "});",
      "",
    ].join("\n");
    const result = judge({ files: { "src/ns.test.ts": ns } });
    expect(result.status).toBe("applicable");

    const typed = [
      'import type { vi } from "vitest";',
      "afterEach(() => {",
      "  vi.restoreAllMocks();",
      "});",
      "",
    ].join("\n");
    expect(judge({ files: { "src/type.test.ts": typed } })).toMatchObject({ status: "unknown", reason: "binding_unresolved" });

    const shadowed = [
      'import { vi } from "vitest";',
      "function setup() {",
      "  const vi = { restoreAllMocks() {} };",
      "  vi.restoreAllMocks();",
      "}",
      "",
    ].join("\n");
    expect(judge({ files: { "src/shadow.test.ts": shadowed } })).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
  });

  it("ignores calls that are only in comments or strings", () => {
    const commented = [
      'import { vi } from "vitest";',
      "// vi.restoreAllMocks()",
      'const sample = "vi.restoreAllMocks()";',
      "",
    ].join("\n");
    expect(judge({ files: { "src/comment.test.ts": commented } })).toMatchObject({ status: "inapplicable", reason: "target_absent" });
  });

  it("reports parse_failed for unbalanced braces", () => {
    const broken = `${applicableTest}afterEach(() => {\n`;
    expect(judge({ files: { "src/broken.test.ts": broken } })).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("reads static config and refuses dynamic config", () => {
    expect(judge({ files: { ...applicableFiles(), "vitest.config.ts": clearMocksConfig } })).toMatchObject({
      status: "inapplicable",
      reason: "config_excludes",
    });
    const plain = [
      "export default {",
      "  test: { clearMocks: true },",
      "};",
      "",
    ].join("\n");
    expect(judge({ files: { ...applicableFiles(), "vite.config.ts": plain } })).toMatchObject({ status: "inapplicable", reason: "config_excludes" });
    expect(judge({ files: { ...applicableFiles(), "vitest.config.ts": functionConfig } })).toMatchObject({
      status: "unknown",
      reason: "config_not_static",
    });
    const spread = [
      "const opts = {};",
      "export default {",
      "  test: { ...opts, clearMocks: false },",
      "};",
      "",
    ].join("\n");
    expect(judge({ files: { ...applicableFiles(), "vitest.config.ts": spread } })).toMatchObject({ status: "unknown", reason: "config_not_static" });
    const merged = [
      'import { mergeConfig } from "vitest/config";',
      "export default mergeConfig({}, { test: { clearMocks: false } });",
      "",
    ].join("\n");
    expect(judge({ files: { ...applicableFiles(), "vitest.config.ts": merged } })).toMatchObject({ status: "unknown", reason: "config_not_static" });
    const absent = [
      'import { defineConfig } from "vitest/config";',
      "export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });",
      "",
    ].join("\n");
    expect(judge({ files: { ...applicableFiles(), "vitest.config.ts": absent } }).status).toBe("applicable");

    const computed = [
      "export default {",
      '  ["test"]: { clearMocks: true },',
      "};",
      "",
    ].join("\n");
    const computedIdent = [
      "const k = 'test';",
      "export default {",
      "  [k]: { clearMocks: true },",
      "};",
      "",
    ].join("\n");
    const dupOuter = [
      "export default {",
      "  test: { clearMocks: false },",
      "  test: { clearMocks: true },",
      "};",
      "",
    ].join("\n");
    const dupInner = [
      "export default {",
      "  test: { clearMocks: false, clearMocks: true },",
      "};",
      "",
    ].join("\n");
    const shorthand = [
      "const test = { clearMocks: true };",
      "export default { test };",
      "",
    ].join("\n");
    for (const source of [computed, computedIdent, dupOuter, dupInner, shorthand]) {
      expect(judge({ files: { ...applicableFiles(), "vitest.config.ts": source } })).toMatchObject({
        status: "unknown",
        reason: "config_not_static",
      });
    }
  });

  it("does not treat a nested config basename as the root config", () => {
    const nested = {
      ...applicableFiles(),
      "packages/x/vitest.config.ts": clearMocksConfig,
    };
    expect(judge({ files: nested })).toMatchObject({ status: "unknown", reason: "config_not_static" });
    expect(judge({
      files: { ...nested, "vitest.config.ts": clearMocksConfig },
    })).toMatchObject({ status: "unknown", reason: "config_not_static" });
    expect(judge({
      files: { ...applicableFiles(), "packages/x/other.ts": "export const x = 1;\n" },
    }).status).toBe("applicable");
  });

  it("classifies package versions, lockfile, contract, and node", () => {
    expect(judge({ resolved_versions: { vitest: "3.2.4", vite: "7.1.11" } })).toMatchObject({
      status: "inapplicable",
      reason: "version_verified_inapplicable",
    });
    expect(judge({ resolved_versions: { vitest: "4.1.11", vite: "7.1.11" } })).toMatchObject({
      status: "unknown",
      reason: "version_unverified",
    });
    expect(judge({ resolved_versions: { vitest: "4.0.0" } })).toMatchObject({ status: "inapplicable", reason: "package_absent" });
    expect(judge({ resolved_versions: null })).toMatchObject({ status: "unknown", reason: "lockfile_unreadable" });
    expect(judge({ contract_id: "reset.implementation" })).toMatchObject({ status: "inapplicable", reason: "contract_mismatch" });
    expect(judge({ contract_id: undefined })).toMatchObject({ status: "unknown", reason: "intent_missing" });
    expect(judge({ node_version: "v22.14.0" })).toMatchObject({ status: "inapplicable", reason: "runtime_mismatch" });
    expect(judge({ node_version: undefined })).toMatchObject({ status: "unknown", reason: "environment_unavailable" });
  });

  it("runs each counterexample fixture to its expected status", () => {
    for (const cx of exampleCounterexamples()) {
      expect(judge({ files: cx.fixture }).status, cx.id).toBe(cx.expected);
    }
    expect(CONTRACT_ID).toBe("mock_cleanup.clear_history");
  });

  it("does not resolve a shadowed parameter, catch binding, or unmodeled access", () => {
    const shadowed = [
      'import { vi } from "vitest";\nconst o = { m(vi) { vi.restoreAllMocks(); } };\n',
      'import { vi } from "vitest";\nclass C { m(vi) { vi.restoreAllMocks(); } }\n',
      'import { vi } from "vitest";\nclass C { async m(vi) { vi.restoreAllMocks(); } }\n',
      'import { vi } from "vitest";\nclass C { set m(vi) { vi.restoreAllMocks(); } }\n',
      'import { vi } from "vitest";\nclass C { get m(vi) { vi.restoreAllMocks(); } }\n',
      'import { vi } from "vitest";\nconst o = { async m(vi) { vi.restoreAllMocks(); } };\n',
      'import { vi } from "vitest";\nconst o = { set m(vi) { vi.restoreAllMocks(); } };\n',
      'import { vi } from "vitest";\nconst o = { get m(vi) { vi.restoreAllMocks(); } };\n',
      'import { vi } from "vitest";\ntry {} catch (vi) { vi.restoreAllMocks(); }\n',
    ];
    for (const source of shadowed) {
      const result = judge({ files: { "src/shadowed.test.ts": source } });
      expect(result.status, source).not.toBe("applicable");
      expect(["unknown", "inapplicable"]).toContain(result.status);
    }

    const positive = [
      'import { vi } from "vitest";',
      "class C { m(other) { return other; } }",
      "afterEach(() => { vi.restoreAllMocks(); });",
      "",
    ].join("\n");
    expect(judge({ files: { "src/positive.test.ts": positive } }).status).toBe("applicable");
    const inMethod = [
      'import { vi } from "vitest";',
      "const o = { m() { vi.restoreAllMocks(); } };",
      "",
    ].join("\n");
    expect(judge({ files: { "src/method-ok.test.ts": inMethod } }).status).toBe("applicable");
    const catchOk = [
      'import { vi } from "vitest";',
      "try {} catch (err) { vi.restoreAllMocks(); }",
      "",
    ].join("\n");
    expect(judge({ files: { "src/catch-ok.test.ts": catchOk } }).status).toBe("applicable");

    const forms = [
      "vi?.restoreAllMocks()",
      "vi.restoreAllMocks?.()",
      'vi["restoreAllMocks"]()',
      "vi[`restoreAllMocks`]()",
      "vi[name]()",
    ];
    for (const call of forms) {
      const only = `import { vi } from "vitest";\nconst name = "restoreAllMocks";\n${call};\n`;
      expect(judge({ files: { "src/unmodeled.test.ts": only } }), call).toMatchObject({
        status: "unknown",
        reason: "binding_unresolved",
      });
      const mixed = `import { vi } from "vitest";\nconst name = "restoreAllMocks";\n${call};\nafterEach(() => { vi.restoreAllMocks(); });\n`;
      expect(judge({ files: { "src/mixed.test.ts": mixed } }), call).toMatchObject({
        status: "unknown",
        reason: "binding_unresolved",
      });
    }
    expect(judge({ files: applicableFiles() }).status).toBe("applicable");
  });

  it("returns unknown for a denylisted write and for a throwing getter", () => {
    const rec = exampleRecord();
    const artifact = structuredClone(rec.artifact);
    artifact.program.effects.writes = ["tools/verify/x.ts"];
    const forged = { ...rec, id: `cap:${sha256Hex(canonicalJson(artifact))}`, artifact };
    const forgedResult = evaluateGuard(forged, guardInput());
    expect(forgedResult).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(GuardResult.safeParse(forgedResult).success).toBe(true);

    const throwing = exampleRecord();
    Object.defineProperty(throwing.artifact.program, "files", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error("files exploded");
      },
    });
    const thrownResult = evaluateGuard(throwing, guardInput());
    expect(thrownResult).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(GuardResult.safeParse(thrownResult).success).toBe(true);

    expect(evaluateGuard(exampleRecord(), guardInput())).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
  });
});
