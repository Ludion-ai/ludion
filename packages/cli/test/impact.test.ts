// Impact Classes (docs/decisions/2026-10-31-impact-classes.md): the fixed CWE table, the strength order, MAL- as trap,
// GHSA severity only, and the protection record's table in English and Japanese.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CWE_CLASSES, DECIDED_UNCLASSIFIED, IMPACT_ORDER, classify, renderRecord, type ImpactClass, type RecordRow } from "../src/security/impact.ts";

const record = (cwes: unknown, extra: Record<string, unknown> = {}) => ({ id: "GHSA-xxxx-xxxx-xxxx", database_specific: { cwe_ids: cwes, ...extra } });
const MAPPED = ["takeover", "impersonate", "steal", "alter", "disrupt"] as const;

describe("the CWE table", () => {
  it("gives every listed CWE its class", () => {
    for (const cls of MAPPED) for (const id of CWE_CLASSES[cls]) expect([id, classify(record([`CWE-${id}`])).class]).toEqual([id, cls]);
  });

  it("keeps the examples the decision names", () => {
    const examples: Record<string, ImpactClass> = {
      78: "takeover", 94: "takeover", 502: "takeover", 79: "impersonate", 352: "impersonate", 601: "impersonate",
      89: "steal", 22: "steal", 918: "steal", 611: "steal", 1321: "alter", 400: "disrupt", 1333: "disrupt",
      20: "unclassified", 74: "unclassified", 707: "unclassified", 693: "unclassified",
    };
    for (const [id, cls] of Object.entries(examples)) expect([id, classify(record([`CWE-${id}`])).class]).toEqual([id, cls]);
  });

  it("puts no CWE in two classes, nor in a class and the decided-unclassified list", () => {
    const all = [...MAPPED.flatMap(c => CWE_CLASSES[c]), ...DECIDED_UNCLASSIFIED];
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
        const strong = `CWE-${CWE_CLASSES[MAPPED[i]!][0]}`, weak = `CWE-${CWE_CLASSES[MAPPED[j]!][0]}`;
        expect(classify(record([weak, strong])).class).toBe(MAPPED[i]);
        expect(classify(record([strong, weak])).class).toBe(MAPPED[i]);
        expect(classify(record([weak, "CWE-20", strong])).class).toBe(MAPPED[i]);
      }
    }
    expect(classify(record(["CWE-400", "CWE-20"])).class).toBe("disrupt");
    expect(classify(record(["CWE-918", "CWE-79"])).reason).toBe("GHSA-xxxx-xxxx-xxxx: CWE-79 is impersonate, the strongest of CWE-79, CWE-918.");
  });
});

describe("trap", () => {
  it("is every record whose id starts with MAL-, whatever its CWEs", () => {
    expect(classify({ id: "MAL-2025-1" })).toEqual({ class: "trap", severity: "unknown", cwes: [], reason: "MAL-2025-1 is an OSV MAL- record: the version itself is malicious." });
    expect(classify({ id: "MAL-2025-2", database_specific: { cwe_ids: ["CWE-79"], severity: "LOW" } })).toMatchObject({ class: "trap", severity: "low", cwes: ["CWE-79"] });
  });

  it("is not an id that only contains MAL-, a lower-case mal-, or a MAL- alias", () => {
    for (const id of ["GHSA-MAL-1", "XMAL-2025-1", "mal-2025-1", " MAL-2025-1"]) expect([id, classify({ id }).class]).toEqual([id, "unclassified"]);
    expect(classify({ id: "GHSA-1", aliases: ["MAL-2025-1"], database_specific: { cwe_ids: [] } }).class).toBe("unclassified");
  });

  it("is not a GHSA malware advisory with CWE-506 (decided unclassified: trap is the MAL- record)", () => {
    expect(classify(record(["CWE-506"], { severity: "CRITICAL" }))).toMatchObject({ class: "unclassified", severity: "critical" });
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
    expect(classify(record(["NVD-CWE-noinfo", "CWE-89"]))).toMatchObject({ class: "steal", cwes: ["CWE-89"] });
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
  // Written from each record's database_specific.cwe_ids and severity, read apart from classify().
  const expected: Record<string, [ImpactClass, string]> = {
    "GHSA-2234-fmw7-43wr": ["impersonate", "moderate"], "GHSA-2238-xc5r-v9hj": ["steal", "moderate"], "GHSA-223g-f5mq-gw33": ["impersonate", "moderate"],
    "GHSA-223j-4rm8-mrmf": ["steal", "low"], "GHSA-224p-v68g-5g8f": ["disrupt", "moderate"], "GHSA-226w-6hhj-69hp": ["unclassified", "critical"],
    "GHSA-2275-rpf5-xv8h": ["takeover", "high"], "GHSA-2299-ghjr-6vjp": ["unclassified", "low"], "GHSA-22h7-7wwg-qmgg": ["alter", "low"],
    "GHSA-22p9-wv53-3rq4": ["disrupt", "high"], "GHSA-22rr-f3p8-5gf8": ["unclassified", "high"], "GHSA-236c-vhj4-gfxg": ["takeover", "high"],
    "GHSA-238x-w2j9-gwwr": ["impersonate", "high"], "GHSA-23vw-mhv5-grv5": ["unclassified", "high"], "GHSA-23wx-cgxq-vpwx": ["alter", "moderate"],
    "GHSA-279x-mwfv-vcqv": ["takeover", "critical"], "MAL-2021-1": ["trap", "unknown"], "MAL-2021-2": ["trap", "unknown"],
    "GHSA-2223-f22x-24cq": ["steal", "moderate"], "GHSA-222v-cx2c-q2f5": ["impersonate", "moderate"], "GHSA-2237-5r9w-vm8j": ["steal", "high"],
    "GHSA-225x-3jhx-wh4q": ["impersonate", "moderate"], "GHSA-22gj-8qj2-fj46": ["unclassified", "moderate"], "GHSA-237r-r8m4-4q88": ["unclassified", "moderate"],
    "GHSA-23gj-x27g-r34f": ["takeover", "high"], "GHSA-243q-g9j3-qf6r": ["unclassified", "moderate"], "GHSA-2444-8gj8-6fmx": ["alter", "high"],
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

const rows: RecordRow[] = [
  { package: "lodash", from: "4.17.20", to: "4.17.21", class: "alter", severity: "high", action: "fixed", fixPublishedAt: "2026-10-01T00:00:00Z", actedAt: "2026-10-03T06:30:00Z" },
  { package: "@scope/evil", from: "1.0.0", to: "1.0.1", class: "trap", severity: "unknown", action: "stopped", fixPublishedAt: null, actedAt: "2026-10-04T00:00:00.000Z" },
  { package: "guzzlehttp/guzzle", from: "7.4.4", to: "7.4.5", class: "steal", severity: "moderate", action: "opened", fixPublishedAt: "2026-10-05T10:00:00Z", actedAt: "2026-10-05T10:45:59Z" },
  { package: "express", from: "4.19.1", to: "4.19.2", class: "impersonate", severity: "critical", action: "waited", fixPublishedAt: "2026-10-06T00:00:00Z", actedAt: "2026-10-06T05:00:00Z" },
  { package: "minimist", from: "1.2.5", to: "1.2.6", class: "unclassified", severity: "low", action: "fixed", fixPublishedAt: "2026-10-07T00:00:00Z", actedAt: "2026-10-08T23:59:00Z" },
];

describe("renderRecord", () => {
  it("renders the English table with its summary", () => {
    expect(renderRecord(rows, "en")).toBe([
      "Ludion: fixed 2, stopped 1, PR opened 1, waiting 1",
      "",
      "| Date (UTC) | Package | Change | Impact | Severity | Ludion | Fix published to action |",
      "|---|---|---|---|---|---|---|",
      "| 2026-10-03 | `lodash` | `4.17.20` → `4.17.21` | Tampering | High | fixed (merged) | 2 d |",
      "| 2026-10-04 | `@scope/evil` | `1.0.0` → `1.0.1` | Trap | Unknown | stopped | unknown |",
      "| 2026-10-05 | `guzzlehttp/guzzle` | `7.4.4` → `7.4.5` | Data theft | Moderate | opened a PR | 45 min |",
      "| 2026-10-06 | `express` | `4.19.1` → `4.19.2` | Impersonation | Critical | waiting | 5 h |",
      "| 2026-10-08 | `minimist` | `1.2.5` → `1.2.6` | Unclassified | Low | fixed (merged) | 47 h |",
      "",
    ].join("\n"));
  });

  it("renders the Japanese table with its summary", () => {
    expect(renderRecord(rows, "ja")).toBe([
      "Ludion：直した 2、止めた 1、PR を開いた 1、待っている 1",
      "",
      "| 日付（UTC） | パッケージ | 変更 | 分類 | 深刻さ | Ludion がしたこと | 修正の公開からの時間 |",
      "|---|---|---|---|---|---|---|",
      "| 2026-10-03 | `lodash` | `4.17.20` → `4.17.21` | 改ざん | 高 | 直した（マージ済み） | 2 日 |",
      "| 2026-10-04 | `@scope/evil` | `1.0.0` → `1.0.1` | 罠 | 不明 | 止めた | 不明 |",
      "| 2026-10-05 | `guzzlehttp/guzzle` | `7.4.4` → `7.4.5` | 抜き取り | 中 | PR を開いた | 45 分 |",
      "| 2026-10-06 | `express` | `4.19.1` → `4.19.2` | なりすまし | 重大 | 待っている | 5 時間 |",
      "| 2026-10-08 | `minimist` | `1.2.5` → `1.2.6` | 未分類 | 低 | 直した（マージ済み） | 47 時間 |",
      "",
    ].join("\n"));
  });

  it("names every class and action in both languages", () => {
    for (const lang of ["en", "ja"] as const) {
      const out = renderRecord(IMPACT_ORDER.map((cls, i) => ({ ...rows[0]!, class: cls, action: (["opened", "stopped", "waited", "fixed"] as const)[i % 4]! })), lang);
      expect(out).toContain(lang === "en" ? "Ludion: fixed 1, stopped 2, PR opened 2, waiting 2" : "Ludion：直した 1、止めた 2、PR を開いた 2、待っている 2");
      for (const label of lang === "en" ? ["Trap", "Takeover", "Impersonation", "Data theft", "Tampering", "Disruption", "Unclassified"] : ["罠", "乗っ取り", "なりすまし", "抜き取り", "改ざん", "停止", "未分類"]) expect(out).toContain(`| ${label} |`);
    }
  });

  it("counts only the rows it is given, and says an empty record is not a safe one", () => {
    expect(renderRecord([rows[1]!], "en").split("\n")[0]).toBe("Ludion: stopped 1");
    expect(renderRecord([], "en")).toBe("No actions recorded. That does not mean the dependencies are safe.\n");
    expect(renderRecord([], "ja")).toBe("記録はありません。依存が安全だという意味ではありません。\n");
  });

  it("rounds the time down, in minutes, hours, then days", () => {
    const at = (minutes: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + minutes * 60_000).toISOString();
    const cell = (minutes: number, lang: "en" | "ja") => renderRecord([{ ...rows[0]!, fixPublishedAt: "2026-10-01T00:00:00Z", actedAt: at(minutes) }], lang).trimEnd().split(" | ").pop()!.replace(/ \|$/, "");
    expect([0, 59, 60, 119, 48 * 60 - 1, 48 * 60, 3 * 1440 - 1, 30 * 1440].map(m => cell(m, "en"))).toEqual(["0 min", "59 min", "1 h", "1 h", "47 h", "2 d", "2 d", "30 d"]);
    expect([59, 60, 48 * 60].map(m => cell(m, "ja"))).toEqual(["59 分", "1 時間", "2 日"]);
  });

  it("keeps every row whole whatever the package name or version holds", () => {
    const names = ["a|b", "a\nb", "a\r\nb|", "a\u{2028}b", "a`b", "``", "`lead", " pad ", "", "a\\|b", "<script>x</script>", "x | y | z"];
    const out = renderRecord(names.map(name => ({ ...rows[0]!, package: name, to: name })), "en").split("\n");
    expect(out).toHaveLength(names.length + 5);
    for (const line of out.slice(2, -1)) expect([line, line.replace(/\\\|/g, "").split("|").length]).toEqual([line, 9]);
    expect(out[4]).toBe("| 2026-10-03 | `a\\|b` | `4.17.20` → `a\\|b` | Tampering | High | fixed (merged) | 2 d |");
    expect(out[5]).toContain("| `a b` |");
    expect(out[8]).toContain("| ``a`b`` |");
    expect(out[9]).toContain("| ``` `` ``` |");
    expect(out[10]).toContain("| `` `lead `` |");
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
      [{ class: "rce" as ImpactClass }, "unknown class"],
      [{ severity: "toString" as RecordRow["severity"] }, "unknown severity"],
      [{ action: "merged" as RecordRow["action"] }, "unknown action"],
    ];
    for (const [change, message] of bad) expect(() => renderRecord([{ ...rows[0]!, ...change }], "en")).toThrow(message);
    expect(() => renderRecord(rows, "fr" as "en")).toThrow("Unknown language");
  });
});
