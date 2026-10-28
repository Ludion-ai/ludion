import { describe, expect, it } from "vitest";
import { allChanges, installScripts, judge, lockDiff, lockEntries, lockEntryChanges, lockLinks, manifestChanges, registryTarball, renderJudgement, urgencyOf, WAIT_HOURS, type Change, type FixedAdvisory, type VersionFacts } from "../src/security/judge.ts";
import { provenanceFrom } from "../src/security/npm-facts.ts";

const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
const url = (name: string, version: string) => `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
const lockOf = (packages: Record<string, { version: string; dev?: boolean }>) => JSON.stringify({
  lockfileVersion: 3,
  packages: { "": { name: "app" }, ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { version: p.version, resolved: url(path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...(p.dev ? { dev: true } : {}) }])) },
});
const PROV = { repository: "https://github.com/acme/lib", workflow: ".github/workflows/release.yml" };
const fact = (over: Partial<VersionFacts> = {}): VersionFacts => ({ published_at: "2026-10-01T00:00:00Z", present: true, deprecated: null, publisher: "alice", provenance: PROV, install_scripts: [], dependencies: ["dep-a"], integrity: INTEGRITY, malicious: [], advisories: [], ...over });
const change = (over: Partial<Change> = {}): Change => ({ path: "node_modules/lib", name: "lib", from: "1.0.0", to: "1.0.1", dev: false, resolved: url("lib", "1.0.1"), integrity: INTEGRITY, replaced: null, ...over });
const fixHigh: FixedAdvisory = { id: "GHSA-aaaa-bbbb-cccc", package: "lib", aliases: ["CVE-2026-1"], severity: "CRITICAL", kev: false, epss: null };
const run = (next: Partial<VersionFacts>, prev: Partial<VersionFacts> = {}, opts: { fixes?: FixedAdvisory[]; now?: string; changes?: Change[]; files?: string[] | null } = {}) => judge({
  changes: opts.changes ?? [change()],
  facts: new Map([["lib@1.0.0", fact({ published_at: "2026-09-01T00:00:00Z", ...prev })], ["lib@1.0.1", fact(next)]]),
  fixes: opts.fixes ?? [fixHigh],
  files: opts.files === undefined ? ["package-lock.json"] : opts.files,
  now: new Date(opts.now ?? "2026-10-10T00:00:00Z"),
});

describe("the lockfile diff", () => {
  it("lists every added version, planned or not, with the version it replaces and whether it is dev-only", () => {
    const before = lockEntries(lockOf({ "node_modules/lib": { version: "1.0.0" }, "node_modules/tool": { version: "2.0.0", dev: true }, "node_modules/x/node_modules/lib": { version: "0.9.0" } }));
    const after = lockEntries(lockOf({ "node_modules/lib": { version: "1.0.1" }, "node_modules/tool": { version: "2.1.0", dev: true }, "node_modules/x/node_modules/lib": { version: "0.9.0" }, "node_modules/fresh": { version: "1.0.0" } }));
    expect(lockDiff(before, after).map(c => [c.name, c.from, c.to, c.dev])).toEqual([["fresh", null, "1.0.0", false], ["lib", "1.0.0", "1.0.1", false], ["tool", "2.0.0", "2.1.0", true]]);
  });
  it("compares a changed copy with the copy at the same path, else the same major line", () => {
    const before = lockEntries(lockOf({ "node_modules/lib": { version: "4.0.0" }, "node_modules/x/node_modules/lib": { version: "3.1.0" } }));
    const after = lockEntries(lockOf({ "node_modules/lib": { version: "4.0.0" }, "node_modules/x/node_modules/lib": { version: "3.1.1" }, "node_modules/y/node_modules/lib": { version: "3.2.0" } }));
    expect(lockDiff(before, after).map(c => [c.path, c.from, c.to])).toEqual([["node_modules/x/node_modules/lib", "3.1.0", "3.1.1"], ["node_modules/y/node_modules/lib", "3.1.0", "3.2.0"]]);
  });
  it("lists links to local directories, which a registry diff would not see", () => {
    const linked = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/lib": { resolved: "packages/lib", link: true }, "packages/lib": { version: "1.0.0" } } });
    expect(lockLinks(linked)).toEqual(["node_modules/lib -> packages/lib"]);
    expect(lockEntries(linked)).toEqual([]);
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
  it("stops a downgrade, and a version with advisories the old one did not have", () => {
    const down = run({}, {}, { changes: [change({ from: "1.0.1", to: "1.0.0", resolved: url("lib", "1.0.0") })], now: "2027-01-01T00:00:00Z" });
    expect(down.findings).toContainEqual(expect.objectContaining({ effect: "stop", message: "lib goes down from 1.0.1 to 1.0.0 at node_modules/lib." }));
    const vulnerable = run({ advisories: ["GHSA-new"] }, { advisories: ["GHSA-old"] }, { now: "2027-01-01T00:00:00Z" });
    expect(vulnerable.verdict).toBe("stop");
    expect(vulnerable.findings).toContainEqual(expect.objectContaining({ effect: "stop", message: expect.stringContaining("GHSA-new") }));
    const unchanged = run({ advisories: ["GHSA-old"] }, { advisories: ["GHSA-old"] }, { now: "2027-01-01T00:00:00Z" });
    expect(unchanged.verdict).toBe("ready_except_build");
    expect(unchanged.findings).toContainEqual(expect.objectContaining({ effect: "info", message: expect.stringContaining("still has known advisories") }));
  });
  it("treats an unpublished predecessor like no predecessor", () => {
    const result = run({ install_scripts: ["postinstall"] }, { present: false, provenance: null, install_scripts: [] }, { now: "2027-01-01T00:00:00Z" });
    expect(result.verdict).toBe("stop");
    expect(result.findings).toContainEqual(expect.objectContaining({ effect: "extend", message: expect.stringContaining("no longer listed") }));
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
    // A provenance record naming no repository or workflow is not comparable.
    expect(run({ provenance: { repository: null, workflow: null } }, { provenance: { repository: null, workflow: null } }, { fixes: kev }).wait_hours).toBe(24);
  });
  it("counts the wait from the newest publish in the diff, not just the target", () => {
    const changes = [change(), change({ path: "node_modules/dep-a", name: "dep-a", from: "1.0.0", to: "1.1.0", resolved: url("dep-a", "1.1.0") })];
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["dep-a@1.0.0", fact()], ["dep-a@1.1.0", fact({ published_at: "2026-10-05T00:00:00Z" })]]);
    const result = judge({ changes, facts, fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2026-10-05T12:00:00Z") });
    expect(result.newest_publish).toBe("2026-10-05T00:00:00Z");
    expect(result.verdict).toBe("wait");
  });
  it("checks every changed package: a clean target does not hide a malicious passenger", () => {
    const changes = [change(), change({ path: "node_modules/passenger", name: "passenger", from: "2.0.0", to: "2.0.1", resolved: url("passenger", "2.0.1") })];
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["passenger@2.0.0", fact()], ["passenger@2.0.1", fact({ malicious: ["MAL-2025-9"] })]]);
    expect(judge({ changes, facts, fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") }).verdict).toBe("stop");
  });
  it("is undecidable without facts or a publish time, and never ready", () => {
    expect(judge({ changes: [change()], facts: new Map(), fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") }).verdict).toBe("undecidable");
    expect(run({ published_at: null }, {}, { now: "2027-01-01T00:00:00Z" }).verdict).toBe("undecidable");
    expect(judge({ changes: [], facts: new Map(), fixes: [], files: [], now: new Date() }).verdict).toBe("undecidable");
    // A failed lookup or unknown changed files: undecidable, even when everything else is clean.
    expect(judge({ changes: [change()], facts: new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()]]), fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), errors: ["registry.npmjs.org answered HTTP 503."] }).verdict).toBe("undecidable");
    expect(run({}, {}, { files: null, now: "2027-01-01T00:00:00Z" }).verdict).toBe("undecidable");
  });
  it("treats a new package as uncomparable: longer wait, and a stop if it runs install scripts", () => {
    const fresh = change({ path: "node_modules/fresh", name: "fresh", from: null, to: "1.0.0", resolved: url("fresh", "1.0.0") });
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
    // Another package's tarball on the right host, with its own valid hash: stopped on the URL and on the hash.
    const swapped = run({}, {}, { changes: [change({ resolved: "https://registry.npmjs.org/evil-pkg/-/evil-pkg-1.0.0.tgz", integrity: "sha512-" + "B".repeat(86) + "==" })], now: "2027-01-01T00:00:00Z" });
    expect(swapped.verdict).toBe("stop");
    expect(swapped.findings.filter(f => f.gate === 4 && f.effect === "stop").map(f => f.message)).toEqual([
      expect.stringContaining("not the registry's tarball"), expect.stringContaining("integrity is not the registry's"),
    ]);
    expect(run({}, {}, { changes: [change({ resolved: url("lib", "1.0.1") + "?x=1" })], now: "2027-01-01T00:00:00Z" }).verdict).toBe("stop");
    expect(registryTarball("@scope/pkg", "1.2.3")).toBe("https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz");
  });
  it("checks every changed entry: a re-pointed unchanged version and a second copy of a new one", () => {
    const evil = { resolved: "https://registry.npmjs.org/evil-pkg/-/evil-pkg-1.0.0.tgz", integrity: "sha512-" + "E".repeat(86) + "==" };
    const lock = (packages: Record<string, { version: string; resolved?: string; integrity?: string }>) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { resolved: url(path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...p }])) } });
    const facts = new Map([["lodash@4.17.21", fact()], ["foo@1.0.0", fact()], ["foo@1.0.1", fact()], ["bar@2.0.0", fact()]]);
    const verdict = (beforeText: string, afterText: string) => {
      const before = lockEntries(beforeText), after = lockEntries(afterText);
      return judge({ changes: lockDiff(before, after), entries: lockEntryChanges(before, after), facts, fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    };
    // (A) lodash keeps its version but points at another package; only foo is a version change.
    const a = verdict(lock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/foo": { version: "1.0.0" } }), lock({ "node_modules/lodash": { version: "4.17.21", ...evil }, "node_modules/foo": { version: "1.0.1" } }));
    expect(a.verdict).toBe("stop");
    expect(a.findings.filter(f => f.gate === 4).map(f => f.message)).toEqual([expect.stringContaining("lodash@4.17.21 at node_modules/lodash resolves to"), expect.stringContaining("lodash@4.17.21 at node_modules/lodash: the lockfile integrity")]);
    // (B) a new version twice, the nested copy pointing at another package.
    const b = verdict(lock({ "node_modules/foo": { version: "1.0.0" } }), lock({ "node_modules/foo": { version: "1.0.0" }, "node_modules/bar": { version: "2.0.0" }, "node_modules/x/node_modules/bar": { version: "2.0.0", ...evil } }));
    expect(b.verdict).toBe("stop");
    expect(b.findings.some(f => f.message.includes("bar@2.0.0 at node_modules/x/node_modules/bar resolves to"))).toBe(true);
    // An entry with no registry facts to check its hash: undecidable.
    const before = lockEntries(lock({ "node_modules/foo": { version: "1.0.0" } })), after = lockEntries(lock({ "node_modules/foo": { version: "1.0.1" }, "node_modules/baz": { version: "1.0.0" } }));
    expect(judge({ changes: lockDiff(before, after).filter(c => c.name === "foo"), entries: lockEntryChanges(before, after), facts, fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") }).verdict).toBe("undecidable");
  });
  it("judges a path that moves to a version or another package already installed elsewhere", () => {
    const lock = (packages: Record<string, { version: string; name?: string }>) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { resolved: url(p.name ?? path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...p }])) } });
    const facts = new Map([["lodash@4.17.21", fact()], ["lodash@4.17.20", fact({ advisories: ["GHSA-x"] })], ["foo@1.0.0", fact()], ["foo@1.0.1", fact()], ["evil-pkg@1.0.0", fact()]]);
    const verdict = (beforeText: string, afterText: string) => {
      const before = lockEntries(beforeText), after = lockEntries(afterText);
      return judge({ changes: lockDiff(before, after), entries: lockEntryChanges(before, after), facts, fixes: [], files: ["package.json", "package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    };
    // (A) The root copy goes down to the vulnerable version a nested copy already had.
    const a = verdict(
      lock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/x/node_modules/lodash": { version: "4.17.20" }, "node_modules/foo": { version: "1.0.0" } }),
      lock({ "node_modules/lodash": { version: "4.17.20" }, "node_modules/x/node_modules/lodash": { version: "4.17.20" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(a.verdict).toBe("stop");
    expect(a.changes.map(c => [c.name, c.from, c.to])).toEqual([["foo", "1.0.0", "1.0.1"], ["lodash", "4.17.21", "4.17.20"]]);
    expect(a.findings.map(f => f.message)).toEqual(expect.arrayContaining(["lodash goes down from 4.17.21 to 4.17.20 at node_modules/lodash.", expect.stringContaining("GHSA-x")]));
    // (B) An alias: node_modules/lodash now installs another package that was already in the tree.
    const b = verdict(
      lock({ "node_modules/lodash": { version: "4.17.21" }, "node_modules/y/node_modules/evil-pkg": { version: "1.0.0" }, "node_modules/foo": { version: "1.0.0" } }),
      lock({ "node_modules/lodash": { version: "1.0.0", name: "evil-pkg" }, "node_modules/y/node_modules/evil-pkg": { version: "1.0.0" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(b.verdict).toBe("stop");
    expect(b.findings.map(f => f.message)).toContain("node_modules/lodash now installs evil-pkg@1.0.0 instead of lodash@4.17.21: another package under the same name.");
    expect(renderJudgement(b)).toContain("(replaces lodash@4.17.21 at node_modules/lodash)");
    // A copy that only moved (hoisting) to a version already installed is no change to judge.
    const before = lockEntries(lock({ "node_modules/x/node_modules/foo": { version: "1.0.0" } })), after = lockEntries(lock({ "node_modules/foo": { version: "1.0.0" } }));
    expect(lockDiff(before, after)).toEqual([]);
    expect(lockEntryChanges(before, after).map(e => e.path)).toEqual(["node_modules/foo"]);
  });
  it("judges what a dependent falls back to when its nested copy is removed", () => {
    const lock = (packages: Record<string, { version: string; name?: string }>) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { resolved: url(p.name ?? path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...p }])) } });
    const facts = new Map([["lodash@4.17.21", fact()], ["lodash@4.17.20", fact({ advisories: ["GHSA-x"] })], ["foo@1.0.0", fact()], ["foo@1.0.1", fact()], ["a@1.0.0", fact()], ["evil-pkg@1.0.0", fact()]]);
    const run = (b: string, a: string) => {
      const before = lockEntries(b), after = lockEntries(a);
      return judge({ changes: lockDiff(before, after), entries: lockEntryChanges(before, after), facts, fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    };
    const base = { "node_modules/a": { version: "1.0.0" }, "node_modules/a/node_modules/lodash": { version: "4.17.21" }, "node_modules/foo": { version: "1.0.0" } };
    const down = run(lock({ ...base, "node_modules/lodash": { version: "4.17.20" } }), lock({ "node_modules/a": { version: "1.0.0" }, "node_modules/lodash": { version: "4.17.20" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(down.verdict).toBe("stop");
    expect(down.changes.map(c => [c.path, c.name, c.from, c.to])).toContainEqual(["node_modules/a/node_modules/lodash", "lodash", "4.17.21", "4.17.20"]);
    // The root copy is an alias for another package: the dependent now loads that package.
    const alias = run(lock({ ...base, "node_modules/lodash": { version: "1.0.0", name: "evil-pkg" } }), lock({ "node_modules/a": { version: "1.0.0" }, "node_modules/lodash": { version: "1.0.0", name: "evil-pkg" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(alias.findings.some(f => f.effect === "stop" && f.message.includes("instead of lodash@4.17.21"))).toBe(true);
    // A removed copy whose dependent is gone too changes nothing for anyone.
    expect(lockDiff(lockEntries(lock(base)), lockEntries(lock({ "node_modules/foo": { version: "1.0.0" } })))).toEqual([]);
  });
  it("lets package.json change only registry dependency specs", () => {
    const before = { name: "app", dependencies: { foo: "^1.0.0" } };
    expect(manifestChanges(before, { ...before, dependencies: { foo: "^1.0.1" } })).toEqual([]);
    expect(manifestChanges(before, { ...before, dependencies: { foo: "^1.0.1", bar: "npm:baz@^2.0.0" } })).toEqual([]);
    expect(manifestChanges(before, { ...before, scripts: { postinstall: "node x.js" } })).toEqual([expect.stringContaining('changes "scripts"')]);
    for (const spec of ["github:evil/foo", "git+https://example.com/foo.git", "file:../foo", "https://example.com/foo.tgz", "link:../foo"]) {
      expect(manifestChanges(before, { ...before, dependencies: { foo: spec } }), spec).toEqual([expect.stringContaining("not a registry range")]);
    }
    expect(manifestChanges(before, { ...before, overrides: { foo: "github:evil/foo" } })).toEqual(["package.json overrides point outside the npm registry."]);
    const result = run({}, {}, { now: "2027-01-01T00:00:00Z" });
    expect(judge({ changes: result.changes, facts: new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()]]), fixes: [], files: ["package.json", "package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), manifest: { before, after: { ...before, scripts: { preinstall: "sh x" } } } }).verdict).toBe("stop");
  });
  it("refuses lockfile keys that are not plain install paths, and stops on bundled dependencies", () => {
    for (const key of ["node_modules/../x/node_modules/lodash", "node_modules\\lodash", "node_modules//lodash"]) {
      expect(() => lockEntries(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, [key]: { version: "1.0.0" } } })), key).toThrow("Unexpected package-lock path");
    }
    expect(lockEntries(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "packages/app/node_modules/@s/x": { version: "1.0.0" } } }))[0]?.name).toBe("@s/x");
    const bundled = { path: "node_modules/p/node_modules/b", name: "b", version: "1.0.1", dev: false, resolved: null, integrity: null, bundled: true };
    const result = judge({ changes: [change()], entries: [bundled], facts: new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()]]), fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    expect(result.findings.map(f => f.message)).toContain("b@1.0.1 at node_modules/p/node_modules/b is bundled inside its parent and has no registry tarball of its own; a change to a bundled dependency needs review.");
  });
  it("judges a version whose hash changed at its path, not only gate 4", () => {
    const lock = (integrity: string) => JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/lib": { version: "1.0.1", resolved: url("lib", "1.0.1"), integrity } } });
    expect(lockDiff(lockEntries(lock("sha512-old")), lockEntries(lock(INTEGRITY))).map(c => [c.name, c.from, c.to])).toEqual([["lib", "1.0.1", "1.0.1"]]);
  });
  it("judges what each dependent loads: shadowing copies, aliases and moved dependents", () => {
    type Spec = { version: string; name?: string; dependencies?: Record<string, string> };
    const lock = (packages: Record<string, Spec>) => JSON.stringify({ lockfileVersion: 3, packages: {
      "": { dependencies: { a: "^1.0.0", foo: "^1.0.0", lodash: "^4.0.0", x: "^1.0.0" } },
      ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { resolved: url(p.name ?? path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...p }])),
    } });
    const facts = new Map([["lodash@4.17.21", fact()], ["lodash@4.17.20", fact({ advisories: ["GHSA-x"] })], ["lodash@3.10.1", fact({ advisories: ["GHSA-old"] })], ["foo@1.0.0", fact()], ["foo@1.0.1", fact()], ["evil-pkg@1.0.0", fact()], ["a@1.0.0", fact()], ["a@1.0.1", fact()], ["x@1.0.0", fact()]]);
    const verdict = (b: string, a: string) => judge({ changes: allChanges(b, a), entries: lockEntryChanges(lockEntries(b), lockEntries(a)), facts, fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    const a = { version: "1.0.0", dependencies: { lodash: "*" } };
    const common = { "node_modules/a": a, "node_modules/lodash": { version: "4.17.21" }, "node_modules/x": { version: "1.0.0", dependencies: { lodash: "^3.0.0", "evil-pkg": "1.0.0" } }, "node_modules/x/node_modules/lodash": { version: "3.10.1" }, "node_modules/x/node_modules/evil-pkg": { version: "1.0.0" } };
    // (A) A new copy under a shadows the root lodash with an older, vulnerable major that was already installed.
    const shadow = verdict(lock({ ...common, "node_modules/foo": { version: "1.0.0" } }), lock({ ...common, "node_modules/a/node_modules/lodash": { version: "3.10.1" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(shadow.verdict).toBe("stop");
    expect(shadow.findings.map(f => f.message)).toEqual(expect.arrayContaining([expect.stringContaining("lodash goes down from 4.17.21 to 3.10.1"), expect.stringContaining("GHSA-old")]));
    // (B) The shadowing copy is another package under the name lodash.
    const alias = verdict(lock({ ...common, "node_modules/foo": { version: "1.0.0" } }), lock({ ...common, "node_modules/a/node_modules/lodash": { version: "1.0.0", name: "evil-pkg" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(alias.verdict).toBe("stop");
    expect(alias.findings.some(f => f.message.includes("instead of lodash@4.17.21"))).toBe(true);
    // (C) a moves under x, its nested 4.17.21 is gone, and from there it now loads x's lodash 3.10.1.
    const before = lock({ ...common, "node_modules/a/node_modules/lodash": { version: "4.17.21" }, "node_modules/lodash": { version: "4.17.20" }, "node_modules/foo": { version: "1.0.0" } });
    const { "node_modules/a": _moved, ...rest } = common;
    const after = lock({ ...rest, "node_modules/lodash": { version: "4.17.20" }, "node_modules/x/node_modules/a": a, "node_modules/foo": { version: "1.0.1" } });
    const moved = verdict(before, after);
    expect(moved.verdict).toBe("stop");
    expect(moved.changes.some(c => c.name === "lodash" && c.from === "4.17.21" && c.to === "3.10.1")).toBe(true);
    // Nothing changes for anyone: no change.
    expect(allChanges(before, before)).toEqual([]);
    // (D) a itself is upgraded and its new version takes x's vulnerable lodash 3.10.1 through a new copy.
    const a101 = { version: "1.0.1", dependencies: { lodash: "^3.0.0" } };
    const upgraded = verdict(lock({ ...common, "node_modules/foo": { version: "1.0.0" } }), lock({ ...common, "node_modules/a": a101, "node_modules/a/node_modules/lodash": { version: "3.10.1" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(upgraded.verdict).toBe("stop");
    expect(upgraded.findings.map(f => f.message)).toEqual(expect.arrayContaining([expect.stringContaining("lodash goes down from 4.17.21 to 3.10.1")]));
    // (D2) ...or an alias of another installed package.
    const aliasUpgrade = verdict(lock({ ...common, "node_modules/foo": { version: "1.0.0" } }), lock({ ...common, "node_modules/a": { version: "1.0.1", dependencies: { lodash: "npm:evil-pkg@1.0.0" } }, "node_modules/a/node_modules/lodash": { version: "1.0.0", name: "evil-pkg" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(aliasUpgrade.findings.some(f => f.effect === "stop" && f.message.includes("instead of lodash@4.17.21"))).toBe(true);
    // Each copy of a dependent is compared with itself: another copy of a@1.0.0 already loading 3.10.1 does not excuse this one.
    const twoCopies = { ...common, "node_modules/x/node_modules/a": a, "node_modules/x/node_modules/a/node_modules/lodash": { version: "3.10.1" } };
    const pooled = verdict(lock({ ...twoCopies, "node_modules/foo": { version: "1.0.0" } }), lock({ ...twoCopies, "node_modules/a/node_modules/lodash": { version: "3.10.1" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(pooled.verdict).toBe("stop");
    // (E) a@1.0.0 moves next to a copy of the vulnerable 3.10.1 that another version of a (0.9.0) already loaded.
    const old = { "node_modules/x/node_modules/a": { version: "0.9.0", dependencies: { lodash: "*" } }, "node_modules/x/node_modules/a/node_modules/lodash": { version: "3.10.1" } };
    const { "node_modules/a": _a, ...withoutA } = common;
    const e = verdict(lock({ ...common, ...old, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...old, "node_modules/y/node_modules/a": a, "node_modules/y/node_modules/lodash": { version: "3.10.1" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(e.verdict).toBe("stop");
    expect(e.findings.map(f => f.message)).toEqual(expect.arrayContaining([expect.stringContaining("lodash goes down from 4.17.21 to 3.10.1")]));
    // (E2) moved and upgraded at once.
    const e2 = verdict(lock({ ...common, ...old, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...old, "node_modules/y/node_modules/a": a101, "node_modules/y/node_modules/lodash": { version: "3.10.1" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(e2.verdict).toBe("stop");
    // (E3) the other version of a loaded an alias; the moved a@1.0.0 now loads it instead of lodash.
    const oldAlias = { "node_modules/x/node_modules/a": { version: "0.9.0", dependencies: { lodash: "npm:evil-pkg@1.0.0" } }, "node_modules/x/node_modules/a/node_modules/lodash": { version: "1.0.0", name: "evil-pkg" } };
    const e3 = verdict(lock({ ...common, ...oldAlias, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...oldAlias, "node_modules/y/node_modules/a": a, "node_modules/y/node_modules/lodash": { version: "1.0.0", name: "evil-pkg" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(e3.findings.some(f => f.effect === "stop" && f.message.includes("instead of lodash@4.17.21"))).toBe(true);
    // (F) the moved a@1.0.0 now loads lodash 5.0.0, which another version of a loaded and which has an advisory 4.17.21 did not.
    const f5 = new Map([...facts, ["lodash@5.0.0", fact({ advisories: ["GHSA-five"] })]]);
    const verdictF = (b: string, a2: string) => judge({ changes: allChanges(b, a2), entries: lockEntryChanges(lockEntries(b), lockEntries(a2)), facts: f5, fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    const old5 = { "node_modules/x/node_modules/a": { version: "0.9.0", dependencies: { lodash: "*" } }, "node_modules/x/node_modules/a/node_modules/lodash": { version: "5.0.0" } };
    const f = verdictF(lock({ ...common, ...old5, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...old5, "node_modules/y/node_modules/a": a, "node_modules/y/node_modules/lodash": { version: "5.0.0" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(f.verdict).toBe("stop");
    expect(f.findings.some(fi => fi.effect === "stop" && fi.message.includes("GHSA-five"))).toBe(true);
    // (F2) moved and upgraded at once.
    const f2 = verdictF(lock({ ...common, ...old5, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...old5, "node_modules/y/node_modules/a": a101, "node_modules/y/node_modules/lodash": { version: "5.0.0" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(f2.verdict).toBe("stop");
    // A harmless move adds no row that compares a version with itself.
    expect(f.changes.some(c => c.from === c.to && !c.replaced)).toBe(false);
  });
  it("refuses lockfile paths that differ only in case, and dependency groups that are not objects", () => {
    expect(() => lockEntries(JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/lodash": { version: "1.0.0" }, "node_modules/Lodash": { version: "1.0.0" } } }))).toThrow("differ only in case");
    expect(manifestChanges({ dependencies: {} }, { dependencies: ["x"] })).toEqual(["package.json dependencies is not an object of name: range."]);
    expect(manifestChanges({}, { dependencies: "abc" })).toEqual(["package.json dependencies is not an object of name: range."]);
  });
  it("is undecidable when the given changed files leave out the lockfile", () => {
    expect(run({}, {}, { files: [], now: "2027-01-01T00:00:00Z" }).verdict).toBe("undecidable");
    expect(run({}, {}, { files: ["package.json"], now: "2027-01-01T00:00:00Z" }).verdict).toBe("undecidable");
  });
  it("ranks urgency by exploitation, severity or EPSS, and dev-only last", () => {
    const prod = [change()], dev = [change({ dev: true })];
    expect(urgencyOf([{ ...fixHigh, kev: true }], prod)).toBe("exploited");
    expect(urgencyOf([fixHigh], prod)).toBe("high");
    expect(urgencyOf([{ ...fixHigh, severity: "MODERATE", epss: 0.4 }], prod)).toBe("high");
    expect(urgencyOf([{ ...fixHigh, severity: "MODERATE" }], prod)).toBe("normal");
    expect(urgencyOf([], prod)).toBe("normal");
    expect(urgencyOf([{ ...fixHigh, kev: true }], dev)).toBe("low");
    // A dev-only fix does not hurry a production passenger.
    const passenger = change({ path: "node_modules/other", name: "other", resolved: url("other", "1.0.1") });
    expect(urgencyOf([{ ...fixHigh, kev: true }], [change({ dev: true }), passenger])).toBe("normal");
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
