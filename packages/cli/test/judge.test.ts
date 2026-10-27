import { describe, expect, it } from "vitest";
import { installScripts, judge, lockDiff, lockEntries, renderJudgement, urgencyOf, WAIT_HOURS, type Change, type FixedAdvisory, type VersionFacts } from "../src/security/judge.ts";
import { provenanceFrom } from "../src/security/npm-facts.ts";

const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
const url = (name: string, version: string) => `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
const lockOf = (packages: Record<string, { version: string; dev?: boolean }>) => JSON.stringify({
  lockfileVersion: 3,
  packages: { "": { name: "app" }, ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { version: p.version, resolved: url(path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...(p.dev ? { dev: true } : {}) }])) },
});
const PROV = { repository: "https://github.com/acme/lib", workflow: ".github/workflows/release.yml" };
const fact = (over: Partial<VersionFacts> = {}): VersionFacts => ({ published_at: "2026-10-01T00:00:00Z", present: true, deprecated: null, publisher: "alice", provenance: PROV, install_scripts: [], dependencies: ["dep-a"], malicious: [], ...over });
const change = (over: Partial<Change> = {}): Change => ({ name: "lib", from: "1.0.0", to: "1.0.1", dev: false, resolved: url("lib", "1.0.1"), integrity: INTEGRITY, ...over });
const fixHigh: FixedAdvisory = { id: "GHSA-aaaa-bbbb-cccc", package: "lib", aliases: ["CVE-2026-1"], severity: "CRITICAL", kev: false, epss: null };
const run = (next: Partial<VersionFacts>, prev: Partial<VersionFacts> = {}, opts: { fixes?: FixedAdvisory[]; now?: string; changes?: Change[]; files?: string[] } = {}) => judge({
  changes: opts.changes ?? [change()],
  facts: new Map([["lib@1.0.0", fact({ published_at: "2026-09-01T00:00:00Z", ...prev })], ["lib@1.0.1", fact(next)]]),
  fixes: opts.fixes ?? [fixHigh],
  files: opts.files ?? ["package-lock.json"],
  now: new Date(opts.now ?? "2026-10-10T00:00:00Z"),
});

describe("the lockfile diff", () => {
  it("lists every added version, planned or not, with the version it replaces and whether it is dev-only", () => {
    const before = lockEntries(lockOf({ "node_modules/lib": { version: "1.0.0" }, "node_modules/tool": { version: "2.0.0", dev: true }, "node_modules/x/node_modules/lib": { version: "0.9.0" } }));
    const after = lockEntries(lockOf({ "node_modules/lib": { version: "1.0.1" }, "node_modules/tool": { version: "2.1.0", dev: true }, "node_modules/x/node_modules/lib": { version: "0.9.0" }, "node_modules/fresh": { version: "1.0.0" } }));
    expect(lockDiff(before, after).map(c => [c.name, c.from, c.to, c.dev])).toEqual([["fresh", null, "1.0.0", false], ["lib", "1.0.0", "1.0.1", false], ["tool", "2.0.0", "2.1.0", true]]);
  });
  it("refuses lockfiles it cannot read exactly", () => {
    expect(() => lockEntries(JSON.stringify({ lockfileVersion: 1, dependencies: {} }))).toThrow("v2/v3");
    expect(() => lockEntries(JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/a": { version: "latest" } } }))).toThrow("Invalid locked version");
  });
  it("names only lifecycle scripts that run at install", () => {
    expect(installScripts({ test: "x", postinstall: "node a.js", prepare: "tsc", preinstall: "sh b" })).toEqual(["preinstall", "postinstall"]);
    expect(installScripts(undefined)).toEqual([]);
  });
});

describe("gate 2 and the wait", () => {
  it("is ready (except the build gate) only after the wait, with nothing found", () => {
    const early = run({}, {}, { now: "2026-10-01T23:00:00Z" });
    expect(early.verdict).toBe("wait");
    expect(early.urgency).toBe("high");
    expect(early.wait_until).toBe("2026-10-02T00:00:00.000Z");
    const later = run({}, {}, { now: "2026-10-02T00:00:00Z" });
    expect(later.verdict).toBe("ready_except_build");
    expect(later.findings).toEqual([]);
    expect(renderJudgement(later)).toContain("build/test gate not run");
  });
  it.each([
    ["lost provenance", { provenance: null }, {}, "had build provenance"],
    ["a different repository", { provenance: { ...PROV, repository: "https://github.com/evil/lib" } }, {}, "was built from"],
    ["a different workflow", { provenance: { ...PROV, workflow: ".github/workflows/other.yml" } }, {}, "was built from"],
    ["a new install script", { install_scripts: ["preinstall"] }, {}, "adds install scripts: preinstall"],
    ["a malicious-package record", { malicious: ["MAL-2025-1"] }, {}, "malicious-package records"],
    ["deprecation", { deprecated: "Bad release" }, {}, "deprecated"],
    ["withdrawal", { present: false }, {}, "no longer listed"],
  ])("stops on %s, whatever the wait", (_name, next, prev, message) => {
    const result = run(next, prev, { now: "2027-01-01T00:00:00Z" });
    expect(result.verdict).toBe("stop");
    expect(result.findings.some(f => f.effect === "stop" && f.message.includes(message))).toBe(true);
  });
  it("keeps an install script the previous version already had", () => {
    expect(run({ install_scripts: ["postinstall"] }, { install_scripts: ["postinstall"] }, { now: "2027-01-01T00:00:00Z" }).verdict).toBe("ready_except_build");
  });
  it("extends the wait (and tells) on a publisher change or a new dependency", () => {
    const publisher = run({ publisher: "mallory" });
    expect(publisher.wait_hours).toBe(72);
    expect(publisher.findings).toContainEqual(expect.objectContaining({ effect: "extend", message: expect.stringContaining("mallory") }));
    expect(run({ dependencies: ["dep-a", "dep-new"] }).wait_hours).toBe(72);
    expect(run({ publisher: "mallory" }, {}, { fixes: [] }).wait_hours).toBe(144);
  });
  it("waits 12h for an exploited fix only when provenance is comparable, else 24h", () => {
    const kev = [{ ...fixHigh, kev: true }];
    expect(run({}, {}, { fixes: kev }).wait_hours).toBe(12);
    expect(run({ provenance: null }, { provenance: null }, { fixes: kev }).wait_hours).toBe(24);
  });
  it("counts the wait from the newest publish in the diff, not just the target", () => {
    const changes = [change(), change({ name: "dep-a", from: "1.0.0", to: "1.1.0", resolved: url("dep-a", "1.1.0") })];
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["dep-a@1.0.0", fact()], ["dep-a@1.1.0", fact({ published_at: "2026-10-05T00:00:00Z" })]]);
    const result = judge({ changes, facts, fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2026-10-05T12:00:00Z") });
    expect(result.newest_publish).toBe("2026-10-05T00:00:00Z");
    expect(result.verdict).toBe("wait");
  });
  it("checks every changed package: a clean target does not hide a malicious passenger", () => {
    const changes = [change(), change({ name: "passenger", from: "2.0.0", to: "2.0.1", resolved: url("passenger", "2.0.1") })];
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["passenger@2.0.0", fact()], ["passenger@2.0.1", fact({ malicious: ["MAL-2025-9"] })]]);
    expect(judge({ changes, facts, fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") }).verdict).toBe("stop");
  });
  it("is undecidable without facts or a publish time, and never ready", () => {
    expect(judge({ changes: [change()], facts: new Map(), fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") }).verdict).toBe("undecidable");
    expect(run({ published_at: null }, {}, { now: "2027-01-01T00:00:00Z" }).verdict).toBe("undecidable");
    expect(judge({ changes: [], facts: new Map(), fixes: [], files: [], now: new Date() }).verdict).toBe("undecidable");
  });
  it("treats a new package as uncomparable: longer wait, and a stop if it runs install scripts", () => {
    const fresh = change({ name: "fresh", from: null, to: "1.0.0", resolved: url("fresh", "1.0.0") });
    const base = { changes: [fresh], fixes: [], files: ["package-lock.json"], now: new Date("2026-10-02T00:00:00Z") };
    expect(judge({ ...base, facts: new Map([["fresh@1.0.0", fact()]]) }).wait_hours).toBe(144);
    expect(judge({ ...base, facts: new Map([["fresh@1.0.0", fact({ install_scripts: ["postinstall"] })]]) }).verdict).toBe("stop");
  });
});

describe("gate 4 and urgency", () => {
  it("stops a change that touches other files, lacks sha512 integrity, or comes from elsewhere", () => {
    expect(run({}, {}, { files: ["package-lock.json", "src/index.js"], now: "2027-01-01T00:00:00Z" }).verdict).toBe("stop");
    expect(run({}, {}, { changes: [change({ integrity: "sha1-abc" })], now: "2027-01-01T00:00:00Z" }).verdict).toBe("stop");
    expect(run({}, {}, { changes: [change({ resolved: "https://evil.example/lib-1.0.1.tgz" })], now: "2027-01-01T00:00:00Z" }).verdict).toBe("stop");
    expect(run({}, {}, { changes: [change({ resolved: "not a url" })], now: "2027-01-01T00:00:00Z" }).verdict).toBe("stop");
  });
  it("ranks urgency by exploitation, severity or EPSS, and dev-only last", () => {
    const prod = [change()], dev = [change({ dev: true })];
    expect(urgencyOf([{ ...fixHigh, kev: true }], prod)).toBe("exploited");
    expect(urgencyOf([fixHigh], prod)).toBe("high");
    expect(urgencyOf([{ ...fixHigh, severity: "MODERATE", epss: 0.4 }], prod)).toBe("high");
    expect(urgencyOf([{ ...fixHigh, severity: "MODERATE" }], prod)).toBe("normal");
    expect(urgencyOf([], prod)).toBe("normal");
    expect(urgencyOf([{ ...fixHigh, kev: true }], dev)).toBe("low");
    expect(WAIT_HOURS).toEqual({ exploited: 12, high: 24, normal: 72, low: 168 });
  });
});

describe("provenance records", () => {
  const encode = (statement: unknown) => Buffer.from(JSON.stringify(statement)).toString("base64");
  it("reads the repository and workflow from SLSA v1 and v0.2 statements", () => {
    const v1 = { attestations: [{ predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1" }, { predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: encode({ predicate: { buildDefinition: { externalParameters: { workflow: { repository: "https://github.com/acme/lib", path: ".github/workflows/release.yml" } } } } }) } } }] };
    expect(provenanceFrom(v1)).toEqual(PROV);
    const v02 = { attestations: [{ predicateType: "https://slsa.dev/provenance/v0.2", bundle: { dsseEnvelope: { payload: encode({ predicate: { invocation: { configSource: { uri: "git+https://github.com/acme/lib@refs/heads/main", entryPoint: ".github/workflows/release.yml" } } } }) } } }] };
    expect(provenanceFrom(v02)).toEqual(PROV);
  });
  it("says none when there is no SLSA statement, and refuses malformed records", () => {
    expect(provenanceFrom({ attestations: [{ predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1" }] })).toBeNull();
    expect(() => provenanceFrom({})).toThrow("Invalid");
    expect(() => provenanceFrom({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: {} }] })).toThrow("payload");
  });
});
