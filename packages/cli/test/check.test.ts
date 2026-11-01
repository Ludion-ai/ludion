// The scheduled workflow's check job (docs/bench/lb2b-next1/definitions.md): before Docker, whether this run has
// anything for `patch` to do. Only the policy's ecosystem is looked at; a fix whose wait cannot have ended does not
// start patch (t*); a fix that is not new starts it only in the doubling 12-hour slots. No test reaches the network.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkProject, checkLines, seenRecord, slot, SLOT_HOURS, type CheckAnswer } from "../src/security/check.ts";
import { judge, WAIT_HOURS, type Change, type FixedAdvisory, type VersionFacts } from "../src/security/judge.ts";
import { EPSS_LIST } from "../src/security/npm-facts.ts";
import type { ProjectScan } from "../src/security/scan.ts";
import type { DependencyScan, Finding } from "../src/security/osv.ts";
import type { Scan } from "../src/security/php.ts";

const H = 3_600_000;
const NOW = Date.parse("2026-11-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const KEV = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-check-"));
  for (const [file, text] of Object.entries(files)) { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text); }
  return root;
}
const NPM_POLICY = JSON.stringify({ schema: 1, ecosystem: "npm", test: ["npm", "test"], timeout_seconds: 120 });
const COMPOSER_POLICY = JSON.stringify({ schema: 1, ecosystem: "composer", test: ["php", "tests/smoke.php"], timeout_seconds: 120 });
const MAVEN_POLICY = JSON.stringify({ schema: 1, ecosystem: "maven", test: ["mvn", "verify"], timeout_seconds: 120 });
const PHP_POLICY = JSON.stringify({ schema: 1, dockerfile: "Dockerfile", test: ["php", "tests/smoke.php"], timeout_seconds: 120 });
const NODE_POLICY = JSON.stringify({ schema: 1, ecosystem: "node", dockerfile: "Dockerfile", test: ["node", "tests/smoke.js"], timeout_seconds: 120 });
const npmProject = (extra: Record<string, string> = {}) => project({ "ludion.security.json": NPM_POLICY, "package.json": "{}", "package-lock.json": "{}", ...extra });

const finding = (name: string, version: string, id: string, aliases: string[] = [], ecosystem: "npm" | "composer" = "npm"): Finding =>
  ({ package: { ecosystem, name, version, direct: true }, advisory: { id, summary: id, aliases, affected: [] } });
function depScan(findings: Finding[], plan: { name: string; from: string; to: string }[], status: DependencyScan["status"] = findings.length ? "vulnerabilities_found" : "no_known_vulnerabilities"): DependencyScan {
  return { schema: 1, checked_at: iso(NOW), source: "https://osv.dev", sources: ["https://osv.dev"], status, inventory: { ecosystem: "npm", files: ["package-lock.json"], scope: "x", packages: [], limitations: [] }, findings, plan: plan.map(p => ({ ...p, advisories: [] })), blocked: [], note: "" };
}
const report = (checks: ProjectScan["checks"]): ProjectScan => ({ schema: 1, checked_at: iso(NOW), status: "attention_required", checks, unsupported: [] });

/** Stand-ins for OSV records, KEV, EPSS, the npm registry and Packagist; every other URL fails the test. */
function web(over: { records?: Record<string, unknown>; kev?: readonly string[] | null; epss?: Record<string, number> | null; npm?: Record<string, unknown>; packagist?: Record<string, unknown> } = {}) {
  const asked: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("https://api.osv.dev/v1/vulns/")) {
      const id = decodeURIComponent(url.slice("https://api.osv.dev/v1/vulns/".length));
      const record = over.records?.[id];
      return record === undefined ? json({ message: "not found" }, 404) : json(record);
    }
    if (url === KEV) return over.kev === null ? json({}, 503) : json({ vulnerabilities: (over.kev ?? []).map(cveID => ({ cveID })) });
    if (url === EPSS_LIST) {
      if (over.epss === null) return new Response("", { status: 503 });
      const rows = Object.entries(over.epss ?? {}).map(([cve, s]) => `${cve},${s},0.5`);
      return new Response(gzipSync(["#model_version:v1,score_date:2026-10-31T00:00:00Z", "cve,epss,percentile", "CVE-1999-0001,0.001,0.1", ...rows, ""].join("\n")));
    }
    if (url.startsWith("https://registry.npmjs.org/")) {
      const doc = over.npm?.[decodeURIComponent(url.slice("https://registry.npmjs.org/".length))];
      return doc === undefined ? json({}, 404) : json(doc);
    }
    if (url.startsWith("https://repo.packagist.org/p2/")) {
      const doc = over.packagist?.[url.slice("https://repo.packagist.org/p2/".length).replace(/\.json$/, "")];
      return doc === undefined ? json({}, 404) : json(doc);
    }
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
  return { fetchFn, asked };
}
const record = (id: string, modified: number, over: Record<string, unknown> = {}) => ({ id, modified: iso(modified), aliases: [], affected: [], ...over });
/** An npm registry document: each version with its publish time, and `time.modified`. */
const registry = (times: Record<string, number>, modified = Math.max(...Object.values(times))) =>
  ({ time: { created: iso(Math.min(...Object.values(times))), modified: iso(modified), ...Object.fromEntries(Object.entries(times).map(([v, t]) => [v, iso(t)])) }, versions: Object.fromEntries(Object.keys(times).map(v => [v, {}])) });

const LODASH = finding("lodash", "4.17.20", "GHSA-lodash", ["CVE-2026-1001"]);
const LODASH_PLAN = [{ name: "lodash", from: "4.17.20", to: "4.17.21" }];
/** One lodash fix published `age` hours before NOW, everything else old. */
function lodash(age: number, over: Parameters<typeof web>[0] = {}) {
  return web({ records: { "GHSA-lodash": record("GHSA-lodash", NOW - 400 * H, { aliases: ["CVE-2026-1001"] }) }, npm: { lodash: registry({ "4.17.20": NOW - 900 * H, "4.17.21": NOW - age * H }) }, ...over });
}
const run = (root: string, scan: ProjectScan, w: ReturnType<typeof web>, opts: { now?: number; changedAt?: number | null; keysOnly?: boolean } = {}) => {
  const asked: string[] = [];
  return checkProject(root, {
    now: new Date(opts.now ?? NOW), changedAt: opts.changedAt === null ? null : iso(opts.changedAt ?? NOW - 1000 * H), keysOnly: opts.keysOnly, fetchFn: w.fetchFn,
    scan: async (_root, ecosystem) => { asked.push(String(ecosystem)); return scan; },
  }).then(answer => ({ answer, scanned: asked }));
};
const keyOf = (a: CheckAnswer, key: string) => { if (!a.decided) throw new Error(`undecided: ${a.reason}`); return a.keys.find(k => k.key === key); };

describe("the policy's ecosystem only (T1, T2)", () => {
  it("scans npm only for an npm policy, even with a floating FROM node: in the folder, and names the image as not checked", async () => {
    const root = npmProject({ Dockerfile: "FROM node:22-alpine\nCOPY . .\n" });
    const { answer, scanned } = await run(root, report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), lodash(100));
    expect(scanned).toEqual(["npm"]);
    expect(answer.outside).toEqual(["node (Dockerfile)"]);
    expect(keyOf(answer, "npm:lodash")).toBeDefined();
    expect(answer.decided && answer.keys.map(k => k.key)).toEqual(["npm:lodash"]);
  });
  it("names a composer.lock with findings as not checked, and has no key for it", async () => {
    const root = npmProject({ "composer.lock": "{}", "composer.json": "{}" });
    const { answer, scanned } = await run(root, report([{ ecosystem: "npm", result: depScan([], []) }]), web());
    expect(scanned).toEqual(["npm"]);
    expect(answer).toMatchObject({ decided: true, keys: [], outside: ["composer"] });
  });
  it("scans the policy's Dockerfile only for an image policy", async () => {
    const root = project({ "ludion.security.json": PHP_POLICY, Dockerfile: "FROM php:8.4.26-cli\n", "package-lock.json": "{}" });
    const { scanned, answer } = await run(root, report([{ ecosystem: "php", result: image("no_newer_security_release", null) }]), web());
    expect(scanned).toEqual(["php"]);
    expect(answer).toMatchObject({ decided: true, keys: [], outside: ["npm"] });
  });
});

function image(status: Scan["status"], candidate: string | null, over: Partial<Scan> = {}): Scan {
  return { schema: 1, checked_at: iso(NOW), status, scope: "dockerfile_base_image", current: { reference: "php:8.4.26-cli", version: "8.4.26", branch: "8.4", flavor: "-cli", start: 0, end: 0 }, candidate: candidate ? { version: candidate, reference: `php:${candidate}-cli` } : null, security_releases: [], source: "x", note: "", ...over };
}

describe("the lower bound t* of the wait (T3)", () => {
  it("normal urgency: t* is the fix's publish time plus 72 hours, and the key waits until then", async () => {
    const { answer } = await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), lodash(10));
    expect(answer).toMatchObject({ decided: true, urgency: "normal" });
    expect(keyOf(answer, "npm:lodash")).toMatchObject({ state: "waits", not_before: iso(NOW - 10 * H + 72 * H) });
  });
  it("exploited (KEV): 12 hours, so a fix published 13 hours ago is due", async () => {
    const { answer } = await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), lodash(13, { kev: ["CVE-2026-1001"] }));
    expect(answer).toMatchObject({ urgency: "exploited" });
    expect(keyOf(answer, "npm:lodash")).toMatchObject({ state: "due", not_before: iso(NOW - 13 * H + 12 * H) });
  });
  it("high: CRITICAL, or an EPSS score of 0.1 or more, gives 24 hours", async () => {
    const critical = lodash(10, { records: { "GHSA-lodash": record("GHSA-lodash", NOW - 400 * H, { aliases: ["CVE-2026-1001"], database_specific: { severity: "CRITICAL" } }) } });
    const a = (await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), critical)).answer;
    expect(a).toMatchObject({ urgency: "high" });
    expect(keyOf(a, "npm:lodash")).toMatchObject({ not_before: iso(NOW - 10 * H + 24 * H) });
    const b = (await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), lodash(10, { epss: { "CVE-2026-1001": 0.1 } }))).answer;
    expect(b).toMatchObject({ urgency: "high" });
  });
  it("unknown urgency is 12 hours: KEV, the EPSS list or an advisory record that cannot be read", async () => {
    for (const over of [{ kev: null }, { epss: null }, { records: {} }] as const) {
      const { answer } = await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), lodash(10, over));
      expect(answer, JSON.stringify(over)).toMatchObject({ urgency: "unknown" });
      expect(keyOf(answer, "npm:lodash"), JSON.stringify(over)).toMatchObject({ state: "waits", not_before: iso(NOW - 10 * H + 12 * H) });
    }
  });
  it("a later version published before the smallest fixed one (a backport) counts with its own, earlier time", async () => {
    const w = web({ records: { "GHSA-lodash": record("GHSA-lodash", NOW - 400 * H) }, npm: { lodash: registry({ "4.17.20": NOW - 900 * H, "4.17.21": NOW - 10 * H, "4.18.0": NOW - 80 * H, "4.16.0": NOW - 5 * H }) } });
    const { answer } = await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), w);
    // 4.18.0 (80 hours ago) is not lower than 4.17.21, so P is its time: 80 − 72 = 8 hours ago, and the key does not wait.
    expect(keyOf(answer, "npm:lodash")).toMatchObject({ not_before: iso(NOW - 80 * H + 72 * H) });
    expect(keyOf(answer, "npm:lodash")!.state).not.toBe("waits");
  });
  it("u is the most urgent of every finding: a KEV entry on another package's advisory makes this one's wait 12 hours", async () => {
    const other = finding("minimist", "1.2.5", "GHSA-minimist", ["CVE-2026-2002"]);
    const w = web({
      kev: ["CVE-2026-2002"],
      records: { "GHSA-lodash": record("GHSA-lodash", NOW - 400 * H), "GHSA-minimist": record("GHSA-minimist", NOW - 400 * H, { aliases: ["CVE-2026-2002"] }) },
      npm: { lodash: registry({ "4.17.20": NOW - 900 * H, "4.17.21": NOW - 10 * H }), minimist: registry({ "1.2.5": NOW - 900 * H, "1.2.6": NOW - 500 * H }) },
    });
    const { answer } = await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH, other], [...LODASH_PLAN, { name: "minimist", from: "1.2.5", to: "1.2.6" }]) }]), w);
    expect(keyOf(answer, "npm:lodash")).toMatchObject({ state: "waits", not_before: iso(NOW - 10 * H + 12 * H) });
  });
  it("no bound when the package has no planned change or its registry document cannot be read", async () => {
    const noPlan = (await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], []) }]), lodash(1))).answer;
    expect(keyOf(noPlan, "npm:lodash")).toMatchObject({ not_before: null });
    const noRegistry = (await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), lodash(1, { npm: {} }))).answer;
    expect(keyOf(noRegistry, "npm:lodash")).toMatchObject({ not_before: null, state: "due" });
  });
});

describe("t* is never later than the judge's wait_until (T4)", () => {
  const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
  const PROV = { repository: "https://github.com/lodash/lodash", workflow: ".github/workflows/release.yml", commit: "5".repeat(40), repository_id: "1", event: "push" };
  const fact = (over: Partial<VersionFacts> = {}): VersionFacts => ({ published_at: iso(NOW - 900 * H), present: true, deprecated: null, publisher: "alice", shared_publisher: false, provenance: PROV, install_scripts: [], dependencies: [], integrity: INTEGRITY, malicious: [], advisories: [], package_created: "2012-01-01T00:00:00Z", ...over });
  const change: Change = { path: "node_modules/lodash", name: "lodash", from: "4.17.20", to: "4.17.21", dev: false, resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz", integrity: INTEGRITY, replaced: null };
  const fix = (over: Partial<FixedAdvisory>): FixedAdvisory => ({ id: "GHSA-lodash", package: "lodash", from: "4.17.20", to: "4.17.21", aliases: ["CVE-2026-1001"], severity: null, kev: false, epss: null, ...over });
  for (const [label, judged, checked, next, projectWait] of [
    ["normal", fix({}), {}, {}, undefined],
    ["high (CRITICAL)", fix({ severity: "CRITICAL" }), { records: { "GHSA-lodash": record("GHSA-lodash", NOW - 400 * H, { aliases: ["CVE-2026-1001"], database_specific: { severity: "CRITICAL" } }) } }, {}, undefined],
    ["exploited", fix({ kev: true }), { kev: ["CVE-2026-1001"] }, {}, undefined],
    ["exploited, provenance not comparable", fix({ kev: true }), { kev: ["CVE-2026-1001"] }, { provenance: null }, undefined],
    ["an extended wait (another publisher)", fix({}), {}, { publisher: "mallory" }, undefined],
    ["a stricter project wait", fix({}), {}, {}, { normal: 200 }],
  ] as const) {
    it(label, async () => {
      const published = NOW - 5 * H;
      const j = judge({ changes: [change], facts: new Map([["lodash@4.17.20", fact()], ["lodash@4.17.21", fact({ published_at: iso(published), ...next })]]), fixes: [judged], files: ["package-lock.json"], now: new Date(NOW), projectWait });
      const { answer } = await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]), lodash(5, checked));
      const t = keyOf(answer, "npm:lodash")!.not_before;
      expect(j.wait_until).not.toBeNull();
      expect(Date.parse(t!)).toBeLessThanOrEqual(Date.parse(j.wait_until!));
    });
  }
  it("uses the judge's own wait table", () => {
    expect(WAIT_HOURS).toMatchObject({ exploited: 12, high: 24, normal: 72 });
  });
});

describe("official images (T5)", () => {
  const php = (scan: Scan, w = web()) => run(project({ "ludion.security.json": PHP_POLICY, Dockerfile: "FROM php:8.4.26-cli\n" }), report([{ ecosystem: "php", result: scan }]), w);
  it("a move in its wait waits until wait_until, exactly", async () => {
    const until = iso(NOW + 30 * H);
    const { answer } = await php(image("wait", "8.4.28", { wait_until: until }));
    expect(keyOf(answer, "php")).toMatchObject({ state: "waits", not_before: until });
  });
  it("a move with no newer security release whose wait has ended is a key, and due (scan exits 0 for it)", async () => {
    const { answer } = await php(image("update_available", "8.4.28", { wait_until: iso(NOW - 2 * H) }));
    expect(keyOf(answer, "php")).toMatchObject({ state: "due", not_before: iso(NOW - 2 * H) });
  });
  it("a security move is due when its newest security release came out recently, and quiet in a slot that does not double", async () => {
    const recent = (await php(image("update_available", "8.4.28", { security_releases: [{ version: "8.4.28", date: "31 Oct 2026", security: true }] }))).answer;
    expect(keyOf(recent, "php")).toMatchObject({ state: "due", not_before: null });
    // Released 30 Sep 2026: its day ends 2026-10-01T00:00Z, 744 hours before NOW: slot 62, not a power of two.
    const old = (await php(image("update_available", "8.4.28", { security_releases: [{ version: "8.4.28", date: "30 Sep 2026", security: true }] }))).answer;
    expect(keyOf(old, "php")).toMatchObject({ state: "quiet", anchor: "2026-10-01T00:00:00.000Z", next_due: iso(Date.parse("2026-10-01T00:00:00Z") + 64 * SLOT_HOURS * H) });
  });
  it("a wait_until that is not a time is undecided, not a move with no bound", async () => {
    for (const wait_until of ["soon", ""]) expect((await php(image("update_available", "8.4.28", { wait_until }))).answer, wait_until).toMatchObject({ decided: false, reason: "the image check's wait_until is not a time." });
  });
  it("no candidate, no key; a node policy reads node's release days", async () => {
    expect((await php(image("no_newer_security_release", null))).answer).toMatchObject({ decided: true, keys: [] });
    const root = project({ "ludion.security.json": NODE_POLICY, Dockerfile: "FROM node:22.22.0-alpine\n" });
    const { answer, scanned } = await run(root, report([{ ecosystem: "node", result: image("update_available", "22.23.4", { runtime: "node", security_releases: [{ version: "22.23.4", date: "2026-10-31", security: true }] }) }]), web());
    expect(scanned).toEqual(["node"]);
    expect(keyOf(answer, "node")).toMatchObject({ state: "due", anchor: "2026-11-01T00:00:00.000Z" });
  });
});

describe("doubling for a fix that is not new (T6)", () => {
  it("is due in slots 0, 1, 2, 4 and 8 and quiet in 3, 5, 6, 7 and 9", () => {
    const at = (m: number) => slot(NOW - (m * SLOT_HOURS + 1) * H, NOW).due;
    expect([0, 1, 2, 4, 8, 16, 64].map(at)).toEqual([true, true, true, true, true, true, true]);
    expect([3, 5, 6, 7, 9, 15, 63].map(at)).toEqual([false, false, false, false, false, false, false]);
    expect(slot(NOW + H, NOW).due).toBe(true);
    expect(slot(NOW - (5 * SLOT_HOURS + 1) * H, NOW).next).toBe(NOW - (5 * SLOT_HOURS + 1) * H + 8 * SLOT_HOURS * H);
  });
  const oldFix = (over: Parameters<typeof web>[0] = {}) => web({ records: { "GHSA-lodash": record("GHSA-lodash", NOW - 1000 * H) }, npm: { lodash: registry({ "4.17.20": NOW - 2000 * H, "4.17.21": NOW - 1000 * H }) }, ...over });
  const scan = report([{ ecosystem: "npm", result: depScan([LODASH], LODASH_PLAN) }]);
  it("an old fix, an old commit and old facts: the anchor is t*, and slot 77 is quiet", async () => {
    // t* = 1000 − 72 = 928 hours ago is the latest of the times: slot ⌊928 / 12⌋ = 77, not a power of two.
    const { answer } = await run(npmProject(), scan, oldFix());
    expect(keyOf(answer, "npm:lodash")).toMatchObject({ state: "quiet", anchor: iso(NOW - 928 * H) });
  });
  it("a later commit time, a newer OSV modified or a newer registry time.modified moves the anchor and makes the key due", async () => {
    expect(keyOf((await run(npmProject(), scan, oldFix(), { changedAt: NOW - 3 * H })).answer, "npm:lodash")).toMatchObject({ state: "due", anchor: iso(NOW - 3 * H) });
    expect(keyOf((await run(npmProject(), scan, oldFix({ records: { "GHSA-lodash": record("GHSA-lodash", NOW - 2 * H) } }))).answer, "npm:lodash")).toMatchObject({ state: "due", anchor: iso(NOW - 2 * H) });
    const deprecated = oldFix({ npm: { lodash: registry({ "4.17.20": NOW - 2000 * H, "4.17.21": NOW - 1000 * H }, NOW - 4 * H) } });
    expect(keyOf((await run(npmProject(), scan, deprecated)).answer, "npm:lodash")).toMatchObject({ state: "due", anchor: iso(NOW - 4 * H) });
  });
  it("a fact that cannot be read makes the key due, and so does a missing commit time", async () => {
    expect(keyOf((await run(npmProject(), scan, oldFix({ records: {} }))).answer, "npm:lodash")).toMatchObject({ state: "due" });
    expect(keyOf((await run(npmProject(), scan, oldFix(), { changedAt: null })).answer, "npm:lodash")).toMatchObject({ state: "due" });
  });
  it("composer: Packagist's newest release time counts, and a Packagist-only advisory is unknown, so due", async () => {
    const root = project({ "ludion.security.json": COMPOSER_POLICY, "composer.json": "{}", "composer.lock": "{}" });
    const guzzle = finding("guzzlehttp/guzzle", "7.4.0", "GHSA-guzzle", [], "composer");
    const packagist = (newest: number) => ({ packages: { "guzzlehttp/guzzle": [{ version: "7.4.0", time: iso(NOW - 3000 * H) }, { version: "7.4.5", time: iso(newest) }] } });
    const w = (newest: number) => web({ records: { "GHSA-guzzle": record("GHSA-guzzle", NOW - 2000 * H) }, packagist: { "guzzlehttp/guzzle": packagist(newest) } });
    const plan = [{ name: "guzzlehttp/guzzle", from: "7.4.0", to: "7.4.5" }];
    const quiet = (await run(root, report([{ ecosystem: "composer", result: depScan([guzzle], plan) }]), w(NOW - 1000 * H))).answer;
    expect(keyOf(quiet, "composer:guzzlehttp/guzzle")).toMatchObject({ state: "quiet", not_before: null, anchor: iso(NOW - 1000 * H) });
    const fresh = (await run(root, report([{ ecosystem: "composer", result: depScan([guzzle], plan) }]), w(NOW - 1 * H))).answer;
    expect(keyOf(fresh, "composer:guzzlehttp/guzzle")).toMatchObject({ state: "due" });
    const pksa = finding("guzzlehttp/guzzle", "7.4.0", "PKSA-abcd-efgh", [], "composer");
    const ww = w(NOW - 1000 * H);
    const unknown = (await run(root, report([{ ecosystem: "composer", result: depScan([guzzle, pksa], plan) }]), ww)).answer;
    expect(keyOf(unknown, "composer:guzzlehttp/guzzle")).toMatchObject({ state: "due" });
    // A Packagist advisory id is never sent to OSV.
    expect(ww.asked.some(u => u.includes("PKSA-"))).toBe(false);
  });
  it("keys only (a PR head): no fact is read, every key is due", async () => {
    const w = web();
    const { answer } = await run(npmProject(), scan, w, { keysOnly: true });
    expect(w.asked).toEqual([]);
    expect(answer).toMatchObject({ decided: true, keys: [{ key: "npm:lodash", state: "due" }] });
  });
});

describe("undecided, so work=true (T7)", () => {
  it("a maven policy is not scanned", async () => {
    const root = project({ "ludion.security.json": MAVEN_POLICY, "pom.xml": "<project/>" });
    const { answer, scanned } = await run(root, report([]), web());
    expect(scanned).toEqual([]);
    expect(answer).toMatchObject({ decided: false, ecosystem: "maven" });
  });
  it("a scan error, an incomplete scan, a scan that throws, a policy that cannot be read", async () => {
    expect((await run(npmProject(), report([{ ecosystem: "npm", error: "OSV lookup failed" }]), web())).answer).toMatchObject({ decided: false, reason: expect.stringContaining("OSV lookup failed") });
    expect((await run(npmProject(), report([{ ecosystem: "npm", result: depScan([], [], "incomplete") }]), web())).answer).toMatchObject({ decided: false });
    expect((await run(project({ "ludion.security.json": PHP_POLICY, Dockerfile: "FROM php:8.4.26-cli\n" }), report([{ ecosystem: "php", error: "Docker Hub has no php:8.4.28-cli", security_releases: [{ version: "8.4.28", date: "31 Oct 2026", security: true }] }]), web())).answer).toMatchObject({ decided: false });
    const thrown = await checkProject(npmProject(), { now: new Date(NOW), changedAt: null, fetchFn: web().fetchFn, scan: async () => { throw new Error("boom"); } });
    expect(thrown).toMatchObject({ decided: false, reason: expect.stringContaining("boom") });
    const broken = await checkProject(project({ "ludion.security.json": "{" }), { now: new Date(NOW), changedAt: null, fetchFn: web().fetchFn, scan: async () => report([]) });
    expect(broken).toMatchObject({ decided: false, ecosystem: null });
  });
});

describe("the lines action/check.sh reads", () => {
  it("one tab-separated line per key, with the key cleaned, and undecided as one line", () => {
    const lines = checkLines({ schema: 1, checked_at: iso(NOW), ecosystem: "npm", outside: ["node (Dockerfile)"], decided: true, urgency: "normal", keys: [
      { key: "npm:@scope/pkg\tx", state: "due", not_before: null, anchor: null, next_due: null, why: "new\nline" },
      { key: "npm:lodash", state: "waits", not_before: iso(NOW + H), anchor: null, next_due: null, why: "w" },
    ] });
    expect(lines).toEqual(["decided\tnpm\tnormal", "outside\tnode (Dockerfile)", "key\tdue\tnpm:@scope/pkg?x\t-\tnew line", `key\twaits\tnpm:lodash\t${iso(NOW + H)}\tw`]);
    expect(checkLines({ schema: 1, checked_at: iso(NOW), ecosystem: "maven", outside: [], decided: false, reason: "a\tb" })).toEqual(["undecided\ta b"]);
  });
});

describe("the record of what this run saw (LEXP X3, docs/bench/lexp/definitions.md section 3)", () => {
  const COMMIT = "f".repeat(40);
  it("a dependency key carries the advisory IDs of its findings, and the record lists every key", async () => {
    const minimist = finding("minimist", "1.2.5", "GHSA-minimist");
    const { answer } = await run(npmProject(), report([{ ecosystem: "npm", result: depScan([LODASH, minimist, finding("lodash", "4.17.20", "GHSA-lodash-2")], [...LODASH_PLAN, { name: "minimist", from: "1.2.5", to: "1.2.6" }]) }]), lodash(10, { npm: { lodash: registry({ "4.17.20": NOW - 900 * H, "4.17.21": NOW - 10 * H }), minimist: registry({ "1.2.5": NOW - 900 * H, "1.2.6": NOW - 500 * H }) } }));
    expect(seenRecord(answer, COMMIT)).toEqual({
      schema: 1, kind: "ludion-seen", checked_at: iso(NOW), commit: COMMIT, ecosystem: "npm",
      keys: [{ key: "npm:lodash", advisories: ["GHSA-lodash", "GHSA-lodash-2"] }, { key: "npm:minimist", advisories: ["GHSA-minimist"] }],
    });
  });
  it("an image key carries the newer security releases and the candidate; no candidate, no key", async () => {
    const php = (scan: Scan) => run(project({ "ludion.security.json": PHP_POLICY, Dockerfile: "FROM php:8.4.26-cli\n" }), report([{ ecosystem: "php", result: scan }]), web());
    const { answer } = await php(image("update_available", "8.4.28", { security_releases: [{ version: "8.4.27", date: "31 Oct 2026", security: true }, { version: "8.4.28", date: "31 Oct 2026", security: true }] }));
    expect(seenRecord(answer, COMMIT)).toMatchObject({ ecosystem: "php", keys: [{ key: "php", releases: ["8.4.27", "8.4.28"], candidate: "8.4.28" }] });
    expect(seenRecord((await php(image("no_newer_security_release", null))).answer, COMMIT)).toMatchObject({ ecosystem: "php", keys: [] });
  });
  it("no record when the check does not decide, or for a commit that is not a SHA", async () => {
    const { answer } = await run(project({ "ludion.security.json": MAVEN_POLICY, "pom.xml": "<project/>" }), report([]), web());
    expect(seenRecord(answer, COMMIT)).toBeNull();
    const decided = (await run(npmProject(), report([{ ecosystem: "npm", result: depScan([], []) }]), web())).answer;
    expect(seenRecord(decided, "main")).toBeNull();
  });
});

// action/check.sh with stand-in node and gh (T8). The stand-ins answer from files the test writes.
describe.skipIf(process.platform === "win32")("action/check.sh (T8)", () => {
  const script = fileURLToPath(new URL("../../../action/check.sh", import.meta.url));
  const SHA = "a".repeat(40), HEAD = "b".repeat(40), BASE = "c".repeat(40);
  /**
   * behind: the first compare's behind_by (this commit against the PR head; 0 by default). moved: what the second compare
   * (the PR's merge base against this commit) lists, as the --jq in check.sh prints it: the count, then each file name;
   * null makes that compare fail. dir: the action's input `dir`.
   */
  function sh(main: string[], opts: { mainStatus?: number; pulls?: string; head?: string[]; ghFails?: boolean; behind?: number; moved?: string[] | null; movedStatus?: number; dir?: string; seen?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "ludion-check-sh-")), bin = join(dir, "bin"), temp = join(dir, "temp");
    mkdirSync(bin); mkdirSync(temp);
    writeFileSync(join(dir, "main.txt"), main.map(l => `${l}\n`).join(""));
    writeFileSync(join(dir, "head.txt"), (opts.head ?? []).map(l => `${l}\n`).join(""));
    writeFileSync(join(dir, "pulls.txt"), opts.pulls ?? "");
    writeFileSync(join(dir, "moved.txt"), (opts.moved ?? []).map(l => `${l}\n`).join(""));
    writeFileSync(join(dir, "calls"), "");
    // node CLI check --dir <d> [...]: the head's answer when --keys-only, else the commit's.
    writeFileSync(join(bin, "node"), `#!/usr/bin/env bash\necho "node $*" >> "${dir}/calls"\nfor a in "$@"; do [ "$a" = --keys-only ] && { cat "${dir}/head.txt"; exit 0; }; done\nnext=""; for a in "$@"; do [ "$next" = 1 ] && ${opts.seen ? `echo '{}' > "$a"` : "true"}; next=""; [ "$a" = --seen ] && next=1; done\ncat "${dir}/main.txt"\nexit ${opts.mainStatus ?? 0}\n`, { mode: 0o755 });
    const gh = opts.ghFails ? `exit 1` : [
      `case "$*" in`,
      `  *pulls\\?state=open*) cat "${dir}/pulls.txt" ;;`,
      `  *compare/${SHA}...${HEAD}*) echo "${opts.behind ?? 0} ${opts.behind ? BASE : SHA}" ;;`,
      `  *compare/${BASE}...${SHA}*) ${opts.moved === null ? "exit 1" : `cat "${dir}/moved.txt"; exit ${opts.movedStatus ?? 0}`} ;;`,
      `  *tarball/*) mkdir -p "${dir}/t/x" && echo '{}' > "${dir}/t/x/ludion.security.json" && tar -czf - -C "${dir}/t" x ;;`,
      `  *) exit 1 ;;`,
      `esac`,
    ].join("\n");
    writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\necho "gh $*" >> "${dir}/calls"\n${gh}\n`, { mode: 0o755 });
    writeFileSync(join(bin, "git"), `#!/usr/bin/env bash\necho 2026-10-31T00:00:00Z\n`, { mode: 0o755 });
    const out = join(dir, "out"), summary = join(dir, "summary");
    writeFileSync(out, ""); writeFileSync(summary, "");
    const r = spawnSync("bash", [script], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: temp, GITHUB_SHA: SHA, GITHUB_ACTION_PATH: fileURLToPath(new URL("../../../", import.meta.url)), GITHUB_WORKSPACE: dir, CLI: "/cli.js", PROJECT: dir, DIR: opts.dir ?? ".", REPO: "o/r", GH_TOKEN: "x" } });
    const output = readFileSync(out, "utf8").trim().split("\n");
    return { status: r.status, stdout: r.stdout + r.stderr, work: output.filter(l => !l.startsWith("seen=")).join("\n"), seen: output.filter(l => l.startsWith("seen=")), calls: readFileSync(join(dir, "calls"), "utf8"), temp };
  }
  const PR = `7 ${HEAD} o/r github-actions[bot] ludion/npm/lodash-4.17.21\n`;
  it("work=false without listing PRs when no key is due", () => {
    const r = sh(["decided\tnpm\tnormal", `key\twaits\tnpm:lodash\t2026-11-02T00:00:00.000Z\tthe wait cannot end before it`, "key\tquiet\tnpm:minimist\t2026-11-05T00:00:00.000Z\tslot 5"]);
    expect(r.work).toBe("work=false");
    expect(r.calls).not.toMatch(/^gh /m);
    expect(r.stdout).toContain("npm:lodash");
    expect(r.calls).toContain("--changed-at 2026-10-31T00:00:00Z");
  });
  it("asks the CLI for the record of what it saw, and says seen=true only when the CLI wrote it (LEXP X3)", () => {
    const wrote = sh(["decided\tnpm\tnormal", "key\twaits\tnpm:lodash\t2026-11-02T00:00:00.000Z\tw"], { seen: true });
    expect(wrote.calls).toContain(`--seen ${wrote.temp}/ludion/seen/seen.json --commit ${SHA}`);
    expect(wrote.seen).toEqual(["seen=true"]);
    expect(wrote.work).toBe("work=false");
    expect(sh(["decided\tnpm\tnormal"]).seen).toEqual([]);
    expect(sh(["undecided\ta maven policy"], { mainStatus: 2 }).seen).toEqual([]);
  });
  it("work=false with no key at all", () => {
    expect(sh(["decided\tnpm\tnormal"]).work).toBe("work=false");
  });
  it("work=true when a due key is not covered by an open Ludion PR", () => {
    expect(sh(["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue"], { pulls: "" }).work).toBe("work=true");
    // The PR's head still has the key: not covered.
    expect(sh(["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue"], { pulls: PR, head: ["decided\tnpm\t-", "key\tdue\tnpm:lodash\t-\tkeys only"] }).work).toBe("work=true");
  });
  it("work=false when every due key is covered by an open Ludion PR", () => {
    const r = sh(["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue", "key\twaits\tnpm:minimist\t2026-11-02T00:00:00.000Z\tw"], { pulls: PR, head: ["decided\tnpm\t-"] });
    expect(r.work).toBe("work=false");
    expect(r.stdout).toContain("#7");
  });
  it("a PR from another author or branch does not cover", () => {
    expect(sh(["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue"], { pulls: `7 ${HEAD} o/r someone ludion/npm/x\n`, head: ["decided\tnpm\t-"] }).work).toBe("work=true");
    expect(sh(["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue"], { pulls: `7 ${HEAD} o/r github-actions[bot] feature\n`, head: ["decided\tnpm\t-"] }).work).toBe("work=true");
  });
  it("a PR whose head ludion check cannot decide on does not cover, even when it exits 0", () => {
    const r = sh(["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue"], { pulls: PR, head: ["undecided\tthe npm scan is incomplete"] });
    expect(r.work).toBe("work=true");
    expect(r.stdout).toContain("PR #7: ludion check could not decide on its head; not counted.");
  });
  describe("a PR opened on an older base: counted only when nothing under the folder moved since its merge base", () => {
    const due = ["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue"], fixed = ["decided\tnpm\t-"];
    const stale = "PR #7: app may have changed on aaaaaaaaaaaa since the PR's merge base; not counted.";
    it("(a) a file under the folder moved: not counted, work=true", () => {
      const r = sh(due, { pulls: PR, head: fixed, behind: 2, moved: ["2", "README.md", "app/package-lock.json"], dir: "app" });
      expect(r.work).toBe("work=true");
      expect(r.stdout).toContain(stale);
      expect(r.calls).not.toMatch(/tarball/);
    });
    it("(a') a file renamed away from under the folder counts as moved under it", () => {
      const r = sh(due, { pulls: PR, head: fixed, behind: 1, moved: ["1", "lib/package-lock.json", "app/package-lock.json"], dir: "app" });
      expect(r.work).toBe("work=true");
      expect(r.stdout).toContain(stale);
      // The stand-in ignores --jq, so this holds only the filter check.sh passes: each file's old name too.
      expect(r.calls).toContain(`compare/${BASE}...${SHA} --jq (.files | length), (.files[] | .filename, (.previous_filename // empty))`);
    });
    it("(b) files moved only outside the folder (one whose name starts with it, too): counted, work=false", () => {
      const r = sh(due, { pulls: PR, head: fixed, behind: 3, moved: ["3", "README.md", "docs/app/x.md", "apple/package.json"], dir: "app" });
      expect(r.work).toBe("work=false");
      expect(r.stdout).toContain("#7");
      expect(r.calls).toMatch(/tarball/);
    });
    it("(c) 300 files moved, all outside the folder: not counted, work=true", () => {
      const r = sh(due, { pulls: PR, head: fixed, behind: 1, moved: ["300", ...Array.from({ length: 300 }, (_, i) => `other/${i}.txt`)], dir: "app" });
      expect(r.work).toBe("work=true");
      expect(r.stdout).toContain(stale);
      // 299 files outside the folder still count.
      expect(sh(due, { pulls: PR, head: fixed, behind: 1, moved: ["299", ...Array.from({ length: 299 }, (_, i) => `other/${i}.txt`)], dir: "app" }).work).toBe("work=false");
    });
    it("(d) the folder is the root and any file moved: not counted, work=true; nothing moved: counted", () => {
      const r = sh(due, { pulls: PR, head: fixed, behind: 1, moved: ["1", "README.md"] });
      expect(r.work).toBe("work=true");
      expect(r.stdout).toContain("PR #7: . may have changed on aaaaaaaaaaaa since the PR's merge base; not counted.");
      expect(sh(due, { pulls: PR, head: fixed, behind: 1, moved: ["0"] }).work).toBe("work=false");
    });
    it("(e) the second compare fails, or its count is not a number: not counted, work=true", () => {
      const r = sh(due, { pulls: PR, head: fixed, behind: 1, moved: null, dir: "app" });
      expect(r.work).toBe("work=true");
      expect(r.stdout).toContain("PR #7: GitHub did not list what changed since its merge base; not counted.");
      // A compare that prints a clean-looking answer and then fails is still a failure.
      const partial = sh(due, { pulls: PR, head: fixed, behind: 1, moved: ["0"], movedStatus: 1, dir: "app" });
      expect(partial.work).toBe("work=true");
      expect(partial.stdout).toContain("PR #7: GitHub did not list what changed since its merge base; not counted.");
      expect(sh(due, { pulls: PR, head: fixed, behind: 1, moved: ["many"], dir: "app" }).work).toBe("work=true");
    });
  });
  it("work=true when the CLI is undecided or fails, or when gh fails", () => {
    expect(sh(["undecided\ta maven policy"], { mainStatus: 2 }).work).toBe("work=true");
    expect(sh([], { mainStatus: 0 }).work).toBe("work=true");
    expect(sh(["decided\tnpm\tnormal", "key\tdue\tnpm:lodash\t-\tdue"], { ghFails: true }).work).toBe("work=true");
  });
});
