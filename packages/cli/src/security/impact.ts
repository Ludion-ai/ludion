// Impact Classes: Ludion's own classification of a vulnerability record by what the attacker gains, not by how the
// hole works (CWE), and the protection record's Markdown table (docs/decisions/2026-10-31-impact-classes.md).
// The CWE table is fixed in this file and reviewed with it; nothing is inferred. Not wired into a PR body or a job
// summary yet.

export type ImpactClass = "trap" | "takeover" | "impersonate" | "steal" | "alter" | "disrupt" | "unclassified";
/** GHSA's severity as the OSV record's database_specific.severity gives it; unknown when it is missing or another value. */
export type Severity = "critical" | "high" | "moderate" | "low" | "unknown";
export type Classification = { class: ImpactClass; severity: Severity; cwes: string[]; reason: string };

/** Strongest first. A record with several CWEs takes the strongest class among them. */
export const IMPACT_ORDER: readonly ImpactClass[] = ["trap", "takeover", "impersonate", "steal", "alter", "disrupt", "unclassified"];

/**
 * Each CWE whose definition states what the attacker gains. A CWE not listed is unclassified. trap is never a CWE: it
 * is an OSV MAL- record.
 */
export const CWE_CLASSES: Readonly<Record<"takeover" | "impersonate" | "steal" | "alter" | "disrupt", readonly number[]>> = {
  // Runs their own code or commands where the application runs: OS command (78) and command (77) injection, code (94),
  // eval (95) and static code (96) injection, PHP file inclusion (98), dangerous file upload processed in the
  // application's environment (434), code downloaded without an integrity check (494), deserialization (502),
  // functionality included from an untrusted sphere (829), expression language (917) and template (1336) injection.
  takeover: [77, 78, 94, 95, 96, 98, 434, 494, 502, 829, 917, 1336],
  // Acts as a user or the owner, or goes past login or permissions: XSS and its variants (79, 80, 83 to 87), access
  // control (284), authorization (285, 639, 862, 863, 425), privileges (266, 269), authentication and its bypasses
  // (287 to 290, 294, 302, 303, 305 to 307), CSRF (352), session fixation and expiry (384, 613), open redirect (601),
  // password change and recovery (620, 640), hard-coded credentials (798), weak and default credentials (1390 to 1393).
  impersonate: [79, 80, 83, 84, 85, 86, 87, 266, 269, 284, 285, 287, 288, 289, 290, 294, 302, 303, 305, 306, 307, 352, 384, 425, 601, 613, 620, 639, 640, 798, 862, 863, 1390, 1391, 1392, 1393],
  // Reads data, files or secrets they must not see: path traversal and its variants (22, 23 to 40), SQL (89), LDAP
  // (90), XPath (643), XQuery (652) and data query (943) injection, out-of-bounds reads (125 to 127), SSRF (918), XXE
  // (611), exposure of sensitive information (200 to 204, 208, 209, 212 to 215, 226, 359, 497, 524 to 526, 532, 538,
  // 548, 552, 598), unprotected passwords and credentials (256, 257, 522), missing or cleartext encryption (311, 312, 319).
  steal: [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 89, 90, 125, 126, 127, 200, 201, 202, 203, 204, 208, 209, 212, 213, 214, 215, 226, 256, 257, 311, 312, 319, 359, 497, 522, 524, 525, 526, 532, 538, 548, 552, 598, 611, 643, 652, 918, 943],
  // Changes data, files or how the application behaves: external control of settings (15), XML injection (91),
  // assumed-immutable data and parameters (471, 472), critical state data (642), object attributes (915), prototype
  // pollution (1321).
  alter: [15, 91, 471, 472, 642, 915, 1321],
  // Slows or stops the application: resource consumption and its forms (400, 401, 405, 407, 409, 770, 789, 834, 1050),
  // uncontrolled recursion (674) and XML entity expansion, its form in a DTD (776), infinite loop (835), ReDoS (1333).
  disrupt: [400, 401, 405, 407, 409, 674, 770, 776, 789, 834, 835, 1050, 1333],
};

/**
 * CWEs decided unclassified, each with its reason in the decision record: too broad to say what the attacker gains
 * (20, 74, 116, 184, 668, 693, 707, 754, 913, 1188, 1395), or doubtful between classes.
 */
export const DECIDED_UNCLASSIFIED: readonly number[] = [
  20, 59, 73, 74, 88, 93, 113, 116, 117, 119, 120, 122, 184, 190, 248, 276, 295, 326, 327, 328, 330, 338, 345, 346, 347,
  362, 367, 416, 426, 476, 427, 436, 441, 444, 470, 506, 668, 693, 707, 732, 749, 754, 787, 843, 912, 913, 916, 942, 1021,
  1022, 1188, 1236, 1385, 1395,
];

const CLASS_OF = new Map<number, ImpactClass>(Object.entries(CWE_CLASSES).flatMap(([cls, ids]) => ids.map(id => [id, cls as ImpactClass] as const)));
const SEVERITIES: readonly Severity[] = ["critical", "high", "moderate", "low"];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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
  if (!cwes.length) return { class: "unclassified", severity, cwes, reason: `${id} lists no CWE in database_specific.cwe_ids.${ignoredNote}` };
  let best: { cls: ImpactClass; cwe: string } | null = null;
  for (const cwe of cwes) {
    const cls = CLASS_OF.get(Number(cwe.slice(4)));
    if (cls && (!best || IMPACT_ORDER.indexOf(cls) < IMPACT_ORDER.indexOf(best.cls))) best = { cls, cwe };
  }
  if (!best) return { class: "unclassified", severity, cwes, reason: `${id}: no CWE listed (${cwes.join(", ")}) is in Ludion's table.${ignoredNote}` };
  return { class: best.cls, severity, cwes, reason: `${id}: ${best.cwe} is ${best.cls}${cwes.length > 1 ? `, the strongest of ${cwes.join(", ")}` : ""}.${ignoredNote}` };
}

/** What Ludion did: opened a PR, stopped the update, is waiting before it, or the fix was merged. */
export type Action = "opened" | "stopped" | "waited" | "fixed";
export type RecordRow = {
  package: string;
  from: string;
  to: string;
  class: ImpactClass;
  severity: Severity;
  action: Action;
  /** The fix's official publish time (ISO 8601, UTC), or null when it is not known. */
  fixPublishedAt: string | null;
  /** When Ludion did `action` (ISO 8601, UTC). Its date is the row's date. */
  actedAt: string;
};
export type Lang = "en" | "ja";

const ACTIONS: readonly Action[] = ["fixed", "stopped", "opened", "waited"];
const LABELS = {
  en: {
    head: ["Date (UTC)", "Package", "Change", "Impact", "Severity", "Ludion", "Fix published to action"],
    class: { trap: "Trap", takeover: "Takeover", impersonate: "Impersonation", steal: "Data theft", alter: "Tampering", disrupt: "Disruption", unclassified: "Unclassified" },
    severity: { critical: "Critical", high: "High", moderate: "Moderate", low: "Low", unknown: "Unknown" },
    action: { fixed: "fixed (merged)", stopped: "stopped", opened: "opened a PR", waited: "waiting" },
    count: { fixed: "fixed", stopped: "stopped", opened: "PR opened", waited: "waiting" },
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
    action: { fixed: "直した（マージ済み）", stopped: "止めた", opened: "PR を開いた", waited: "待っている" },
    count: { fixed: "直した", stopped: "止めた", opened: "PR を開いた", waited: "待っている" },
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
 * count of the input rows or a time between two of its timestamps. Throws on a row it cannot render truthfully.
 */
export function renderRecord(rows: readonly RecordRow[], lang: Lang): string {
  const l = LABELS[lang];
  if (!l) throw new Error(`Unknown language: ${JSON.stringify(lang)}`);
  if (!rows.length) return `${l.none}\n`;
  const counts = new Map<Action, number>();
  const lines = rows.map((row, i) => {
    if (!IMPACT_ORDER.includes(row.class)) throw new Error(`Row ${i}: unknown class ${JSON.stringify(row.class)}`);
    if (!Object.hasOwn(l.severity, row.severity)) throw new Error(`Row ${i}: unknown severity ${JSON.stringify(row.severity)}`);
    if (!ACTIONS.includes(row.action)) throw new Error(`Row ${i}: unknown action ${JSON.stringify(row.action)}`);
    const acted = instant(row.actedAt, `Row ${i} actedAt`);
    let elapsed: string = l.unknown;
    if (row.fixPublishedAt !== null) {
      const minutes = Math.floor((acted - instant(row.fixPublishedAt, `Row ${i} fixPublishedAt`)) / 60_000);
      if (minutes < 0) throw new Error(`Row ${i}: actedAt is before fixPublishedAt`);
      elapsed = l.time(minutes);
    }
    counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
    const cells = [new Date(acted).toISOString().slice(0, 10), code(row.package), `${code(row.from)} → ${code(row.to)}`, l.class[row.class], l.severity[row.severity], l.action[row.action], elapsed];
    return `| ${cells.join(" | ")} |`;
  });
  const summary = l.lead + ACTIONS.filter(a => counts.has(a)).map(a => `${l.count[a]} ${counts.get(a)}`).join(l.join);
  return [summary, "", `| ${l.head.join(" | ")} |`, `|${l.head.map(() => "---").join("|")}|`, ...lines, ""].join("\n");
}
