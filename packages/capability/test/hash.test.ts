import { describe, expect, it } from "vitest";
import { CapabilityArtifact, canonicalJson, capabilityId, dependenciesHash, verifierHash, verifyRecord, type CapabilityArtifactT } from "../src/index.ts";
import { exampleArtifact, exampleArtifactInput, exampleLineage, exampleRecord, reseal } from "./fixtures.ts";

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
  it("is stable across key order and changes when bytes or normalization differ", () => {
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
    lf.program.files["insert-clear.ts"] = "a\nb";
    crlf.program.files["insert-clear.ts"] = "a\r\nb";
    cr.program.files["insert-clear.ts"] = "\r";
    const lfOnly = structuredClone(base);
    lfOnly.program.files["insert-clear.ts"] = "\n";
    expect(capabilityId(crlf)).not.toBe(capabilityId(lf));
    expect(capabilityId(cr)).not.toBe(capabilityId(lfOnly));

    const nfcFile = structuredClone(base);
    const nfdFile = structuredClone(base);
    nfcFile.program.files["insert-clear.ts"] = "\u00e9";
    nfdFile.program.files["insert-clear.ts"] = "e\u0301";
    expect(capabilityId(nfdFile)).not.toBe(capabilityId(nfcFile));

    const nfc = structuredClone(base);
    const nfd = structuredClone(base);
    nfc.contract = { ...nfc.contract, intent: `${"caf\u00e9"} history cleanup for mocks` };
    nfd.contract = { ...nfd.contract, intent: `${"cafe\u0301"} history cleanup for mocks` };
    expect(nfc.contract.intent.normalize("NFC")).toBe(nfd.contract.intent.normalize("NFC"));
    expect(capabilityId(nfd)).not.toBe(capabilityId(nfc));
  });

  it("rejects a CR or NFD path and a lone surrogate, and parses defaults before hashing", () => {
    expect(() => canonicalJson("\uD800")).toThrow(/well-formed/);
    expect(() => canonicalJson({ "\uD800": 1 })).toThrow(/well-formed/);
    const surrogate = exampleArtifact();
    surrogate.program.files["insert-clear.ts"] = "\uD800";
    expect(() => capabilityId(surrogate)).toThrow();

    const crPath = exampleArtifactInput();
    crPath.program.files["insert\r.ts"] = "x";
    expect(CapabilityArtifact.safeParse(crPath).success).toBe(false);
    const nfdPath = exampleArtifactInput();
    nfdPath.program.files["cafe\u0301.ts"] = "x";
    expect(CapabilityArtifact.safeParse(nfdPath).success).toBe(false);

    const input = exampleArtifactInput();
    const contract = { ...input.contract } as { excludes?: string[] };
    delete contract.excludes;
    const packages = input.guard.packages.map((pkg) => {
      const next = { ...pkg } as { inapplicable_versions?: string[] };
      delete next.inapplicable_versions;
      return next;
    });
    const structure = input.guard.structure.map((condition) => {
      if (condition.kind !== "call") return condition;
      const target = { ...condition.target } as { member?: string[] };
      delete target.member;
      return { ...condition, target };
    });
    const { capabilities: _capabilities, ...dependencies } = input.dependencies;
    const partial = { ...input, contract, guard: { ...input.guard, packages, structure }, dependencies };
    const parsed = CapabilityArtifact.parse(partial);
    expect(parsed.contract.excludes).toEqual([]);
    expect(parsed.dependencies.capabilities).toEqual([]);
    expect(parsed.guard.packages.every((pkg) => Array.isArray(pkg.inapplicable_versions))).toBe(true);
    expect(parsed.guard.structure.filter((condition) => condition.kind === "call").every((condition) => condition.kind === "call" && condition.target.member.length === 0)).toBe(true);
    expect(canonicalJson(partial)).not.toBe(canonicalJson(parsed));
    expect(capabilityId(partial)).toBe(capabilityId(parsed));
    expect(() => capabilityId({ ...input, format: "capability/0" })).toThrow();

    const { protected_paths: _protected, ...verifierRest } = input.verifier;
    expect(verifierHash(verifierRest)).toBe(verifierHash({ ...verifierRest, protected_paths: [] }));
    expect(dependenciesHash(dependencies)).toBe(dependenciesHash({ ...dependencies, capabilities: [] }));
    const loose = { ...exampleRecord() } as { counterexamples?: unknown; id: string };
    delete loose.counterexamples;
    expect(verifyRecord(loose)).toEqual({ ok: true });
    expect(() => verifyRecord({ ...exampleRecord(), id: "not-an-id" })).toThrow();
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
