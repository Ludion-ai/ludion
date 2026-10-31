// Impact Classes: Ludion's own classification of a vulnerability record by what the attacker gains, not by how the
// hole works (CWE), and the protection record's Markdown table (docs/decisions/2026-10-31-impact-classes.md,
// docs/decisions/2026-10-31-impact-classes-trap-published-record.md and docs/decisions/2026-10-31-impact-classes-cvss-vector.md).
// The CWE table is fixed in this file and reviewed with it; nothing is inferred. Not wired into a PR body or a job
// summary yet.

export type ImpactClass = "trap" | "takeover" | "impersonate" | "steal" | "alter" | "disrupt" | "unclassified";
/** GHSA's severity as the OSV record's database_specific.severity gives it; unknown when it is missing or another value. */
export type Severity = "critical" | "high" | "moderate" | "low" | "unknown";
export type Classification = { class: ImpactClass; severity: Severity; cwes: string[]; reason: string };

/** Strongest first. A record takes the strongest class its CWEs allow and its CVSS vectors do not rule out. */
export const IMPACT_ORDER: readonly ImpactClass[] = ["trap", "takeover", "impersonate", "steal", "alter", "disrupt", "unclassified"];

/** A class the CWE table can give: what the attacker gains through the hole. */
export type TableClass = Exclude<ImpactClass, "trap" | "unclassified">;

/**
 * Each CWE in the table with the set of classes its definition allows (docs/decisions/2026-10-31-impact-classes-cvss-vector.md).
 * A CWE not listed is unclassified. trap is a published record that says the version is malicious: a MAL- id or alias, or
 * TRAP_CWE.
 */
export const CWE_CLASSES: readonly (readonly [readonly TableClass[], readonly number[]])[] = [
  // Runs their own code or commands where the application runs: OS command (78) and command (77) injection, code (94),
  // eval (95) and static code (96) injection, PHP file inclusion (98), dangerous file upload processed in the
  // application's environment (434), code downloaded without an integrity check (494), deserialization (502),
  // functionality included from an untrusted sphere (829), expression language (917) and template (1336) injection.
  [["takeover"], [77, 78, 94, 95, 96, 98, 434, 494, 502, 829, 917, 1336]],
  // Gets past permissions to act, read or change: privileges (266, 269), access control (284), authorization (285, 425,
  // 639, 862, 863).
  [["impersonate", "steal", "alter"], [266, 269, 284, 285, 425, 639, 862, 863]],
  // Acts as a user or the owner: XSS and its variants (79, 80, 83 to 87), authentication and its bypasses (287 to 290,
  // 294, 302, 303, 305 to 307), CSRF (352), session fixation and expiry (384, 613), open redirect (601), password change
  // and recovery (620, 640), hard-coded credentials (798), weak and default credentials (1390 to 1393).
  [["impersonate"], [79, 80, 83, 84, 85, 86, 87, 287, 288, 289, 290, 294, 302, 303, 305, 306, 307, 352, 384, 601, 613, 620, 640, 798, 1390, 1391, 1392, 1393]],
  // Reads or writes data or files: path traversal and its variants (22, 23 to 40), SQL injection (89), files or
  // directories accessible to external parties (552), data query logic (943).
  [["steal", "alter"], [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 89, 552, 943]],
  // Reads data, files or secrets they must not see: LDAP (90), XPath (643) and XQuery (652) injection, out-of-bounds reads
  // (125 to 127), SSRF (918), XXE (611), exposure of sensitive information (200 to 204, 208, 209, 212 to 215, 226, 359,
  // 497, 524 to 526, 532, 538, 548, 598), unprotected passwords and credentials (256, 257, 522), missing or cleartext
  // encryption (311, 312, 319).
  [["steal"], [90, 125, 126, 127, 200, 201, 202, 203, 204, 208, 209, 212, 213, 214, 215, 226, 256, 257, 311, 312, 319, 359, 497, 522, 524, 525, 526, 532, 538, 548, 598, 611, 643, 652, 918]],
  // Changes data, files or how the application behaves: external control of settings (15), XML injection (91),
  // assumed-immutable data and parameters (471, 472), critical state data (642), object attributes (915), prototype
  // pollution (1321).
  [["alter"], [15, 91, 471, 472, 642, 915, 1321]],
  // Slows or stops the application: resource consumption and its forms (400, 401, 405, 407, 409, 770, 789, 834, 1050),
  // uncontrolled recursion (674) and XML entity expansion, its form in a DTD (776), infinite loop (835), ReDoS (1333).
  [["disrupt"], [400, 401, 405, 407, 409, 674, 770, 776, 789, 834, 835, 1050, 1333]],
];

/** Embedded Malicious Code: a record listing it is a GitHub-reviewed malware advisory, so trap. */
export const TRAP_CWE = 506;

/**
 * CWEs decided unclassified, each with its reason in the decision record: too broad to say what the attacker gains
 * (20, 74, 116, 184, 668, 693, 707, 754, 913, 1188, 1395), or doubtful between classes.
 */
export const DECIDED_UNCLASSIFIED: readonly number[] = [
  20, 59, 73, 74, 88, 93, 113, 116, 117, 119, 120, 122, 184, 190, 248, 276, 295, 326, 327, 328, 330, 338, 345, 346, 347,
  362, 367, 416, 426, 476, 427, 436, 441, 444, 470, 668, 693, 707, 732, 749, 754, 787, 843, 912, 913, 916, 942, 1021,
  1022, 1188, 1236, 1385, 1395,
];

const CLASSES_OF = new Map<number, readonly TableClass[]>(CWE_CLASSES.flatMap(([classes, ids]) => ids.map(id => [id, classes] as const)));
const SEVERITIES: readonly Severity[] = ["critical", "high", "moderate", "low"];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a CVSS vector says confidentiality, integrity and availability are each affected (not N). */
type Affects = { c: boolean; i: boolean; a: boolean };
/** The OSV severity types read, each with its score's prefix and the base metrics for C, I and A (CVSS 4: vulnerable and subsequent systems). */
const VECTORS: Readonly<Record<string, { prefix: RegExp; c: readonly string[]; i: readonly string[]; a: readonly string[] }>> = {
  CVSS_V3: { prefix: /^CVSS:3\.[01]\//, c: ["C"], i: ["I"], a: ["A"] },
  CVSS_V4: { prefix: /^CVSS:4\.0\//, c: ["VC", "SC"], i: ["VI", "SI"], a: ["VA", "SA"] },
};
/** When a class is consistent with a vector. */
const CONSISTENT: Readonly<Record<TableClass, (v: Affects) => boolean>> = {
  takeover: v => v.c || v.i || v.a,
  impersonate: v => v.c || v.i,
  steal: v => v.c,
  alter: v => v.i,
  disrupt: v => v.a,
};

/** The record's CVSS 3 and 4 vectors, or why one of them cannot be read. Other severity types are not read. */
function vectors(record: Record<string, unknown>): { affects: Affects[] } | { unreadable: string } {
  const affects: Affects[] = [];
  for (const entry of Array.isArray(record.severity) ? record.severity : []) {
    const type = isObject(entry) && typeof entry.type === "string" && Object.hasOwn(VECTORS, entry.type) ? entry.type : null;
    if (!type) continue;
    const spec = VECTORS[type]!, score = (entry as Record<string, unknown>).score;
    if (typeof score !== "string" || !spec.prefix.test(score)) return { unreadable: `its ${type} score is not a CVSS ${type.slice(6)} vector` };
    const values = new Map<string, string[]>();
    for (const part of score.split("/").slice(1)) {
      const [key = "", value = ""] = part.split(":");
      values.set(key, [...(values.get(key) ?? []), value]);
    }
    const affected = (keys: readonly string[]): boolean | string => {
      let any = false;
      for (const key of keys) {
        const seen = values.get(key) ?? [];
        if (seen.length !== 1 || !["N", "L", "H"].includes(seen[0]!)) return `${key} is given ${seen.length} time${seen.length === 1 ? "" : "s"}${seen.length ? ` (${seen.map(v => JSON.stringify(v)).join(", ")})` : ""}, not once as N, L or H`;
        any ||= seen[0] !== "N";
      }
      return any;
    };
    const c = affected(spec.c), i = affected(spec.i), a = affected(spec.a);
    for (const result of [c, i, a]) if (typeof result === "string") return { unreadable: `its ${type} vector cannot be read: ${result}` };
    affects.push({ c: c as boolean, i: i as boolean, a: a as boolean });
  }
  return { affects };
}

/** Classifies one OSV record (parsed JSON). Never throws; a record it cannot read is unclassified with the reason. */
export function classify(record: unknown): Classification {
  const id = isObject(record) && typeof record.id === "string" ? record.id : "";
  const specific = isObject(record) && isObject(record.database_specific) ? record.database_specific : {};
  const raw = typeof specific.severity === "string" ? specific.severity.toLowerCase() : "";
  const severity: Severity = (SEVERITIES as readonly string[]).includes(raw) ? (raw as Severity) : "unknown";
  const listed = Array.isArray(specific.cwe_ids) ? specific.cwe_ids : [];
  const numbers = new Set<number>(), ignored: string[] = [];
  for (const entry of listed) {
    const match = typeof entry === "string" ? /^CWE-([1-9]\d{0,5})$/i.exec(entry.trim()) : null;
    if (match) numbers.add(Number(match[1]));
    else ignored.push(JSON.stringify(entry));
  }
  const cwes = [...numbers].sort((a, b) => a - b).map(n => `CWE-${n}`);
  const ignoredNote = ignored.length ? ` Ignored cwe_ids entries not of the form CWE-<number>: ${ignored.slice(0, 5).join(", ")}${ignored.length > 5 ? ", …" : ""}.` : "";
  if (!id) return { class: "unclassified", severity, cwes, reason: `The record has no id.${ignoredNote}` };
  if (id.startsWith("MAL-")) return { class: "trap", severity, cwes, reason: `${id} is an OSV MAL- record: the version itself is malicious.${ignoredNote}` };
  const aliases = isObject(record) && Array.isArray(record.aliases) ? record.aliases : [];
  const malAlias = aliases.find((alias): alias is string => typeof alias === "string" && alias.startsWith("MAL-"));
  if (malAlias) return { class: "trap", severity, cwes, reason: `${id} has the alias ${malAlias}, an OSV MAL- record: the version itself is malicious.${ignoredNote}` };
  if (numbers.has(TRAP_CWE)) return { class: "trap", severity, cwes, reason: `${id} lists CWE-${TRAP_CWE} (Embedded Malicious Code): the version itself is malicious.${ignoredNote}` };
  if (!cwes.length) return { class: "unclassified", severity, cwes, reason: `${id} lists no CWE in database_specific.cwe_ids.${ignoredNote}` };
  const inTable = cwes.flatMap(cwe => {
    const classes = CLASSES_OF.get(Number(cwe.slice(4)));
    return classes ? [{ cwe, classes }] : [];
  });
  if (!inTable.length) return { class: "unclassified", severity, cwes, reason: `${id}: no CWE listed (${cwes.join(", ")}) is in Ludion's table.${ignoredNote}` };
  const rank = (cls: ImpactClass) => IMPACT_ORDER.indexOf(cls);
  const strongest = (classes: Iterable<TableClass>) => [...classes].sort((a, b) => rank(a) - rank(b))[0];
  const read = vectors(record as Record<string, unknown>);
  if ("unreadable" in read) return { class: "unclassified", severity, cwes, reason: `${id}: ${read.unreadable}, so no class can be ruled out.${ignoredNote}` };
  const unclassified = (why: string): Classification => ({ class: "unclassified", severity, cwes, reason: `${id}: ${why}.${ignoredNote}` });
  if (read.affects.length) {
    // The vectors keep only the classes consistent with every one of them; the record takes the strongest kept.
    const allowed = [...new Set(inTable.flatMap(l => l.classes))].sort((a, b) => rank(a) - rank(b));
    const best = strongest(allowed.filter(cls => read.affects.every(CONSISTENT[cls])));
    const vector = read.affects.length > 1 ? "CVSS vectors" : "CVSS vector";
    if (!best) return unclassified(`its ${vector} rule${read.affects.length > 1 ? "" : "s"} out every class its CWEs allow (${allowed.join(", ")})`);
    const from = inTable.find(l => l.classes.includes(best))!.cwe;
    return { class: best, severity, cwes, reason: `${id}: ${best} (${from}), the strongest class its CWEs allow (${allowed.join(", ")}) that its ${vector} do${read.affects.length > 1 ? "" : "es"} not rule out.${ignoredNote}` };
  }
  // No vector: a CWE with one class decides it, one with more decides nothing; the strongest decided class stands only
  // when no undecided CWE allows a stronger one.
  let best: { cls: TableClass; cwe: string } | null = null;
  for (const l of inTable) if (l.classes.length === 1 && (!best || rank(l.classes[0]!) < rank(best.cls))) best = { cls: l.classes[0]!, cwe: l.cwe };
  const open = inTable.find(l => l.classes.length > 1 && (!best || rank(strongest(l.classes)!) < rank(best.cls)));
  if (open || !best) {
    const o = open ?? inTable[0]!;
    return unclassified(`${o.cwe} allows ${o.classes.slice(0, -1).join(", ")} or ${o.classes.at(-1)}${best ? `, stronger than ${best.cls} (${best.cwe}),` : ""} and the record has no CVSS vector to choose`);
  }
  return { class: best.cls, severity, cwes, reason: `${id}: ${best.cwe} is ${best.cls}${cwes.length > 1 ? `, the strongest of ${cwes.join(", ")}` : ""}.${ignoredNote}` };
}

/** What Ludion did: opened a PR, stopped the update, is waiting before it, or the fix was merged. */
export type Action = "opened" | "stopped" | "waited" | "fixed";
/** Why Ludion stopped an update it could not verify; the decision record names the judge.ts findings each stands for. */
export type StopReason = "provenance-lost" | "provenance-changed" | "install-scripts" | "deprecated" | "withdrawn" | "replaced" | "new-advisory" | "downgrade" | "after-fix" | "lockfile" | "tests" | "undecidable";
/**
 * A trap carries the published record (an OSV record) that says the version is malicious; renderRecord checks it with
 * classify(). Any other stop is one Ludion could not verify, never a trap.
 */
export type Stop = { reason: "trap"; record: unknown } | { reason: StopReason };
export type RecordRow = {
  package: string;
  from: string;
  to: string;
  class: ImpactClass;
  severity: Severity;
  action: Action;
  /** Why it was stopped: required when action is "stopped", null otherwise. */
  stop: Stop | null;
  /** The fix's official publish time (ISO 8601, UTC), or null when it is not known. */
  fixPublishedAt: string | null;
  /** When Ludion did `action` (ISO 8601, UTC). Its date is the row's date. */
  actedAt: string;
};
export type Lang = "en" | "ja";

const ACTIONS: readonly Action[] = ["fixed", "stopped", "opened", "waited"];
const STOP_REASONS: readonly StopReason[] = ["provenance-lost", "provenance-changed", "install-scripts", "deprecated", "withdrawn", "replaced", "new-advisory", "downgrade", "after-fix", "lockfile", "tests", "undecidable"];
const LABELS = {
  en: {
    head: ["Date (UTC)", "Package", "Change", "Impact", "Severity", "Ludion", "Fix published to action"],
    class: { trap: "Trap", takeover: "Takeover", impersonate: "Impersonation", steal: "Data theft", alter: "Tampering", disrupt: "Disruption", unclassified: "Unclassified" },
    severity: { critical: "Critical", high: "High", moderate: "Moderate", low: "Low", unknown: "Unknown" },
    action: { fixed: "fixed (merged)", opened: "opened a PR", waited: "waiting" },
    count: { fixed: "fixed", opened: "PR opened", waited: "waiting" },
    trap: "trap stopped",
    unverified: "stopped as unverified",
    trapCell: (id: string) => `trap stopped (${id})`,
    unverifiedCell: (reason: string) => `stopped as unverified: ${reason}`,
    reasons: (list: string) => ` (${list})`,
    stop: {
      "provenance-lost": "provenance lost", "provenance-changed": "built from another repository or workflow", "install-scripts": "install scripts added",
      deprecated: "deprecated", withdrawn: "no longer listed by the registry", replaced: "another package under the same name",
      "new-advisory": "the new version has known advisories", downgrade: "the version goes down", "after-fix": "published at or after the fix",
      lockfile: "the lockfile or the changed files do not check out", tests: "tests fail on the new version", undecidable: "could not be judged",
    },
    lead: "Ludion: ",
    join: ", ",
    none: "No actions recorded. That does not mean the dependencies are safe.",
    unknown: "unknown",
    time: (minutes: number) => (minutes < 60 ? `${minutes} min` : minutes < 48 * 60 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d`),
  },
  ja: {
    head: ["日付（UTC）", "パッケージ", "変更", "分類", "深刻さ", "Ludion がしたこと", "修正の公開からの時間"],
    class: { trap: "罠", takeover: "乗っ取り", impersonate: "なりすまし", steal: "抜き取り", alter: "改ざん", disrupt: "停止", unclassified: "未分類" },
    severity: { critical: "重大", high: "高", moderate: "中", low: "低", unknown: "不明" },
    action: { fixed: "直した（マージ済み）", opened: "PR を開いた", waited: "待っている" },
    count: { fixed: "直した", opened: "PR を開いた", waited: "待っている" },
    trap: "罠を止めた",
    unverified: "確かめられなかったので止めた",
    trapCell: (id: string) => `罠を止めた（${id}）`,
    unverifiedCell: (reason: string) => `確かめられなかったので止めた（${reason}）`,
    reasons: (list: string) => `（${list}）`,
    stop: {
      "provenance-lost": "来歴が切れた", "provenance-changed": "作り元が変わった", "install-scripts": "install スクリプトが増えた",
      deprecated: "非推奨になった", withdrawn: "取り下げられた", replaced: "同じ名前の別のパッケージ",
      "new-advisory": "新しい版に既知の勧告がある", downgrade: "版が下がる", "after-fix": "修正の後に公開された",
      lockfile: "ロックファイルか変更の範囲が合わない", tests: "新しい版でテストが通らない", undecidable: "判断できなかった",
    },
    lead: "Ludion：",
    join: "、",
    none: "記録はありません。依存が安全だという意味ではありません。",
    unknown: "不明",
    time: (minutes: number) => (minutes < 60 ? `${minutes} 分` : minutes < 48 * 60 ? `${Math.floor(minutes / 60)} 時間` : `${Math.floor(minutes / 1440)} 日`),
  },
} as const;

/** Milliseconds since the epoch for an ISO 8601 UTC time that names a real instant (Date.parse accepts Feb 30). */
function instant(value: string, field: string): number {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,3})?Z$/.exec(value);
  const at = match ? Date.parse(value) : NaN;
  if (!match || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 19) !== match[1]) throw new Error(`${field} is not an ISO 8601 UTC time: ${JSON.stringify(value)}`);
  return at;
}

/** A Markdown code span that keeps a table row whole: no line break, every | escaped, a fence longer than any backtick run. */
function code(text: string): string {
  const flat = text.replace(/\r\n|[\r\n\u{2028}\u{2029}]/gu, " ").replace(/\|/g, "\\|");
  const fence = "`".repeat(Math.max(0, ...[...flat.matchAll(/`+/g)].map(m => m[0].length)) + 1);
  const pad = /^[ `]|[ `]$/.test(flat) || flat === "" ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/**
 * The protection record: a summary line, then one table row per input row, in the input's order. Every number is a
 * count of the input rows or a time between two of its timestamps. A stop is written as a trap only with a published
 * record that classifies as trap; any other stop is "stopped as unverified" with its reason. Throws on a row it cannot
 * render truthfully.
 */
export function renderRecord(rows: readonly RecordRow[], lang: Lang): string {
  const l = LABELS[lang];
  if (!l) throw new Error(`Unknown language: ${JSON.stringify(lang)}`);
  if (!rows.length) return `${l.none}\n`;
  const counts = new Map<Exclude<Action, "stopped">, number>(), unverified = new Map<StopReason, number>();
  let traps = 0;
  const lines = rows.map((row, i) => {
    if (!IMPACT_ORDER.includes(row.class)) throw new Error(`Row ${i}: unknown class ${JSON.stringify(row.class)}`);
    if (!Object.hasOwn(l.severity, row.severity)) throw new Error(`Row ${i}: unknown severity ${JSON.stringify(row.severity)}`);
    if (!ACTIONS.includes(row.action)) throw new Error(`Row ${i}: unknown action ${JSON.stringify(row.action)}`);
    const stop = row.stop;
    let did: string;
    if (row.action !== "stopped") {
      if (stop != null) throw new Error(`Row ${i}: only a stopped row has a stop reason`);
      did = l.action[row.action];
      counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
    } else if (typeof stop !== "object" || stop === null) {
      throw new Error(`Row ${i}: a stopped row needs its reason`);
    } else if (stop.reason === "trap") {
      // A trap only when a published record says the version is malicious, that is when classify() gives it trap.
      const c = classify(stop.record);
      if (c.class !== "trap") throw new Error(`Row ${i}: the stop is given as a trap, but its record does not say the version is malicious (${c.reason})`);
      did = l.trapCell(code((stop.record as { id: string }).id));
      traps++;
    } else if (STOP_REASONS.includes(stop.reason)) {
      did = l.unverifiedCell(l.stop[stop.reason]);
      unverified.set(stop.reason, (unverified.get(stop.reason) ?? 0) + 1);
    } else {
      throw new Error(`Row ${i}: unknown stop reason ${JSON.stringify((stop as { reason: unknown }).reason)}`);
    }
    const acted = instant(row.actedAt, `Row ${i} actedAt`);
    let elapsed: string = l.unknown;
    if (row.fixPublishedAt !== null) {
      const minutes = Math.floor((acted - instant(row.fixPublishedAt, `Row ${i} fixPublishedAt`)) / 60_000);
      if (minutes < 0) throw new Error(`Row ${i}: actedAt is before fixPublishedAt`);
      elapsed = l.time(minutes);
    }
    const cells = [new Date(acted).toISOString().slice(0, 10), code(row.package), `${code(row.from)} → ${code(row.to)}`, l.class[row.class], l.severity[row.severity], did, elapsed];
    return `| ${cells.join(" | ")} |`;
  });
  // Traps are counted apart, and only those a published record backs; every other stop is counted by its reason.
  const parts = ACTIONS.flatMap(a => {
    if (a !== "stopped") return counts.has(a) ? [`${l.count[a]} ${counts.get(a)}`] : [];
    const reasons = STOP_REASONS.filter(r => unverified.has(r));
    const total = reasons.reduce((sum, r) => sum + unverified.get(r)!, 0);
    return [
      ...(traps ? [`${l.trap} ${traps}`] : []),
      ...(total ? [`${l.unverified} ${total}${l.reasons(reasons.map(r => `${l.stop[r]} ${unverified.get(r)}`).join(l.join))}`] : []),
    ];
  });
  return [l.lead + parts.join(l.join), "", `| ${l.head.join(" | ")} |`, `|${l.head.map(() => "---").join("|")}|`, ...lines, ""].join("\n");
}
