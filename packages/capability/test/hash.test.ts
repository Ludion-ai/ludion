import { describe, expect, it } from "vitest";
import { canonicalJson, capabilityId, verifyRecord, type CapabilityArtifactT } from "../src/index.ts";
import { exampleArtifact, exampleLineage, exampleRecord, reseal } from "./fixtures.ts";

describe("canonical JSON", () => {
  it("sorts keys, omits undefined, and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ b: 1, a: undefined, c: 2 })).toBe('{"b":1,"c":2}');
    expect(canonicalJson(["b", "a"])).toBe('["b","a"]');
  });

  it("rejects numbers that are not finite safe integers", () => {
    expect(() => canonicalJson(1.5)).toThrow(/integers/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/integers/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/integers/);
  });
});

describe("capability id", () => {
  it("is stable across key order, newlines, and unicode normalization", () => {
    const base = exampleArtifact();
    const reordered = JSON.parse(canonicalJson(base)) as CapabilityArtifactT;
    expect(capabilityId(reordered)).toBe(capabilityId(base));

    const withOrder: CapabilityArtifactT = { ...base, contract: { ...base.contract } };
    const flipped: CapabilityArtifactT = {
      invalidates_on: base.invalidates_on,
      dependencies: base.dependencies,
      verifier: base.verifier,
      program: base.program,
      guard: base.guard,
      contract: base.contract,
      format: base.format,
    };
    expect(capabilityId(flipped)).toBe(capabilityId(withOrder));

    const lf = structuredClone(base);
    const crlf = structuredClone(base);
    const cr = structuredClone(base);
    lf.program.files["insert-clear.ts"] = "line\nline\n";
    crlf.program.files["insert-clear.ts"] = "line\r\nline\r\n";
    cr.program.files["insert-clear.ts"] = "line\rline\r";
    expect(capabilityId(crlf)).toBe(capabilityId(lf));
    expect(capabilityId(cr)).toBe(capabilityId(lf));

    const nfc = structuredClone(base);
    const nfd = structuredClone(base);
    nfc.contract = { ...nfc.contract, intent: `${"caf\u00e9"} history cleanup for mocks` };
    nfd.contract = { ...nfd.contract, intent: `${"cafe\u0301"} history cleanup for mocks` };
    expect(nfc.contract.intent.normalize("NFC")).toBe(nfd.contract.intent.normalize("NFC"));
    expect(capabilityId(nfd)).toBe(capabilityId(nfc));
  });

  it("ignores lineage and created_at", () => {
    const first = exampleRecord();
    const later = reseal(first.artifact, exampleLineage("2026-11-01T12:00:00Z"));
    const otherOrigin = reseal(first.artifact, {
      ...exampleLineage(),
      derived_from: [{ kind: "trace", hash: "sha256:" + "ab".repeat(32), synthetic: true }],
    });
    expect(later.id).toBe(first.id);
    expect(otherOrigin.id).toBe(first.id);
    expect(capabilityId(later.artifact)).toBe(capabilityId(first.artifact));
  });

  it("changes when program, verifier, or guard changes, and verifyRecord reports the mismatch", () => {
    const rec = exampleRecord();
    expect(verifyRecord(rec)).toEqual({ ok: true });

    const program = structuredClone(rec.artifact);
    const source = program.program.files["insert-clear.ts"];
    expect(source).toBeDefined();
    program.program.files["insert-clear.ts"] = `${source}\n// edited\n`;

    const verifier = structuredClone(rec.artifact);
    verifier.verifier.files["contract.test.mjs"] = "/* different contract */\n";

    const guard = structuredClone(rec.artifact);
    guard.guard = {
      ...guard.guard,
      runtime: { node_major: ["22"] },
    };

    for (const artifact of [program, verifier, guard]) {
      expect(capabilityId(artifact)).not.toBe(rec.id);
      const stale = verifyRecord({ ...rec, artifact });
      expect(stale).toMatchObject({ status: "stale", reason: "artifact_hash_mismatch" });
    }
  });
});
