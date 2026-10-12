import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkedFiles, gradeRuntime, snapshotProject } from "../src/runtime-tasks.ts";
import { checkoutArgs } from "../src/checkout-command.ts";

describe("optional runtime acceptance boundary", () => {
  it("does not invoke Docker for an unsupported task or report it as wrong", async () => {
    let calls = 0;
    expect((await gradeRuntime("wrangler-unsupported", {}, {}, async () => { calls++; throw new Error(); })).verdict).toBe("unsupported");
    expect(calls).toBe(0);
  });
  it("distinguishes Docker failure/timeout from an observed acceptance failure", async () => {
    const id = "vitest-5-0-0-13-c";
    expect((await gradeRuntime(id, {}, {}, async () => ({ kind: "error", reason: "Docker missing" }))).verdict).toBe("error");
    expect((await gradeRuntime(id, {}, {}, async () => ({ kind: "done", exitCode: 137, timedOut: true, stdout: "", stderr: "" }))).verdict).toBe("error");
    expect((await gradeRuntime(id, {}, {}, async () => ({ kind: "done", exitCode: 2, timedOut: false, stdout: "", stderr: "subprocess timeout" }))).verdict).toBe("error");
    expect((await gradeRuntime(id, {}, {}, async () => ({ kind: "done", exitCode: 1, timedOut: false, stdout: "", stderr: "wrong test selection" }))).verdict).toBe("failed");
    expect((await gradeRuntime(id, {}, {}, async () => ({ kind: "done", exitCode: 0, timedOut: false, stdout: "", stderr: "" }))).verdict).toBe("error");
    for (const exitCode of [125, 126, 127]) expect((await gradeRuntime(id, {}, {}, async () => ({ kind: "done", exitCode, timedOut: false, stdout: "", stderr: "Docker launch failed" }))).verdict).toBe("error");
  });
  it("parses the supported quoted/equals filters as argv", () => {
    expect(checkoutArgs('vitest run src/cart.test.js -t "cart > checkout"')).toEqual(['run', 'src/cart.test.js', '-t', 'cart > checkout']);
    expect(checkoutArgs("vitest run --testNamePattern='^cart.*checkout$'")).toEqual(['run', '--testNamePattern=^cart.*checkout$']);
  });
  it.each([
    'vitest run -t cart; node fake.js', 'vitest run -t cart && echo forged',
    'vitest run -t "$(touch sentinel)"', 'vitest run -t "cart" --reporter=fake.js',
    'vitest run -t "cart" --config fake.js', 'vitest run -t "cart',
    'vitest run -t cart --outputFile=fake.json', 'node fake.js',
  ])("refuses shell execution/config/report overrides (%s)", (text) => {
    expect(() => checkoutArgs(text)).toThrow();
  });
  it.each(["../outside.js", "/outside.js", "src/../../outside.js", "node_modules/secret.js", "src\\outside.js", "C:/outside.js"])("refuses unsafe serialized paths (%s)", (path) => {
    expect(() => checkedFiles({ [path]: "unexecuted text" })).toThrow();
  });
  it("bounds file count and content", () => {
    expect(() => checkedFiles({ "src/a.js": "a".repeat(512 * 1024 + 1) })).toThrow("too large");
    expect(() => checkedFiles(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`src/${i}.js`, ""])))).toThrow("Too many");
  });
  it("only reads candidate text, ignores dependencies, and refuses links", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-runtime-input-"));
    writeFileSync(join(dir, "package.json"), '{}');
    writeFileSync(join(dir, "unexecuted.js"), "throw new Error('Never run me on host');");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules/secret.js"), "ignored");
    expect(snapshotProject(dir)).toEqual({ "package.json": '{}', "unexecuted.js": "throw new Error('Never run me on host');" });
    symlinkSync(join(dir, "node_modules"), join(dir, "linked"), "junction");
    expect(() => snapshotProject(dir)).toThrow("symbolic links");
  });
});
