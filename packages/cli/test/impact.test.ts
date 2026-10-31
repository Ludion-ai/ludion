// Impact Classes (docs/decisions/2026-10-31-impact-classes.md, docs/decisions/2026-10-31-impact-classes-trap-published-record.md,
// docs/decisions/2026-10-31-impact-classes-cvss-vector.md): the fixed CWE table and each CWE's set of classes, the CVSS
// vectors that choose among them, the strength order, trap as a published record (MAL- id or alias, CWE-506), GHSA
// severity only, and the protection record's table in English and Japanese, with traps apart from stops that could not be verified.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CWE_CLASSES, DECIDED_UNCLASSIFIED, IMPACT_ORDER, TRAP_CWE, classify, codeSpan, renderRecord, type ImpactClass, type RecordRow, type StopReason } from "../src/security/impact.ts";

const record = (cwes: unknown, extra: Record<string, unknown> = {}) => ({ id: "GHSA-xxxx-xxxx-xxxx", database_specific: { cwe_ids: cwes, ...extra } });
const MAPPED = ["takeover", "impersonate", "steal", "alter", "disrupt"] as const;
/** The first CWE of the table whose set is exactly this one class. */
const only = (cls: (typeof MAPPED)[number]) => CWE_CLASSES.find(([classes]) => classes.length === 1 && classes[0] === cls)![1][0]!;
const v3 = (cia: string) => ({ type: "CVSS_V3", score: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/${cia}` });
const v4 = (metrics: string) => ({ type: "CVSS_V4", score: `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/${metrics}` });
const withVectors = (cwes: string[], ...severity: unknown[]) => ({ ...record(cwes), severity });

describe("the CWE table", () => {
  it("gives a CWE whose set is one class that class, with no vector", () => {
    for (const [classes, ids] of CWE_CLASSES) if (classes.length === 1) for (const id of ids) expect([id, classify(record([`CWE-${id}`])).class]).toEqual([id, classes[0]]);
  });

  it("leaves a CWE whose set has two or more classes unclassified with no vector, and gives it the strongest when the vector allows all", () => {
    let open = 0;
    for (const [classes, ids] of CWE_CLASSES) {
      if (classes.length < 2) continue;
      for (const id of ids) {
        open++;
        expect([id, classify(record([`CWE-${id}`])).class]).toEqual([id, "unclassified"]);
        expect([id, classify(withVectors([`CWE-${id}`], v3("C:H/I:H/A:H"))).class]).toEqual([id, classes[0]]);
      }
    }
    expect(open).toBe(30);
  });

  it("keeps the sets the decisions name", () => {
    const sets = new Map(CWE_CLASSES.flatMap(([classes, ids]) => ids.map(id => [id, classes] as const)));
    const examples: Record<string, readonly string[]> = {
      22: ["steal", "alter"], 89: ["steal", "alter"], 862: ["impersonate", "steal", "alter"], 78: ["takeover"],
      94: ["takeover"], 502: ["takeover"], 79: ["impersonate"], 352: ["impersonate"], 601: ["impersonate"], 918: ["steal"], 611: ["steal"],
      1321: ["alter"], 400: ["disrupt"], 1333: ["disrupt"],
    };
    for (const [id, classes] of Object.entries(examples)) expect([id, sets.get(Number(id))]).toEqual([id, classes]);
    for (const id of [20, 74, 707, 693]) expect([id, sets.has(id), classify(withVectors([`CWE-${id}`], v3("C:H/I:H/A:H"))).class]).toEqual([id, false, "unclassified"]);
  });

  it("lists each set's classes strongest first, and puts no CWE in two sets, nor in a set and the decided-unclassified list", () => {
    for (const [classes] of CWE_CLASSES) expect([...classes].sort((a, b) => IMPACT_ORDER.indexOf(a) - IMPACT_ORDER.indexOf(b))).toEqual(classes);
    const all = [...CWE_CLASSES.flatMap(([, ids]) => ids), ...DECIDED_UNCLASSIFIED, TRAP_CWE];
    expect(new Set(all).size).toBe(all.length);
  });

  it("leaves every decided-unclassified CWE and an unlisted CWE unclassified", () => {
    for (const id of [...DECIDED_UNCLASSIFIED, 99999]) expect([id, classify(record([`CWE-${id}`])).class]).toEqual([id, "unclassified"]);
    expect(classify(record(["CWE-99999"])).reason).toBe("GHSA-xxxx-xxxx-xxxx: no CWE listed (CWE-99999) is in Ludion's table.");
  });
});

describe("the strength order", () => {
  it("is trap > takeover > impersonate > steal > alter > disrupt > unclassified", () => {
    expect(IMPACT_ORDER).toEqual(["trap", "takeover", "impersonate", "steal", "alter", "disrupt", "unclassified"]);
  });

  it("takes the strongest class of a record's CWEs, in either order", () => {
    for (let i = 0; i < MAPPED.length; i++) {
      for (let j = i + 1; j < MAPPED.length; j++) {
        const strong = `CWE-${only(MAPPED[i]!)}`, weak = `CWE-${only(MAPPED[j]!)}`;
        expect(classify(record([weak, strong])).class).toBe(MAPPED[i]);
        expect(classify(record([strong, weak])).class).toBe(MAPPED[i]);
        expect(classify(record([weak, "CWE-20", strong])).class).toBe(MAPPED[i]);
      }
    }
    expect(classify(record(["CWE-400", "CWE-20"])).class).toBe("disrupt");
    expect(classify(record(["CWE-918", "CWE-79"])).reason).toBe("GHSA-xxxx-xxxx-xxxx: CWE-79 is impersonate, the strongest of CWE-79, CWE-918.");
  });
});

describe("CVSS vectors (docs/decisions/2026-10-31-impact-classes-cvss-vector.md)", () => {
  it("keep only the classes a CVSS 3 vector is consistent with, and the record takes the strongest", () => {
    const cases: [string, string, ImpactClass][] = [
      // CWE-22 allows steal or alter; CWE-862 impersonate, steal or alter.
      ["CWE-22", "C:H/I:N/A:N", "steal"], ["CWE-22", "C:L/I:H/A:N", "steal"], ["CWE-22", "C:N/I:L/A:N", "alter"], ["CWE-22", "C:N/I:N/A:H", "unclassified"],
      ["CWE-862", "C:L/I:N/A:N", "impersonate"], ["CWE-862", "C:N/I:L/A:N", "impersonate"], ["CWE-862", "C:N/I:N/A:H", "unclassified"],
      // One class, ruled in or out: takeover by any of C, I and A; impersonate by C or I; steal by C; alter by I; disrupt by A.
      ["CWE-78", "C:N/I:N/A:L", "takeover"], ["CWE-78", "C:N/I:L/A:N", "takeover"], ["CWE-78", "C:L/I:N/A:N", "takeover"], ["CWE-78", "C:N/I:N/A:N", "unclassified"],
      ["CWE-79", "C:N/I:L/A:N", "impersonate"], ["CWE-79", "C:L/I:N/A:N", "impersonate"], ["CWE-79", "C:N/I:N/A:H", "unclassified"],
      ["CWE-918", "C:L/I:N/A:N", "steal"], ["CWE-918", "C:N/I:H/A:H", "unclassified"],
      ["CWE-1321", "C:N/I:L/A:N", "alter"], ["CWE-1321", "C:H/I:N/A:H", "unclassified"],
      ["CWE-400", "C:N/I:N/A:L", "disrupt"], ["CWE-400", "C:H/I:H/A:N", "unclassified"],
      // Several CWEs: the strongest kept among all their classes, in either order.
      ["CWE-400,CWE-22", "C:N/I:N/A:H", "disrupt"], ["CWE-22,CWE-400", "C:N/I:H/A:H", "alter"], ["CWE-78,CWE-22", "C:H/I:N/A:N", "takeover"],
      ["CWE-79,CWE-918", "C:H/I:N/A:N", "impersonate"], ["CWE-1321,CWE-918", "C:N/I:H/A:N", "alter"], ["CWE-20,CWE-22", "C:N/I:H/A:N", "alter"],
    ];
    for (const [cwes, cia, want] of cases) expect([cwes, cia, classify(withVectors(cwes.split(","), v3(cia))).class]).toEqual([cwes, cia, want]);
    expect(classify(withVectors(["CWE-22"], { type: "CVSS_V3", score: "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N" })).class).toBe("alter");
  });

  it("read CVSS 4's vulnerable and subsequent systems, in any order, past other metrics", () => {
    const cases: [string, string, ImpactClass][] = [
      ["CWE-22", "VC:N/VI:N/VA:N/SC:H/SI:N/SA:N", "steal"], ["CWE-22", "VC:N/VI:N/VA:N/SC:N/SI:L/SA:N", "alter"], ["CWE-22", "VC:N/VI:N/VA:H/SC:N/SI:N/SA:H", "unclassified"],
      ["CWE-400", "VC:N/VI:N/VA:N/SC:N/SI:N/SA:L", "disrupt"], ["CWE-400", "VC:H/VI:H/VA:N/SC:H/SI:H/SA:N", "unclassified"],
      ["CWE-862", "VC:N/VI:N/VA:N/SC:N/SI:H/SA:N", "impersonate"], ["CWE-862", "VC:N/VI:N/VA:H/SC:N/SI:N/SA:H", "unclassified"],
      ["CWE-78", "VC:N/VI:N/VA:N/SC:N/SI:N/SA:L", "takeover"], ["CWE-78", "VC:N/VI:N/VA:N/SC:N/SI:N/SA:N", "unclassified"],
      ["CWE-22", "SA:N/SI:N/SC:H/VA:N/VI:N/VC:N/E:A/U:Red/MVC:H", "steal"],
    ];
    for (const [cwes, metrics, want] of cases) expect([cwes, metrics, classify(withVectors(cwes.split(","), v4(metrics))).class]).toEqual([cwes, metrics, want]);
  });

  it("keep a class only when every vector of the record is consistent with it", () => {
    const steal = v3("C:H/I:N/A:N"), alter = v4("VC:N/VI:H/VA:N/SC:N/SI:N/SA:N"), both = v3("C:H/I:H/A:N");
    expect(classify(withVectors(["CWE-22"], both, alter)).class).toBe("alter");
    expect(classify(withVectors(["CWE-22"], alter, both)).class).toBe("alter");
    expect(classify(withVectors(["CWE-22"], steal, alter)).class).toBe("unclassified");
    expect(classify(withVectors(["CWE-862"], steal, alter)).class).toBe("impersonate");
    expect(classify(withVectors(["CWE-22"], steal, alter)).reason).toBe("GHSA-xxxx-xxxx-xxxx: its CVSS vectors rule out every class its CWEs allow (steal, alter).");
  });

  it("say which CWE gave the class and what the vector ruled out", () => {
    expect(classify(withVectors(["CWE-22"], v3("C:H/I:N/A:N")))).toEqual({
      class: "steal", severity: "unknown", cwes: ["CWE-22"], reason: "GHSA-xxxx-xxxx-xxxx: steal (CWE-22), the strongest class its CWEs allow (steal, alter) that its CVSS vector does not rule out.",
    });
    expect(classify(withVectors(["CWE-400", "CWE-22"], v3("C:N/I:H/A:H"), v4("VC:N/VI:H/VA:H/SC:N/SI:N/SA:N"))).reason).toBe(
      "GHSA-xxxx-xxxx-xxxx: alter (CWE-22), the strongest class its CWEs allow (steal, alter, disrupt) that its CVSS vectors do not rule out.",
    );
    expect(classify(withVectors(["CWE-22", "CWE-400"], v3("C:N/I:N/A:H"))).reason).toBe(
      "GHSA-xxxx-xxxx-xxxx: disrupt (CWE-400), the strongest class its CWEs allow (steal, alter, disrupt) that its CVSS vector does not rule out.",
    );
    expect(classify(withVectors(["CWE-400"], v3("C:H/I:H/A:N"))).reason).toBe("GHSA-xxxx-xxxx-xxxx: its CVSS vector rules out every class its CWEs allow (disrupt).");
  });

  it("with none, give a CWE's one class, and the strongest only when no CWE with several classes allows a stronger one", () => {
    const cases: [string[], ImpactClass][] = [
      [["CWE-22"], "unclassified"], [["CWE-89"], "unclassified"], [["CWE-862"], "unclassified"], [["CWE-22", "CWE-89"], "unclassified"], [["CWE-20", "CWE-22"], "unclassified"],
      [["CWE-78", "CWE-22"], "takeover"], [["CWE-79", "CWE-862"], "impersonate"], [["CWE-22", "CWE-918"], "steal"],
      [["CWE-400", "CWE-22"], "unclassified"], [["CWE-1321", "CWE-22"], "unclassified"], [["CWE-918", "CWE-862"], "unclassified"],
    ];
    for (const [cwes, want] of cases) expect([cwes, classify(record(cwes)).class]).toEqual([cwes, want]);
    expect(classify(record(["CWE-22"])).reason).toBe("GHSA-xxxx-xxxx-xxxx: CWE-22 allows steal or alter and the record has no CVSS vector to choose.");
    expect(classify(record(["CWE-862"])).reason).toBe("GHSA-xxxx-xxxx-xxxx: CWE-862 allows impersonate, steal or alter and the record has no CVSS vector to choose.");
    expect(classify(record(["CWE-400", "CWE-22"])).reason).toBe("GHSA-xxxx-xxxx-xxxx: CWE-22 allows steal or alter, stronger than disrupt (CWE-400), and the record has no CVSS vector to choose.");
    expect(classify(record(["CWE-78", "CWE-22"])).reason).toBe("GHSA-xxxx-xxxx-xxxx: CWE-78 is takeover, the strongest of CWE-22, CWE-78.");
  });

  it("leave the record unclassified when a CVSS 3 or 4 vector cannot be read, even beside one that can", () => {
    const bad: [unknown, string][] = [
      [{ type: "CVSS_V3", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N" }, "its CVSS_V3 score is not a CVSS 3 vector"],
      [{ type: "CVSS_V4", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N" }, "its CVSS_V4 score is not a CVSS 4 vector"],
      [{ type: "CVSS_V3", score: "CVSS:3.2/AV:N/C:H/I:N/A:N" }, "its CVSS_V3 score is not a CVSS 3 vector"],
      [{ type: "CVSS_V3", score: "AV:N/AC:L/Au:N/C:P/I:N/A:N" }, "its CVSS_V3 score is not a CVSS 3 vector"],
      [{ type: "CVSS_V3" }, "its CVSS_V3 score is not a CVSS 3 vector"],
      [{ type: "CVSS_V3", score: 9.8 }, "its CVSS_V3 score is not a CVSS 3 vector"],
      [v3("I:H/A:H"), "its CVSS_V3 vector cannot be read: C is given 0 times, not once as N, L or H"],
      [v3("C:H/C:N/I:N/A:N"), 'its CVSS_V3 vector cannot be read: C is given 2 times ("H", "N"), not once as N, L or H'],
      [v3("C:X/I:N/A:N"), 'its CVSS_V3 vector cannot be read: C is given 1 time ("X"), not once as N, L or H'],
      [v3("c:h/I:N/A:N"), "its CVSS_V3 vector cannot be read: C is given 0 times, not once as N, L or H"],
      [v3("C:H/I:N/A:"), 'its CVSS_V3 vector cannot be read: A is given 1 time (""), not once as N, L or H'],
      [v4("VC:H/VI:N/VA:N/SI:N/SA:N"), "its CVSS_V4 vector cannot be read: SC is given 0 times, not once as N, L or H"],
      [v4("VC:H/VI:N/VA:N/SC:N/SI:N/SA:S"), 'its CVSS_V4 vector cannot be read: SA is given 1 time ("S"), not once as N, L or H'],
    ];
    for (const [vector, why] of bad) {
      expect(classify(withVectors(["CWE-78"], vector))).toEqual({ class: "unclassified", severity: "unknown", cwes: ["CWE-78"], reason: `GHSA-xxxx-xxxx-xxxx: ${why}, so no class can be ruled out.` });
      expect(classify(withVectors(["CWE-78"], v3("C:H/I:H/A:H"), vector)).class).toBe("unclassified");
    }
  });

  it("read no other severity type, nor entries or lists of another shape", () => {
    for (const severity of [[{ type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:N/I:N/A:P" }], [{ type: "Ubuntu", score: "high" }], [null, 5, "CVSS:3.1/C:N/I:N/A:N"], "CVSS:3.1/AV:N/C:N/I:N/A:N", { type: "CVSS_V3", score: "x" }, [{ type: "cvss_v3", score: "x" }], [{ type: "toString", score: "x" }]]) {
      expect([severity, classify({ ...record(["CWE-78"]), severity }).class]).toEqual([severity, "takeover"]);
      expect([severity, classify({ ...record(["CWE-22"]), severity }).class]).toEqual([severity, "unclassified"]);
    }
  });

  it("are not read for a trap, a record with no CWE in the table, or one with no CWE", () => {
    const none = v3("C:N/I:N/A:N"), unreadable = v3("C:X/I:N/A:N");
    for (const vector of [none, unreadable]) {
      expect(classify({ id: "MAL-2025-1", severity: [vector] }).class).toBe("trap");
      expect(classify({ id: "GHSA-1", aliases: ["MAL-2025-1"], severity: [vector] }).class).toBe("trap");
      expect(classify(withVectors(["CWE-506"], vector)).class).toBe("trap");
      expect(classify(withVectors(["CWE-20"], vector)).reason).toBe("GHSA-xxxx-xxxx-xxxx: no CWE listed (CWE-20) is in Ludion's table.");
      expect(classify(withVectors([], vector)).reason).toBe("GHSA-xxxx-xxxx-xxxx lists no CWE in database_specific.cwe_ids.");
    }
  });
});

describe("trap", () => {
  it("is every record whose id starts with MAL-, whatever its CWEs", () => {
    expect(classify({ id: "MAL-2025-1" })).toEqual({ class: "trap", severity: "unknown", cwes: [], reason: "MAL-2025-1 is an OSV MAL- record: the version itself is malicious." });
    expect(classify({ id: "MAL-2025-2", database_specific: { cwe_ids: ["CWE-79"], severity: "LOW" } })).toMatchObject({ class: "trap", severity: "low", cwes: ["CWE-79"] });
  });

  it("is not an id that only contains MAL-, or a lower-case mal-", () => {
    for (const id of ["GHSA-MAL-1", "XMAL-2025-1", "mal-2025-1", " MAL-2025-1"]) expect([id, classify({ id }).class]).toEqual([id, "unclassified"]);
  });

  it("is a record with a MAL- alias, whatever its CWEs: the same case in another database", () => {
    expect(classify({ id: "GHSA-1", aliases: ["CVE-2025-1", "MAL-2025-1"], database_specific: { cwe_ids: [] } })).toEqual({
      class: "trap", severity: "unknown", cwes: [], reason: "GHSA-1 has the alias MAL-2025-1, an OSV MAL- record: the version itself is malicious.",
    });
    expect(classify({ id: "GHSA-2", aliases: ["MAL-2025-2"], database_specific: { cwe_ids: ["CWE-400"], severity: "HIGH" } })).toMatchObject({ class: "trap", severity: "high", cwes: ["CWE-400"] });
    expect(classify({ id: "MAL-2025-3", aliases: ["MAL-2025-4"] }).reason).toBe("MAL-2025-3 is an OSV MAL- record: the version itself is malicious.");
  });

  it("is not an alias that only contains MAL-, a lower-case one, one that is not a string, or aliases that are not a list", () => {
    for (const aliases of [["GHSA-MAL-1"], ["mal-2025-1"], [" MAL-2025-1"], [{ id: "MAL-2025-1" }], [["MAL-2025-1"]], "MAL-2025-1", { 0: "MAL-2025-1" }, null]) {
      expect([aliases, classify({ id: "GHSA-1", aliases }).class]).toEqual([aliases, "unclassified"]);
    }
    expect(classify({ id: "GHSA-1", aliases: [7, "MAL-2025-1"] }).class).toBe("trap");
  });

  it("is a GitHub malware advisory, one that lists CWE-506, alone or among other CWEs", () => {
    expect(TRAP_CWE).toBe(506);
    expect(classify(record(["CWE-506"], { severity: "CRITICAL" }))).toEqual({
      class: "trap", severity: "critical", cwes: ["CWE-506"], reason: "GHSA-xxxx-xxxx-xxxx lists CWE-506 (Embedded Malicious Code): the version itself is malicious.",
    });
    expect(classify(record(["CWE-78", "CWE-506", "CWE-912"]))).toMatchObject({ class: "trap", cwes: ["CWE-78", "CWE-506", "CWE-912"] });
    expect(classify({ id: "GHSA-1", aliases: ["MAL-2025-1"], database_specific: { cwe_ids: ["CWE-506"] } }).reason).toBe("GHSA-1 has the alias MAL-2025-1, an OSV MAL- record: the version itself is malicious.");
  });

  it("is not CWE-912 (hidden functionality), nor a CWE-506 that is not of the form CWE-<number>", () => {
    for (const cwes of [["CWE-912"], ["CWE-5060"], ["CWE-50"], ["NVD-CWE-506"], [506]]) expect([cwes, classify(record(cwes)).class]).toEqual([cwes, "unclassified"]);
  });
});

describe("records without a CWE", () => {
  it("are unclassified with the reason", () => {
    expect(classify({ id: "GHSA-1" })).toEqual({ class: "unclassified", severity: "unknown", cwes: [], reason: "GHSA-1 lists no CWE in database_specific.cwe_ids." });
    for (const cwes of [[], undefined, null, "CWE-79", { 0: "CWE-79" }]) expect(classify(record(cwes)).class).toBe("unclassified");
  });

  it("ignore entries that are not CWE-<number>, and say so", () => {
    const c = classify(record(["NVD-CWE-Other", 79, "CWE-", "CWE-0", "CWE-79x"]));
    expect(c).toMatchObject({ class: "unclassified", cwes: [] });
    expect(c.reason).toBe('GHSA-xxxx-xxxx-xxxx lists no CWE in database_specific.cwe_ids. Ignored cwe_ids entries not of the form CWE-<number>: "NVD-CWE-Other", 79, "CWE-", "CWE-0", "CWE-79x".');
    expect(classify(record(["NVD-CWE-noinfo", "CWE-918"]))).toMatchObject({ class: "steal", cwes: ["CWE-918"] });
  });

  it("never throw on input that is not a record", () => {
    for (const input of [null, undefined, 1, "GHSA-1", [], [{ id: "MAL-1" }], { id: 7 }, { id: "GHSA-1", database_specific: [] }]) {
      expect(classify(input)).toMatchObject({ class: "unclassified", severity: "unknown", cwes: [] });
    }
    expect(classify({ database_specific: { cwe_ids: ["CWE-78"] } }).reason).toBe("The record has no id.");
  });
});

describe("severity", () => {
  it("is GHSA's database_specific.severity only, or unknown", () => {
    const cases: [unknown, string][] = [["CRITICAL", "critical"], ["HIGH", "high"], ["MODERATE", "moderate"], ["LOW", "low"], ["moderate", "moderate"], ["MEDIUM", "unknown"], ["", "unknown"], [9.8, "unknown"], [undefined, "unknown"]];
    for (const [given, want] of cases) expect([given, classify(record(["CWE-79"], { severity: given })).severity]).toEqual([given, want]);
  });

  it("is not computed from a CVSS vector", () => {
    const r = { id: "GHSA-1", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }], database_specific: { cwe_ids: ["CWE-78"] } };
    expect(classify(r).severity).toBe("unknown");
    expect(classify({ ...r, affected: [{ database_specific: { severity: "HIGH" } }] }).severity).toBe("unknown");
  });
});

describe("the same input", () => {
  it("gives the same output, with CWEs sorted and deduplicated", () => {
    const r = record([" cwe-918 ", "CWE-79", "CWE-79", "CWE-22"], { severity: "HIGH" });
    const first = classify(r);
    expect(classify(JSON.parse(JSON.stringify(r)))).toEqual(first);
    expect(classify(record(["CWE-22", "CWE-918", "CWE-79"], { severity: "HIGH" }))).toEqual(first);
    expect(first).toEqual({ class: "impersonate", severity: "high", cwes: ["CWE-22", "CWE-79", "CWE-918"], reason: "GHSA-xxxx-xxxx-xxxx: CWE-79 is impersonate, the strongest of CWE-22, CWE-79, CWE-918." });
  });
});

describe("real OSV records (packages/cli/test/fixtures/impact/records.json)", () => {
  const records: { id: string }[] = JSON.parse(readFileSync(new URL("./fixtures/impact/records.json", import.meta.url), "utf8"));
  // Written from each record's database_specific.cwe_ids, CVSS vectors and severity, read apart from classify()
  // (docs/bench/2026-10-31-lmr1-impact-classes/logs/fixture-vectors.log). GHSA-2444-8gj8-6fmx lists CWE-91 (alter), and
  // both its CVSS 3 and 4 vectors say integrity is not affected, so it is unclassified since LMR1c.
  const expected: Record<string, [ImpactClass, string]> = {
    "GHSA-2234-fmw7-43wr": ["impersonate", "moderate"], "GHSA-2238-xc5r-v9hj": ["steal", "moderate"], "GHSA-223g-f5mq-gw33": ["impersonate", "moderate"],
    "GHSA-223j-4rm8-mrmf": ["steal", "low"], "GHSA-224p-v68g-5g8f": ["disrupt", "moderate"], "GHSA-226w-6hhj-69hp": ["trap", "critical"],
    "GHSA-2275-rpf5-xv8h": ["takeover", "high"], "GHSA-2299-ghjr-6vjp": ["unclassified", "low"], "GHSA-22h7-7wwg-qmgg": ["alter", "low"],
    "GHSA-22p9-wv53-3rq4": ["disrupt", "high"], "GHSA-22rr-f3p8-5gf8": ["unclassified", "high"], "GHSA-236c-vhj4-gfxg": ["takeover", "high"],
    "GHSA-238x-w2j9-gwwr": ["impersonate", "high"], "GHSA-23vw-mhv5-grv5": ["unclassified", "high"], "GHSA-23wx-cgxq-vpwx": ["alter", "moderate"],
    "GHSA-279x-mwfv-vcqv": ["takeover", "critical"], "MAL-2021-1": ["trap", "unknown"], "MAL-2021-2": ["trap", "unknown"],
    "GHSA-2223-f22x-24cq": ["steal", "moderate"], "GHSA-222v-cx2c-q2f5": ["impersonate", "moderate"], "GHSA-2237-5r9w-vm8j": ["steal", "high"],
    "GHSA-225x-3jhx-wh4q": ["impersonate", "moderate"], "GHSA-22gj-8qj2-fj46": ["unclassified", "moderate"], "GHSA-237r-r8m4-4q88": ["unclassified", "moderate"],
    "GHSA-23gj-x27g-r34f": ["takeover", "high"], "GHSA-243q-g9j3-qf6r": ["unclassified", "moderate"], "GHSA-2444-8gj8-6fmx": ["unclassified", "high"],
    "GHSA-2497-6pwj-pwg7": ["impersonate", "moderate"], "GHSA-24cf-848g-762c": ["impersonate", "moderate"], "GHSA-24wv-6c99-f843": ["takeover", "critical"],
    "GHSA-2528-jw5q-ww88": ["disrupt", "high"], "GHSA-265m-7826-wjqm": ["alter", "high"], "GHSA-267j-cwvg-j28c": ["unclassified", "moderate"],
    "GHSA-273w-7fxj-pcp6": ["disrupt", "high"], "MAL-2026-3637": ["trap", "unknown"],
  };

  it("are each classified as expected", () => {
    expect(records.map(r => r.id).sort()).toEqual(Object.keys(expected).sort());
    for (const r of records) {
      const c = classify(r);
      expect([r.id, c.class, c.severity]).toEqual([r.id, ...expected[r.id]!]);
    }
  });

  it("cover every class", () => {
    expect(new Set(Object.values(expected).map(([c]) => c))).toEqual(new Set(IMPACT_ORDER));
  });
});

describe("real GitHub malware advisories (packages/cli/test/fixtures/impact/trap-records.json)", () => {
  const records: { id: string }[] = JSON.parse(readFileSync(new URL("./fixtures/impact/trap-records.json", import.meta.url), "utf8"));
  // Written from each record's aliases, database_specific.cwe_ids and severity, read apart from classify().
  const expected: Record<string, [string, string]> = {
    "GHSA-286p-vc9p-p5qv": ["high", "GHSA-286p-vc9p-p5qv has the alias MAL-2025-46973, an OSV MAL- record: the version itself is malicious."],
    "GHSA-4x49-vf9v-38px": ["high", "GHSA-4x49-vf9v-38px has the alias MAL-2025-46974, an OSV MAL- record: the version itself is malicious."],
    "GHSA-226w-6hhj-69hp": ["critical", "GHSA-226w-6hhj-69hp lists CWE-506 (Embedded Malicious Code): the version itself is malicious."],
    "GHSA-22gq-x6pg-752j": ["high", "GHSA-22gq-x6pg-752j lists CWE-506 (Embedded Malicious Code): the version itself is malicious."],
    "GHSA-gr3r-crp5-qrrm": ["critical", "GHSA-gr3r-crp5-qrrm lists CWE-506 (Embedded Malicious Code): the version itself is malicious."],
  };

  it("are each a trap, by a MAL- alias or by CWE-506", () => {
    expect(records.map(r => r.id)).toEqual(Object.keys(expected));
    for (const r of records) {
      const c = classify(r);
      expect([r.id, c.class, c.severity, c.reason]).toEqual([r.id, "trap", ...expected[r.id]!]);
    }
  });

  it("are each written as a trap when a stop carries them", () => {
    const out = renderRecord(records.map(record => ({ ...rows[0]!, action: "stopped" as const, stop: { reason: "trap" as const, record } })), "ja").split("\n");
    expect(out[0]).toBe("Ludion：罠を止めた 5");
    expect(out.slice(4, -1).map(line => line.split(" | ")[5])).toEqual(Object.keys(expected).map(id => `罠を止めた（\`${id}\`）`));
  });
});

const rows: RecordRow[] = [
  { ecosystem: "npm", package: "lodash", from: "4.17.20", to: "4.17.21", class: "alter", severity: "high", action: "fixed", stop: null, fixPublishedAt: "2026-10-01T00:00:00Z", actedAt: "2026-10-03T06:30:00Z" },
  { ecosystem: "npm", package: "@scope/evil", from: "1.0.0", to: "1.0.1", class: "takeover", severity: "unknown", action: "stopped", stop: { reason: "trap", record: { id: "MAL-2025-1" } }, fixPublishedAt: null, actedAt: "2026-10-04T00:00:00.000Z" },
  { ecosystem: "composer", package: "guzzlehttp/guzzle", from: "7.4.4", to: "7.4.5", class: "steal", severity: "moderate", action: "opened", stop: null, fixPublishedAt: "2026-10-05T10:00:00Z", actedAt: "2026-10-05T10:45:59Z" },
  { ecosystem: "npm", package: "express", from: "4.19.1", to: "4.19.2", class: "impersonate", severity: "critical", action: "waited", stop: null, fixPublishedAt: "2026-10-06T00:00:00Z", actedAt: "2026-10-06T05:00:00Z" },
  { ecosystem: "npm", package: "minimist", from: "1.2.5", to: "1.2.6", class: "unclassified", severity: "low", action: "fixed", stop: null, fixPublishedAt: "2026-10-07T00:00:00Z", actedAt: "2026-10-08T23:59:00Z" },
  // A trap class without a published record behind the stop: written as unverified, not counted as a trap.
  { ecosystem: "npm", package: "ua-parser-js", from: "0.7.28", to: "0.7.29", class: "trap", severity: "critical", action: "stopped", stop: { reason: "install-scripts" }, fixPublishedAt: "2026-10-09T00:00:00Z", actedAt: "2026-10-09T13:00:00Z" },
  { ecosystem: "npm", package: "left-pad", from: "1.2.0", to: "1.3.0", class: "disrupt", severity: "moderate", action: "stopped", stop: { reason: "provenance-lost" }, fixPublishedAt: "2026-10-10T00:00:00Z", actedAt: "2026-10-10T00:10:00Z" },
];

describe("renderRecord", () => {
  it("renders the English table with its summary", () => {
    expect(renderRecord(rows, "en")).toBe([
      "Ludion: fixed 2, trap stopped 1, stopped as unverified 2 (provenance lost 1, install scripts added 1), PR opened 1, waiting 1",
      "",
      "| Date (UTC) | Package | Change | Impact | Severity | Ludion | Fix published to action |",
      "|---|---|---|---|---|---|---|",
      "| 2026-10-03 | `lodash` | `4.17.20` → `4.17.21` | Tampering | High | fixed (merged) | 2 d |",
      "| 2026-10-04 | `@scope/evil` | `1.0.0` → `1.0.1` | Takeover | Unknown | trap stopped (`MAL-2025-1`) | unknown |",
      "| 2026-10-05 | `guzzlehttp/guzzle` | `7.4.4` → `7.4.5` | Data theft | Moderate | opened a PR | 45 min |",
      "| 2026-10-06 | `express` | `4.19.1` → `4.19.2` | Impersonation | Critical | waiting | 5 h |",
      "| 2026-10-08 | `minimist` | `1.2.5` → `1.2.6` | Unclassified | Low | fixed (merged) | 47 h |",
      "| 2026-10-09 | `ua-parser-js` | `0.7.28` → `0.7.29` | Trap | Critical | stopped as unverified: install scripts added | 13 h |",
      "| 2026-10-10 | `left-pad` | `1.2.0` → `1.3.0` | Disruption | Moderate | stopped as unverified: provenance lost | 10 min |",
      "",
    ].join("\n"));
  });

  it("renders the Japanese table with its summary", () => {
    expect(renderRecord(rows, "ja")).toBe([
      "Ludion：直した 2、罠を止めた 1、確かめられなかったので止めた 2（来歴が切れた 1、install スクリプトが増えた 1）、PR を開いた 1、待っている 1",
      "",
      "| 日付（UTC） | パッケージ | 変更 | 分類 | 深刻さ | Ludion がしたこと | 修正の公開からの時間 |",
      "|---|---|---|---|---|---|---|",
      "| 2026-10-03 | `lodash` | `4.17.20` → `4.17.21` | 改ざん | 高 | 直した（マージ済み） | 2 日 |",
      "| 2026-10-04 | `@scope/evil` | `1.0.0` → `1.0.1` | 乗っ取り | 不明 | 罠を止めた（`MAL-2025-1`） | 不明 |",
      "| 2026-10-05 | `guzzlehttp/guzzle` | `7.4.4` → `7.4.5` | 抜き取り | 中 | PR を開いた | 45 分 |",
      "| 2026-10-06 | `express` | `4.19.1` → `4.19.2` | なりすまし | 重大 | 待っている | 5 時間 |",
      "| 2026-10-08 | `minimist` | `1.2.5` → `1.2.6` | 未分類 | 低 | 直した（マージ済み） | 47 時間 |",
      "| 2026-10-09 | `ua-parser-js` | `0.7.28` → `0.7.29` | 罠 | 重大 | 確かめられなかったので止めた（install スクリプトが増えた） | 13 時間 |",
      "| 2026-10-10 | `left-pad` | `1.2.0` → `1.3.0` | 停止 | 中 | 確かめられなかったので止めた（来歴が切れた） | 10 分 |",
      "",
    ].join("\n"));
  });

  it("names every class and action in both languages", () => {
    for (const lang of ["en", "ja"] as const) {
      const out = renderRecord(IMPACT_ORDER.map((cls, i) => {
        const action = (["opened", "stopped", "waited", "fixed"] as const)[i % 4]!;
        return { ...rows[0]!, class: cls, action, stop: action === "stopped" ? { reason: "tests" as const } : null };
      }), lang);
      expect(out).toContain(lang === "en" ? "Ludion: fixed 1, stopped as unverified 2 (tests fail on the new version 2), PR opened 2, waiting 2" : "Ludion：直した 1、確かめられなかったので止めた 2（新しい版でテストが通らない 2）、PR を開いた 2、待っている 2");
      for (const label of lang === "en" ? ["Trap", "Takeover", "Impersonation", "Data theft", "Tampering", "Disruption", "Unclassified"] : ["罠", "乗っ取り", "なりすまし", "抜き取り", "改ざん", "停止", "未分類"]) expect(out).toContain(`| ${label} |`);
    }
  });

  it("names every stop reason in both languages, counted in the decision record's order", () => {
    const reasons: StopReason[] = ["provenance-lost", "provenance-changed", "install-scripts", "deprecated", "withdrawn", "replaced", "new-advisory", "downgrade", "after-fix", "lockfile", "tests", "undecidable"];
    const labels = {
      en: ["provenance lost", "built from another repository or workflow", "install scripts added", "deprecated", "no longer listed by the registry", "another package under the same name", "the new version has known advisories", "the version goes down", "published at or after the fix", "the lockfile or the changed files do not check out", "tests fail on the new version", "could not be judged"],
      ja: ["来歴が切れた", "作り元が変わった", "install スクリプトが増えた", "非推奨になった", "取り下げられた", "同じ名前の別のパッケージ", "新しい版に既知の勧告がある", "版が下がる", "修正の後に公開された", "ロックファイルか変更の範囲が合わない", "新しい版でテストが通らない", "判断できなかった"],
    };
    // Given in reverse, the first reason twice: the summary keeps the table's order and counts each.
    const given = [...reasons].reverse().concat(reasons[0]!).map(reason => ({ ...rows[0]!, action: "stopped" as const, stop: { reason } }));
    expect(renderRecord(given, "en").split("\n")[0]).toBe(`Ludion: stopped as unverified 13 (${labels.en.map((label, i) => `${label} ${i ? 1 : 2}`).join(", ")})`);
    expect(renderRecord(given, "ja").split("\n")[0]).toBe(`Ludion：確かめられなかったので止めた 13（${labels.ja.map((label, i) => `${label} ${i ? 1 : 2}`).join("、")}）`);
    const en = renderRecord(given, "en").split("\n").slice(4, -1), ja = renderRecord(given, "ja").split("\n").slice(4, -1);
    expect(en.map(line => line.split(" | ")[5])).toEqual([...labels.en].reverse().concat(labels.en[0]!).map(label => `stopped as unverified: ${label}`));
    expect(ja.map(line => line.split(" | ")[5])).toEqual([...labels.ja].reverse().concat(labels.ja[0]!).map(label => `確かめられなかったので止めた（${label}）`));
  });

  it("counts as traps only the stops a published record backs: a MAL- id, a MAL- alias or CWE-506", () => {
    const stopped = (stop: RecordRow["stop"], cls: ImpactClass = "steal"): RecordRow => ({ ...rows[0]!, class: cls, action: "stopped", stop });
    const out = renderRecord([
      stopped({ reason: "trap", record: { id: "MAL-2025-1" } }),
      stopped({ reason: "trap", record: { id: "GHSA-aaaa-bbbb-cccc", aliases: ["MAL-2025-2"] } }),
      stopped({ reason: "trap", record: { id: "GHSA-dddd-eeee-ffff", database_specific: { cwe_ids: ["CWE-506"] } } }),
      stopped({ reason: "undecidable" }, "trap"),
      stopped({ reason: "new-advisory" }, "trap"),
    ], "en").split("\n");
    expect(out[0]).toBe("Ludion: trap stopped 3, stopped as unverified 2 (the new version has known advisories 1, could not be judged 1)");
    expect(out.slice(4, -1).map(line => line.split(" | ")[5])).toEqual([
      "trap stopped (`MAL-2025-1`)", "trap stopped (`GHSA-aaaa-bbbb-cccc`)", "trap stopped (`GHSA-dddd-eeee-ffff`)", "stopped as unverified: could not be judged", "stopped as unverified: the new version has known advisories",
    ]);
    expect(renderRecord([stopped({ reason: "undecidable" }, "trap")], "ja").split("\n")[0]).toBe("Ludion：確かめられなかったので止めた 1（判断できなかった 1）");
    // A record id not of an id's form is not shown; the row is counted as unreadable.
    expect(renderRecord([stopped({ reason: "trap", record: { id: "MAL-a|b`c" } })], "en")).toBe("Rows that could not be read: 1. Their contents are not shown.\n");
  });

  it("refuses a stop given as a trap whose record does not say the version is malicious", () => {
    const records: unknown[] = [
      { id: "GHSA-1", database_specific: { cwe_ids: ["CWE-79"] } }, { id: "GHSA-1", aliases: ["mal-2025-1"] }, { id: "mal-2025-1" }, { id: "GHSA-1", database_specific: { cwe_ids: ["CWE-912"] } },
      { aliases: ["MAL-2025-1"] }, "MAL-2025-1", null, undefined,
    ];
    for (const record of records) {
      expect(() => renderRecord([{ ...rows[0]!, action: "stopped", stop: { reason: "trap", record } }], "en")).toThrow("Row 0: the stop is given as a trap, but its record does not say the version is malicious");
    }
    expect(() => renderRecord([rows[0]!, { ...rows[0]!, action: "stopped", stop: { reason: "trap", record: { id: "GHSA-1" } } }], "ja")).toThrow("Row 1: the stop is given as a trap, but its record does not say the version is malicious (GHSA-1 lists no CWE in database_specific.cwe_ids.)");
  });

  it("counts only the rows it is given, and says an empty record is not a safe one", () => {
    expect(renderRecord([rows[1]!], "en").split("\n")[0]).toBe("Ludion: trap stopped 1");
    expect(renderRecord([rows[6]!], "ja").split("\n")[0]).toBe("Ludion：確かめられなかったので止めた 1（来歴が切れた 1）");
    expect(renderRecord([], "en")).toBe("No actions recorded. That does not mean the dependencies are safe.\n");
    expect(renderRecord([], "ja")).toBe("記録はありません。依存が安全だという意味ではありません。\n");
  });

  it("rounds the time down, in minutes, hours, then days", () => {
    const at = (minutes: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + minutes * 60_000).toISOString();
    const cell = (minutes: number, lang: "en" | "ja") => renderRecord([{ ...rows[0]!, fixPublishedAt: "2026-10-01T00:00:00Z", actedAt: at(minutes) }], lang).trimEnd().split(" | ").pop()!.replace(/ \|$/, "");
    expect([0, 59, 60, 119, 48 * 60 - 1, 48 * 60, 3 * 1440 - 1, 30 * 1440].map(m => cell(m, "en"))).toEqual(["0 min", "59 min", "1 h", "1 h", "47 h", "2 d", "2 d", "30 d"]);
    expect([59, 60, 48 * 60].map(m => cell(m, "ja"))).toEqual(["59 分", "1 時間", "2 日"]);
  });

  it("shows the honest names and versions of every ecosystem", () => {
    const honest: [RecordRow["ecosystem"], string, string][] = [
      ["npm", "lodash", "4.17.21"], ["npm", "@babel/core", "7.24.0-rc.1+build.5"], ["npm", "JSONStream", "1.3.5"], ["npm", "lodash.merge", "4.6.2"],
      ["composer", "guzzlehttp/guzzle", "7.4.5"], ["composer", "symfony/http-kernel", "v6.4.1"], ["composer", "drupal/core-recommended", "dev-main"], ["composer", "a.b_c/d--e", "1.0"],
      ["maven", "org.apache.commons:commons-text", "1.10.0"], ["maven", "com.fasterxml.jackson.core:jackson-databind", "2.0.0-SNAPSHOT"],
      ["php", "php", "8.3.12"],
    ];
    const out = renderRecord(honest.map(([ecosystem, name, version]) => ({ ...rows[0]!, ecosystem, package: name, to: version })), "en").split("\n");
    expect(out[0]).toBe(`Ludion: fixed ${honest.length}`);
    expect(out.slice(4, -1).map(line => line.split(" | ").slice(1, 3))).toEqual(honest.map(([, name, version]) => [`\`${name}\``, `\`4.17.20\` → \`${version}\``]));
  });

  it("counts a row whose shown values do not have their strict form as unreadable, and shows none of its values", () => {
    const bad: Partial<RecordRow>[] = [
      // Names that would break the table or the code span.
      ...["a|b", "a\\|b", "a\\", "a\\\\|b", "a\nb", "a\r\nb", "a\u{2028}b", "a\u{2029}b", "a`b", "``", " pad ", "", "<script>x</script>", "x | y | z"].map(name => ({ package: name })),
      ...["1.0.0\\", "1.0|1", "1.0\n1", "`1`", "", " 1.0"].flatMap(version => [{ from: version }, { to: version }]),
      // Another ecosystem's form, or no ecosystem.
      { ecosystem: "composer", package: "lodash" }, { ecosystem: "composer", package: "Guzzle/Guzzle" }, { ecosystem: "maven", package: "lodash" }, { ecosystem: "php", package: "php8" },
      { ecosystem: "npm", package: "a:b" }, { ecosystem: "pypi" as RecordRow["ecosystem"] }, { ecosystem: ["npm"] as unknown as RecordRow["ecosystem"], package: "left-pad" }, { ecosystem: "toString" as RecordRow["ecosystem"] },
      { package: `${"a".repeat(107)}/${"a".repeat(107)}` }, { package: 7 as unknown as string },
      // Class and severity outside their lists.
      { class: "rce" as ImpactClass }, { severity: "toString" as RecordRow["severity"] }, { severity: ["high"] as unknown as RecordRow["severity"] }, { severity: "HIGH" as RecordRow["severity"] },
      // A trap's record id not of an id's form.
      { action: "stopped", stop: { reason: "trap", record: { id: "MAL-a|b" } } }, { action: "stopped", stop: { reason: "trap", record: { id: "MAL-1\\" } } },
    ];
    for (const lang of ["en", "ja"] as const) {
      const given = [rows[0]!, ...bad.map(change => ({ ...rows[2]!, ...change })), rows[3]!];
      const out = renderRecord(given, lang);
      const lines = out.split("\n");
      expect(lines.slice(0, 2)).toEqual(lang === "en"
        ? ["Ludion: fixed 1, waiting 1", `Rows that could not be read: ${bad.length}. Their contents are not shown.`]
        : ["Ludion：直した 1、待っている 1", `読めない行が ${bad.length} 件あった。中身は出していない。`]);
      expect(lines).toHaveLength(8);
      for (const line of lines.slice(3, -1)) expect([line, line.split("|").length]).toEqual([line, 9]);
      for (const text of ["guzzle", "Guzzle", "a|b", "pad", "script", "a\\", "php8", "pypi", "rce", "MAL-", "1.0.0\\", "1.0|1", "aaaa", "left-pad"]) expect([text, out.includes(text)]).toEqual([text, false]);
    }
    expect(renderRecord([{ ...rows[0]!, package: "a|b" }], "ja")).toBe("読めない行が 1 件あった。中身は出していない。\n");
  });

  it("escapes every \\ before every | in a code span, removes line breaks, and keeps the row's columns", () => {
    // Two readings of where a row's cells split: at each | that no \ escapes, a \ escaping the character after it (as
    // micromark reads it); and at each | with no \ right before it (as GitHub rendered `a\\|b` in one cell, 2026-10-31).
    const escaped = (line: string) => {
      let n = 0;
      for (let i = 0; i < line.length; i++) if (line[i] === "\\") i++; else if (line[i] === "|") n++;
      return n;
    };
    const github = (line: string) => [...line].filter((c, i) => c === "|" && line[i - 1] !== "\\").length;
    const cases: [string, string][] = [
      ["a|b", "`a\\|b`"], ["a\\|b", "`a\\\\\\|b`"], ["a\\", "`a\\\\`"], ["a\\\\|b", "`a\\\\\\\\\\|b`"], ["\\|", "`\\\\\\|`"],
      ["a\nb", "`a b`"], ["a\r\nb|", "`a b\\|`"], ["a\u{2028}b\u{2029}c", "`a b c`"], ["a`b", "``a`b``"], ["``", "``` `` ```"], ["`lead", "`` `lead ``"], ["", "`  `"],
    ];
    for (const [text, want] of cases) {
      expect([text, codeSpan(text)]).toEqual([text, want]);
      const row = `| ${codeSpan(text)} | x |`;
      expect([text, escaped(row), github(row)]).toEqual([text, 3, 3]);
    }
  });

  it("gives the same output for the same input and leaves the input as it was", () => {
    const copy = JSON.parse(JSON.stringify(rows));
    expect(renderRecord(rows, "ja")).toBe(renderRecord(copy, "ja"));
    expect(rows).toEqual(copy);
  });

  it("refuses a row it cannot render truthfully", () => {
    const bad: [Partial<RecordRow>, string][] = [
      [{ actedAt: "2026-02-30T00:00:00Z" }, "actedAt is not an ISO 8601 UTC time"],
      [{ actedAt: "2026-10-31" }, "actedAt is not an ISO 8601 UTC time"],
      [{ actedAt: "2026-10-31T09:00:00+09:00" }, "actedAt is not an ISO 8601 UTC time"],
      [{ fixPublishedAt: "yesterday" }, "fixPublishedAt is not an ISO 8601 UTC time"],
      [{ fixPublishedAt: "2026-10-04T00:00:00Z" }, "actedAt is before fixPublishedAt"],
      [{ action: "merged" as RecordRow["action"] }, "unknown action"],
      [{ action: "stopped" }, "a stopped row needs its reason"],
      [{ action: "stopped", stop: undefined as unknown as null }, "a stopped row needs its reason"],
      [{ action: "stopped", stop: "trap" as unknown as null }, "a stopped row needs its reason"],
      [{ stop: { reason: "tests" } }, "only a stopped row has a stop reason"],
      [{ action: "opened", stop: { reason: "trap", record: { id: "MAL-2025-1" } } }, "only a stopped row has a stop reason"],
      [{ action: "stopped", stop: { reason: "stopped" } as unknown as RecordRow["stop"] }, 'unknown stop reason "stopped"'],
      [{ action: "stopped", stop: { reason: "toString" } as unknown as RecordRow["stop"] }, 'unknown stop reason "toString"'],
      [{ action: "stopped", stop: {} as unknown as RecordRow["stop"] }, "unknown stop reason undefined"],
    ];
    for (const [change, message] of bad) expect(() => renderRecord([{ ...rows[0]!, ...change }], "en")).toThrow(message);
    expect(() => renderRecord(rows, "fr" as "en")).toThrow("Unknown language");
  });
});
