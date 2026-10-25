import { describe, expect, it } from "vitest";
import { evaluateGuard, GuardResult } from "../src/index.ts";
import { aliasTest, applicableTest, exampleRecord, guardInput } from "./fixtures.ts";

function judge(source: string) {
  const result = evaluateGuard(exampleRecord(), guardInput({ files: { "src/case.test.ts": source } }));
  expect(GuardResult.safeParse(result).success).toBe(true);
  return result;
}

const head = [
  'import { vi } from "vitest";',
  "afterEach(() => {",
  "  vi.restoreAllMocks();",
  "});",
  "",
].join("\n");

function withExtra(extra: string): string {
  return `${head}${extra}\n`;
}

describe("scanner fails toward unknown", () => {
  it("records a bound name used as a value (B1)", () => {
    const cases = [
      "const { clearAllMocks } = vi; clearAllMocks();",
      "const v2 = vi; v2.clearAllMocks();",
      "const r = vi.restoreAllMocks; r();",
      "foo(vi);",
      "foo(...vi);",
      "const listed = [vi];",
      "const bag = { vi };",
      "const named = { x: vi };",
      "let x; x = vi;",
      "function give() { return vi; }",
    ];
    for (const extra of cases) {
      expect(judge(withExtra(extra)), extra).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    }
  });

  it("rejects a member chain longer than the target (B2)", () => {
    const cases = [
      "vi.clearAllMocks.call(vi);",
      "vi.restoreAllMocks.apply(vi, []);",
      "vi.restoreAllMocks.bind(vi)();",
      "vi.restoreAllMocks.apply(null, []);",
      "vi.restoreAllMocks.bind(null)();",
    ];
    for (const extra of cases) {
      expect(judge(withExtra(extra)), extra).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    }

    const ns = [
      'import * as V from "vitest";',
      "afterEach(() => { V.vi.restoreAllMocks(); });",
      "V.vi.restoreAllMocks.apply(null, []);",
      "",
    ].join("\n");
    expect(judge(ns)).toMatchObject({ status: "unknown", reason: "binding_unresolved" });

    const shadowed = [
      'import { vi } from "vitest";',
      "function setup() { const vi = {}; vi.restoreAllMocks.apply(null, []); }",
      "afterEach(() => { vi.restoreAllMocks(); });",
      "",
    ].join("\n");
    expect(judge(shadowed)).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
  });

  it("treats a var of the bound name as hoisted (B3)", () => {
    const inside = [
      'import { vi } from "vitest";',
      "afterEach(() => { vi.restoreAllMocks(); var vi = {}; });",
      "",
    ].join("\n");
    expect(judge(inside)).toMatchObject({ status: "unknown", reason: "binding_unresolved" });

    const loop = [
      'import { vi } from "vitest";',
      "afterEach(() => { vi.restoreAllMocks(); });",
      "function walk(xs) { for (var vi of xs) {} }",
      "",
    ].join("\n");
    expect(judge(loop)).toMatchObject({ status: "unknown", reason: "binding_unresolved" });

    const hidden = [
      'import { vi } from "vitest";',
      "function hide() { var vi = {}; foo(vi); }",
      "afterEach(() => { vi.restoreAllMocks(); });",
      "",
    ].join("\n");
    expect(judge(hidden)).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    expect(judge(withExtra("var kept = 1, vi = {};"))).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
  });

  it("fails the scan on a backslash in code (B4)", () => {
    expect(judge(withExtra("\\u0076i.clearAllMocks();"))).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(judge(withExtra("v\\u0069.restoreAllMocks();"))).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(judge(withExtra("const bad = `${\\u0076}`;"))).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("fails the scan on with and bare eval", () => {
    expect(judge(withExtra("with (obj) { x; }"))).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(judge(withExtra('eval("1");'))).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(judge(withExtra("const alias = eval;"))).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("records a global object access and the already-unmodeled forms", () => {
    const cases = [
      "globalThis.vi.restoreAllMocks();",
      'globalThis["vi"];',
      "global.vi.restoreAllMocks();",
      "window.vi;",
      'self["vi"];',
      "self.vi.restoreAllMocks();",
      "vi?.restoreAllMocks();",
      "vi.restoreAllMocks?.();",
      'vi["restoreAllMocks"]();',
    ];
    for (const extra of cases) {
      expect(judge(withExtra(extra)), extra).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    }
  });

  it("keeps the applicable and alias fixtures applicable", () => {
    expect(judge(applicableTest)).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    expect(judge(aliasTest)).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    expect(judge(withExtra("vi.fn();"))).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    expect(judge(withExtra("var n = 1;"))).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    expect(judge(withExtra("function g(xs) { for (let vi of xs) {} }"))).toMatchObject({
      status: "applicable",
      reason: "all_conditions_met",
    });
    expect(judge(withExtra("const f = (vi) => 1;"))).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    expect(judge(withExtra("class C { m(vi) { return 1; } }"))).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    expect(judge(withExtra("const obj = {}; obj.eval(); obj.with(1);"))).toMatchObject({
      status: "applicable",
      reason: "all_conditions_met",
    });
    expect(judge(withExtra("const o = { with(x) { return x; } };"))).toMatchObject({
      status: "applicable",
      reason: "all_conditions_met",
    });
    expect(judge(`${head}// eval(\n/* with (x) {} */\n`)).toMatchObject({ status: "applicable", reason: "all_conditions_met" });

    const nonAscii = withExtra("vi\u00e9.restoreAllMocks();");
    expect(judge(nonAscii)).toMatchObject({ status: "applicable", reason: "all_conditions_met" });

    const slash = "\\";
    const safe = [
      'import { vi } from "vitest";',
      `const text = "a${slash}b";`,
      `const tmpl = \`a${slash}b \${1}\`;`,
      `// comment ${slash}`,
      `/* block ${slash} */`,
      `const re = /${slash}w/;`,
      "afterEach(() => { vi.restoreAllMocks(); });",
      "",
    ].join("\n");
    expect(judge(safe)).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
  });

  it("keeps the B1-B4 examples non-applicable inside the target block", () => {
    const inBlock = (body: string) => ['import { vi } from "vitest";', `afterEach(() => { vi.restoreAllMocks(); ${body} });`, ""].join("\n");
    const unresolved = [
      "const { clearAllMocks } = vi; clearAllMocks();",
      "const v2 = vi; v2.clearAllMocks();",
      "vi.clearAllMocks.call(vi);",
      "var vi = {};",
    ];
    for (const body of unresolved) {
      const result = judge(inBlock(body));
      expect(result.status, body).not.toBe("applicable");
      expect(result, body).toMatchObject({ status: "unknown", reason: "binding_unresolved" });
    }
    const escaped = judge(inBlock("\\u0076i.clearAllMocks();"));
    expect(escaped.status).not.toBe("applicable");
    expect(escaped).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("treats Unicode whitespace as whitespace, not identifier text", () => {
    for (const ws of ["\u00a0", "\ufeff", "\u2028", "\u3000"]) {
      const src = ['import { vi } from "vitest";', `afterEach(() => { vi.restoreAllMocks(); vi${ws}.clearAllMocks(); });`, ""].join("\n");
      const result = judge(src);
      expect(result.status, JSON.stringify(ws)).not.toBe("applicable");
      expect(result, JSON.stringify(ws)).toMatchObject({ status: "inapplicable", reason: "already_fixed" });
    }
    expect(judge(`\ufeff${applicableTest}`)).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
  });
});
