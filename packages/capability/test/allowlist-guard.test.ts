import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { evaluateGuard, GuardResult } from "../src/index.ts";
import { MAX_GUARD_FILE_BYTES } from "../src/guard.ts";
import { applicableFiles, applicableTest, clearMocksConfig, exampleRecord, guardInput } from "./fixtures.ts";

function judge(files: Record<string, string>) {
  const result = evaluateGuard(exampleRecord(), guardInput({ files }));
  expect(GuardResult.safeParse(result).success).toBe(true);
  return result;
}

function judgeTest(source: string) {
  return judge({ "src/history.test.ts": source });
}

function judgeConfig(source: string) {
  return judge({ ...applicableFiles(), "vitest.config.ts": source });
}

const config = (body: string) => ['import { defineConfig } from "vitest/config";', `export default defineConfig({ test: { ${body} } });`, ""].join("\n");

describe("allowlist: accepted shapes stay applicable", () => {
  it("accepts a top-level `import { vi } from 'vitest'` with a direct vi.restoreAllMocks() call", () => {
    expect(judgeTest(applicableTest)).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    expect(judgeTest(`#!/usr/bin/env node\n${applicableTest}`)).toMatchObject({ status: "applicable" });
  });

  it("reads a static `clearMocks` boolean in export default defineConfig({...})", () => {
    expect(judgeConfig(clearMocksConfig)).toMatchObject({ status: "inapplicable", reason: "config_excludes" });
    expect(judgeConfig(config("clearMocks: true"))).toMatchObject({ status: "inapplicable", reason: "config_excludes" });
    expect(judgeConfig(config("clearMocks: false"))).toMatchObject({ status: "applicable" });
    expect(judgeConfig(config("include: ['src/**/*.test.ts']"))).toMatchObject({ status: "applicable" });
  });
});

describe("allowlist: reviewer items are not applicable", () => {
  it("1: U+2028/U+2029 in a line comment is parse_failed", () => {
    for (const sep of ["\u2028", "\u2029"]) {
      const fake = ["// x" + sep + "const vi = fake;", 'import { vi } from "vitest";', "afterEach(() => { vi.restoreAllMocks(); });", ""].join("\n");
      expect(judgeTest(fake), JSON.stringify(sep)).toMatchObject({ status: "unknown", reason: "parse_failed" });
      const cfg = ['import { defineConfig } from "vitest/config";', "export default defineConfig({ test: {", "  // x" + sep + "clearMocks: true", "} });", ""].join("\n");
      const result = judgeConfig(cfg);
      expect(result.status, JSON.stringify(sep)).not.toBe("applicable");
      expect(result).toMatchObject({ status: "unknown", reason: "parse_failed" });
    }
  });

  it("2: a config value that is not a single boolean literal is config_not_static", () => {
    for (const value of ["false || true", "0 || 1", "false ? false : true", "1", '"yes"', "!0", "false && x", "`true`"]) {
      expect(judgeConfig(config(`clearMocks: ${value}`)), value).toMatchObject({ status: "unknown", reason: "config_not_static" });
    }
  });

  it("3: test.projects, workspace, or a non-defineConfig default export is config_not_static", () => {
    const cases = [
      config("projects: [{ test: { clearMocks: true } }], clearMocks: false"),
      ['import { defineConfig } from "vitest/config";', "export default defineConfig({ workspace: ['a'], test: { clearMocks: false } });", ""].join("\n"),
      ['import { defineConfig } from "vitest/config";', "const c = defineConfig({ test: { clearMocks: false } });", ""].join("\n"),
      ['import { defineConfig } from "vitest/config";', "const c = defineConfig({ test: { clearMocks: true } });", "export { c as default };", ""].join("\n"),
      ['import { defineConfig } from "vitest/config";', "export = defineConfig({ test: { clearMocks: true } });", ""].join("\n"),
      ["export default {", "  test: { clearMocks: true },", "};", ""].join("\n"),
    ];
    for (const source of cases) {
      expect(judgeConfig(source), source).toMatchObject({ status: "unknown", reason: "config_not_static" });
    }
  });

  it("4: require() or import() of vitest is binding_unresolved", () => {
    const cases = [
      'require("vitest").vi.clearAllMocks();',
      'afterEach(async () => { (await import("vitest")).vi.clearAllMocks(); });',
      'const m = "vitest"; require(m);',
      'import("vitest/config");',
    ];
    for (const extra of cases) {
      expect(judgeTest(`${applicableTest}${extra}\n`), extra).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    }
  });

  it("5: a leading hashbang is a comment; a hashbang elsewhere does not hide code", () => {
    const hidden = ["#!/usr/bin/env node", 'import { vi } from "vitest";', "afterEach(() => { vi.restoreAllMocks(); });", "const vi2 = 1;", ""].join("\n");
    expect(judgeTest(hidden)).toMatchObject({ status: "applicable" });
    const shadow = ["#!/usr/bin/env node", 'import { vi } from "vitest";', "afterEach(() => { vi.restoreAllMocks(); });", "function f() { const vi = {}; }", ""].join("\n");
    expect(judgeTest(shadow)).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    expect(judgeTest(`\n#!x\n${applicableTest}`)).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("6: reassigning defineConfig is config_not_static; `-->` in code is parse_failed", () => {
    const reassigned = ['import { defineConfig } from "vitest/config";', "defineConfig = (c) => ({ test: { clearMocks: true } });", "export default defineConfig({ test: { clearMocks: false } });", ""].join("\n");
    expect(judgeConfig(reassigned)).toMatchObject({ status: "unknown", reason: "config_not_static" });
    const html = ['import { vi } from "vitest";', "afterEach(() => { vi.restoreAllMocks(); });", "--> const vi = {};", ""].join("\n");
    expect(judgeTest(html)).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(judgeTest(`${applicableTest}<!-- x\n`)).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });
});

describe("allowlist: scan time at the 64 KiB limit", () => {
  for (const unit of ["x=>", "(x)=>"]) {
    it(`scans a ${unit} chain of exactly the limit`, () => {
      const head = `${applicableTest}export const f = `;
      const text = `${head}${unit.repeat(Math.ceil(MAX_GUARD_FILE_BYTES / unit.length))}`.slice(0, MAX_GUARD_FILE_BYTES);
      expect(Buffer.byteLength(text, "utf8")).toBe(MAX_GUARD_FILE_BYTES);
      const start = performance.now();
      const result = judgeTest(text);
      const elapsed = performance.now() - start;
      console.log(`64KiB ${unit} chain guard elapsed: ${elapsed.toFixed(1)}ms (${result.status})`);
      expect(result).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
      expect(elapsed).toBeLessThan(2000);
    });
  }
});
