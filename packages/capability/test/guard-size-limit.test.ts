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

/** `head` followed by a trailing line comment of `unit` repeated, padded with ASCII to exactly `bytes` UTF-8 bytes. */
function padTo(head: string, bytes: number, unit = "a"): string {
  const prefix = `${head}// `;
  const room = bytes - Buffer.byteLength(prefix, "utf8") - 1;
  const unitBytes = Buffer.byteLength(unit, "utf8");
  const body = unit.repeat(Math.floor(room / unitBytes)) + "a".repeat(room % unitBytes);
  const text = `${prefix}${body}\n`;
  expect(Buffer.byteLength(text, "utf8")).toBe(bytes);
  return text;
}

describe("guard input size limit", () => {
  it("is 256 KiB", () => {
    expect(MAX_GUARD_FILE_BYTES).toBe(262_144);
  });

  it("still scans a target file of exactly the limit", () => {
    expect(judge({ "src/history.test.ts": padTo(applicableTest, MAX_GUARD_FILE_BYTES) })).toMatchObject({ status: "applicable", reason: "all_conditions_met" });
    // Multi-byte text is measured in UTF-8 bytes: exactly the limit is still scanned.
    expect(judge({ "src/history.test.ts": padTo(applicableTest, MAX_GUARD_FILE_BYTES, "\u3042") })).toMatchObject({ status: "applicable" });
    expect(judge({ "src/history.test.ts": padTo(applicableTest, MAX_GUARD_FILE_BYTES, "\u{1f600}") })).toMatchObject({ status: "applicable" });
  });

  it("returns unknown/parse_failed quickly for limit+1 bytes, without scanning a quadratic x=> chain", () => {
    const head = `${applicableTest}export const f = `;
    const chain = "x=>".repeat(Math.ceil((MAX_GUARD_FILE_BYTES + 1 - head.length) / 3));
    const text = `${head}${chain}`.slice(0, MAX_GUARD_FILE_BYTES + 1);
    expect(Buffer.byteLength(text, "utf8")).toBe(MAX_GUARD_FILE_BYTES + 1);
    const start = performance.now();
    const result = judge({ "src/history.test.ts": text });
    const elapsed = performance.now() - start;
    console.log(`over-limit guard elapsed: ${elapsed.toFixed(1)}ms`);
    expect(result).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(result.detail).toContain("src/history.test.ts");
    expect(result.detail).toContain(String(MAX_GUARD_FILE_BYTES));
    expect(elapsed).toBeLessThan(1000);
  });

  it("counts UTF-8 bytes, not string length", () => {
    const text = padTo(applicableTest, MAX_GUARD_FILE_BYTES + 1, "\u3042");
    expect(text.length).toBeLessThan(MAX_GUARD_FILE_BYTES);
    expect(judge({ "src/history.test.ts": text })).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("applies to config files and dot-path target files as well", () => {
    expect(judge({ ...applicableFiles(), "vitest.config.ts": padTo(clearMocksConfig, MAX_GUARD_FILE_BYTES + 1) })).toMatchObject({ status: "unknown", reason: "parse_failed" });
    expect(judge({ ...applicableFiles(), "src/.private/a.test.ts": padTo(applicableTest, MAX_GUARD_FILE_BYTES + 1) })).toMatchObject({ status: "unknown", reason: "parse_failed" });
  });

  it("ignores an oversized file that no condition reads", () => {
    expect(judge({ ...applicableFiles(), "src/big.ts": "a".repeat(MAX_GUARD_FILE_BYTES + 1) })).toMatchObject({ status: "applicable" });
  });
});