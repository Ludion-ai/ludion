import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allChanges, installScripts, judge, lockDiff, lockEntries, lockEntryChanges, lockExtraneous, lockLinks, manifestChanges, ownFixes, registryTarball, renderJudgement, urgencyOf, WAIT_HOURS, type Change, type FixedAdvisory, type VersionFacts } from "../src/security/judge.ts";
import { gatherFacts, osvIds, provenanceFrom, sharedPublisher } from "../src/security/npm-facts.ts";
import { pnpmChanges } from "../src/security/judge-cli.ts";
import { OsvClient } from "../src/security/osv.ts";
import { firstPublish, renderTimeCap, timeCap } from "../src/security/time-cap.ts";

const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
const url = (name: string, version: string) => `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
const lockOf = (packages: Record<string, { version: string; dev?: boolean }>) => JSON.stringify({
  lockfileVersion: 3,
  packages: { "": { name: "app" }, ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { version: p.version, resolved: url(path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...(p.dev ? { dev: true } : {}) }])) },
});
const COMMIT = "535e26d3c69de49df8bd17618a424cbe65ec897b";
/** A record as npm writes it today, with GitHub's repository id and event; OLD has neither, as older or other formats. */
const PROV = { repository: "https://github.com/acme/lib", workflow: ".github/workflows/release.yml", commit: COMMIT, repository_id: "123456789", event: "push" };
const OLD = { repository: PROV.repository, workflow: PROV.workflow, commit: COMMIT };
const fact =(over: Partial<VersionFacts> = {}): VersionFacts => ({ published_at: "2026-10-01T00:00:00Z", present: true, deprecated: null, publisher: "alice", shared_publisher: false, provenance: PROV, install_scripts: [], dependencies: ["dep-a"], integrity: INTEGRITY, malicious: [], advisories: [], package_created: "2020-01-01T00:00:00Z", ...over });
/** A package from another repository and release than lib, so it is never lib's sibling. */
const depFact = (over: Partial<VersionFacts> = {}) => fact({ provenance: { repository: "https://github.com/acme/dep-a", workflow: ".github/workflows/release.yml", commit: "1".repeat(40), repository_id: "987654321", event: "push" }, ...over });
const change = (over: Partial<Change> = {}): Change => ({ path: "node_modules/lib", name: "lib", from: "1.0.0", to: "1.0.1", dev: false, resolved: url("lib", "1.0.1"), integrity: INTEGRITY, replaced: null, ...over });
const fixHigh: FixedAdvisory = { id: "GHSA-aaaa-bbbb-cccc", package: "lib", from: "1.0.0", to: "1.0.1", aliases: ["CVE-2026-1"], severity: "CRITICAL", kev: false, epss: null };
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
    // docs/decisions/2026-10-30-provenance-immutable-id.md. SlugFest: the name and path are the same, the id is another.
    ["another repository id under the same name and workflow", { provenance: { ...PROV, repository_id: "999" } }, {}, "was built from GitHub repository id 999, not 123456789 like 1.0.0."],
    ["a repository id on the new version only", {}, { provenance: OLD }, "Only one of lib@1.0.0 and 1.0.1 records a GitHub repository id in its provenance, so they cannot be compared."],
    ["a repository id on the old version only", { provenance: OLD }, {}, "Only one of lib@1.0.0 and 1.0.1 records a GitHub repository id"],
    ["a name that differs with the same id (a rename or transfer is not let through)", { provenance: { ...PROV, repository: "https://github.com/acme/lib-renamed" } }, {}, "was built from"],
    ["publishing from pull_request_target", { provenance: { ...PROV, event: "pull_request_target" } }, {}, "lib@1.0.1's provenance was published from a GitHub pull_request_target event, not push, release or workflow_dispatch."],
    ["publishing from issue_comment", { provenance: { ...PROV, event: "issue_comment" } }, {}, "issue_comment event"],
    ["publishing from workflow_run", { provenance: { ...PROV, event: "workflow_run" } }, {}, "workflow_run event"],
    ["publishing from schedule", { provenance: { ...PROV, event: "schedule" } }, {}, "schedule event"],
    ["a repository id without an event", { provenance: { ...PROV, event: null } }, {}, "lib@1.0.1's provenance records a GitHub repository id but no triggering event."],
    ["a new install script", { install_scripts: ["preinstall"] }, {}, "adds install scripts: preinstall"],
    ["a malicious-package record", { malicious: ["MAL-2025-1"] }, {}, "malicious-package records"],
    ["deprecation", { deprecated: "Bad release" }, {}, "deprecated"],
    ["withdrawal", { present: false }, {}, "no longer listed"],
  ])("stops on %s, whatever the wait", (_name, next, prev, message) => {
    const result = run(next, prev, { now: "2027-01-01T00:00:00Z" });
    expect(result.verdict).toBe("stop");
    expect(result.findings.some(f => f.effect === "stop" && f.message.includes(message))).toBe(true);
  });
  it("compares two records without a repository id by name and workflow, as before, and says it did not compare by ID", () => {
    const result = run({ provenance: OLD }, { provenance: OLD }, { now: "2027-01-01T00:00:00Z" });
    expect(result.verdict).toBe("ready_except_build");
    expect(result.findings).toEqual([{ gate: 2, package: "lib", effect: "info", message: "Neither lib@1.0.0 nor 1.0.1 records a GitHub repository id in its provenance: compared by repository name and workflow, not by ID." }]);
    expect(run({ provenance: { ...OLD, repository: "https://github.com/evil/lib" } }, { provenance: OLD }, { now: "2027-01-01T00:00:00Z" }).verdict).toBe("stop");
    // A record with neither an id nor an event is not checked for its event.
    expect(run({ provenance: { ...OLD, event: null, repository_id: null } }, { provenance: OLD }, { now: "2027-01-01T00:00:00Z" }).verdict).toBe("ready_except_build");
  });
  it("lets push, release and workflow_dispatch publish, and judges the event of the version installed, not the one replaced", () => {
    for (const event of ["push", "release", "workflow_dispatch"]) expect(run({ provenance: { ...PROV, event } }, {}, { now: "2027-01-01T00:00:00Z" }).findings).toEqual([]);
    expect(run({}, { provenance: { ...PROV, event: "pull_request_target" } }, { now: "2027-01-01T00:00:00Z" }).verdict).toBe("ready_except_build");
    // An event recorded with no id on either side is still checked.
    const eventOnly = run({ provenance: { ...OLD, event: "issue_comment" } }, { provenance: OLD }, { now: "2027-01-01T00:00:00Z" });
    expect(eventOnly.findings).toContainEqual(expect.objectContaining({ effect: "stop", message: expect.stringContaining("issue_comment event") }));
  });
  it("says the id and the event are the build's own claims, which only the wait and the re-query back", () => {
    expect(run({}).not_checked).toContain("The GitHub repository id and event in a provenance statement are written by npm from the build's environment variables, which the publishing workflow can set; Ludion has not established that the registry matches them against the signing certificate. A re-registered repository name whose publisher writes the old id and an allowed event passes these checks and is caught only by the wait and the re-query.");
  });
  it("stops a package new to the project when its provenance was published from another event", () => {
    const result = judge({ changes: [change({ from: null })], facts: new Map([["lib@1.0.1", fact({ provenance: { ...PROV, event: "pull_request_target" } })]]), fixes: [], direct: ["lib"], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), created: new Map([["lib", "2020-01-01T00:00:00Z"]]) });
    expect(result.findings).toContainEqual(expect.objectContaining({ effect: "stop", message: "lib@1.0.1's provenance was published from a GitHub pull_request_target event, not push, release or workflow_dispatch." }));
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
    expect(run({ provenance: { repository: null, workflow: null, commit: null } }, { provenance: { repository: null, workflow: null, commit: null } }, { fixes: kev }).wait_hours).toBe(24);
  });
  it("counts the wait from the newest publish in the diff, not just the target", () => {
    const changes = [change(), change({ path: "node_modules/dep-a", name: "dep-a", from: "1.0.0", to: "1.1.0", resolved: url("dep-a", "1.1.0") })];
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["dep-a@1.0.0", depFact()], ["dep-a@1.1.0", depFact({ published_at: "2026-10-05T00:00:00Z" })]]);
    // dep-a@1.1.0 is newer than the fix, but already in the lockfile (another path), so the cap lets it move.
    const result = judge({ changes, facts, fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2026-10-05T12:00:00Z"), locked: new Set(["lib@1.0.0", "dep-a@1.0.0", "dep-a@1.1.0"]) });
    expect(result.newest_publish).toBe("2026-10-05T00:00:00Z");
    expect(result.verdict).toBe("wait");
  });
  it("stops a version newer than the fix that was not in the lockfile, and always shows the count", () => {
    const passenger = (published_at: string) => {
      const changes = [change(), change({ path: "node_modules/dep-a", name: "dep-a", from: "1.0.0", to: "1.1.0", resolved: url("dep-a", "1.1.0") })];
      const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["dep-a@1.0.0", depFact()], ["dep-a@1.1.0", depFact({ published_at })]]);
      return judge({ changes, facts, fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), locked: new Set(["lib@1.0.0", "dep-a@1.0.0"]) });
    };
    // Published after the fix (T = 2026-10-01), and at the same instant: both stop.
    for (const at of ["2026-10-05T00:00:00Z", "2026-10-01T00:00:00Z"]) {
      const late = passenger(at);
      expect(late.verdict).toBe("stop");
      expect(late.time_cap.after_t).toEqual(["dep-a@1.1.0"]);
      expect(late.findings).toContainEqual(expect.objectContaining({ effect: "stop", message: expect.stringContaining("dep-a@1.1.0 was published at or after the fix (T = 2026-10-01T00:00:00.000Z)") }));
      expect(renderJudgement(late)).toContain("Published at or after T (2026-10-01T00:00:00.000Z, the fix's publish time): 1 version(s)\n  dep-a@1.1.0");
    }
    const early = passenger("2026-09-30T23:59:59Z");
    expect(early.verdict).toBe("ready_except_build");
    expect(renderJudgement(early)).toContain("Published at or after T (2026-10-01T00:00:00.000Z, the fix's publish time): 0 version(s)");
  });
  it("takes the changed direct dependencies as targets when nothing is fixed, and is undecidable without any", () => {
    const changes = [change(), change({ path: "node_modules/dep-a", name: "dep-a", from: "1.0.0", to: "1.1.0", resolved: url("dep-a", "1.1.0") })];
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["dep-a@1.0.0", depFact()], ["dep-a@1.1.0", depFact({ published_at: "2026-10-03T00:00:00Z" })]]);
    const base = { changes, facts, fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") };
    expect(judge({ ...base, direct: ["lib"] }).time_cap).toMatchObject({ t: "2026-10-01T00:00:00.000Z", after_t: ["dep-a@1.1.0"] });
    expect(judge({ ...base, direct: ["lib", "dep-a"] }).verdict).toBe("ready_except_build");
    const none = judge(base);
    expect(none.verdict).toBe("undecidable");
    expect(renderJudgement(none)).toContain("Published at or after T (unknown, the fix's publish time): unknown version(s)");
  });
  it("stops on a new dependency whose package is younger than the base wait at T; an older one only extends", () => {
    const run = (created: string | null | undefined) => judge({
      changes: [change()], fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"),
      facts: new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact({ dependencies: ["dep-a", "fresh"] })]]),
      created: created === undefined ? new Map() : new Map([["fresh", created]]),
    });
    // High urgency: base wait 24h before T = 2026-10-01.
    const young = run("2026-09-30T00:00:01Z");
    expect(young.verdict).toBe("stop");
    expect(young.time_cap.young).toEqual(["fresh (first published 2026-09-30T00:00:01.000Z)"]);
    const old = run("2026-09-30T00:00:00Z");
    expect(old.time_cap.young).toEqual([]);
    expect(old.findings).toContainEqual(expect.objectContaining({ effect: "extend", message: expect.stringContaining("adds dependencies: fresh") }));
    expect(run(null).verdict).toBe("undecidable");
    expect(run(undefined).verdict).toBe("undecidable");
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
    const base = { changes: [fresh], fixes: [], files: ["package-lock.json"], now: new Date("2026-10-02T00:00:00Z"), direct: ["fresh"] };
    expect(judge({ ...base, facts: new Map([["fresh@1.0.0", fact()]]) }).wait_hours).toBe(144);
    expect(judge({ ...base, facts: new Map([["fresh@1.0.0", fact({ install_scripts: ["postinstall"] })]]) }).verdict).toBe("stop");
  });
});

describe("rule 1's same-release exception", () => {
  // The fix lib@1.0.1 is published at T = 2026-10-01T00:00:00Z; its sibling lib-env moves with it.
  const sibling = (next: Partial<VersionFacts>, fix: Partial<VersionFacts> = {}, to = "1.0.1") => judge({
    changes: [change(), change({ path: "node_modules/lib-env", name: "lib-env", from: "1.0.0", to, resolved: url("lib-env", to) })],
    facts: new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact(fix)], ["lib-env@1.0.0", fact()], [`lib-env@${to}`, fact(next)]]),
    fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), locked: new Set(["lib@1.0.0", "lib-env@1.0.0"]),
  });
  it("allows a sibling whose provenance names the same repository, workflow and commit, at any time and any version", () => {
    const result = sibling({ published_at: "2026-10-03T00:00:00Z" }, {}, "2.0.0");
    expect(result.time_cap.after_t).toEqual([]);
    expect(result.time_cap.same_release).toEqual([{ version: "lib-env@2.0.0", target: "lib@1.0.1", basis: "provenance", by_id: true }]);
    expect(result.findings.filter(f => f.effect === "stop")).toEqual([]);
    expect(renderJudgement(result)).toContain("Published at or after T (2026-10-01T00:00:00.000Z, the fix's publish time): 1 version(s)\n  lib-env@2.0.0: allowed, the same release as lib@1.0.1 (provenance names the same repository, workflow, commit and repository id)");
  });
  it("allows a sibling when neither record has a repository id, as before, and says it was not compared by ID", () => {
    const cap = sibling({ published_at: "2026-10-01T00:00:05Z", provenance: OLD }, { provenance: OLD }).time_cap;
    expect(cap.same_release).toEqual([{ version: "lib-env@1.0.1", target: "lib@1.0.1", basis: "provenance", by_id: false }]);
    expect(renderTimeCap(cap)[1]).toBe("  lib-env@1.0.1: allowed, the same release as lib@1.0.1 (provenance names the same repository, workflow and commit; neither records a repository id, so not compared by ID)");
    // An entry that does not say it was compared by ID is shown as not compared by ID.
    const { by_id: _unsaid, ...unsaid } = cap.same_release[0]!;
    expect(renderTimeCap({ ...cap, same_release: [unsaid] })[1]).toContain("so not compared by ID");
  });
  it("counts the wait from the newest sibling", () => {
    const result = sibling({ published_at: "2026-10-01T00:10:00Z" });
    expect(result.newest_publish).toBe("2026-10-01T00:10:00Z");
    expect(result.wait_until).toBe("2026-10-02T00:10:00.000Z");
  });
  it.each([
    ["another commit", { provenance: { ...PROV, commit: "0".repeat(40) } }, {}],
    ["another repository", { provenance: { ...PROV, repository: "https://github.com/evil/lib" } }, {}],
    ["another workflow", { provenance: { ...PROV, workflow: ".github/workflows/pr.yml" } }, {}],
    ["a record without a commit", { provenance: { ...PROV, commit: null } }, { provenance: { ...PROV, commit: null } }],
    ["a record without a repository", { provenance: { ...PROV, repository: null } }, { provenance: { ...PROV, repository: null } }],
    ["a record without a workflow", { provenance: { ...PROV, workflow: null } }, { provenance: { ...PROV, workflow: null } }],
    ["provenance on the sibling only", {}, { provenance: null }],
    ["provenance on the fix only", { provenance: null }, {}],
    ["another repository id under the same name, workflow and commit", { provenance: { ...PROV, repository_id: "999" } }, {}],
    ["a repository id on the fix only", { provenance: OLD }, {}],
    ["a repository id on the sibling only", {}, { provenance: OLD }],
    ["a sibling published from pull_request_target", { provenance: { ...PROV, event: "pull_request_target" } }, {}],
    ["a fix published from issue_comment", {}, { provenance: { ...PROV, event: "issue_comment" } }],
    ["a sibling with a repository id and no event", { provenance: { ...PROV, event: null } }, {}],
  ])("stops a sibling with %s", (_name, next, fix) => {
    const result = sibling({ published_at: "2026-10-01T00:00:05Z", ...next }, fix);
    expect(result.time_cap.same_release).toEqual([]);
    expect(result.time_cap.after_t).toEqual(["lib-env@1.0.1"]);
    expect(result.verdict).toBe("stop");
  });
  it("without provenance, allows only the same publisher and version at most 15 minutes after T", () => {
    const none = { provenance: null };
    const at = (published_at: string, over: Partial<VersionFacts> = {}, to = "1.0.1") => sibling({ ...none, published_at, ...over }, none, to).time_cap;
    expect(at("2026-10-01T00:15:00.000Z").same_release).toEqual([{ version: "lib-env@1.0.1", target: "lib@1.0.1", basis: "publisher" }]);
    expect(at("2026-10-01T00:00:00.000Z").same_release).toHaveLength(1);
    expect(at("2026-10-01T00:15:00.001Z").after_t).toEqual(["lib-env@1.0.1"]);
    expect(at("2026-10-01T00:00:05Z", { publisher: "mallory" }).after_t).toEqual(["lib-env@1.0.1"]);
    expect(at("2026-10-01T00:00:05Z", {}, "1.0.2").after_t).toEqual(["lib-env@1.0.2"]);
    // An unknown publisher (on either side) never matches.
    expect(at("2026-10-01T00:00:05Z", { publisher: null }).after_t).toEqual(["lib-env@1.0.1"]);
    expect(sibling({ ...none, published_at: "2026-10-01T00:00:05Z", publisher: null }, { ...none, publisher: null }).time_cap.after_t).toEqual(["lib-env@1.0.1"]);
    expect(renderTimeCap(at("2026-10-01T00:00:05Z"))[1]).toBe("  lib-env@1.0.1: allowed, the same release as lib@1.0.1 (no provenance; same publisher and version, at most 15 minutes after it)");
  });
  it("does not count npm trusted publishing's shared user as the same publisher", () => {
    // Both read "GitHub Actions" (npm-oidc-no-reply@github.com), whoever's repository published them.
    const shared = { provenance: null, publisher: "GitHub Actions", shared_publisher: true };
    expect(sibling({ ...shared, published_at: "2026-10-01T00:00:05Z" }, shared).time_cap.after_t).toEqual(["lib-env@1.0.1"]);
    // Without the flag the same names would match: the flag is what stops it.
    expect(sibling({ ...shared, shared_publisher: false, published_at: "2026-10-01T00:00:05Z" }, { ...shared, shared_publisher: false }).time_cap.same_release).toHaveLength(1);
  });
  it("with several targets, counts the 15 minutes from the matched target, not only from T", () => {
    // old@2.1.0 was fixed a month before T (lib@1.0.1); old-helper@2.1.0 by old's publisher 5 minutes after T is no sibling of it.
    const changes = [change(), change({ path: "node_modules/old", name: "old", from: "2.0.0", to: "2.1.0", resolved: url("old", "2.1.0") }), change({ path: "node_modules/old-helper", name: "old-helper", from: "2.0.0", to: "2.1.0", resolved: url("old-helper", "2.1.0") })];
    const none = { provenance: null, publisher: "bob" };
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["old@2.0.0", fact(none)], ["old@2.1.0", fact({ ...none, published_at: "2026-09-01T00:00:00Z" })], ["old-helper@2.0.0", fact(none)], ["old-helper@2.1.0", fact({ ...none, published_at: "2026-10-01T00:05:00Z" })]]);
    const result = judge({ changes, facts, fixes: [fixHigh, { ...fixHigh, package: "old", from: "2.0.0", to: "2.1.0" }], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), locked: new Set(["lib@1.0.0", "old@2.0.0", "old-helper@2.0.0"]) });
    expect(result.time_cap.t).toBe("2026-10-01T00:00:00.000Z");
    expect(result.time_cap.after_t).toEqual(["old-helper@2.1.0"]);
  });
  it("takes only the fixing version as a target: a newer copy of the fixed package added alongside neither sets T nor anchors a sibling", () => {
    // lib 1.0.0 → 1.0.1 is the fix (T = 2026-10-01). The same change adds foo's own lib@2.5.0, a week after the fix.
    const copy = change({ path: "node_modules/foo/node_modules/lib", from: null, to: "2.5.0", resolved: url("lib", "2.5.0") });
    const sibling = change({ path: "node_modules/lib-env", name: "lib-env", from: "2.4.0", to: "2.5.0", resolved: url("lib-env", "2.5.0") });
    const late = { provenance: null, publisher: "bob", published_at: "2026-10-08T00:00:00Z" };
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["lib@2.5.0", fact(late)], ["lib-env@2.4.0", fact({ provenance: null, publisher: "bob" })], ["lib-env@2.5.0", fact({ ...late, published_at: "2026-10-08T00:01:00Z" })]]);
    const result = judge({ changes: [change(), copy, sibling], facts, fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), locked: new Set(["lib@1.0.0", "lib-env@2.4.0"]) });
    expect(result.time_cap.t).toBe("2026-10-01T00:00:00.000Z");
    expect(result.time_cap.after_t).toEqual(["lib-env@2.5.0", "lib@2.5.0"]);
    expect(result.time_cap.same_release).toEqual([]);
    expect(result.verdict).toBe("stop");
  });
  it("counts urgency only from the fixing version, not from another copy of its name", () => {
    const devFix = change({ dev: true });
    const prodCopy = change({ path: "node_modules/foo/node_modules/lib", from: "2.0.0", to: "2.0.1", resolved: url("lib", "2.0.1") });
    expect(urgencyOf([{ ...fixHigh, kev: true }], [devFix, prodCopy])).toBe("normal");
    expect(urgencyOf([{ ...fixHigh, kev: true, from: "2.0.0", to: "2.0.1" }], [devFix, prodCopy])).toBe("exploited");
    // A dependent that moves off the vulnerable 1.0.0 in production ends a production exposure: its fix counts for
    // urgency, though it is no target (ownFixes).
    const loaded = change({ path: "node_modules/foo/node_modules/lib", from: "1.0.0", to: "2.5.0", resolved: url("lib", "2.5.0") });
    expect(urgencyOf([{ ...fixHigh, kev: true }, { ...fixHigh, kev: true, to: "2.5.0" }], [devFix, loaded])).toBe("exploited");
    // A production copy that was never vulnerable, moving to the fixed version number, does not match the fix.
    const neverVulnerable = change({ path: "node_modules/foo/node_modules/lib", from: "0.9.0", to: "1.0.1", resolved: url("lib", "1.0.1") });
    expect(urgencyOf([{ ...fixHigh, kev: true }], [devFix, neverVulnerable])).toBe("normal");
  });
  it("keeps, per advisory, package and vulnerable version, only the smallest version it changed to", () => {
    const lineTwo = { ...fixHigh, from: "2.0.0", to: "2.0.1" };
    expect(ownFixes([fixHigh, { ...fixHigh, to: "2.5.0" }, lineTwo])).toEqual([fixHigh, lineTwo]);
    expect(ownFixes([{ ...fixHigh, to: "2.5.0" }, fixHigh])).toEqual([fixHigh]);
    // Another advisory on the same versions is its own fix.
    expect(ownFixes([fixHigh, { ...fixHigh, id: "GHSA-dddd-eeee-ffff", to: "2.5.0" }])).toHaveLength(2);
  });
  it("does not let a dependent's newly loaded copy of the fixed package set T (through allChanges and gatherFacts)", async () => {
    // Before: root lib@1.0.0 (GHSA-x), loaded by foo@1.0.0. After: root lib@1.0.1 (the fix, 2026-10-01); foo@2.0.0 now
    // loads its own lib@2.5.0, published a week after the fix.
    const entry = (name: string, version: string, deps?: Record<string, string>) => ({ version, resolved: url(name, version), integrity: INTEGRITY, ...(deps ? { dependencies: deps } : {}) });
    const before = JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app", dependencies: { lib: "^1.0.0", foo: "^1.0.0" } }, "node_modules/lib": entry("lib", "1.0.0"), "node_modules/foo": entry("foo", "1.0.0", { lib: "^1.0.0" }) } });
    const after = JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app", dependencies: { lib: "^1.0.1", foo: "^2.0.0" } }, "node_modules/lib": entry("lib", "1.0.1"), "node_modules/foo": entry("foo", "2.0.0", { lib: "^2.0.0" }), "node_modules/foo/node_modules/lib": entry("lib", "2.5.0") } });
    const changes = allChanges(before, after);
    expect(changes.filter(c => c.name === "lib").map(c => `${c.from}→${c.to}`).sort()).toEqual(["1.0.0→1.0.1", "1.0.0→2.5.0", "null→2.5.0"]);
    const time: Record<string, Record<string, string>> = { lib: { created: "2020-01-01T00:00:00Z", "1.0.0": "2026-09-01T00:00:00Z", "1.0.1": "2026-10-01T00:00:00Z", "2.5.0": "2026-10-08T00:00:00Z" }, foo: { created: "2020-01-01T00:00:00Z", "1.0.0": "2026-09-01T00:00:00Z", "2.0.0": "2026-10-05T00:00:00Z" } };
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (u === "https://api.osv.dev/v1/querybatch") {
        const queries = JSON.parse(String(init?.body)).queries as { package: { name: string }; version: string }[];
        return json({ results: queries.map(q => ({ vulns: q.package.name === "lib" && q.version === "1.0.0" ? [{ id: "GHSA-aaaa-bbbb-cccc" }] : [] })) });
      }
      if (u === "https://api.osv.dev/v1/vulns/GHSA-aaaa-bbbb-cccc") return json({ id: "GHSA-aaaa-bbbb-cccc", aliases: [], database_specific: { severity: "HIGH" } });
      if (u.includes("known_exploited_vulnerabilities")) return json({ vulnerabilities: [] });
      const name = u.split("/").at(-1)!;
      if (u.startsWith("https://registry.npmjs.org/") && time[name]) return json({ name, time: time[name], versions: Object.fromEntries(Object.keys(time[name]!).filter(v => v !== "created").map(v => [v, { name, version: v, _npmUser: { name: "bob" }, dist: { integrity: INTEGRITY } }])) });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const { facts, fixes } = await gatherFacts(changes, fetchFn);
    // gatherFacts records both changes away from the vulnerable 1.0.0; only the smallest is the change's own fix.
    expect(fixes.map(f => `${f.package}@${f.from}→${f.to}`).sort()).toEqual(["lib@1.0.0→1.0.1", "lib@1.0.0→2.5.0"]);
    expect(ownFixes(fixes).map(f => f.to)).toEqual(["1.0.1"]);
    const result = judge({ changes, entries: lockEntryChanges(lockEntries(before), lockEntries(after)), facts, fixes, files: ["package.json", "package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), manifest: { before: JSON.parse(before).packages[""], after: JSON.parse(after).packages[""] } });
    expect(result.time_cap.t).toBe("2026-10-01T00:00:00.000Z");
    expect(result.time_cap.after_t).toEqual(["foo@2.0.0", "lib@2.5.0"]);
    expect(result.exposure.fix_published_at).toBe("2026-10-01T00:00:00Z");
    expect(result.verdict).toBe("stop");
  });
  it("allows nothing after T for a version without publisher and provenance facts", () => {
    const base = { targets: [{ name: "lib", version: "1.0.1" }], others: [{ name: "lib-env", version: "1.0.1" }], locked: new Set<string>(), newDependencies: [], created: () => null, waitHours: 24, published: () => "2026-10-01T00:00:00Z" };
    const known = { publisher: "alice", provenance: null };
    expect(timeCap({ ...base, identity: name => name === "lib" ? known : undefined }).after_t).toEqual(["lib-env@1.0.1"]);
    expect(timeCap({ ...base, identity: name => name === "lib" ? undefined : known }).after_t).toEqual(["lib-env@1.0.1"]);
    expect(timeCap(base).after_t).toEqual(["lib-env@1.0.1"]);
    expect(timeCap({ ...base, identity: () => known }).same_release).toHaveLength(1);
  });
  it("leaves rule 2 as it is: a young new sibling still stops", () => {
    const fresh = change({ path: "node_modules/lib-new", name: "lib-new", from: null, to: "1.0.1", resolved: url("lib-new", "1.0.1") });
    const result = judge({
      changes: [change(), fresh], fixes: [fixHigh], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), locked: new Set(["lib@1.0.0"]),
      facts: new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["lib-new@1.0.1", fact({ published_at: "2026-10-01T00:00:05Z", package_created: "2026-10-01T00:00:05Z" })]]),
    });
    expect(result.time_cap.same_release).toHaveLength(1);
    expect(result.time_cap.young).toEqual(["lib-new (first published 2026-10-01T00:00:05.000Z)"]);
    expect(result.verdict).toBe("stop");
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
      return judge({ changes: lockDiff(before, after), entries: lockEntryChanges(before, after), facts, fixes: [], direct: [...new Set([...facts.keys()].map(id => id.slice(0, id.lastIndexOf("@"))))], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
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
      return judge({ changes: lockDiff(before, after), entries: lockEntryChanges(before, after), facts, fixes: [], direct: [...new Set([...facts.keys()].map(id => id.slice(0, id.lastIndexOf("@"))))], files: ["package.json", "package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
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
      return judge({ changes: lockDiff(before, after), entries: lockEntryChanges(before, after), facts, fixes: [], direct: [...new Set([...facts.keys()].map(id => id.slice(0, id.lastIndexOf("@"))))], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
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
    expect(judge({ changes: result.changes, facts: new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()]]), fixes: [], direct: ["lib"], files: ["package.json", "package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), manifest: { before, after: { ...before, scripts: { preinstall: "sh x" } } } }).verdict).toBe("stop");
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
      "": { dependencies: { foo: "^1.0.0", lodash: "^4.0.0", x: "^1.0.0" } },
      ...Object.fromEntries(Object.entries(packages).map(([path, p]) => [path, { resolved: url(p.name ?? path.split("node_modules/").at(-1)!, p.version), integrity: INTEGRITY, ...p }])),
    } });
    const facts = new Map([["lodash@4.17.21", fact()], ["lodash@4.17.20", fact({ advisories: ["GHSA-x"] })], ["lodash@3.10.1", fact({ advisories: ["GHSA-old"] })], ["foo@1.0.0", fact()], ["foo@1.0.1", fact()], ["evil-pkg@1.0.0", fact()], ["a@1.0.0", fact()], ["a@1.0.1", fact()], ["x@1.0.0", fact()]]);
    const verdict = (b: string, a: string) => judge({ changes: allChanges(b, a), entries: lockEntryChanges(lockEntries(b), lockEntries(a)), facts, fixes: [], direct: [...new Set([...facts.keys()].map(id => id.slice(0, id.lastIndexOf("@"))))], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    const a = { version: "1.0.0", dependencies: { lodash: "*" } };
    const common = { "node_modules/a": a, "node_modules/lodash": { version: "4.17.21" }, "node_modules/x": { version: "1.0.0", dependencies: { lodash: "^3.0.0", "evil-pkg": "1.0.0" } }, "node_modules/x/node_modules/lodash": { version: "3.10.1" }, "node_modules/x/node_modules/evil-pkg": { version: "1.0.0" } };
    // (A) A new copy under a shadows the root lodash with an older, vulnerable major that was already installed.
    const shadow = verdict(lock({ ...common, "node_modules/foo": { version: "1.0.0" } }), lock({ ...common, "node_modules/a/node_modules/lodash": { version: "3.10.1" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(shadow.verdict).toBe("stop");
    expect(shadow.findings.map(f => f.message)).toEqual(expect.arrayContaining([expect.stringContaining("lodash goes down from 4.17.21 to 3.10.1"), expect.stringContaining("GHSA-old")]));
    // (B) The shadowing copy is another package under the name lodash, which a requires as lodash: the lock is not read
    // at all (review of ebfe89d, B1), since what a finds there is not what it requires.
    expect(() => verdict(lock({ ...common, "node_modules/foo": { version: "1.0.0" } }), lock({ ...common, "node_modules/a/node_modules/lodash": { version: "1.0.0", name: "evil-pkg" }, "node_modules/foo": { version: "1.0.1" } }))).toThrow("node_modules/a requires lodash *, and node_modules/a/node_modules/lodash has evil-pkg@1.0.0, which is not that");
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
    // (E3) the other version of a loaded an alias; the moved a@1.0.0, which requires lodash itself, would load it instead
    // of lodash: the lock is not read at all (review of ebfe89d, B1).
    const oldAlias = { "node_modules/x/node_modules/a": { version: "0.9.0", dependencies: { lodash: "npm:evil-pkg@1.0.0" } }, "node_modules/x/node_modules/a/node_modules/lodash": { version: "1.0.0", name: "evil-pkg" } };
    expect(() => verdict(lock({ ...common, ...oldAlias, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...oldAlias, "node_modules/y/node_modules/a": a, "node_modules/y/node_modules/lodash": { version: "1.0.0", name: "evil-pkg" }, "node_modules/foo": { version: "1.0.1" } }))).toThrow("node_modules/y/node_modules/a requires lodash *, and node_modules/y/node_modules/lodash has evil-pkg@1.0.0, which is not that");
    // (F) the moved a@1.0.0 now loads lodash 5.0.0, which another version of a loaded and which has an advisory 4.17.21 did not.
    const f5 = new Map([...facts, ["lodash@5.0.0", fact({ advisories: ["GHSA-five"] })]]);
    const verdictF = (b: string, a2: string) => judge({ changes: allChanges(b, a2), entries: lockEntryChanges(lockEntries(b), lockEntries(a2)), facts: f5, fixes: [], direct: [...new Set([...f5.keys()].map(id => id.slice(0, id.lastIndexOf("@"))))], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z") });
    const old5 = { "node_modules/x/node_modules/a": { version: "0.9.0", dependencies: { lodash: "*" } }, "node_modules/x/node_modules/a/node_modules/lodash": { version: "5.0.0" } };
    const f = verdictF(lock({ ...common, ...old5, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...old5, "node_modules/y/node_modules/a": a, "node_modules/y/node_modules/lodash": { version: "5.0.0" }, "node_modules/foo": { version: "1.0.1" } }));
    expect(f.verdict).toBe("stop");
    expect(f.findings.some(fi => fi.effect === "stop" && fi.message.includes("GHSA-five"))).toBe(true);
    // (F2) moved and upgraded at once.
    const f2 = verdictF(lock({ ...common, ...old5, "node_modules/foo": { version: "1.0.0" } }), lock({ ...withoutA, ...old5, "node_modules/y/node_modules/a": { ...a101, dependencies: { lodash: "*" } }, "node_modules/y/node_modules/lodash": { version: "5.0.0" }, "node_modules/foo": { version: "1.0.1" } }));
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
  /** With `github`, v1's internalParameters.github; with `environment`, v0.2's invocation.environment. */
  const v1 = (resolvedDependencies: unknown, github?: unknown) => ({ attestations: [{ predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1" }, { predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: encode({ predicate: { buildDefinition: { externalParameters: { workflow: { repository: "https://github.com/acme/lib", path: ".github/workflows/release.yml" } }, ...(github === undefined ? {} : { internalParameters: { github } }), resolvedDependencies } } }) } } }] });
  const v02 = (digest: unknown, environment?: unknown) => ({ attestations: [{ predicateType: "https://slsa.dev/provenance/v0.2", bundle: { dsseEnvelope: { payload: encode({ predicate: { invocation: { configSource: { uri: "git+https://github.com/acme/lib@refs/heads/main", digest, entryPoint: ".github/workflows/release.yml" }, ...(environment === undefined ? {} : { environment }) } } }) } } }] });
  const resolved = [{ uri: "git+https://github.com/acme/lib@refs/heads/main", digest: { gitCommit: COMMIT } }];
  it("reads the repository, workflow and source commit from SLSA v1 and v0.2 statements", () => {
    expect(provenanceFrom(v1(resolved))).toEqual({ ...OLD, repository_id: null, event: null });
    expect(provenanceFrom(v02({ sha1: COMMIT }))).toEqual({ ...OLD, repository_id: null, event: null });
  });
  it("reads GitHub's repository id and event from v1's internalParameters and v0.2's environment", () => {
    expect(provenanceFrom(v1(resolved, { event_name: "push", repository_id: "123456789", repository_owner_id: "42" }))).toEqual(PROV);
    expect(provenanceFrom(v02({ sha1: COMMIT }, { GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY_ID: "123456789", GITHUB_REPOSITORY: "acme/lib" }))).toEqual(PROV);
    expect(provenanceFrom(v1(resolved, { event_name: "pull_request_target" }))).toEqual({ ...OLD, repository_id: null, event: "pull_request_target" });
    expect(provenanceFrom(v1(resolved, {}))).toEqual({ ...OLD, repository_id: null, event: null });
  });
  it.each([
    ["an id that is a number, not text", { repository_id: 123456789, event_name: "push" }, "repository id is not in the expected form"],
    ["an id that is not only digits", { repository_id: "12a", event_name: "push" }, "repository id is not in the expected form"],
    ["an empty id", { repository_id: "", event_name: "push" }, "repository id is not in the expected form"],
    ["an event that is not a plain lower-case name", { repository_id: "1", event_name: "Push" }, "event name is not in the expected form"],
    ["an event with other characters", { repository_id: "1", event_name: "push\n" }, "event name is not in the expected form"],
    ["GitHub parameters that are not an object", "push", "not an object"],
    ["GitHub parameters that are a list", ["push"], "not an object"],
  ])("refuses a statement with %s", (_name, github, message) => {
    expect(() => provenanceFrom(v1(resolved, github))).toThrow(message);
  });
  it("reads both values from the one block of the statement's own form, never one from each", () => {
    const both = (predicate: unknown) => ({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: encode({ predicate }) } } }] });
    const github = { repository_id: "123456789" }, environment = { GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY_ID: "555" };
    // A v1 statement takes nothing from a v0.2 environment beside it, and a v0.2 statement nothing from v1's internalParameters.
    expect(provenanceFrom(both({ buildDefinition: { externalParameters: { workflow: { repository: PROV.repository, path: PROV.workflow } }, internalParameters: { github }, resolvedDependencies: resolved }, invocation: { environment } }))).toEqual({ ...PROV, event: null });
    expect(provenanceFrom(both({ buildDefinition: { internalParameters: { github: { repository_id: "1", event_name: "issue_comment" } } }, invocation: { configSource: { uri: "git+https://github.com/acme/lib@refs/heads/main", digest: { sha1: COMMIT }, entryPoint: PROV.workflow }, environment } }))).toEqual({ ...OLD, repository_id: "555", event: "push" });
  });
  it("refuses a v0.2 environment that is malformed", () => {
    expect(() => provenanceFrom(v02({ sha1: COMMIT }, { GITHUB_REPOSITORY_ID: 5 }))).toThrow("repository id is not in the expected form");
    expect(() => provenanceFrom(v02({ sha1: COMMIT }, "x"))).toThrow("not an object");
  });
  it("refuses a statement that does not name the version and its tarball, when asked to check", () => {
    const hex = Buffer.from(INTEGRITY.slice(7), "base64").toString("hex");
    const signed = (subject: unknown) => ({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: encode({ subject, predicate: { buildDefinition: { externalParameters: { workflow: { repository: "https://github.com/acme/lib", path: ".github/workflows/release.yml" } }, resolvedDependencies: [{ digest: { gitCommit: COMMIT } }] } } }) } } }] });
    const want = { name: "@acme/lib", version: "1.0.1", integrity: INTEGRITY };
    expect(provenanceFrom(signed([{ name: "pkg:npm/%40acme/lib@1.0.1", digest: { sha512: hex } }]), want)).toEqual({ ...OLD, repository_id: null, event: null });
    expect(() => provenanceFrom(signed([{ name: "pkg:npm/%40acme/other@1.0.1", digest: { sha512: hex } }]), want)).toThrow("does not name @acme/lib@1.0.1");
    expect(() => provenanceFrom(signed([{ name: "pkg:npm/%40acme/lib@1.0.0", digest: { sha512: hex } }]), want)).toThrow("does not name");
    expect(() => provenanceFrom(signed([{ name: "pkg:npm/%40acme/lib@1.0.1", digest: { sha512: "f".repeat(128) } }]), want)).toThrow("does not name");
    expect(() => provenanceFrom(signed([{ name: "pkg:npm/%40acme/lib@1.0.1", digest: { sha512: hex } }]), { ...want, integrity: null })).toThrow("does not name");
  });
  it("keeps a v0.2 source URI's user part and drops only its ref", () => {
    const uri = (u: string) => ({ attestations: [{ predicateType: "https://slsa.dev/provenance/v0.2", bundle: { dsseEnvelope: { payload: encode({ predicate: { invocation: { configSource: { uri: u, entryPoint: "x.yml" } } } }) } } }] });
    expect(provenanceFrom(uri("git+https://github.com/acme/lib@refs/tags/v1.0.1"))?.repository).toBe("https://github.com/acme/lib");
    expect(provenanceFrom(uri("git+https://bot@github.com/acme/lib"))?.repository).toBe("https://bot@github.com/acme/lib");
    // A monorepo tag with "@" in it: the ref starts at the first "@" after the host.
    expect(provenanceFrom(uri("git+https://github.com/acme/lib@refs/tags/@acme/lib@1.2.3"))?.repository).toBe("https://github.com/acme/lib");
  });
  it("counts trusted publishing's shared user, and any name outside [a-z0-9][a-z0-9._-]*, as no account", () => {
    expect(sharedPublisher({ name: "GitHub Actions", email: "npm-oidc-no-reply@github.com", trustedPublisher: { id: "github", oidcConfigId: "oidc:x" } })).toBe(true);
    expect(sharedPublisher({ name: "gitlab-ci", trustedPublisher: { id: "gitlab" } })).toBe(true);
    expect(sharedPublisher({ name: "ci-bot", email: "npm-oidc-no-reply@gitlab.com" })).toBe(true);
    expect(sharedPublisher({ name: "Release Bot" })).toBe(true);
    // Real lowercase names outside the pattern lose the publisher branch too (fail closed).
    expect(sharedPublisher({ name: "-bot" })).toBe(true);
    expect(sharedPublisher({ name: "_bot" })).toBe(true);
    expect(sharedPublisher({ name: "bob!" })).toBe(true);
    expect(sharedPublisher({ name: "b.o_b-1" })).toBe(false);
    expect(sharedPublisher({ name: "bnjmn", email: "b@example.com" })).toBe(false);
    expect(sharedPublisher(undefined)).toBe(false);
  });
  it("names no commit when the statement has none or it is not a git hash", () => {
    expect(provenanceFrom(v1(undefined))?.commit).toBeNull();
    expect(provenanceFrom(v1([{ digest: { gitCommit: "main" } }]))?.commit).toBeNull();
    expect(provenanceFrom(v02({ sha1: `${COMMIT} ` }))?.commit).toBeNull();
  });
  it("says none when there is no SLSA statement, and refuses malformed records", () => {
    expect(provenanceFrom({ attestations: [{ predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1" }] })).toBeNull();
    expect(() => provenanceFrom({})).toThrow("Invalid");
    expect(() => provenanceFrom({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: {} }] })).toThrow("payload");
  });
});

describe("OSV's batch answers for the judge", () => {
  const answering = (item: unknown): typeof fetch => async () => new Response(JSON.stringify({ results: [item] }));
  const one = [{ name: "lib", version: "1.0.0" }];
  it.each([[null], [7], ["GHSA-x"], [{ vulnerabilities: [] }], [{ vulns: [], x: 1 }], [{ vulns: null }], [{ vulns: {} }], [[]]])("throws on an item that is not an answer (%j), as OsvClient.ids does, rather than reading it as no record", async item => {
    await expect(osvIds(one, answering(item))).rejects.toThrow("Invalid OSV batch item; no clean result is available.");
  });
  it("reads an empty item as no record, and refuses a pagination token", async () => {
    expect(await osvIds(one, answering({}))).toEqual(new Map([["lib@1.0.0", []]]));
    expect(await osvIds(one, answering({ vulns: [{ id: "MAL-2026-0001" }], next_page_token: "" }))).toEqual(new Map([["lib@1.0.0", ["MAL-2026-0001"]]]));
    await expect(osvIds(one, answering({ vulns: [], next_page_token: "abc" }))).rejects.toThrow("OSV paginated a judge query");
    await expect(osvIds(one, answering({ vulns: [], next_page_token: 7 }))).rejects.toThrow("Invalid OSV pagination token.");
    await expect(osvIds(one, answering({ vulns: [null] }))).rejects.toThrow("Invalid OSV advisory id.");
  });
  it("keeps a repeated id once, in OSV's order", async () => {
    expect(await osvIds(one, answering({ vulns: [{ id: "MAL-2026-0001" }, { id: "GHSA-aaaa-bbbb-cccc" }, { id: "MAL-2026-0001" }] }))).toEqual(new Map([["lib@1.0.0", ["MAL-2026-0001", "GHSA-aaaa-bbbb-cccc"]]]));
    // Only the whole id is one id: two ids with the same prefix stay two, or a newly named advisory reads as the old one
    // and gate 1's "introduced" stop is lost (docs/mistakes/2026-10-30-lv4-fixes-not-held-by-tests.md).
    expect(await osvIds(one, answering({ vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }, { id: "GHSA-dddd-eeee-ffff" }, { id: "GHSA-aaaa-bbbb-cccc" }] }))).toEqual(new Map([["lib@1.0.0", ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"]]]));
    expect(await osvIds(one, answering({ vulns: [{ id: "MAL-2026-0001" }, { id: "MAL-2026-0002" }] }))).toEqual(new Map([["lib@1.0.0", ["MAL-2026-0001", "MAL-2026-0002"]]]));
  });
  // The judge's reader and the scan's reader (OsvClient.ids) are two parsers of one answer; they must refuse the same
  // items and read the same ids (docs/mistakes/2026-10-30-osv-batch-item-read-as-no-record.md).
  it.each([[null], [7], ["GHSA-x"], [[]], [{ vulnerabilities: [] }], [{ vulns: [], x: 1 }], [{ vulns: null }], [{ vulns: {} }], [{ vulns: [null] }], [{ vulns: [{ id: "../x" }] }], [{ vulns: [], next_page_token: 7 }], [{}], [{ vulns: [{ id: "MAL-2026-0001" }, { id: "GHSA-aaaa-bbbb-cccc" }] }], [{ vulns: [{ id: "MAL-2026-0001" }, { id: "MAL-2026-0001" }] }], [{ vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }, { id: "MAL-2026-0001" }, { id: "GHSA-aaaa-bbbb-cccc" }] }], [{ vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }, { id: "GHSA-dddd-eeee-ffff" }, { id: "GHSA-aaaa-bbbb-cccc" }] }], [{ vulns: [{ id: "MAL-2026-0001" }, { id: "MAL-2026-0002" }] }]])("agrees with OsvClient.ids on %j", async item => {
    const scan = await new OsvClient(answering(item)).ids([{ ecosystem: "npm", name: "lib", version: "1.0.0" }]).then(m => [...m.values()], () => "throws");
    const judge = await osvIds(one, answering(item)).then(m => [...m.values()], () => "throws");
    expect(judge).toEqual(scan);
  });
});

describe("pnpm-lock.yaml changes", () => {
  it("reads the versions a pnpm lockfile adds and applies the time cap, but is never ready", () => {
    const before = ["lockfileVersion: '9.0'", "packages:", "  lib@1.0.0:", "    resolution: {integrity: x}", "  dep-a@1.0.0:", "    resolution: {integrity: x}"].join("\n");
    const after = ["lockfileVersion: '9.0'", "packages:", "  lib@1.0.1:", "    resolution: {integrity: x}", "  dep-a@1.0.0:", "    resolution: {integrity: x}", "  dep-a@1.1.0:", "    resolution: {integrity: x}"].join("\n");
    const { changes, locked } = pnpmChanges(before, after);
    expect(changes.map(c => [c.name, c.from, c.to])).toEqual([["dep-a", "1.0.0", "1.1.0"], ["lib", "1.0.0", "1.0.1"]]);
    const facts = new Map([["lib@1.0.0", fact()], ["lib@1.0.1", fact()], ["dep-a@1.0.0", depFact()], ["dep-a@1.1.0", depFact({ published_at: "2026-10-02T00:00:00Z" })]]);
    const result = judge({ changes, facts, fixes: [fixHigh], files: ["pnpm-lock.yaml"], now: new Date("2027-01-01T00:00:00Z"), locked, lockfile: "pnpm-lock" });
    expect(result.verdict).toBe("undecidable");
    expect(result.time_cap.after_t).toEqual(["dep-a@1.1.0"]);
    expect(result.findings).toContainEqual(expect.objectContaining({ effect: "stop", message: expect.stringContaining("dep-a@1.1.0 was published at or after the fix") }));
    expect(result.findings).toContainEqual(expect.objectContaining({ gate: 4, message: expect.stringContaining("not checked for pnpm") }));
  });
});

describe("a package's first publish", () => {
  it("is the earliest of created and every version, so a re-created package keeps its age", () => {
    expect(firstPublish({ created: "2025-09-01T00:00:00Z", modified: "2026-01-01T00:00:00Z", "1.0.0": "2019-03-01T00:00:00Z", "2.0.0": "2025-09-01T00:00:00Z" })).toBe("2019-03-01T00:00:00.000Z");
    expect(firstPublish({ modified: "2026-01-01T00:00:00Z" })).toBeNull();
  });
});

// Moved from production.test.ts when the split was removed (docs/decisions/2026-10-29-every-change-counts-as-production.md):
// these test the lockfile reader and gate 4 in judge.ts, which stay.
describe("the lockfile reader's extraneous folders", () => {
  const folder = { name: "@netlify/ai-gateway", version: "1.0.0", extraneous: true, dependencies: { "@netlify/api": "^14" } };
  const lockWith = (extra: Record<string, unknown>) => JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app", dependencies: { a: "^1" } }, "node_modules/a": { version: "1.0.0", resolved: url("a", "1.0.0"), integrity: INTEGRITY }, ...extra } });
  it("skips an installed package's own workspace folder that npm records as extraneous", () => {
    const lock = lockWith({ "node_modules/primitives/packages/ai-gateway": folder });
    expect(lockEntries(lock).map(e => e.path)).toEqual(["node_modules/a"]);
    expect(lockExtraneous(lock)).toEqual([`node_modules/primitives/packages/ai-gateway ${JSON.stringify(folder)}`]);
  });
  it("still refuses such a path when it is not extraneous, or carries a tarball, a hash, a link or a dot segment", () => {
    for (const [path, item] of [
      ["node_modules/primitives/packages/ai-gateway", { ...folder, extraneous: false }],
      ["node_modules/primitives/packages/ai-gateway", { ...folder, resolved: "https://evil.example/x.tgz" }],
      ["node_modules/primitives/packages/ai-gateway", { ...folder, integrity: INTEGRITY }],
      ["node_modules/primitives/packages/ai-gateway", { ...folder, link: true }],
      ["node_modules/primitives/../ai-gateway", folder],
    ] as const) expect(() => lockEntries(lockWith({ [path]: item }))).toThrow("Unexpected package-lock path");
  });
  it("stops the judge when such a folder is added, removed or changed", () => {
    const j = judge({
      changes: [{ path: "node_modules/a", name: "a", from: "1.0.0", to: "1.0.1", dev: false, resolved: url("a", "1.0.1"), integrity: INTEGRITY, replaced: null }],
      facts: new Map([["a@1.0.0", fact()], ["a@1.0.1", fact()]]), fixes: [], files: ["package-lock.json"], now: new Date("2026-10-28T00:00:00Z"), direct: ["a"],
      extraneous: [`node_modules/primitives/packages/ai-gateway ${JSON.stringify(folder)}`],
    });
    expect(j.verdict).toBe("stop");
    expect(j.findings.some(f => f.gate === 4 && f.effect === "stop" && f.message.includes("extraneous"))).toBe(true);
    expect(renderJudgement(j)).toContain("extraneous");
  });
});

describe("package-lock.json as every npm reads it (review of aa5d75b, B1)", () => {
  // Written by npm 11.19.1 (`npm install --package-lock-only --lockfile-version 2`, in Docker): nested copies, an alias,
  // a dev and an optional dependency; and a workspace with its own nested copy and a local folder.
  const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
  const nested = fixture("lock-v2-npm11-nested.json"), workspace = fixture("lock-v2-npm11-workspace.json");
  const edit = (text: string, change: (lock: any) => void) => { const lock = JSON.parse(text); change(lock); return JSON.stringify(lock); };
  const LEFT_PAD = { resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", integrity: "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==" };

  it("reads what npm writes: both views of a v2 lock agree", () => {
    expect(lockEntries(nested).map(e => e.path)).toContain("node_modules/mkdirp/node_modules/minimist");
    expect(lockEntries(nested).find(e => e.path === "node_modules/lodash-alias")).toMatchObject({ name: "lodash", version: "4.17.21" });
    expect(lockEntries(workspace).map(e => e.path)).toContain("packages/a/node_modules/is-number");
    expect(lockLinks(workspace)).toEqual(["node_modules/a -> packages/a", "node_modules/local -> local"]);
    // Also written by npm 11.19.1: many dev and optional entries with their requires (react, react-dom, chokidar 2), and
    // a workspace and a local folder with devDependencies and optionalDependencies, which a link's requires includes.
    expect(lockEntries(fixture("lock-v2-npm11-flags.json")).length).toBeGreaterThan(100);
    expect(lockEntries(fixture("lock-v2-npm11-workspace-dev.json")).map(e => e.path)).toContain("node_modules/is-odd/node_modules/is-number");
  });

  it("the closed list of the npm 6 tree's keys: each one that differs from packages is refused, and so is any other key", () => {
    // version, resolved, integrity, dev, optional, bundled, requires and dependencies; anything else (devOptional and
    // peer included, which npm 11 did not write here) is refused.
    for (const [key, change] of [
      ["version", (l: any) => { l.dependencies.nan.version = "2.29.0"; }],
      ["resolved", (l: any) => { l.dependencies.nan.resolved = "https://registry.npmjs.org/nan/-/nan-2.29.0.tgz"; }],
      ["integrity", (l: any) => { l.dependencies.nan.integrity = LEFT_PAD.integrity; }],
      ["dev", (l: any) => { l.dependencies.minimist.dev = true; }],
      ["optional", (l: any) => { delete l.dependencies.nan.optional; }],
      ["bundled", (l: any) => { l.dependencies.nan.bundled = true; }],
      ["requires", (l: any) => { l.dependencies.fsevents.requires = { bindings: "^1.5.0" }; }],
      ["dependencies", (l: any) => { l.dependencies.mkdirp.dependencies = {}; }],
    ] as const) expect(() => lockEntries(edit(nested, change)), key).toThrow(/disagree at node_modules\/(nan|minimist|fsevents|mkdirp)/);
    for (const key of ["devOptional", "peer", "extraneous", "from", "name"]) {
      expect(() => lockEntries(edit(nested, l => { l.dependencies.minimist[key] = true; })), key).toThrow(`gives node_modules/minimist a key npm does not write: ${key}`);
    }
  });

  it("every requirement is found by Node's lookup, in its range, in both views (review of ebfe89d, B1)", () => {
    // The left-pad form: a requirement the tree names that neither view has, by URL or by range.
    for (const spec of ["https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", "1.3.0"]) {
      expect(() => lockEntries(edit(nested, l => { l.dependencies.minimist.requires = { "not-in-lock": spec }; l.packages["node_modules/minimist"].dependencies = { "not-in-lock": spec }; }))).toThrow(`npm 6 dependencies tree: node_modules/minimist requires not-in-lock ${spec}, and npm finds no copy of it in the lock`);
    }
    // A requirement outside its range: mkdirp 0.5.1 requires minimist 0.0.8; its nested copy moved to 0.0.10, in both views.
    expect(() => lockEntries(edit(nested, l => { l.packages["node_modules/mkdirp/node_modules/minimist"].version = "0.0.10"; l.dependencies.mkdirp.dependencies.minimist.version = "0.0.10"; }))).toThrow("npm 6 dependencies tree: node_modules/mkdirp requires minimist 0.0.8, and node_modules/mkdirp/node_modules/minimist has minimist@0.0.10, which is not that");
    // A missing requirement in a v3 lock (no tree): the same reading on packages.
    const v3 = (change: (l: any) => void) => edit(nested, l => { l.lockfileVersion = 3; delete l.dependencies; change(l); });
    expect(() => lockEntries(v3(l => { delete l.packages["node_modules/nan"]; }))).toThrow("packages: node_modules/fsevents requires nan ^2.12.1, and npm finds no copy of it in the lock");
    expect(() => lockEntries(v3(l => { l.packages["node_modules/nan"].version = "1.0.0"; }))).toThrow("node_modules/fsevents requires nan ^2.12.1, and node_modules/nan has nan@1.0.0, which is not that");
    // An alias requirement must find the package it names, and the project's own requirements count too.
    expect(() => lockEntries(v3(l => { l.packages["node_modules/lodash-alias"].name = "left-pad"; }))).toThrow("the project requires lodash-alias npm:lodash@4.17.21, and node_modules/lodash-alias has left-pad@4.17.21, which is not that");
    expect(() => lockEntries(v3(l => { l.packages[""].dependencies.minimist = "^2.0.0"; }))).toThrow("the project requires minimist ^2.0.0");
    // A spec npm resolves some other way than a semver range cannot be shown to be met.
    expect(() => lockEntries(v3(l => { l.packages["node_modules/mkdirp"].dependencies.minimist = "latest"; }))).toThrow("node_modules/mkdirp requires minimist latest");
    // A required peer counts; one marked optional does not.
    expect(() => lockEntries(v3(l => { l.packages["node_modules/mkdirp"].peerDependencies = { react: "^18.0.0" }; }))).toThrow("node_modules/mkdirp requires react ^18.0.0, and npm finds no copy of it in the lock");
    expect(lockEntries(v3(l => { l.packages["node_modules/mkdirp"].peerDependencies = { react: "^18.0.0" }; l.packages["node_modules/mkdirp"].peerDependenciesMeta = { react: { optional: true } }; })).length).toBeGreaterThan(0);
  });

  it("refuses a v2 lock whose npm 6 tree requires, or flags, something else (review of 1e6f705, B1)", () => {
    const wsdev = fixture("lock-v2-npm11-workspace-dev.json"), URL_SPEC = "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz";
    for (const [lock, why] of [
      // The review's attack: npm 6 installs what requires names when the tree lacks it, from any spec.
      [edit(nested, l => { l.dependencies.minimist.requires = { "left-pad": URL_SPEC }; }), "disagree at node_modules/minimist"],
      [edit(nested, l => { l.dependencies.minimist.requires = { "left-pad": "1.3.0" }; }), "disagree at node_modules/minimist"],
      [edit(nested, l => { l.dependencies.mkdirp.requires.minimist = URL_SPEC; }), "disagree at node_modules/mkdirp"],
      [edit(nested, l => { delete l.dependencies.mkdirp.requires; }), "disagree at node_modules/mkdirp"],
      // A link's requires (the folder's own requirements, devDependencies included).
      [edit(wsdev, l => { l.dependencies.a.requires["left-pad"] = "1.3.0"; }), "disagree at node_modules/a"],
      [edit(wsdev, l => { delete l.dependencies.local.requires["left-pad"]; }), "disagree at node_modules/local"],
      // The flags, which decide what npm 6 --production leaves out.
      [edit(nested, l => { l.dependencies.minimist.dev = true; }), "disagree at node_modules/minimist"],
      [edit(nested, l => { delete l.dependencies["left-pad"].dev; }), "disagree at node_modules/left-pad"],
      [edit(nested, l => { l.dependencies.nan.bundled = true; }), "disagree at node_modules/nan"],
      // Keys and values npm does not write.
      [edit(nested, l => { l.dependencies.minimist.from = "evil"; }), "gives node_modules/minimist a key npm does not write: from"],
      [edit(nested, l => { l.dependencies["left-pad"].dev = "yes"; }), "gives node_modules/left-pad a flag that is not true: dev"],
      [edit(nested, l => { l.dependencies.mkdirp.requires = { minimist: 1 }; }), "gives node_modules/mkdirp requires that are not a list of specs"],
    ] as const) expect(() => lockEntries(lock), why).toThrow(why);
    // The packages side says the same: a requirement only packages has disagrees too.
    expect(() => lockEntries(edit(nested, l => { l.packages["node_modules/minimist"].dependencies = { "left-pad": "1.3.0" }; }))).toThrow("disagree at node_modules/minimist");
  });

  it("refuses a v2 lock whose npm 6 tree installs something else", () => {
    for (const [lock, at] of [
      // Another tarball under a fixed version's name (the review's attack: npm 6 installs left-pad as minimist).
      [edit(nested, l => Object.assign(l.dependencies.minimist, LEFT_PAD)), "disagree at node_modules/minimist"],
      // A package only the tree has, at the top and nested.
      [edit(nested, l => { l.dependencies.evil = { version: "9.9.9", ...LEFT_PAD }; }), "disagree at node_modules/evil: only the dependencies tree has it"],
      [edit(nested, l => { l.dependencies.mkdirp.dependencies.evil = { version: "1.3.0", ...LEFT_PAD }; }), "disagree at node_modules/mkdirp/node_modules/evil"],
      // A copy the tree leaves out, and one it moves to another place.
      [edit(nested, l => { delete l.dependencies.mkdirp.dependencies; }), "disagree at node_modules/mkdirp/node_modules/minimist: only packages has it"],
      [edit(nested, l => { l.dependencies.minimist2 = l.dependencies.mkdirp.dependencies.minimist; delete l.dependencies.mkdirp.dependencies; }), "disagree at node_modules/m"],
      // An alias pointing at another package, a version, and an integrity.
      [edit(nested, l => { l.dependencies["lodash-alias"].version = "npm:left-pad@4.17.21"; }), "disagree at node_modules/lodash-alias"],
      [edit(nested, l => { l.dependencies.nan.version = "2.29.0"; }), "disagree at node_modules/nan"],
      [edit(nested, l => { l.dependencies.nan.integrity = LEFT_PAD.integrity; }), "disagree at node_modules/nan"],
      // A workspace's nested copy, and a link's target.
      [edit(workspace, l => Object.assign(l.dependencies.a.dependencies["is-number"], LEFT_PAD)), "disagree at packages/a/node_modules/is-number"],
      [edit(workspace, l => { l.dependencies.local.version = "file:elsewhere"; }), "disagree at node_modules/local"],
      // A v2 lock with no tree, which npm 6 does not install from.
      [edit(nested, l => { delete l.dependencies; }), "only packages has it"],
      // A key that is not a name.
      [edit(nested, l => { l.dependencies[".."] = { version: "1.0.0" }; }), "disagree at node_modules/.."],
    ] as const) expect(() => lockEntries(lock), at).toThrow(at);
  });

  it("refuses another lockfileVersion and a top-level key npm does not write", () => {
    for (const version of [1, 4, "2", null]) expect(() => lockEntries(edit(nested, l => { l.lockfileVersion = version; }))).toThrow("package-lock v2/v3 only");
    expect(() => lockEntries(edit(nested, l => { l.overrides = {}; }))).toThrow("a top-level key npm does not write: overrides");
    expect(() => lockEntries("[]")).toThrow("not an object");
    // A v3 lock carries no tree; one that does is held to it as well.
    const v3 = edit(nested, l => { l.lockfileVersion = 3; delete l.dependencies; });
    expect(lockEntries(v3)).toHaveLength(lockEntries(nested).length);
    expect(() => lockEntries(edit(nested, l => { l.lockfileVersion = 3; l.dependencies.nan.version = "2.29.0"; }))).toThrow("disagree at node_modules/nan");
  });
});
