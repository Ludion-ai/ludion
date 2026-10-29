import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categorize, predecessorIn, type Sources } from "../src/disputed.ts";
import { judgeVersion, readStore, registryPredecessor, renderReport, replay, windowOf, type Store } from "../src/replay.ts";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-02T00:00:00.000Z");
const at = (h: number) => new Date(T0 + h * HOUR).toISOString();
const integrity = (id: string) => `sha512-${createHash("sha512").update(id).digest("base64")}`;
const hex = (id: string) => createHash("sha512").update(id).digest("hex");

type Opts = { scripts?: Record<string, string>; deps?: Record<string, string>; user?: string; attested?: boolean; deprecated?: string };
const manifest = (name: string, v: string, o: Opts = {}) => ({
  name, version: v, scripts: o.scripts ?? {}, dependencies: o.deps ?? {}, _npmUser: { name: o.user ?? "alice" },
  dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${v}.tgz`, integrity: integrity(`${name}@${v}`), shasum: `sha1-${v}`, ...(o.attested ? { attestations: { url: "x" } } : {}) },
  ...(o.deprecated ? { deprecated: o.deprecated } : {}),
});
/** An attestations answer with SLSA v1 provenance naming the version and its tarball. */
const attestations = (name: string, v: string, repo = "https://github.com/alice/left-pad") => ({
  attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify({ subject: [{ name: `pkg:npm/${name}@${v}`, digest: { sha512: hex(`${name}@${v}`) } }], predicate: { buildDefinition: { externalParameters: { workflow: { repository: repo, path: ".github/workflows/publish.yml" } }, resolvedDependencies: [{ digest: { gitCommit: "a".repeat(40) } }] } } })).toString("base64") } } }],
});

/** A recorder store built record by record, written as the recorder lays it out. */
class World {
  captures: object[] = []; osv: object[] = []; status: object[] = [];
  watched: Record<string, string[]> = { "left-pad": ["1.0.0"] };
  constructor(pollsUntil = 900) {
    this.status.push({ type: "start", at: at(-1.5), commit: "c0ffee", watched_sha256: "w" });
    for (let h = -1; h <= pollsUntil; h++) this.status.push({ type: "poll", at: at(h), entries: 1, watched: 0 });
    for (let h = 0; h <= pollsUntil; h += 24) this.status.push({ type: "osv", at: at(h + 0.5), stored: 0 });
    this.captures.push({ type: "baseline", name: "left-pad", fetched_at: at(-0.5), time: { created: "2020-01-01T00:00:00.000Z", "1.0.0": "2020-01-01T00:00:00.000Z" }, dist_tags: { latest: "1.0.0" } });
    this.version("left-pad", "1.0.0", -0.5, "lockfile");
  }
  version(name: string, v: string, h: number, reason = "new", o: Opts = {}, att: object | null | "fail" = null) {
    const m = manifest(name, v, o);
    this.captures.push({ type: "version", name, version: v, reason, fetched_at: at(h), shared_publisher: false, manifest: m, attestations: att === "fail" ? { url: "x", status: 500, sha256: null, body: null } : att ? { url: "x", status: 200, body: att } : null, files: null });
    return this;
  }
  /** Publish name@v at hour h and capture it 0.01h later (a change record and its version record). */
  publish(name: string, v: string, h: number, o: Opts = {}, att: object | null | "fail" = null) {
    this.captures.push({ type: "change", name, fetched_at: at(h + 0.01), dist_tags: null, time: { [v]: at(h) }, removed: [] });
    return this.version(name, v, h + 0.01, "new", o, att);
  }
  mal(id: string, name: string, versions: string[], publishedH: number, fetchedH = publishedH + 1) {
    this.osv.push({ type: "osv", id, modified: at(publishedH), fetched_at: at(fetchedH), sha256: id, record: { id, published: at(publishedH), affected: [{ package: { ecosystem: "npm", name }, versions }] } });
    return this;
  }
  write(): string {
    const dir = mkdtempSync(join(tmpdir(), "replay-"));
    for (const [kind, list] of [["captures", this.captures], ["osv", this.osv], ["status", this.status]] as const) {
      mkdirSync(join(dir, kind));
      writeFileSync(join(dir, kind, "2026-11-02.jsonl"), list.map(x => JSON.stringify(x)).join("\n") + "\n");
    }
    return dir;
  }
  store(): Store { return readStore(this.write()); }
}
const ctxOf = (w: World, coverage = T0 + 900 * HOUR) => { const store = w.store(); return { store, records: [...store.osv.values()].map(c => c.at(-1)!.record), watched: new Map(Object.entries(w.watched)), coverage }; };
const row = (r: ReturnType<typeof judgeVersion>, scenario: string, u: string, prev?: string) => r.rows.find(x => x.scenario === scenario && x.row === u && (prev === undefined || x.prev === prev))!;

describe("the store", () => {
  it("drops records a crash repeated, ignoring fetched_at", () => {
    const w = new World().publish("left-pad", "1.0.1", 1);
    w.captures.push({ ...(w.captures.at(-1) as object), fetched_at: at(1.5) });
    const store = w.store();
    expect(store.duplicates).toBe(1);
    expect(store.versions.get("left-pad@1.0.1")).toHaveLength(1);
  });
});

describe("the four weeks", () => {
  const status = (hours: number[]) => hours.map(h => ({ type: "poll", at: at(h) }));
  it("start at the first successful poll and are complete after 28 days with a poll every day", () => {
    const hours = Array.from({ length: 31 * 24 }, (_, h) => h + 3);
    const w = windowOf(status(hours), T0 + 31 * 24 * HOUR);
    expect(w).toMatchObject({ start: at(3), end: at(3 + 28 * 24), state: "complete", runs: [{ start: at(3), broken_by: null }] });
    expect(windowOf(status(hours), T0 + 10 * 24 * HOUR).state).toBe("in_progress");
  });
  it("restart at the next successful poll after a UTC day with none", () => {
    const hours = Array.from({ length: 40 * 24 }, (_, h) => h).filter(h => h < 48 || h >= 72 + 5);
    const w = windowOf(status(hours), T0 + 40 * 24 * HOUR);
    expect(w.runs).toEqual([{ start: at(0), broken_by: "2026-11-04" }, { start: at(77), broken_by: null }]);
    expect(w.start).toBe(at(77));
  });
  it("do not count today, which is not over, as a break", () => {
    const w = windowOf(status([0, 1, 2]), T0 + 30 * HOUR);
    expect(w).toMatchObject({ state: "in_progress", runs: [{ start: at(0), broken_by: null }] });
  });
});

describe("one version, per row", () => {
  it("judges (b) at the judge's own wait_until per row, with the synthetic fix setting urgency", () => {
    const r = judgeVersion(ctxOf(new World().publish("left-pad", "1.0.1", 1)), "left-pad", "1.0.1", true);
    expect(r.decided_prev).toBe("1.0.0");
    // No provenance on either side: exploited waits 24h, not 12h.
    expect(["exploited", "high", "normal", "low"].map(u => [row(r, "b", u).urgency, row(r, "b", u).wait_hours, row(r, "b", u).wait_until])).toEqual([
      ["exploited", 24, at(25)], ["high", 24, at(25)], ["normal", 72, at(73)], ["low", 168, at(169)],
    ]);
    expect(r.rows.filter(x => x.scenario === "b").every(x => x.outcome === "missed" && x.verdict === "ready_except_build")).toBe(true);
    expect(row(r, "b", "low").judged_at).toBe(new Date(T0 + 169 * HOUR + 1).toISOString());
    expect(r.decided).toBe(true);
    // (a) has no exploited or high row; normal and low are judged with V direct.
    expect(row(r, "a", "exploited").outcome).toBe("not_applicable");
    expect(row(r, "a", "high").outcome).toBe("not_applicable");
    expect(row(r, "a", "normal")).toMatchObject({ urgency: "normal", wait_hours: 144 });
    expect(r.literal).toMatchObject({ scenario: "literal", urgency: "normal", verdict: "ready_except_build" });
    expect(r.capture_lag_hours).toBeCloseTo(0.01, 6);
  });

  it("uses 12h for exploited when both sides have comparable provenance", () => {
    const w = new World();
    w.captures.pop();
    w.version("left-pad", "1.0.0", -0.5, "lockfile", { attested: true }, attestations("left-pad", "1.0.0"));
    w.publish("left-pad", "1.0.1", 1, { attested: true }, attestations("left-pad", "1.0.1"));
    const r = judgeVersion(ctxOf(w), "left-pad", "1.0.1", false);
    expect(row(r, "b", "exploited")).toMatchObject({ wait_hours: 12, outcome: "missed" });
  });

  it("stops in every row on an added install script or a lost provenance", () => {
    const r = judgeVersion(ctxOf(new World().publish("left-pad", "1.0.1", 1, { scripts: { postinstall: "node x" } })), "left-pad", "1.0.1", true);
    expect(r.combined).toEqual({ exploited: "stopped", high: "stopped", normal: "stopped", low: "stopped" });
    expect(row(r, "b", "normal").stops!.join()).toMatch(/adds install scripts/);
    const w = new World();
    w.captures.pop();
    w.version("left-pad", "1.0.0", -0.5, "lockfile", { attested: true }, attestations("left-pad", "1.0.0"));
    w.publish("left-pad", "1.0.1", 1);
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.every(x => x.outcome === "stopped" && x.stops!.some(s => /had build provenance/.test(s)))).toBe(true);
  });

  it("re-queries MAL- records at wait_until: only those published by then stop", () => {
    // Published at hour 40: after high's wait_until (25), before normal's (73).
    const r = judgeVersion(ctxOf(new World().publish("left-pad", "1.0.1", 1).mal("MAL-1", "left-pad", ["1.0.1"], 40, 41)), "left-pad", "1.0.1", true);
    expect(r.combined).toMatchObject({ exploited: "missed", high: "missed", normal: "stopped", low: "stopped" });
    expect(row(r, "b", "normal").stops!.join()).toMatch(/MAL-1/);
  });

  it("recomputes wait_until with the facts as of that moment until it stops moving", () => {
    // The predecessor stops being listed at hour 50: before normal's first wait_until (73), so normal extends to 144h.
    const w = new World().publish("left-pad", "1.0.1", 1);
    w.captures.push({ type: "change", name: "left-pad", fetched_at: at(50), dist_tags: null, time: {}, removed: ["1.0.0"] });
    const r = judgeVersion(ctxOf(w), "left-pad", "1.0.1", false);
    expect(row(r, "b", "normal")).toMatchObject({ wait_hours: 144, wait_until: at(145), iterations: 2 });
    // exploited and high settled at 25, before the removal: unchanged.
    expect(row(r, "b", "high")).toMatchObject({ wait_hours: 24, wait_until: at(25) });
  });

  it("deprecation and removal of V captured before wait_until stop it", () => {
    const w = new World().publish("left-pad", "1.0.1", 1);
    w.captures.push({ type: "deprecation", name: "left-pad", version: "1.0.1", fetched_at: at(30), deprecated: "do not use" });
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.map(x => x.outcome)).toEqual(["missed", "missed", "stopped", "stopped"]);
  });

  it("is pending while wait_until is past the store's coverage", () => {
    const r = judgeVersion(ctxOf(new World().publish("left-pad", "1.0.1", 1), T0 + 100 * HOUR), "left-pad", "1.0.1", false);
    expect(r.rows.map(x => x.outcome)).toEqual(["missed", "missed", "missed", "pending"]);
    expect(r.decided).toBe(false);
  });
});

describe("capture gaps", () => {
  it("a version removed before its first capture", () => {
    const w = new World();
    w.captures.push({ type: "change", name: "left-pad", fetched_at: at(2), dist_tags: null, time: { "1.0.1": at(1) }, removed: [] });
    const r = judgeVersion(ctxOf(w), "left-pad", "1.0.1", true);
    expect(Object.values(r.combined!)).toEqual(["capture_gap", "capture_gap", "capture_gap", "capture_gap"]);
    expect(row(r, "b", "normal").gap).toMatch(/never captured/);
  });
  it("attestations the manifest lists that were not captured", () => {
    const r = judgeVersion(ctxOf(new World().publish("left-pad", "1.0.1", 1, { attested: true }, "fail")), "left-pad", "1.0.1", false);
    expect(r.rows.every(x => x.outcome === "capture_gap" && /attestations listed/.test(x.gap!))).toBe(true);
  });
  it("a new dependency's first publish that was not captured; a 404 is not a gap but stops", () => {
    const w = new World().publish("left-pad", "1.0.1", 1, { deps: { evil: "^1.0.0" } });
    expect(row(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false), "b", "normal")).toMatchObject({ outcome: "capture_gap" });
    w.captures.push({ type: "created", name: "evil", fetched_at: at(1.02), url: "x", status: 404, created: null });
    const r = judgeVersion(ctxOf(w), "left-pad", "1.0.1", false);
    expect(row(r, "b", "normal")).toMatchObject({ outcome: "stopped", verdict: "undecidable" });
    expect(r.decided).toBe(false);
    w.captures.push({ type: "created", name: "evil", fetched_at: at(1.03), url: "x", created: at(-2) });
    // Created 3h before T: younger than every row's base wait (rule 2), and a new dependency extends the wait.
    expect(row(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false), "b", "normal")).toMatchObject({ outcome: "stopped", verdict: "stop", wait_hours: 144 });
  });
  it("a capture taken after wait_until is not used for it", () => {
    // Captured 30h after publication: high's wait_until (25h) is before V's first capture.
    const w = new World();
    w.captures.push({ type: "change", name: "left-pad", fetched_at: at(31), dist_tags: null, time: { "1.0.1": at(1) }, removed: [] });
    w.version("left-pad", "1.0.1", 31);
    const r = judgeVersion(ctxOf(w), "left-pad", "1.0.1", false);
    expect(row(r, "b", "high")).toMatchObject({ outcome: "capture_gap" });
    expect(row(r, "b", "normal")).toMatchObject({ outcome: "missed" });
  });
});

describe("prevs", () => {
  it("judges every watched-lockfile version below V, and one miss is the row's miss", () => {
    const w = new World();
    w.watched["left-pad"] = ["0.9.0", "1.0.0", "2.0.0"];
    w.captures.push({ type: "change", name: "left-pad", fetched_at: at(-0.4), dist_tags: null, time: { "0.9.0": "2019-01-01T00:00:00.000Z" }, removed: [] });
    w.version("left-pad", "0.9.0", -0.4, "lockfile", { scripts: { postinstall: "x" } });
    w.publish("left-pad", "1.0.1", 1, { scripts: { postinstall: "x" } });
    const r = judgeVersion(ctxOf(w), "left-pad", "1.0.1", true);
    expect(r.decided_prev).toBe("1.0.0");
    expect(row(r, "b", "normal", "1.0.0").outcome).toBe("stopped");
    expect(row(r, "b", "normal", "0.9.0").outcome).toBe("missed");
    expect(r.combined!.normal).toBe("missed");
  });
  it("else the registry's predecessor, among versions listed (captured) when V was first captured", () => {
    const w = new World();
    w.watched = {};
    // 1.0.0's time is stored but it was never captured: it was not listed, so 0.9.0 is the predecessor.
    w.captures.push({ type: "change", name: "left-pad", fetched_at: at(-0.4), dist_tags: null, time: { "0.9.0": "2019-01-01T00:00:00.000Z" }, removed: [] });
    w.version("left-pad", "0.9.0", -0.4, "predecessor");
    w.captures.splice(1, 1);
    w.publish("left-pad", "1.0.1", 1);
    expect(registryPredecessor(w.store(), "left-pad", "1.0.1")).toBe("0.9.0");
    w.version("left-pad", "1.0.0", 1.02, "predecessor");
    expect(registryPredecessor(w.store(), "left-pad", "1.0.1")).toBe("1.0.0");
  });
  it("(b) without any version below V is a capture gap: a missing predecessor", () => {
    const w = new World();
    w.watched = {};
    w.captures.push({ type: "baseline", name: "fresh", fetched_at: at(1.01), time: { created: at(1), "1.0.0": at(1) }, dist_tags: {} });
    w.version("fresh", "1.0.0", 1.01);
    const r = judgeVersion(ctxOf(w), "fresh", "1.0.0", true);
    expect(r.rows.filter(x => x.scenario === "b").every(x => x.outcome === "capture_gap" && /missing predecessor/.test(x.gap!))).toBe(true);
    expect(r.decided).toBe(false);
    // (a): a package first published at T is younger than any base wait (rule 2).
    expect(row(r, "a", "normal")).toMatchObject({ outcome: "stopped" });
  });
});

/** Fake archive sources: files per version, all agreeing unless a test changes them. */
function sources(files: Record<string, Record<string, string>>, opts: { listed?: string[]; scripts?: Record<string, string[]>; records?: object[] } = {}): Sources {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const list = (v: string) => new Map(Object.entries(files[v]!).map(([p, c]) => [p, { sha256: sha(c), size: c.length }]));
  const listed = opts.listed ?? Object.keys(files);
  return {
    registryTime: async () => ({}),
    osvRecords: async () => opts.records ?? [],
    registry: async n => Object.fromEntries(listed.map(v => [v, { scripts: opts.scripts?.[v] ?? [], integrity: integrity(`${n}@${v}`), shasum: `sha1-${v}`, unpackedSize: null }])),
    registryTar: async (_n, v) => files[v] ? { ok: true, files: [...list(v)].map(([p, f]) => [p, f.sha256, f.size] as [string, string, number]), packageJson: files[v]!["package.json"] ?? null } : { ok: false, reason: "tarball HTTP 404" },
    jsdelivrList: async (_n, v) => files[v] ? list(v) : null,
    jsdelivrFile: async (_n, v, p) => files[v]?.[p] !== undefined ? Buffer.from(files[v]![p]!) : null,
    ecosystems: async () => ({ held: false, scripts: null, shasum: null, integrity: null, unpackedSize: null }),
    swh: async (n, v) => files[v] ? { held: true, visit: "2026-11-03", root: "r", files: list(v), dist: null, artifacts: [{ url: `https://registry.npmjs.org/${n}/-/${n}-${v}.tgz`, checksums: { sha1: `sha1-${v}` } }] } : { held: false, why: "not archived" },
  };
}
function malStore(versions: [string, number][], named: string[]): { store: Store; records: object[] } {
  const w = new World();
  w.captures.push({ type: "baseline", name: "p", fetched_at: at(-0.5), time: Object.fromEntries(versions.map(([v, h]) => [v, at(h)])), dist_tags: {} });
  for (const [v] of versions) w.version("p", v, -0.4, "lockfile");
  for (const v of named) w.mal(`MAL-${v}`, "p", [v], 20);
  const store = w.store();
  return { store, records: [...store.osv.values()].map(c => c.at(-1)!.record) };
}

describe("malicious categories (section 6)", () => {
  const pkg = (v: string, scripts = "{}") => `{"name":"p","version":"${v}","scripts":${scripts}}`;
  it("a version whose code differs from prev_d is confirmed", async () => {
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2]], ["1.0.1"]);
    const src = sources({ "1.0.0": { "package.json": pkg("1.0.0"), "index.js": "ok" }, "1.0.1": { "package.json": pkg("1.0.1"), "index.js": "evil" } }, { listed: ["1.0.0"] });
    const c = await categorize({ name: "p", version: "1.0.1", published: at(2), store, records: records as any, sources: src });
    expect(c).toMatchObject({ category: "confirmed", evidence: { step: "code differs from prev_d (jsDelivr's files)" } });
  });
  it("identical code with no other named version and no added install script: a false-report candidate", async () => {
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2], ["1.0.2", 3]], ["1.0.1"]);
    const src = sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "x", "README.md": "new" } });
    const c = await categorize({ name: "p", version: "1.0.1", published: at(2), store, records: records as any, sources: src });
    expect(c.category).toBe("false_report");
    expect(c.evidence).toMatchObject({ step: "disputed", o: "1.0.0", run: ["1.0.1", "1.0.0"], o_predecessor: null, o_adds_install_script: false });
  });
  it("a run that starts with an added install script: a record-omission candidate (freo-design-system)", async () => {
    const pre = pkg("1.0.3", `{"preinstall":"node s.js"}`);
    const { store, records } = malStore([["1.0.2", 1], ["1.0.3", 2], ["1.0.4", 3]], ["1.0.4"]);
    // 1.0.3 is named by no record but has 1.0.4's code; prev_d is 1.0.3 itself.
    const src = sources({ "1.0.2": { "package.json": pkg("1.0.2"), "s.js": "a" }, "1.0.3": { "package.json": pre, "s.js": "b" }, "1.0.4": { "package.json": pre.replace("1.0.3", "1.0.4"), "s.js": "b" } }, { scripts: { "1.0.3": ["preinstall"] } });
    const c = await categorize({ name: "p", version: "1.0.4", published: at(3), store, records: records as any, sources: src });
    expect(c.category).toBe("record_omission");
    expect(c.evidence).toMatchObject({ o: "1.0.3", o_predecessor: "1.0.2", o_adds_install_script: true });
  });
  it("O published after another named version: a record-omission candidate", async () => {
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2], ["1.0.2", 3], ["1.0.3", 4]], ["1.0.1", "1.0.3"]);
    const src = sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "evil" }, "1.0.2": { "package.json": pkg("1.0.2"), "a.js": "y" }, "1.0.3": { "package.json": pkg("1.0.3"), "a.js": "y" } });
    const c = await categorize({ name: "p", version: "1.0.3", published: at(4), store, records: records as any, sources: src });
    expect(c.category).toBe("record_omission");
    expect(c.evidence).toMatchObject({ prev_d: "1.0.2", o: "1.0.2", earliest_other_named: "1.0.1", o_after_earliest_named: true });
  });
  it("the recorder's own file hashes must equal the archives'", async () => {
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2]], ["1.0.1"]);
    store.versions.get("p@1.0.1")!.at(-1)!.files = [["a.js", 1, "f".repeat(64)], ["package.json", 1, "0".repeat(64)]];
    const src = sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "x" } });
    const c = await categorize({ name: "p", version: "1.0.1", published: at(2), store, records: records as any, sources: src });
    expect(c).toMatchObject({ category: "confirmed", evidence: { step: "the recorder's file list differs from jsDelivr's" } });
  });
  it("an unreadable source is not a dispute", async () => {
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2]], ["1.0.1"]);
    const src = { ...sources({}), osvRecords: async () => "unreadable" as const };
    expect((await categorize({ name: "p", version: "1.0.1", published: at(2), store, records: records as any, sources: src })).category).toBe("confirmed");
    const src2 = { ...sources({ "1.0.0": { "package.json": pkg("1.0.0") } }), jsdelivrList: async () => "unreadable" as const };
    expect((await categorize({ name: "p", version: "1.0.1", published: at(2), store, records: records as any, sources: src2 })).evidence).toMatchObject({ step: "jsDelivr unreadable" });
  });
  it("predecessorIn ignores later-published backports", () => {
    expect(predecessorIn(new Map([["1.0.0", at(1)], ["1.1.0", at(2)], ["1.0.1", at(3)], ["1.2.0", at(4)]]), "1.2.0")).toBe("1.0.1");
    expect(predecessorIn(new Map([["1.0.0", at(1)], ["2.0.0", at(2)], ["1.0.1", at(3)]]), "2.0.0")).toBe("1.0.0");
  });
});

describe("the report", () => {
  it("is not final while the window runs, and counts no miss for a false-report candidate", async () => {
    const w = new World(400);
    w.publish("left-pad", "1.0.1", 1).mal("MAL-9", "left-pad", ["1.0.1"], 100);
    const pkg = (v: string) => `{"name":"left-pad","version":"${v}"}`;
    const src = sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "x" } });
    const report = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: src });
    expect(report.final).toBe(false);
    expect(report.window.state).toBe("in_progress");
    expect(report.mal).toMatchObject({ records_naming_watched: 1, versions: 1, by_category: { false_report: 1 }, records_by_category: { false_report: 1, confirmed: 0 } });
    // The record (hour 100) is published before low's wait_until (169) only.
    expect(report.mal.cases[0]!.missed_rows).toEqual(["exploited", "high", "normal"]);
    expect(report.misses).toMatchObject({ count: 0, state: "not_yet" });
    expect(renderReport(report)).toMatch(/Final: no/);
  });
  it("without sources every MAL-named version counts as malicious, and a missed row or capture gap is a miss", async () => {
    const w = new World(400);
    w.publish("left-pad", "1.0.1", 1).mal("MAL-9", "left-pad", ["1.0.1"], 100);
    const report = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: null });
    expect(report.mal.by_category.not_checked).toBe(1);
    expect(report.misses).toMatchObject({ count: 1, state: "not_met", versions: ["left-pad@1.0.1"] });
  });
  it("is final after the window plus 336h: 100 decided versions and no MAL case is met, with no case", async () => {
    const w = new World(28 * 24 + 336 + 200);
    for (let i = 1; i <= 100; i++) w.publish("left-pad", `1.0.${i}`, i);
    // A record published long after the window's end + 336h does not join the denominator.
    w.publish("left-pad", "1.1.0", 300, { scripts: { postinstall: "x" } }).mal("MAL-late", "left-pad", ["1.1.0"], 28 * 24 + 337 + 50, 28 * 24 + 337 + 51);
    const report = await replay({ store: w.store(), watched: w.watched, asOf: T0 + (28 * 24 + 336 + 200) * HOUR, sources: sources({}) });
    expect(report.final).toBe(true);
    expect(report.versions_in_window).toBe(101);
    expect(report.decided).toEqual({ count: 101, needed: 100, state: "met" });
    expect(report.misses).toMatchObject({ count: 0, state: "met_with_no_case" });
    expect(report.mal.outside_window).toEqual([{ version: "left-pad@1.1.0", records: ["MAL-late"], why: "named only by records published after the window's end + 336h" }]);
  });
  it("a version published before the window is not counted", async () => {
    const w = new World(100);
    const report = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 100 * HOUR, sources: null });
    expect(report.versions_in_window).toBe(0);
  });
});

describe("reading a store that is being written", () => {
  it("skips a last line with no newline", () => {
    const w = new World().publish("left-pad", "1.0.1", 1);
    const dir = w.write();
    writeFileSync(join(dir, "captures", "2026-11-03.jsonl"), `${JSON.stringify({ type: "deprecation", name: "left-pad", version: "1.0.1", fetched_at: at(30), deprecated: "x" })}\n{"type":"version","na`);
    const store = readStore(dir);
    expect(store.deprecations.get("left-pad@1.0.1")).toHaveLength(1);
    expect(store.versions.get("left-pad@1.0.1")).toHaveLength(1);
  });
});

describe("retries and repeats", () => {
  it("seeds from the first capture with every input: a later retry fills a failed attestations read", () => {
    const w = new World().publish("left-pad", "1.0.1", 1, { attested: true }, "fail");
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.every(x => x.outcome === "capture_gap")).toBe(true);
    w.version("left-pad", "1.0.1", 2.01, "retry", { attested: true }, attestations("left-pad", "1.0.1"));
    const r = judgeVersion(ctxOf(w), "left-pad", "1.0.1", false);
    // No provenance on 1.0.0, provenance on 1.0.1: not comparable, so exploited waits 24h; nothing stops.
    expect(r.rows.map(x => [x.outcome, x.wait_hours])).toEqual([["missed", 24], ["missed", 24], ["missed", 72], ["missed", 168]]);
  });
  it("keeps a value that changes and changes back, and drops only a repeat of the record before it", () => {
    const w = new World().publish("left-pad", "1.0.1", 1);
    const dep = (h: number, d: string | null) => ({ type: "deprecation", name: "left-pad", version: "1.0.1", fetched_at: at(h), deprecated: d });
    w.captures.push(dep(10, "x"), dep(10.5, "x"), dep(11, null), dep(20, "x"));
    const store = w.store();
    expect(store.deprecations.get("left-pad@1.0.1")!.map(d => d.deprecated)).toEqual(["x", null, "x"]);
    expect(store.duplicates).toBe(1);
    // Deprecated again at hour 20, before every row's wait_until: every row stops.
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.every(x => x.outcome === "stopped")).toBe(true);
  });
});

describe("review fixes (PR #194)", () => {
  const copy = (id: string, versions: string[], publishedH: number, modifiedH: number, extra: object = {}) => ({ type: "osv", id, modified: at(modifiedH), fetched_at: at(modifiedH + 1), sha256: `${id}-${modifiedH}`, record: { id, published: at(publishedH), modified: at(modifiedH), affected: [{ package: { ecosystem: "npm", name: "left-pad" }, versions }], ...extra } });
  const pkg = (v: string) => `{"name":"left-pad","version":"${v}"}`;
  const same = () => sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "x" } });
  const finalWorld = () => { const w = new World(28 * 24 + 336 + 200); w.publish("left-pad", "1.0.1", 1); return w; };
  const asOfFinal = T0 + (28 * 24 + 336 + 200) * HOUR;

  it("reads a MAL- record as its copy modified by the judgement says, not as it is today", () => {
    // Published before V naming only 1.0.0; extended to 1.0.1 at hour 200, after every row's wait_until.
    const w = new World().publish("left-pad", "1.0.1", 1);
    w.osv.push(copy("MAL-x", ["1.0.0"], -10, -10), copy("MAL-x", ["1.0.0", "1.0.1"], -10, 200));
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.map(x => x.outcome)).toEqual(["missed", "missed", "missed", "missed"]);
    // Extended at hour 30 instead: normal (73) and low (169) see it.
    const w2 = new World().publish("left-pad", "1.0.1", 1);
    w2.osv.push(copy("MAL-x", ["1.0.0"], -10, -10), copy("MAL-x", ["1.0.0", "1.0.1"], -10, 30));
    expect(judgeVersion(ctxOf(w2), "left-pad", "1.0.1", false).rows.map(x => x.outcome)).toEqual(["missed", "missed", "stopped", "stopped"]);
  });
  it("keeps a withdrawn record's version in the denominator", async () => {
    const w = finalWorld();
    w.osv.push(copy("MAL-w", ["1.0.1"], 100, 100), copy("MAL-w", ["1.0.1"], 100, 300, { withdrawn: at(300) }));
    const report = await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: null });
    expect(report.mal.versions).toBe(1);
    expect(report.misses).toMatchObject({ count: 1, state: "not_met" });
  });
  it("is not final until an OSV read 24h past the window's end + 336h", async () => {
    const w = finalWorld();
    w.status = w.status.filter(s => (s as { type: string }).type !== "osv" || Date.parse((s as { at: string }).at) <= T0 + (671 + 336 + 22) * HOUR);
    const report = await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: sources({}) });
    expect(report.final).toBe(false);
    expect(report.not_final_because.join()).toMatch(/last OSV read/);
    expect(report.misses.state).toBe("not_yet");
  });
  it("says met, not met with no case, when every case is a false-report candidate", async () => {
    const w = finalWorld().mal("MAL-9", "left-pad", ["1.0.1"], 100);
    const report = await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: same() });
    expect(report.final).toBe(true);
    expect(report.mal.by_category.false_report).toBe(1);
    expect(report.misses).toMatchObject({ count: 0, state: "met" });
  });
  it("a MAL-named version with no stored publish time: a capture gap, unless the registry's time places it outside", async () => {
    const w = new World(400).mal("MAL-g", "left-pad", ["1.0.9"], 100);
    const offline = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: null });
    expect(offline.versions_in_window).toBe(0);
    expect(offline.mal.cases.map(c => [c.version, c.missed_rows.length, c.rows[0]!.gap])).toEqual([["1.0.9", 4, "no stored publish time, and the registry's time was not read"]]);
    const old = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: { ...same(), registryTime: async () => ({ "1.0.9": "2019-01-01T00:00:00.000Z" }) } });
    expect(old.mal.cases).toEqual([]);
    expect(old.mal.outside_window[0]!.why).toMatch(/registry's time/);
    const inside = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: { ...same(), registryTime: async () => ({ "1.0.9": at(5) }) } });
    expect(inside.mal.cases[0]!.rows[0]!.gap).toMatch(/never captured/);
  });
  it("compares the archives with the latest capture that hashed the tarball, not a later one without a list", async () => {
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2]], ["1.0.1"]);
    const caps = store.versions.get("p@1.0.1")!;
    caps[0]!.files = [["a.js", 1, "f".repeat(64)]];
    caps.push({ ...caps[0]!, fetched_at: caps[0]!.fetched_at + HOUR, files: null, files_status: "error" });
    const pkgP = (v: string) => `{"name":"p","version":"${v}","scripts":{}}`;
    const src = sources({ "1.0.0": { "package.json": pkgP("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkgP("1.0.1"), "a.js": "x" } });
    const c = await categorize({ name: "p", version: "1.0.1", published: at(2), store, records: records as any, sources: src });
    expect(c).toMatchObject({ category: "confirmed", evidence: { step: "the recorder's file list differs from jsDelivr's" } });
  });
});

describe("the re-query's published rule", () => {
  it("does not count a record published after the judgement, even if a copy says it was modified before", () => {
    const w = new World().publish("left-pad", "1.0.1", 1);
    w.osv.push({ type: "osv", id: "MAL-p", modified: at(10), fetched_at: at(11), sha256: "p", record: { id: "MAL-p", published: at(100), modified: at(10), affected: [{ package: { ecosystem: "npm", name: "left-pad" }, versions: ["1.0.1"] }] } });
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.map(x => x.outcome)).toEqual(["missed", "missed", "missed", "stopped"]);
  });
});

describe("second review fixes (PR #194)", () => {
  const rec = (id: string, name: string, affected: object, publishedH: number, modifiedH: number, extra: object = {}) => ({ type: "osv", id, modified: at(modifiedH), fetched_at: at(modifiedH + 1), sha256: `${id}-${modifiedH}`, record: { id, published: at(publishedH), modified: at(modifiedH), affected: [{ package: { ecosystem: "npm", name }, ...affected }], ...extra } });
  const finalWorld = () => { const w = new World(28 * 24 + 336 + 200); w.publish("left-pad", "1.0.1", 1); return w; };
  const asOfFinal = T0 + (28 * 24 + 336 + 200) * HOUR;

  it("keeps a version in the denominator when a later copy of its record stops naming it", async () => {
    const w = finalWorld();
    w.osv.push(rec("MAL-d", "left-pad", { versions: ["1.0.1"] }, 100, 100), rec("MAL-d", "left-pad", { versions: ["1.0.0"] }, 100, 300));
    const report = await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: sources({}) });
    expect(report.final).toBe(true);
    expect(report.mal.versions).toBe(1);
    expect(report.misses).toMatchObject({ count: 1, state: "not_met", versions: ["left-pad@1.0.1"] });
  });
  it("counts a withdrawn record's version as named in the record-omission rule", async () => {
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2], ["1.0.2", 3], ["1.0.3", 4]], ["1.0.1", "1.0.3"]);
    (records.find(r => (r as { id: string }).id === "MAL-1.0.1") as Record<string, unknown>).withdrawn = at(30);
    const pkg = (v: string) => `{"name":"p","version":"${v}","scripts":{}}`;
    const src = sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "evil" }, "1.0.2": { "package.json": pkg("1.0.2"), "a.js": "y" }, "1.0.3": { "package.json": pkg("1.0.3"), "a.js": "y" } });
    const c = await categorize({ name: "p", version: "1.0.3", published: at(4), store, records: records as any, sources: src });
    expect(c.category).toBe("record_omission");
    expect(c.evidence).toMatchObject({ prev_d: "1.0.2", earliest_other_named: "1.0.1" });
  });
  it("is not final while an OSV record's read is still being retried", async () => {
    const w = finalWorld();
    w.status.push({ type: "error", at: at(1100), id: "MAL-r", error: "osv: HTTP 503" });
    const retrying = await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: sources({}) });
    expect(retrying.final).toBe(false);
    expect(retrying.not_final_because.join()).toMatch(/still being read again \(MAL-r\)/);
    w.osv.push(rec("MAL-r", "unwatched", { versions: ["1.0.0"] }, 1090, 1100));
    expect((await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: sources({}) })).final).toBe(true);
  });
  it("enumerates a range over the registry's versions too; without the network the result is not final", async () => {
    const w = new World(400);
    w.publish("left-pad", "1.0.1", 1);
    w.osv.push(rec("MAL-range", "left-pad", { ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.1" }] }] }, 100, 100));
    const offline = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: null });
    expect(offline.not_final_because.join()).toMatch(/by a range/);
    expect(offline.mal.cases.map(c => c.version)).toEqual(["1.0.1"]);
    const pkg = (v: string) => `{"name":"left-pad","version":"${v}"}`;
    const src = { ...sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "y" } }), registryTime: async () => ({ "1.0.0": "2020-01-01T00:00:00.000Z", "1.0.1": at(1), "1.0.5": at(50) }) };
    const online = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: src });
    expect(online.not_final_because.join()).not.toMatch(/by a range/);
    expect(online.mal.cases.map(c => [c.version, c.rows[0]!.outcome])).toEqual([["1.0.1", "missed"], ["1.0.5", "capture_gap"]]);
  });
});

describe("third review fixes (PR #194)", () => {
  const finalWorld = () => { const w = new World(28 * 24 + 336 + 200); w.publish("left-pad", "1.0.1", 1); return w; };
  const asOfFinal = T0 + (28 * 24 + 336 + 200) * HOUR;

  it("places a version known only from the registry's time in the run of identical code", async () => {
    // 1.0.2 is not in the store; it has 1.0.0's code, and 1.0.1 (evil, named) comes between them.
    const { store, records } = malStore([["1.0.0", 1], ["1.0.1", 2]], ["1.0.1"]);
    const w2 = new World().mal("MAL-1.0.2", "p", ["1.0.2"], 20);
    const extra = w2.store().osv.get("MAL-1.0.2")!.map(c => c.record);
    const pkg = (v: string) => `{"name":"p","version":"${v}","scripts":{}}`;
    const src = { ...sources({ "1.0.0": { "package.json": pkg("1.0.0"), "a.js": "x" }, "1.0.1": { "package.json": pkg("1.0.1"), "a.js": "evil" }, "1.0.2": { "package.json": pkg("1.0.2"), "a.js": "x" } }), registryTime: async () => ({ "1.0.0": at(1), "1.0.1": at(2), "1.0.2": at(3) }) };
    const c = await categorize({ name: "p", version: "1.0.2", published: at(3), store, records: [...records, ...extra] as any, sources: src });
    expect(c.category).toBe("record_omission");
    expect(c.evidence).toMatchObject({ prev_d: "1.0.0", o: "1.0.2", o_predecessor: "1.0.1", earliest_other_named: "1.0.1", o_after_earliest_named: true });
  });
  it("seeds from a later capture of the predecessor that completes its inputs", () => {
    const w = new World();
    w.captures.pop();
    w.version("left-pad", "1.0.0", -0.5, "lockfile", { attested: true }, "fail");
    w.publish("left-pad", "1.0.1", 1);
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.every(x => x.outcome === "capture_gap")).toBe(true);
    w.version("left-pad", "1.0.0", 3.01, "retry", { attested: true }, attestations("left-pad", "1.0.0"));
    // 1.0.0 had provenance and 1.0.1 has none: every row stops, judged from the seed after the retry.
    expect(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false).rows.map(x => x.outcome)).toEqual(["stopped", "stopped", "stopped", "stopped"]);
  });
  it("asks OSV by package name for records the recorder never stored; without the network the result is not final", async () => {
    const w = finalWorld();
    const offline = await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: null });
    expect(offline.final).toBe(false);
    expect(offline.not_final_because.join()).toMatch(/OSV was not asked/);
    const old = { id: "MAL-old", published: at(-100), modified: at(-50), affected: [{ package: { ecosystem: "npm", name: "left-pad" }, ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.1" }] }] }] };
    const report = await replay({ store: w.store(), watched: w.watched, asOf: asOfFinal, sources: { ...sources({}), osvRecords: async () => [old] } });
    expect(report.final).toBe(true);
    expect(report.mal.cases.map(c => [c.version, c.records])).toEqual([["1.0.1", ["MAL-old"]]]);
    expect(report.misses).toMatchObject({ count: 1, state: "not_met" });
  });
  it("lists the capture gaps of MAL-named versions placed only by the registry", async () => {
    const w = new World(400).mal("MAL-g", "left-pad", ["1.0.9"], 100);
    const report = await replay({ store: w.store(), watched: w.watched, asOf: T0 + 400 * HOUR, sources: { ...sources({}), registryTime: async () => ({ "1.0.9": at(5) }) } });
    expect(report.capture_gaps.filter(g => g.version === "left-pad@1.0.9")).toHaveLength(4);
  });
  it("does not take an error line naming a package for the end of a poll", () => {
    const w = new World();
    w.status.push({ type: "error", at: at(1.012), name: "other", error: "HTTP 500" });
    w.publish("left-pad", "1.0.1", 1, { deps: { fresh: "^1.0.0" } });
    w.captures.push({ type: "created", name: "fresh", fetched_at: at(1.015), url: "x", created: "2019-01-01T00:00:00.000Z" });
    // The created record (1.015) comes after the mid-poll error line (1.012) and before the poll's end (2).
    const r = row(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false), "b", "normal");
    expect(r).toMatchObject({ outcome: "missed", wait_hours: 144, iterations: 1 });
  });
});

describe("fourth review fixes (PR #194)", () => {
  it("seeds from a later poll that stored a new dependency's first publish", () => {
    const w = new World().publish("left-pad", "1.0.1", 1, { deps: { fresh: "^1.0.0" } });
    w.captures.push({ type: "created", name: "fresh", fetched_at: at(5), url: "x", created: "2019-01-01T00:00:00.000Z" });
    expect(row(judgeVersion(ctxOf(w), "left-pad", "1.0.1", false), "b", "normal")).toMatchObject({ outcome: "missed", wait_hours: 144 });
  });
  it("is pending, not a gap, for a version captured after the last poll line", () => {
    const w = new World(100);
    w.publish("left-pad", "1.0.1", 100.5);
    const r = judgeVersion(ctxOf(w, T0 + 96.5 * HOUR), "left-pad", "1.0.1", false);
    expect(r.rows.map(x => x.outcome)).toEqual(["pending", "pending", "pending", "pending"]);
  });
});
