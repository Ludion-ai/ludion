import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dirBytes, newMalIds, predecessor, Recorder, scrub } from "../src/recorder.ts";
import { watchedFrom } from "../src/watched.ts";

/** A minimal npm tarball: ustar entries under package/. */
function tgz(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text), header = Buffer.alloc(512);
    header.write(`package/${name}`, 0, 100, "utf8");
    header.write(body.length.toString(8).padStart(11, "0"), 124, 12, "ascii");
    header.write("0", 156, 1, "ascii");
    header.write("ustar", 257, 6, "ascii");
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
const integrity = (b: Buffer) => `sha512-${createHash("sha512").update(b).digest("base64")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const ball = (v: string) => tgz({ "package.json": `{"name":"left-pad","version":"${v}"}`, "index.js": `module.exports = "${v}";` });
const manifest = (v: string, extra: object = {}) => ({
  name: "left-pad", version: v, scripts: {}, dependencies: {},
  _npmUser: { name: "alice", email: "alice@example.com" }, maintainers: [{ name: "alice", email: "alice@example.com" }],
  author: "Alice <alice@example.com>",
  dist: { tarball: `https://registry.npmjs.org/left-pad/-/left-pad-${v}.tgz`, integrity: integrity(ball(v)), shasum: "x" },
  ...extra,
});

/** A fake registry, feed and OSV export; records every URL asked for. */
function world() {
  const w = {
    seq: 100,
    feed: [] as { seq: number; id: string }[],
    packuments: { "left-pad": { "dist-tags": { latest: "1.0.0" }, time: { created: "2020-01-01T00:00:00.000Z", "0.9.0": "2019-12-31T00:00:00.000Z", "1.0.0": "2020-01-01T00:00:00.000Z" }, versions: { "0.9.0": manifest("0.9.0"), "1.0.0": manifest("1.0.0") } } } as Record<string, any>,
    tarballs: new Map<string, Buffer>([["0.9.0", ball("0.9.0")], ["1.0.0", ball("1.0.0")], ["1.0.1", ball("1.0.1")]]),
    csv: "",
    osv: {} as Record<string, object>,
    fail: new Set<string>(),
    asked: [] as string[],
  };
  const reply = (status: number, body: string | Buffer = "") => new Response(status === 200 ? (typeof body === "string" ? body : new Uint8Array(body)) : null, { status });
  const fetchFn = (async (input: string | URL) => {
    const url = String(input);
    w.asked.push(url);
    if (w.fail.has(url)) throw new Error("network down");
    const u = new URL(url);
    if (url === "https://replicate.npmjs.com/") return reply(200, JSON.stringify({ update_seq: w.seq }));
    if (u.pathname === "/registry/_changes") {
      const since = Number(u.searchParams.get("since"));
      const results = w.feed.filter(e => e.seq > since);
      return reply(200, JSON.stringify({ results: results.map(e => ({ seq: e.seq, id: e.id, changes: [] })), last_seq: results.at(-1)?.seq ?? since }));
    }
    if (u.hostname === "registry.npmjs.org" && u.pathname.includes("/-/") && u.pathname.endsWith(".tgz")) {
      const v = /-([0-9][^/]*)\.tgz$/.exec(u.pathname)![1]!;
      const b = w.tarballs.get(v);
      return b ? reply(200, b) : reply(404);
    }
    if (u.hostname === "registry.npmjs.org" && u.pathname.startsWith("/-/npm/v1/attestations/")) return reply(200, JSON.stringify({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1" }] }));
    if (u.hostname === "registry.npmjs.org") { const doc = w.packuments[decodeURIComponent(u.pathname.slice(1))]; return doc ? reply(200, JSON.stringify(doc)) : reply(404); }
    if (url === "https://osv-vulnerabilities.storage.googleapis.com/npm/modified_id.csv") return reply(200, w.csv);
    if (u.hostname === "api.osv.dev") { const rec = w.osv[decodeURIComponent(u.pathname.split("/").at(-1)!)]; return rec ? reply(200, JSON.stringify(rec)) : reply(404); }
    return reply(404);
  }) as typeof fetch;
  return { w, fetchFn };
}
const lines = (dir: string, kind: string) => readdirSync(join(dir, kind)).flatMap(f => readFileSync(join(dir, kind, f), "utf8").trim().split("\n").map(l => JSON.parse(l)));
const setup = (maxBytes = 50_000_000) => {
  const dir = mkdtempSync(join(tmpdir(), "shadow-")), { w, fetchFn } = world();
  let t = Date.parse("2026-10-29T00:00:00Z");
  const rec = new Recorder({ dir, maxBytes, fetchFn, watched: { "left-pad": ["0.9.0"], "watched-quiet": [] }, now: () => new Date(t) });
  return { dir, w, rec, tick: (ms: number) => { t += ms; } };
};

describe("scrub", () => {
  it("leaves versions, specs and URLs that only look like addresses", () => {
    for (const text of ["left-pad@1.0.1", "npm:evil@1.0.0", "git+ssh://git@github.com/o/r.git", "git@github.com:org/repo.git", "https://registry.npmjs.org/@s/n/-/n-1.0.0.tgz", "use lodash@4.17.21 instead"]) expect(scrub(text)).toBe(text);
    expect(scrub("Alice <alice@example.com>")).toBe("Alice <[email removed]>");
    expect(scrub("email:a@b.com")).toBe("email:[email removed]");
    expect(scrub("jö@exämple.de")).toBe("[email removed]");
    expect(scrub({ "bob@example.org": "x" })).toEqual({ "[email removed]": "x" });
  });
  it("drops email keys and replaces addresses inside strings, at any depth", () => {
    const out = JSON.stringify(scrub(manifest("1.0.0", { contributors: ["Bob <bob@example.org> (https://b.example)"], bugs: { email: "x@y.io", url: "u" } })));
    expect(out).not.toMatch(/@example|x@y\.io/);
    expect(out).toContain("[email removed]");
    expect(out).toContain('"name":"alice"');
  });
});

describe("newMalIds", () => {
  const csv = "2026-10-29T10:00:00Z,MAL-2026-3\n2026-10-29T09:00:00Z,GHSA-aaaa\n2026-10-29T08:00:00Z,MAL-2026-2\n2026-10-28T08:00:00Z,MAL-2026-1\n";
  it("keeps MAL- ids modified after the position, newest first, and reports the newest time", () => {
    expect(newMalIds(csv, "2026-10-29T00:00:00Z")).toEqual({ ids: [{ id: "MAL-2026-3", modified: "2026-10-29T10:00:00Z" }, { id: "MAL-2026-2", modified: "2026-10-29T08:00:00Z" }], newest: "2026-10-29T10:00:00Z" });
  });
  it("returns nothing new when the position is the newest line", () => {
    expect(newMalIds(csv, "2026-10-29T10:00:00Z").ids).toEqual([]);
  });
});

describe("predecessor", () => {
  it("is the latest-published version lower by semver and published before it, never a later backport", () => {
    const time = { "1.0.0": "2026-01-01", "2.0.0": "2026-02-01", "1.9.5": "2026-03-01", "2.0.1": "2026-04-01", "1.9.6": "2026-05-01" };
    expect(predecessor(Object.keys(time), time, "2.0.1")).toBe("1.9.5");
    expect(predecessor(Object.keys(time), time, "2.0.0")).toBe("1.0.0");
    expect(predecessor(Object.keys(time), time, "1.9.5")).toBe("1.0.0");
    expect(predecessor(Object.keys(time), time, "1.0.0")).toBeUndefined();
  });
});

describe("watchedFrom", () => {
  it("collects every name and version with the judge's lockfile reader", () => {
    const lock = (deps: Record<string, string>) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...Object.fromEntries(Object.entries(deps).map(([n, v]) => [`node_modules/${n}`, { version: v, resolved: `https://registry.npmjs.org/${n}/-/${n}-${v}.tgz` }])) } });
    const w = watchedFrom([{ source: "a", sha: "1", text: lock({ b: "1.0.0", a: "2.0.0" }) }, { source: "c", sha: "2", text: lock({ b: "1.1.0" }) }], "t");
    expect(w.names).toEqual({ a: ["2.0.0"], b: ["1.0.0", "1.1.0"] });
    expect(w.sources.map(s => s.entries)).toEqual([2, 1]);
  });
});

describe("Recorder", () => {
  it("starts at the feed's current position without reading anything else", async () => {
    const { rec, w } = setup();
    await rec.poll();
    expect(rec.state.seq).toBe("100");
    expect(w.asked).toEqual(["https://replicate.npmjs.com/"]);
  });

  it("captures a watched package on first sight: baseline time, its lockfile version and the latest, no file list for those", async () => {
    const { dir, w, rec } = setup();
    await rec.poll();
    w.feed.push({ seq: 101, id: "left-pad" }, { seq: 102, id: "not-watched" });
    const s = await rec.poll();
    expect(s).toMatchObject({ entries: 2, watched: 1, seq: "102" });
    expect(w.asked.some(u => u.includes("not-watched"))).toBe(false);
    const recs = lines(dir, "captures");
    expect(recs[0]).toMatchObject({ type: "baseline", name: "left-pad", time: { "1.0.0": "2020-01-01T00:00:00.000Z" } });
    expect(recs.filter(r => r.type === "version").map(r => [r.version, r.reason, r.files])).toEqual([["0.9.0", "lockfile", null], ["1.0.0", "predecessor", null]]);
    expect(JSON.stringify(recs)).not.toContain("alice@example.com");
    expect(recs.find(r => r.type === "version").shared_publisher).toBe(false);
  });

  it("captures a new version with its attestations and the file list of its tarball, checked against its integrity", async () => {
    const { dir, w, rec } = setup();
    await rec.poll();
    w.feed.push({ seq: 101, id: "left-pad" });
    await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1", { dist: { ...manifest("1.0.1").dist, attestations: { url: "x" } } });
    p.time["1.0.1"] = "2026-10-29T00:00:30.000Z";
    p["dist-tags"].latest = "1.0.1";
    w.feed.push({ seq: 103, id: "left-pad" });
    await rec.poll();
    const recs = lines(dir, "captures");
    const change = recs.find(r => r.type === "change");
    expect(change).toMatchObject({ dist_tags: { latest: "1.0.1" }, time: { "1.0.1": "2026-10-29T00:00:30.000Z" }, removed: [] });
    const v = recs.find(r => r.type === "version" && r.version === "1.0.1");
    expect(v.reason).toBe("new");
    expect(v.attestations).toMatchObject({ status: 200 });
    expect(v.files.status).toBe("hashed");
    const js = 'module.exports = "1.0.1";', pkg = '{"name":"left-pad","version":"1.0.1"}';
    expect(v.files.files).toEqual([["index.js", js.length, sha256(js)], ["package.json", pkg.length, sha256(pkg)]]);
    // Only the list is kept: no tarball bytes anywhere in the data directory.
    expect(readdirSync(dir, { recursive: true }).some(f => String(f).endsWith(".tgz"))).toBe(false);
  });

  it("stores the first publish time of a new version's dependency outside the watched set, once", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    w.packuments["watched-quiet"] = { "dist-tags": {}, time: { created: "2025-01-01T00:00:00.000Z" }, versions: {} };
    w.packuments["tiny-dep"] = { "dist-tags": { latest: "1.0.0" }, time: { created: "2026-10-28T00:00:00.000Z", "1.0.0": "2026-10-28T00:00:00.000Z" }, versions: {} };
    p.versions["1.0.1"] = manifest("1.0.1", { dependencies: { "tiny-dep": "^1.0.0", "left-pad": "*", "watched-quiet": "^1.0.0" } });
    p.time["1.0.1"] = "2026-10-29T01:00:00.000Z";
    w.feed.push({ seq: 103, id: "left-pad" });
    await rec.poll();
    p.versions["1.0.2"] = manifest("1.0.2", { dependencies: { "tiny-dep": "^1.0.0" } });
    p.time["1.0.2"] = "2026-10-29T02:00:00.000Z";
    w.tarballs.set("1.0.2", ball("1.0.2"));
    w.feed.push({ seq: 104, id: "left-pad" });
    await rec.poll();
    expect(lines(dir, "captures").filter(r => r.type === "created").map(r => [r.name, r.created])).toEqual([["tiny-dep", "2026-10-28T00:00:00.000Z"], ["watched-quiet", "2025-01-01T00:00:00.000Z"]]);
    expect(w.asked.filter(u => u === "https://registry.npmjs.org/tiny-dep")).toHaveLength(1);
  });

  it("refuses a tarball whose bytes do not match the registry's integrity, and one that is not the registry's own URL", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1");
    p.time["1.0.1"] = "2026-10-29T01:00:00.000Z";
    w.tarballs.set("1.0.1", ball("tampered"));
    p.versions["1.0.2"] = manifest("1.0.2", { dist: { tarball: "https://evil.example/left-pad-1.0.2.tgz", integrity: "sha512-x" } });
    p.time["1.0.2"] = "2026-10-29T02:00:00.000Z";
    w.feed.push({ seq: 103, id: "left-pad" });
    await rec.poll();
    const recs = lines(dir, "captures").filter(r => r.reason === "new");
    expect(recs.map(r => [r.version, r.files.status])).toEqual([["1.0.1", "integrity_mismatch"], ["1.0.2", "not_registry_tarball"]]);
    expect(w.asked.some(u => u.includes("evil.example"))).toBe(false);
  });

  it("records removal and deprecation of a stored version", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.0"].deprecated = "do not use";
    delete p.versions["0.9.0"];
    p.time.unpublished = "2026-10-29T03:00:00.000Z";
    w.feed.push({ seq: 104, id: "left-pad" });
    await rec.poll();
    const recs = lines(dir, "captures");
    expect(recs.find(r => r.type === "change")).toMatchObject({ removed: ["0.9.0"], time: { unpublished: "2026-10-29T03:00:00.000Z" } });
    expect(recs.find(r => r.type === "deprecation")).toMatchObject({ version: "1.0.0", deprecated: "do not use" });
  });

  it("keeps a name whose capture failed and retries it on the next poll, while the feed moves on", async () => {
    const { dir, w, rec } = setup();
    await rec.poll();
    w.fail.add("https://registry.npmjs.org/left-pad");
    w.feed.push({ seq: 101, id: "left-pad" });
    await rec.poll();
    expect(rec.state).toMatchObject({ seq: "101", pending: ["left-pad"] });
    w.fail.clear();
    await rec.poll();
    expect(rec.state.pending).toEqual([]);
    expect(lines(dir, "captures")[0]).toMatchObject({ type: "baseline" });
  });

  it("resumes from the stored position after a restart", async () => {
    const { dir, w, rec } = setup();
    await rec.poll();
    w.feed.push({ seq: 101, id: "other" });
    await rec.poll();
    const again = new Recorder({ dir, maxBytes: 50_000_000, fetchFn: rec.cfg.fetchFn, watched: { "left-pad": [] } });
    expect(again.state.seq).toBe("101");
  });

  it("never treats a package named like an Object property as watched", async () => {
    const { w, rec } = setup();
    await rec.poll();
    w.feed.push({ seq: 101, id: "constructor" }, { seq: 102, id: "__proto__" }, { seq: 103, id: "hasOwnProperty" });
    expect(await rec.poll()).toMatchObject({ watched: 0 });
  });

  it("stops recording before the data directory passes its limit, and stays stopped", async () => {
    const { dir, w, rec } = setup(600);
    await rec.poll();
    w.feed.push({ seq: 101, id: "left-pad" });
    await rec.poll();
    expect(rec.state.stopped).toMatch(/would pass 600 bytes/);
    const stoppedAt = dirBytes(dir);
    expect(stoppedAt).toBeLessThan(1_000);
    expect(await rec.poll()).toMatchObject({ entries: 0 });
    expect(await rec.osv()).toBe(0);
    expect(dirBytes(dir)).toBe(stoppedAt);
    expect(lines(dir, "status").at(-1)).toMatchObject({ type: "stopped" });
  });

  it("reads OSV once a day: the first read sets the position, later reads store every new MAL- record", async () => {
    const { dir, w, rec, tick } = setup();
    w.csv = "2026-10-28T23:00:00Z,MAL-2026-1\n";
    expect(await rec.osv()).toBe(0);
    expect(await rec.osv()).toBe(0);
    tick(86_400_000);
    w.csv = "2026-10-29T12:00:00Z,MAL-2026-2\n2026-10-29T11:00:00Z,GHSA-xxxx\n2026-10-28T23:00:00Z,MAL-2026-1\n";
    w.osv["MAL-2026-2"] = { id: "MAL-2026-2", affected: [{ package: { name: "left-pad", ecosystem: "npm" }, versions: ["1.0.1"] }] };
    expect(await rec.osv()).toBe(1);
    expect(lines(dir, "osv").map(r => r.id)).toEqual(["MAL-2026-2"]);
    expect(w.asked.filter(u => u.startsWith("https://api.osv.dev/"))).toEqual(["https://api.osv.dev/v1/vulns/MAL-2026-2"]);
  });

  it("asks only the four allowed hosts", async () => {
    const { w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll(); await rec.osv();
    expect(new Set(w.asked.map(u => new URL(u).hostname))).toEqual(new Set(["replicate.npmjs.com", "registry.npmjs.org", "osv-vulnerabilities.storage.googleapis.com"]));
  });
});

describe("Recorder, review findings and failure paths", () => {
  it("captures a version published after the feed start as new on a name's first sight, with its file list and predecessor", async () => {
    const { dir, w, rec } = setup();
    await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1", { dependencies: { "brand-new-dep": "^1.0.0" } });
    p.time["1.0.1"] = "2026-10-29T00:00:30.000Z";
    p["dist-tags"].latest = "1.0.1";
    w.packuments["brand-new-dep"] = { "dist-tags": {}, time: { created: "2026-10-28T12:00:00.000Z" }, versions: {} };
    w.feed.push({ seq: 101, id: "left-pad" });
    expect(await rec.poll()).toMatchObject({ seq: "101" });
    const recs = lines(dir, "captures");
    expect(recs.filter(r => r.type === "version").map(r => [r.version, r.reason, r.files?.status ?? null])).toEqual([["1.0.1", "new", "hashed"], ["0.9.0", "lockfile", null], ["1.0.0", "predecessor", null]]);
    expect(recs.find(r => r.type === "created")).toMatchObject({ name: "brand-new-dep", created: "2026-10-28T12:00:00.000Z" });
  });

  it("does not let a malformed dependency name or a malformed packument hold the feed", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1", { dependencies: { ["a".repeat(215)]: "1.0.0" } });
    p.time["1.0.1"] = "2026-10-29T01:00:00.000Z";
    w.packuments["other"] = { versions: null, time: {} };
    const r2 = new Recorder({ dir, maxBytes: 50_000_000, fetchFn: rec.cfg.fetchFn, watched: { "left-pad": ["0.9.0"], other: [] }, now: () => new Date("2026-10-29T02:00:00Z") });
    w.feed.push({ seq: 102, id: "left-pad" }, { seq: 103, id: "other" });
    expect(await r2.poll()).toMatchObject({ seq: "103" });
    expect(r2.state.pending).toEqual(["other"]);
    expect(lines(dir, "captures").some(r => r.type === "version" && r.version === "1.0.1")).toBe(true);
    expect(lines(dir, "status").some(r => r.type === "error" && /dependency name not read/.test(r.error))).toBe(true);
  });

  it("retries a version whose attestations or tarball could not be read, and records the complete capture", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1", { dist: { ...manifest("1.0.1").dist, attestations: { url: "x" } } });
    p.time["1.0.1"] = "2026-10-29T01:00:00.000Z";
    const att = "https://registry.npmjs.org/-/npm/v1/attestations/left-pad@1.0.1", tarball = "https://registry.npmjs.org/left-pad/-/left-pad-1.0.1.tgz";
    w.fail.add(att); w.fail.add(tarball);
    w.feed.push({ seq: 102, id: "left-pad" });
    await rec.poll();
    expect(rec.state.pending).toEqual(["left-pad"]);
    w.fail.clear();
    await rec.poll();
    expect(rec.state.pending).toEqual([]);
    const v = lines(dir, "captures").filter(r => r.type === "version" && r.version === "1.0.1");
    expect(v.map(r => [r.reason, r.attestations.status, r.files.status])).toEqual([["new", "error", "error"], ["retry", 200, "hashed"]]);
  });

  it("records removal once, not again in every later change", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    delete w.packuments["left-pad"].versions["0.9.0"];
    w.feed.push({ seq: 102, id: "left-pad" }); await rec.poll();
    w.packuments["left-pad"].time.modified = "2026-10-29T05:00:00.000Z";
    w.feed.push({ seq: 103, id: "left-pad" }); await rec.poll();
    expect(lines(dir, "captures").filter(r => r.type === "change").map(r => r.removed)).toEqual([["0.9.0"], []]);
  });

  it("records a package the registry no longer has as gone", async () => {
    const { dir, w, rec } = setup();
    await rec.poll();
    delete w.packuments["left-pad"];
    w.feed.push({ seq: 101, id: "left-pad" });
    await rec.poll();
    expect(lines(dir, "captures")).toEqual([expect.objectContaining({ type: "gone", name: "left-pad", status: 404 })]);
    expect(rec.state.pending).toEqual([]);
  });

  it("reads every page of a long feed", async () => {
    const { w, rec } = setup();
    await rec.poll();
    for (let i = 1; i <= 10_001; i++) w.feed.push({ seq: 100 + i, id: `pkg-${i}` });
    expect(await rec.poll()).toMatchObject({ entries: 10_001, seq: "10101" });
  });

  it("stays stopped after a restart once the limit was reached", async () => {
    const { dir, w, rec } = setup(600);
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    expect(rec.state.stopped).toBeTruthy();
    const again = new Recorder({ dir, maxBytes: 600, fetchFn: rec.cfg.fetchFn, watched: { "left-pad": [] } });
    const before = dirBytes(dir);
    expect(await again.poll()).toMatchObject({ entries: 0 });
    expect(dirBytes(dir)).toBe(before);
  });

  it("gives no file list for a tarball over the size limit or without a sha512 integrity", async () => {
    const { rec } = setup();
    expect(await rec.files("left-pad", "1.0.0", manifest("1.0.0", { dist: { ...manifest("1.0.0").dist, unpackedSize: 10 ** 12 } }))).toMatchObject({ status: "too_large" });
    expect(await rec.files("left-pad", "1.0.0", manifest("1.0.0", { dist: { ...manifest("1.0.0").dist, integrity: "sha1-abc" } }))).toMatchObject({ status: "no_sha512_integrity" });
  });

  it("refuses an archive that inflates past the unpacked limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shadow-")), { w, fetchFn } = world();
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024));
    w.tarballs.set("1.0.0", bomb);
    const rec = new Recorder({ dir, maxBytes: 50_000_000, fetchFn, watched: {}, maxUnpackedBytes: 1024 * 1024 });
    expect(await rec.files("left-pad", "1.0.0", manifest("1.0.0", { dist: { ...manifest("1.0.0").dist, integrity: integrity(bomb) } }))).toMatchObject({ status: "unreadable" });
  });

  it("keeps reading the day's OSV records when one cannot be read, reads the export once that day, and reads the failed record again later", async () => {
    const { dir, w, rec, tick } = setup();
    w.csv = "2026-10-28T23:00:00Z,MAL-2026-1\n"; await rec.osv();
    tick(86_400_000);
    w.csv = "2026-10-29T12:00:00Z,MAL-2026-3\n2026-10-29T11:00:00Z,MAL-2026-2\n";
    w.osv["MAL-2026-2"] = { id: "MAL-2026-2", credits: [{ name: "x", contact: ["mailto:someone@example.org"] }] };
    expect(await rec.osv()).toBe(1);
    expect(await rec.osv()).toBe(0);
    expect(lines(dir, "osv").map(r => r.id)).toEqual(["MAL-2026-2"]);
    expect(JSON.stringify(lines(dir, "osv"))).not.toContain("someone@example.org");
    expect(lines(dir, "status").some(r => r.type === "error" && r.id === "MAL-2026-3")).toBe(true);
    expect(w.asked.filter(u => u.endsWith("modified_id.csv"))).toHaveLength(2);
    w.osv["MAL-2026-3"] = { id: "MAL-2026-3" };
    expect(await rec.osv()).toBe(1);
    expect(lines(dir, "osv").map(r => r.id)).toEqual(["MAL-2026-2", "MAL-2026-3"]);
    expect(rec.state.osv_retry).toEqual([]);
  });

  it("gives up the retries of a version removed before its capture was complete, once, and does not keep the package pending", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1");
    p.time["1.0.1"] = "2026-10-29T01:00:00.000Z";
    w.fail.add("https://registry.npmjs.org/left-pad/-/left-pad-1.0.1.tgz");
    w.feed.push({ seq: 102, id: "left-pad" }); await rec.poll();
    expect(rec.state.pending).toEqual(["left-pad"]);
    delete p.versions["1.0.1"];
    await rec.poll();
    expect(rec.state.pending).toEqual([]);
    await rec.poll();
    const gave = lines(dir, "captures").filter(r => r.type === "gave_up");
    expect(gave).toEqual([expect.objectContaining({ version: "1.0.1", reason: "removed before its capture was complete" })]);
  });

  it("gives up a package whose read keeps failing after 60 polls, with a record", async () => {
    const { dir, w, rec } = setup();
    await rec.poll();
    w.fail.add("https://registry.npmjs.org/left-pad");
    w.feed.push({ seq: 101, id: "left-pad" });
    for (let i = 0; i < 60; i++) await rec.poll();
    expect(rec.state.pending).toEqual([]);
    expect(lines(dir, "captures").filter(r => r.type === "gave_up")).toEqual([expect.objectContaining({ name: "left-pad", tries: 60, reason: "the package read kept failing" })]);
  });

  it("records a dependency the registry does not have as a fact, without retrying it", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1", { dependencies: { "no-such-dep": "1.0.0" } });
    p.time["1.0.1"] = "2026-10-29T01:00:00.000Z";
    w.feed.push({ seq: 102, id: "left-pad" }); await rec.poll();
    expect(rec.state.pending).toEqual([]);
    expect(lines(dir, "captures").find(r => r.type === "created")).toMatchObject({ name: "no-such-dep", status: 404, created: null });
    // Published later: the next version that depends on it reads it again.
    w.packuments["no-such-dep"] = { "dist-tags": {}, time: { created: "2026-11-02T00:00:00.000Z" }, versions: {} };
    p.versions["1.0.2"] = manifest("1.0.2", { dependencies: { "no-such-dep": "1.0.0" } });
    p.time["1.0.2"] = "2026-11-03T00:00:00.000Z";
    w.tarballs.set("1.0.2", ball("1.0.2"));
    w.feed.push({ seq: 103, id: "left-pad" }); await rec.poll();
    expect(lines(dir, "captures").filter(r => r.type === "created").map(r => r.created)).toEqual([null, "2026-11-02T00:00:00.000Z"]);
  });

  it("gives up each version still retried when its package is given up, and a version on its own after 60 attempts", async () => {
    const { dir, w, rec } = setup();
    await rec.poll(); w.feed.push({ seq: 101, id: "left-pad" }); await rec.poll();
    const p = w.packuments["left-pad"];
    p.versions["1.0.1"] = manifest("1.0.1");
    p.time["1.0.1"] = "2026-10-29T01:00:00.000Z";
    w.fail.add("https://registry.npmjs.org/left-pad/-/left-pad-1.0.1.tgz");
    w.feed.push({ seq: 102, id: "left-pad" });
    for (let i = 0; i < 60; i++) await rec.poll();
    expect(rec.state.pending).toEqual([]);
    const gave = lines(dir, "captures").filter(r => r.type === "gave_up");
    expect(gave.some(r => r.version === "1.0.1")).toBe(true);
    expect(JSON.stringify(lines(dir, "captures").filter(r => r.type === "version" && r.version === "1.0.1").length)).toBe("60");
  });

  it("refuses a host outside the four allowed", async () => {
    const { rec } = setup();
    await expect((rec as any).get("https://example.com/x", 100)).rejects.toThrow(/Refused host/);
  });
});
