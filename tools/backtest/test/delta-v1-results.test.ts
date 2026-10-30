import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The committed delta v1 results carry no file content and no file path of a malicious version
// (docs/decisions/2026-10-30-ld-delta-v1-definitions.md, section 7; docs/mistakes/2026-10-30-delta-v1-records.md).
const results = JSON.parse(readFileSync(new URL("../../../docs/bench/2026-10-30-delta-v1/delta-v1.json", import.meta.url), "utf8"));
const MALICIOUS_KEYS = new Set(["set", "id", "name", "prev", "version", "sources", "tried", "status", "not_obtained", "undecidable", "capabilities", "size", "shown", "changed_code"]);

describe("delta v1 results", () => {
  const malicious = (results.rows as any[]).filter(r => r.set === "malicious");
  it("hold every malicious version, each with only the fields that carry no path", () => {
    expect(malicious).toHaveLength(1148);
    for (const r of malicious) expect([`${r.name}@${r.version}`, Object.keys(r).filter(k => !MALICIOUS_KEYS.has(k))]).toEqual([`${r.name}@${r.version}`, []]);
  });
  it("give a malicious version's changed code files as capability names and counts only", () => {
    for (const r of malicious.filter(r => r.changed_code)) {
      expect(Object.keys(r.changed_code).sort()).toEqual(["after", "before", "files", "with_previous"]);
      for (const c of [...r.changed_code.before, ...r.changed_code.after]) expect(c).toMatch(/^(?:module|api|code|obf):/);
    }
  });
});
