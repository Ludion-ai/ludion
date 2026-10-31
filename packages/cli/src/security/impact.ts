// Impact Classes: Ludion's own classification of a vulnerability record by what the attacker gains, not by how the
// hole works (CWE), and the protection record's Markdown table (docs/decisions/2026-10-31-impact-classes.md,
// docs/decisions/2026-10-31-impact-classes-trap-published-record.md, docs/decisions/2026-10-31-impact-classes-cvss-vector.md
// and docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md).
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

/** The CWE table's shape: each set of classes with the CWEs that allow it. */
export type CweTable = readonly (readonly [readonly TableClass[], readonly number[]])[];

/**
 * Each CWE in the table with every class an attacker can gain through its mechanism, strongest first; the record's
 * CVSS vector says which (docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md, one line of reason per CWE).
 * When in doubt the set is the wider one. A set has one class only when the mechanism can give only that. A CWE not
 * listed is unclassified. trap is a published record that says the version is malicious: a MAL- id or alias, or one
 * of TRAP_CWES.
 */
export const CWE_CLASSES: CweTable = [
  // External control of a setting (15), SQL injection (89), dangerous upload (434), hidden functionality (912), data
  // query logic (943), prototype pollution (1321): any of the five.
  [["takeover", "impersonate", "steal", "alter", "disrupt"], [15, 89, 434, 912, 943, 1321]],
  // Runs code or commands, or only reads, writes or stops: command (77, 78), code (94, 95, 96) and PHP include (98)
  // injection, code downloaded without an integrity check (494), deserialization (502), untrusted functionality (829),
  // expression language (917) and template (1336) injection; files reached outside their place, which a written file
  // the application runs turns into code: path traversal and its variants (22 to 40), link following (59), external
  // control of a file name (73), default and assigned permissions (276, 732), files accessible to external parties (552).
  [["takeover", "steal", "alter", "disrupt"], [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 59, 73, 77, 78, 94, 95, 96, 98, 276, 494, 502, 552, 732, 829, 917, 1336]],
  // Gets past login or permissions, then acts as someone, reads, changes or removes: XSS and its variants (79, 80, 83 to
  // 87), privileges (266, 269), access control and authorization (284, 285, 425, 639, 862, 863), authentication and its
  // bypasses (287 to 290, 294, 302, 303, 305 to 307), sessions (384, 613), passwords (620, 640), credentials (798, 1390 to
  // 1393).
  [["impersonate", "steal", "alter", "disrupt"], [79, 80, 83, 84, 85, 86, 87, 266, 269, 284, 285, 287, 288, 289, 290, 294, 302, 303, 305, 306, 307, 384, 425, 613, 620, 639, 640, 798, 862, 863, 1390, 1391, 1392, 1393]],
  // CSRF (352): the user is made to change or remove something; the answer cannot be read.
  [["impersonate", "alter", "disrupt"], [352]],
  // Open redirect (601), LDAP injection (90), XML injection (91), missing or cleartext encryption (311, 319), critical
  // state data (642): acts as the site or the user, reads, changes.
  [["impersonate", "steal", "alter"], [90, 91, 311, 319, 601, 642]],
  // XPath (643) and XQuery (652) "used to retrieve data", unprotected passwords and credentials (256, 257, 522),
  // cleartext storage (312): reads, and logs in with what it read.
  [["impersonate", "steal"], [256, 257, 312, 522, 643, 652]],
  // Assumed-immutable data (471) and web parameters (472), object attributes (915): changes, a role or identity among them.
  [["impersonate", "alter"], [471, 472, 915]],
  // XXE (611), SSRF (918): reads, sends requests that change or stop.
  [["steal", "alter", "disrupt"], [611, 918]],
  // Out-of-bounds reads (125 to 127): reads memory, or crashes.
  [["steal", "disrupt"], [125, 126, 127]],
  // Exposure of information through a response, a timing, an error, a cache, a log, a listing or a query string: read
  // only (200 to 204, 208, 209, 212 to 215, 226, 359, 497, 524 to 526, 532, 538, 548, 598).
  [["steal"], [200, 201, 202, 203, 204, 208, 209, 212, 213, 214, 215, 226, 359, 497, 524, 525, 526, 532, 538, 548, 598]],
  // Slows or stops the application: resource consumption and its forms (400, 401, 405, 407, 409, 770, 789, 834, 1050),
  // uncontrolled recursion (674) and XML entity expansion, its form in a DTD (776), infinite loop (835), ReDoS (1333).
  [["disrupt"], [400, 401, 405, 407, 409, 674, 770, 776, 789, 834, 835, 1050, 1333]],
];

/**
 * The malicious-code family: embedded malicious code (506), Trojan horse (507), malicious code (508, 509), trapdoor
 * (510), logic or time bomb (511), spyware (512). A record listing one says the version itself is malicious, so trap.
 * Hidden functionality (912) is not one of them: legitimate products get it for features they forgot to remove.
 */
export const TRAP_CWES: readonly number[] = [506, 507, 508, 509, 510, 511, 512];

/**
 * CWEs decided unclassified, each with its reason in the decision record: too broad to say what the attacker gains
 * (20, 74, 116, 184, 668, 693, 707, 754, 913, 1188, 1395), or doubtful between classes.
 */
export const DECIDED_UNCLASSIFIED: readonly number[] = [
  20, 74, 88, 93, 113, 116, 117, 119, 120, 122, 184, 190, 248, 295, 326, 327, 328, 330, 338, 345, 346, 347,
  362, 367, 416, 426, 476, 427, 436, 441, 444, 470, 668, 693, 707, 749, 754, 787, 843, 913, 916, 942, 1021,
  1022, 1188, 1236, 1385, 1395,
];

const lookups = new WeakMap<CweTable, Map<number, readonly TableClass[]>>();
/** The table as a CWE number → set lookup, built once per table. */
function lookup(table: CweTable): Map<number, readonly TableClass[]> {
  let map = lookups.get(table);
  if (!map) lookups.set(table, (map = new Map(table.flatMap(([classes, ids]) => ids.map(id => [id, classes] as const)))));
  return map;
}
const SEVERITIES: readonly Severity[] = ["critical", "high", "moderate", "low"];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What a CVSS vector says: whether confidentiality, integrity and availability are each affected (not N), and whether
 * one system's confidentiality and integrity are both H.
 */
type Affects = { c: boolean; i: boolean; a: boolean; full: boolean };
/**
 * The OSV severity types read, each with its score's prefix, the base metrics for C, I and A (CVSS 4: vulnerable and
 * subsequent systems), and the pairs of C and I metrics of one system.
 */
const VECTORS: Readonly<Record<string, { prefix: RegExp; c: readonly string[]; i: readonly string[]; a: readonly string[]; systems: readonly (readonly [string, string])[] }>> = {
  CVSS_V3: { prefix: /^CVSS:3\.[01]\//, c: ["C"], i: ["I"], a: ["A"], systems: [["C", "I"]] },
  CVSS_V4: { prefix: /^CVSS:4\.0\//, c: ["VC", "SC"], i: ["VI", "SI"], a: ["VA", "SA"], systems: [["VC", "VI"], ["SC", "SI"]] },
};
/**
 * When a class is consistent with a vector. No stronger class's condition follows from a weaker one's, so a vector can
 * move a record down from takeover or impersonate.
 */
const CONSISTENT: Readonly<Record<TableClass, (v: Affects) => boolean>> = {
  takeover: v => v.full,
  impersonate: v => v.c && v.i,
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
    const full = spec.systems.some(([ck, ik]) => values.get(ck)![0] === "H" && values.get(ik)![0] === "H");
    affects.push({ c: c as boolean, i: i as boolean, a: a as boolean, full });
  }
  return { affects };
}

const TRAP_NAMES: Readonly<Record<number, string>> = {
  506: "Embedded Malicious Code", 507: "Trojan Horse", 508: "Non-Replicating Malicious Code", 509: "Replicating Malicious Code",
  510: "Trapdoor", 511: "Logic/Time Bomb", 512: "Spyware",
};

/**
 * Classifies one OSV record (parsed JSON) with the CWE table (CWE_CLASSES unless another is given, as the measurements
 * and tests do). Never throws; a record it cannot read is unclassified with the reason.
 */
export function classify(record: unknown, table: CweTable = CWE_CLASSES): Classification {
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
  const trapCwe = TRAP_CWES.find(n => numbers.has(n));
  if (trapCwe !== undefined) return { class: "trap", severity, cwes, reason: `${id} lists CWE-${trapCwe} (${TRAP_NAMES[trapCwe]}): the version itself is malicious.${ignoredNote}` };
  if (!cwes.length) return { class: "unclassified", severity, cwes, reason: `${id} lists no CWE in database_specific.cwe_ids.${ignoredNote}` };
  const sets = lookup(table);
  const inTable = cwes.flatMap(cwe => {
    const classes = sets.get(Number(cwe.slice(4)));
    return classes ? [{ cwe, classes }] : [];
  });
  if (!inTable.length) return { class: "unclassified", severity, cwes, reason: `${id}: no CWE listed (${cwes.join(", ")}) is in Ludion's table.${ignoredNote}` };
  const read = vectors(record as Record<string, unknown>);
  if ("unreadable" in read) return { class: "unclassified", severity, cwes, reason: `${id}: ${read.unreadable}, so no class can be ruled out.${ignoredNote}` };
  const unclassified = (why: string): Classification => ({ class: "unclassified", severity, cwes, reason: `${id}: ${why}.${ignoredNote}` });
  // The record's set is the union of its CWEs' sets.
  const allowed = byStrength(inTable.flatMap(l => l.classes));
  const best = choose(allowed, read.affects);
  if (read.affects.length) {
    const vector = read.affects.length > 1 ? "CVSS vectors" : "CVSS vector";
    if (!best) return unclassified(`its ${vector} rule${read.affects.length > 1 ? "" : "s"} out every class its CWEs allow (${allowed.join(", ")})`);
    const from = inTable.find(l => l.classes.includes(best))!.cwe;
    return { class: best, severity, cwes, reason: `${id}: ${best} (${from}), the strongest class its CWEs allow (${allowed.join(", ")}) that its ${vector} do${read.affects.length > 1 ? "" : "es"} not rule out.${ignoredNote}` };
  }
  if (!best) return unclassified(`its CWEs allow ${allowed.slice(0, -1).join(", ")} or ${allowed.at(-1)}, and the record has no CVSS vector to choose`);
  return { class: best, severity, cwes, reason: `${id}: ${inTable.map(l => l.cwe).join(", ")} ${inTable.length > 1 ? "are" : "is"} ${best}.${ignoredNote}` };
}

const rank = (cls: ImpactClass) => IMPACT_ORDER.indexOf(cls);
/** The classes without repeats, strongest first. */
const byStrength = (classes: readonly TableClass[]): TableClass[] => [...new Set(classes)].sort((a, b) => rank(a) - rank(b));

/**
 * The step after the union: with vectors, the strongest class consistent with every one of them; with none, the set's
 * class when it has only one. Undefined when nothing is left. `allowed` is strongest first.
 */
function choose(allowed: readonly TableClass[], affects: readonly Affects[]): TableClass | undefined {
  if (affects.length) return allowed.find(cls => affects.every(CONSISTENT[cls]));
  return allowed.length === 1 ? allowed[0] : undefined;
}

/**
 * The class `classify()` gives a record whose CWEs together allow `set`, from the record's OSV `severity` list: the same
 * step classify() runs after taking the union. Exported so the tests can give it every set directly
 * (docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md, point 1).
 */
export function chooseClass(set: readonly TableClass[], severity: unknown): TableClass | "unclassified" {
  const read = vectors({ severity });
  if ("unreadable" in read) return "unclassified";
  return choose(byStrength(set), read.affects) ?? "unclassified";
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
/** The ecosystems whose names the record shows, as deliver.ts names them. */
export type RecordEcosystem = "npm" | "composer" | "maven" | "php";
export type RecordRow = {
  ecosystem: RecordEcosystem;
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

// The rows come from receipts, which are not trusted. Every value the table shows must have its strict form, as
// deliver.ts checks the values it uses; none of these forms allows \, |, a backtick or a line break, so an honest
// receipt loses no row. A row that does not match is counted as unreadable and none of its values is shown.
const NAMES: Readonly<Record<RecordEcosystem, RegExp>> = {
  // npm: an optional scope, then the name (older packages have capitals).
  npm: /^(?:@[a-z0-9][a-z0-9._~-]{0,213}\/)?[A-Za-z0-9][A-Za-z0-9._~-]{0,213}$/,
  // Composer's pattern for vendor/name, written without its optional separators so that it cannot backtrack.
  composer: /^[a-z0-9]+(?:[_.-][a-z0-9]+)*\/[a-z0-9]+(?:(?:[_.]|-{1,2})[a-z0-9]+)*$/,
  // Maven: groupId:artifactId.
  maven: /^[A-Za-z0-9_.-]{1,200}:[A-Za-z0-9_.-]{1,200}$/,
  // The official PHP image.
  php: /^php$/,
};
const NAME_LIMIT = 214;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_~-]{0,99}$/;
const RECORD_ID = /^[A-Za-z][A-Za-z0-9]{1,15}-[A-Za-z0-9._:-]{1,100}$/;

/** Whether every value the row shows has its strict form: ecosystem, package, versions, class, severity, a trap's record id. */
function readable(row: RecordRow): boolean {
  const ecosystem: unknown = row.ecosystem, record: unknown = isObject(row.stop) && row.stop.reason === "trap" ? row.stop.record : null;
  if (typeof ecosystem !== "string" || !Object.hasOwn(NAMES, ecosystem)) return false;
  if (typeof row.package !== "string" || row.package.length > NAME_LIMIT || !NAMES[ecosystem as RecordEcosystem].test(row.package)) return false;
  if (typeof row.from !== "string" || !VERSION.test(row.from) || typeof row.to !== "string" || !VERSION.test(row.to)) return false;
  if (!IMPACT_ORDER.includes(row.class) || (row.severity !== "unknown" && !SEVERITIES.includes(row.severity))) return false;
  // A trap's record with no id is refused below with classify()'s reason; one with an id must have an id's form.
  return !(isObject(record) && typeof record.id === "string" && !RECORD_ID.test(record.id));
}

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
    unreadable: (n: number) => `Rows that could not be read: ${n}. Their contents are not shown.`,
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
    unreadable: (n: number) => `読めない行が ${n} 件あった。中身は出していない。`,
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

/**
 * A Markdown code span, with a fence longer than any backtick run. Nothing is escaped: a code span shows an escaping \
 * as written, so text holding \, | or a line break (CR, LF, U+2028, U+2029) is refused. The second defence:
 * renderRecord shows only values of a strict form, which hold none of these.
 */
export function codeSpan(text: string): string {
  if (/[\\|\r\n\u{2028}\u{2029}]/u.test(text)) throw new Error(`A code span cannot hold \\, | or a line break: ${JSON.stringify(text)}`);
  const fence = "`".repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length)) + 1);
  const pad = /^[ `]|[ `]$/.test(text) || text === "" ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * The protection record: a summary line, then one table row per input row, in the input's order. Every number is a
 * count of the input rows or a time between two of its timestamps. A stop is written as a trap only with a published
 * record that classifies as trap; any other stop is "stopped as unverified" with its reason. A row whose shown values
 * do not all have their strict form is not shown: a line says how many there were. Throws on a row it cannot render
 * truthfully.
 */
export function renderRecord(rows: readonly RecordRow[], lang: Lang): string {
  const l = LABELS[lang];
  if (!l) throw new Error(`Unknown language: ${JSON.stringify(lang)}`);
  if (!rows.length) return `${l.none}\n`;
  const counts = new Map<Exclude<Action, "stopped">, number>(), unverified = new Map<StopReason, number>();
  let traps = 0, unreadable = 0;
  const lines = rows.flatMap((row, i) => {
    if (!readable(row)) {
      unreadable++;
      return [];
    }
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
      did = l.trapCell(codeSpan((stop.record as { id: string }).id));
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
    const cells = [new Date(acted).toISOString().slice(0, 10), codeSpan(row.package), `${codeSpan(row.from)} → ${codeSpan(row.to)}`, l.class[row.class], l.severity[row.severity], did, elapsed];
    return [`| ${cells.join(" | ")} |`];
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
  // Unreadable rows are only counted: none of their values is shown, and none enters the summary.
  const note = unreadable ? [l.unreadable(unreadable)] : [];
  if (!lines.length) return [...note, ""].join("\n");
  return [l.lead + parts.join(l.join), ...note, "", `| ${l.head.join(" | ")} |`, `|${l.head.map(() => "---").join("|")}|`, ...lines, ""].join("\n");
}
