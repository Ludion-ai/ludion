import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import semver from "semver";
import { acquisitionPolicy, candidateTimeCap, changedPackages, compatible, fixesOf, NPM_FINAL_MANIFEST, patchDependencies, resolverDockerfile, unplannedRemovals, type FixReceipt } from "../src/security/dependency-patch.ts";
import { acquisitionPom, localComposerLock, MAVEN_SETTINGS, publicArchiveUrl } from "../src/security/acquisition.ts";
import { changedManifest, inventory, mavenGraph, parsePom, raisedRequirement, type Inventory } from "../src/security/inventory.ts";
import { EPSS_LIST } from "../src/security/npm-facts.ts";
import { OsvClient, type Advisory } from "../src/security/osv.ts";
import { privateState, snapshot } from "../src/security/project.ts";
import { comparePublishers, nextFix, NEXT_FIX_LIMIT, type VersionChoice } from "../src/security/next-fix.ts";
import { scanProject } from "../src/security/scan.ts";
import { packagistReleases, renderTimeCap } from "../src/security/time-cap.ts";
import { commit, git } from "./git.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;
/** The fixture registry's sha512 for a version's tarball (fixtures only, not a real hash). */
const integrityOf = (name: string, version: string) => `sha512-${Buffer.from(`${name}@${version}`.padEnd(64, "#")).toString("base64")}`;
const lockFor = (deps: Record<string, string>) => ({ lockfileVersion: 3, packages: { "": { dependencies: deps }, ...Object.fromEntries(Object.entries(deps).map(([name, version]) => [`node_modules/${name}`, { version, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`, integrity: integrityOf(name, version) }])) } as Record<string, any> });
const lock = (version = "4.17.20") => lockFor({ lodash: version });
const advisory: Advisory = { id: "GHSA-test-0001", summary: "Example advisory", aliases: ["CVE-2026-0001"], affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ events: [{ fixed: "4.17.21" }] }] }] };
const minimistAdvisory: Advisory = { ...advisory, id: "GHSA-test-0002", aliases: ["CVE-2026-0002"], affected: [{ package: { ecosystem: "npm", name: "minimist" }, ranges: [{ events: [{ fixed: "1.2.6" }] }] }] };
const MINIMIST_RELEASES = { created: "2013-06-25T08:12:47.000Z", versions: { "1.2.5": "2020-03-12T00:00:00.000Z", "1.2.6": "2022-03-21T00:00:00.000Z" } };
/** The versions the fake OSV (the judge's included) has an advisory for. */
const VULNERABLE: Record<string, Advisory> = { "lodash@4.17.20": advisory, "minimist@1.2.5": minimistAdvisory };
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-dependency-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: { lodash: "4.17.20" } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock()));
  writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ schema: 1, ecosystem: "npm", test: ["node", "test.cjs"], timeout_seconds: 30 }));
  return root;
}
const response = (value: unknown) => new Response(JSON.stringify(value));
function client(candidateVulnerable = false): OsvClient {
  return new OsvClient(async (url, init) => {
    if (String(url).includes("/vulns/")) return response(advisory);
    const queries = JSON.parse(String(init?.body)).queries;
    return response({ results: queries.map((q: any) => q.version === "4.17.20" || candidateVulnerable ? { vulns: [{ id: advisory.id }] } : {}) });
  });
}
/**
 * registry.npmjs.org for the time cap and the judge: lodash 4.17.21 (the fix) and any extra versions given, each with
 * its fixture integrity and `manifest`'s fields. For the judge also OSV (lodash@4.17.20 has the advisory), an empty KEV
 * catalog and FIRST's whole EPSS list, which does not have the advisory's CVE. `seen` collects every URL and body. The
 * judge's OSV answers come from `found`, by name@version.
 */
const EPSS_DAY = "https://epss.empiricalsecurity.com/epss_scores-2026-10-29.csv.gz";
function registry(extra: Record<string, { created: string; versions: Record<string, string> }> = {}, manifest: (name: string, version: string) => object = () => ({}), seen: string[] = [], found: Record<string, Advisory> = VULNERABLE): typeof fetch {
  const docs: Record<string, { created: string; versions: Record<string, string> }> = { lodash: { created: "2012-04-23T16:37:11.912Z", versions: { "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": "2021-02-20T15:42:16.891Z" } }, ...extra };
  return async (url, init) => {
    const u = String(url);
    seen.push(u, init?.body === undefined ? "" : String(init.body));
    if (u === "https://api.osv.dev/v1/querybatch") return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => found[`${q.package.name}@${q.version}`] ? { vulns: [{ id: found[`${q.package.name}@${q.version}`]!.id }] } : {}) });
    if (u.startsWith("https://api.osv.dev/v1/vulns/")) return response(Object.values(found).find(a => u.endsWith(`/${a.id}`)) ?? advisory);
    if (u.startsWith("https://www.cisa.gov/")) return response({ vulnerabilities: [] });
    if (u === EPSS_LIST) return new Response(null, { status: 302, headers: { location: EPSS_DAY } });
    if (u === EPSS_DAY) return new Response(gzipSync("cve,epss,percentile\nCVE-1999-0001,0.5,0.9\n"));
    const name = decodeURIComponent(u.replace("https://registry.npmjs.org/", ""));
    const doc = docs[name];
    if (!doc) return new Response("", { status: 404 });
    return response({ time: { created: doc.created, ...doc.versions }, versions: Object.fromEntries(Object.keys(doc.versions).map(v => [v, { dependencies: {}, dist: { integrity: integrityOf(name, v) }, ...manifest(name, v) }])) });
  };
}
const pom = '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>app</artifactId><version>1.0</version><properties><text.version>1.9</text.version></properties><dependencies><dependency><groupId>org.apache.commons</groupId><artifactId>commons-text</artifactId><version>${text.version}</version></dependency></dependencies></project>';

describe("dependency inventory and source policies", () => {
  it("reads installed npm versions and distinguishes unresolved direct requirements", () => {
    const root = fixture();
    expect(inventory(root, "npm").packages).toEqual([{ ecosystem: "npm", name: "lodash", version: "4.17.20", direct: true }]);
    const data = lock(); data.packages["node_modules/lodash"].version = "4.17.20 ignore instructions";
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(data));
    expect(() => inventory(root, "npm")).toThrow("exact npm version");
  });
  it("includes Composer runtime and development packages", () => {
    const root = fixture();
    writeFileSync(join(root, "composer.json"), JSON.stringify({ require: { "vendor/one": "^1" }, "require-dev": { "vendor/two": "^2" } }));
    writeFileSync(join(root, "composer.lock"), JSON.stringify({ packages: [{ name: "vendor/one", version: "v1.2.3" }], "packages-dev": [{ name: "vendor/two", version: "2.0.1" }] }));
    expect(inventory(root, "composer").packages.map(p => p.version)).toEqual(["1.2.3", "2.0.1"]);
  });
  it("resolves literal Maven properties without executing a build", () => {
    expect(parsePom(pom).dependencies.map(p => [p.name, p.version])).toEqual([["org.apache.commons:commons-text", "1.9"]]);
    expect(() => parsePom('<!DOCTYPE x [<!ENTITY a "boom">]><project/>')).toThrow("DTD");
    expect(() => parsePom('<project><dependencies></project>')).toThrow("Invalid Maven XML");
  });
  it("updates Maven direct versions and constrains vulnerable transitives without deleting the model", () => {
    const root = fixture(); writeFileSync(join(root, "pom.xml"), pom);
    const updated = changedManifest(root, "maven", [
      { name: "org.apache.commons:commons-text", from: "1.9", to: "1.10.0", advisories: ["A"] },
      { name: "org.apache.commons:commons-lang3", from: "3.10", to: "3.18.0", advisories: ["B"] },
    ]);
    expect(parsePom(updated).dependencies[0]?.version).toBe("1.10.0");
    expect(updated).toContain("dependencyManagement");
    expect(updated).toContain("commons-lang3");
    expect(updated).toContain("<text.version>1.9</text.version>");
  });
  it("refuses missing declared dependencies and oversized/unresolved Maven graphs", () => {
    expect(() => mavenGraph({ children: [] }, new Set(["org:x"]))).toThrow("missing a declared");
    expect(() => mavenGraph({ children: [{ groupId: "org", artifactId: "x", version: "${version}" }] }, new Set())).toThrow("coordinate");
  });
  it.each([
    { dependencies: { lodash: "https://internal.example/package.tgz" } },
    { dependencies: { lodash: "4.17.20" }, overrides: { lodash: "file:../private" } },
    { dependencies: { lodash: "4.17.20" }, workspaces: ["packages/*"] },
  ])("rejects acquisition that needs an unconfigured trust policy", manifest => {
    const root = fixture(); writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    expect(() => acquisitionPolicy(root, "npm")).toThrow();
  });
  it("refuses Maven extensions and custom repositories before acquisition", () => {
    const root = fixture();
    for (const addition of ["<build><extensions/></build>", "<repositories/>", "<parent/>"]) {
      writeFileSync(join(root, "pom.xml"), pom.replace("</project>", `${addition}</project>`));
      expect(() => acquisitionPolicy(root, "maven")).toThrow();
    }
  });
});

describe("OSV decisions are complete or fail closed", () => {
  it("plans a same-major fix and retains exact advisory ids", async () => {
    const report = await client().scan(inventory(fixture(), "npm"));
    expect(report.status).toBe("vulnerabilities_found");
    expect(report.plan).toEqual([{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: [advisory.id] }]);
  });
  it("handles two-component Maven releases without inventing artifact versions", async () => {
    const installed: Inventory = { ecosystem: "maven", files: ["pom.xml"], scope: "resolved", limitations: [], packages: [{ ecosystem: "maven", name: "org:lib", version: "1.9", direct: true }] };
    const c = new OsvClient(async url => String(url).includes("/vulns/") ? response({ ...advisory, affected: [{ package: { ecosystem: "Maven", name: "org:lib" }, ranges: [{ events: [{ fixed: "1.10" }] }] }] }) : response({ results: [{ vulns: [{ id: advisory.id }] }] }));
    expect((await c.scan(installed)).plan[0]?.to).toBe("1.10");
  });
  it.each(["5.0.0", "4.17.21-rc.1"])("does not automatically select a major/prerelease fix: %s", async fixed => {
    const c = new OsvClient(async url => String(url).includes("/vulns/") ? response({ ...advisory, affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ events: [{ fixed }] }] }] }) : response({ results: [{ vulns: [{ id: advisory.id }] }] }));
    const result = await c.scan(inventory(fixture(), "npm"));
    expect(result.plan).toEqual([]); expect(result.blocked).toHaveLength(1);
  });
  it("reads all pages, associates results by request order and caches advisory details", async () => {
    let batch = 0, detail = 0;
    const c = new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) { detail++; return response(advisory); }
      batch++;
      const query = JSON.parse(String(init?.body)).queries[0];
      return response({ results: [query.page_token ? { vulns: [{ id: advisory.id }] } : { next_page_token: "next" }] });
    });
    const input = inventory(fixture(), "npm");
    expect((await c.scan(input)).findings).toHaveLength(1);
    await c.scan(input);
    expect(batch).toBe(4); expect(detail).toBe(1);
  });
  it.each([{ results: [] }, { results: [[]] }, { results: [{ error: "quota failure" }] }, { results: [{ vulns: [{ id: "../../private" }] }] }])("does not interpret malformed/partial metadata as clean: %j", async body => {
    await expect(new OsvClient(async () => response(body)).scan(inventory(fixture(), "npm"))).rejects.toThrow();
  });
  it("reports outages and repeated pagination rather than a clean result", async () => {
    await expect(new OsvClient(async () => new Response("", { status: 503 })).scan(inventory(fixture(), "npm"))).rejects.toThrow("HTTP 503");
    await expect(new OsvClient(async () => response({ results: [{ next_page_token: "same" }] })).scan(inventory(fixture(), "npm"))).rejects.toThrow("repeated");
  });
});

function fakeCommand() {
  return async (args: string[]) => {
    if (args.includes("{{.Id}}")) return DIGEST;
    if (args.includes("{{json .RepoDigests}}")) return JSON.stringify([`node@${DIGEST}`]);
    const out = args.find(a => a.startsWith("type=local,dest="));
    if (out) {
      const dest = out.slice("type=local,dest=".length), context = args.at(-1)!;
      const manifest = JSON.parse(readFileSync(join(context, "manifests/package.json"), "utf8"));
      // Baseline must be byte-identical. The candidate is what npm leaves: the final manifest, copied over the pinned
      // one, and a lockfile at the pinned (exact, fixed) version.
      if (dest.endsWith("baseline-export")) {
        writeFileSync(join(dest, "package.json"), JSON.stringify(manifest));
        writeFileSync(join(dest, "package-lock.json"), readFileSync(join(context, "manifests/package-lock.json")));
      } else {
        writeFileSync(join(dest, "package.json"), readFileSync(join(context, "manifests/ludion-final-package.json")));
        writeFileSync(join(dest, "package-lock.json"), JSON.stringify(lockFor(Object.fromEntries(Object.entries<string>(manifest.dependencies).map(([name, spec]) => [name, semver.minVersion(spec)!.version])))));
      }
    }
    return "";
  };
}

/** A lockfile entry from the registry, with its fixture integrity. */
const entry = (name: string, version: string) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: integrityOf(name, version) });
/**
 * A project with two transitive copies of lodash, both affected by one advisory: 4.17.20 at the top (fixed in 4.17.21)
 * and 3.10.0 under `other` (fixed in 3.10.2), so its one fix has two changes (each a scoped override; npm refuses two
 * changes of a direct dependency). `manifest` gives registry fields per version.
 */
function twoCopies(manifest: (name: string, version: string) => object = () => ({})) {
  const root = fixture(), deps = { first: "1.0.0", other: "1.0.0" };
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: deps }));
  const locked = lockFor(deps);
  locked.packages["node_modules/lodash"] = entry("lodash", "4.17.20");
  locked.packages["node_modules/other/node_modules/lodash"] = entry("lodash", "3.10.0");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(locked));
  commit(root);
  const both: Advisory = { ...advisory, id: "GHSA-test-0011", affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ events: [{ introduced: "0" } as { fixed?: string }, { fixed: "3.10.2" }] }, { events: [{ introduced: "4.0.0" } as { fixed?: string }, { fixed: "4.17.21" }] }] }] };
  const osv = new OsvClient(async (url, init) => {
    if (String(url).includes("/vulns/")) return response(both);
    return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => q.package.name === "lodash" && ["4.17.20", "3.10.0"].includes(q.version) ? { vulns: [{ id: both.id }] } : {}) });
  });
  const lodash = { created: "2012-04-23T16:37:11.912Z", versions: { "3.10.0": "2015-06-30T00:00:00.000Z", "3.10.2": "2015-07-10T00:00:00.000Z", "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": "2021-02-20T15:42:16.891Z", "4.17.22": "2021-03-01T00:00:00.000Z" } };
  const one = { created: "2015-01-01T00:00:00.000Z", versions: { "1.0.0": "2015-01-01T00:00:00.000Z" } };
  const npm = registry({ lodash, first: one, other: one }, manifest, [], { "lodash@4.17.20": both, "lodash@3.10.0": both });
  return { root, osv, npm };
}

describe("dependency patch gates and recoverable application", () => {
  it("refuses a lookalike official registry in tool-image evidence", async () => {
    const root = fixture(); commit(root); const before = snapshot(root), command = fakeCommand();
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: async args => args.includes("{{json .RepoDigests}}") ? JSON.stringify([`dockerXio/library/node@${DIGEST}`]) : command(args), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("digest is unavailable");
    expect(snapshot(root)).toBe(before);
  });
  it.each([false, true])("commits both dependency files on the fix's own branch only under explicit policy (apply=%s)", async apply => {
    const root = fixture(), head = commit(root), before = snapshot(root);
    const tools: string[] = [];
    const result = await patchDependencies(root, apply, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async (_name, _image, _command, _timeout, tool) => { tools.push(tool); } });
    expect(result.receipt?.outcome).toBe(apply ? "applied" : "validated");
    // Baseline and candidate tests both run with the npm tool's fixed scratch directories.
    expect(tools).toEqual(["npm", "npm"]);
    const fix = result.receipt!.fixes[0]!;
    expect(fix).toMatchObject({ package: "lodash", outcome: apply ? "applied" : "validated", candidate_passed: true, fix_published_at: "2021-02-20T15:42:16.891Z", found_at: result.scan.checked_at });
    expect(fix.after?.findings).toEqual([]);
    expect(fix.files).toHaveLength(2);
    // The judge's parts of gates 1, 2 and 4 and its wait found nothing to stop or wait for.
    expect(fix.judgement).toMatchObject({ verdict: "ready_except_build", urgency: "normal", fixes: [expect.objectContaining({ id: advisory.id, package: "lodash", from: "4.17.20", to: "4.17.21" })] });
    // The judge's exposure times: here the fix's own publish time, seen after this run's lookup and before the branch.
    expect(fix.judgement?.exposure.fix_published_at).toBe(fix.fix_published_at);
    expect(Date.parse(fix.judgement!.exposure.detected_at)).toBeGreaterThanOrEqual(Date.parse(fix.found_at));
    if (apply) expect(Date.parse(fix.applied_at!)).toBeGreaterThanOrEqual(Date.parse(fix.judgement!.exposure.detected_at));
    // The working tree is never changed; with --apply the fix is one commit on HEAD, on its own branch.
    expect(snapshot(root)).toBe(before);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    if (apply) {
      expect(fix).toMatchObject({ branch: "ludion/npm/lodash-4.17.21", commit: git(root, "rev-parse", "ludion/npm/lodash-4.17.21") });
      expect(Date.parse(fix.applied_at!)).toBeGreaterThanOrEqual(Date.parse(fix.found_at));
      expect(result.receipt?.base_commit).toBe(head);
      expect(git(root, "rev-parse", `${fix.commit}^`)).toBe(head);
      expect(git(root, "diff", "--name-only", head, fix.commit!).split("\n")).toEqual(["package-lock.json", "package.json"]);
      expect(JSON.parse(git(root, "show", `${fix.commit}:package.json`)).dependencies.lodash).toBe("4.17.21");
      expect(git(root, "log", "-1", "--format=%s", fix.commit!)).toBe("ludion: lodash 4.17.20 -> 4.17.21 (npm)");
    } else expect(fix).toMatchObject({ branch: null, commit: null, applied_at: null });
    expect(existsSync(join(root, ".ludion/security/patch.lock"))).toBe(false);
  });
  it("validates each fix alone against one baseline, and one failing fix stops no other", async () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: { lodash: "4.17.20", minimist: "1.2.5" } }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lockFor({ lodash: "4.17.20", minimist: "1.2.5" })));
    const head = commit(root), before = snapshot(root);
    const minimist: Advisory = { ...advisory, id: "GHSA-test-0002", affected: [{ package: { ecosystem: "npm", name: "minimist" }, ranges: [{ events: [{ fixed: "1.2.6" }] }] }] };
    const osv = new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response(String(url).includes("0002") ? minimist : advisory);
      const queries = JSON.parse(String(init?.body)).queries;
      return response({ results: queries.map((q: any) => q.version === "4.17.20" ? { vulns: [{ id: advisory.id }] } : q.version === "1.2.5" ? { vulns: [{ id: minimist.id }] } : {}) });
    });
    const tested: string[] = [], manifests: unknown[] = [], command = fakeCommand();
    const result = await patchDependencies(root, true, {
      fetchFn: registry({ minimist: { created: "2013-06-25T08:12:47.000Z", versions: { "1.2.5": "2020-03-12T00:00:00.000Z", "1.2.6": "2022-03-21T00:00:00.000Z" } } }), client: osv,
      command: async args => { if (args.includes("resolve")) manifests.push(JSON.parse(readFileSync(join(args.at(-1)!, "manifests/package.json"), "utf8")).dependencies); return command(args); },
      // The lodash candidate's test fails.
      testRun: async name => { tested.push(name.replace(/^ludion-check-[^-]+-[^-]+-[^-]+-[^-]+-[^-]+-/, "")); if (name.endsWith("candidate-1")) throw new Error("lodash candidate test failure"); },
    });
    // One baseline, and each candidate moves only its own package.
    expect(tested).toEqual(["baseline", "candidate-1", "candidate-2"]);
    expect(manifests).toEqual([{ lodash: "4.17.20", minimist: "1.2.5" }, { lodash: "4.17.21", minimist: "1.2.5" }, { lodash: "4.17.20", minimist: "1.2.6" }]);
    expect(result.receipt?.outcome).toBe("partial");
    const [lodash, other] = result.receipt!.fixes;
    expect(lodash).toMatchObject({ package: "lodash", outcome: "failed", branch: null, applied_at: null, candidate_passed: false });
    expect(lodash?.reason).toContain("lodash candidate test failure");
    expect(other).toMatchObject({ package: "minimist", outcome: "applied", branch: "ludion/npm/minimist-1.2.6", fix_published_at: "2022-03-21T00:00:00.000Z" });
    // The minimist branch has only the minimist fix; the failed lodash fix has no branch.
    expect(JSON.parse(git(root, "show", "ludion/npm/minimist-1.2.6:package.json")).dependencies).toEqual({ lodash: "4.17.20", minimist: "1.2.6" });
    expect(git(root, "branch", "--list", "ludion/*")).toBe("ludion/npm/minimist-1.2.6");
    expect(snapshot(root)).toBe(before);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    // The receipt on disk is the one returned.
    expect(JSON.parse(readFileSync(result.path!, "utf8")).fixes.map((f: any) => f.outcome)).toEqual(["failed", "applied"]);
  });
  it("stops a fix whose npm candidate adds a vulnerable version, even under an advisory the baseline had", async () => {
    const minimist: Advisory = { ...advisory, id: "GHSA-test-0002", affected: [{ package: { ecosystem: "npm", name: "minimist" }, ranges: [{ events: [{ fixed: "1.2.6" }] }] }] };
    const unseen: Advisory = { ...minimist, id: "GHSA-test-0003" };
    const osv = () => new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response([advisory, minimist, unseen].find(a => String(url).endsWith(a.id)));
      const ids: Record<string, string> = { "4.17.20": advisory.id, "1.2.5": minimist.id, "1.2.4": minimist.id, "1.3.0": minimist.id, "0.0.1": unseen.id };
      return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => ids[q.version] ? { vulns: [{ id: ids[q.version] }] } : {}) });
    });
    const npm = registry({ minimist: { created: "2013-06-25T08:12:47.000Z", versions: { "0.0.1": "2013-06-25T08:12:47.000Z", "1.2.4": "2019-11-12T00:00:00.000Z", "1.2.5": "2020-03-12T00:00:00.000Z", "1.3.0": "2020-06-01T00:00:00.000Z", "1.2.6": "2022-03-21T00:00:00.000Z" } } });
    // Only Maven, which does not hold the graph fixed, may carry another package within an advisory it had. The judge
    // stops 1.2.4, a copy that goes down within its major (gate 1). Its OSV answers mark neither 1.3.0 nor 0.0.1, so for
    // those the re-scan after the judge is what stops the fix.
    for (const [nested, outcome, reason] of [
      ["1.2.4", "failed", "gate 1: minimist goes down from 1.2.5 to 1.2.4"], ["1.3.0", "failed", "minimist@1.3.0 GHSA-test-0002"], ["0.0.1", "failed", "minimist@0.0.1 GHSA-test-0003"],
    ] as const) {
      const root = fixture();
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: { lodash: "4.17.20", minimist: "1.2.5" } }));
      writeFileSync(join(root, "package-lock.json"), JSON.stringify(lockFor({ lodash: "4.17.20", minimist: "1.2.5" })));
      commit(root);
      const command = fakeCommand();
      // The lodash candidate also holds a second, nested copy of minimist.
      const result = await patchDependencies(root, true, { fetchFn: npm, client: osv(), testRun: async () => {}, command: async args => {
        const output = await command(args), out = args.find(a => a.startsWith("type=local,dest="))?.slice("type=local,dest=".length);
        if (out?.endsWith("candidate-1-export")) {
          const locked = JSON.parse(readFileSync(join(out, "package-lock.json"), "utf8"));
          locked.packages["node_modules/lodash/node_modules/minimist"] = { version: nested, resolved: `https://registry.npmjs.org/minimist/-/minimist-${nested}.tgz`, integrity: integrityOf("minimist", nested) };
          writeFileSync(join(out, "package-lock.json"), JSON.stringify(locked));
        }
        return output;
      } });
      expect(result.receipt?.fixes.map(f => [f.package, f.outcome])).toEqual([["lodash", outcome], ["minimist", "applied"]]);
      expect(result.receipt?.fixes[0]?.reason).toContain(reason);
    }
  });
  it("stops on an OSV MAL- record: in the baseline before any Docker work, in a candidate for that fix", async () => {
    const evil: Advisory = { id: "MAL-2026-0001", summary: "Malicious code in evil", aliases: [], affected: [{ package: { ecosystem: "npm", name: "evil" }, ranges: [{ events: [{ introduced: "0" } as { fixed?: string }] }] }] };
    const npm = registry({ evil: { created: "2015-01-01T00:00:00.000Z", versions: { "1.0.0": "2015-01-01T00:00:00.000Z", "1.0.1": "2016-01-01T00:00:00.000Z" } } });
    const osvFor = (marked: string[]) => new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response(String(url).endsWith(evil.id) ? evil : advisory);
      return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => q.version === "4.17.20" ? { vulns: [{ id: advisory.id }] } : marked.includes(`${q.package.name}@${q.version}`) ? { vulns: [{ id: evil.id }] } : {}) });
    });
    const project = () => {
      const root = fixture(), deps = { lodash: "4.17.20", evil: "1.0.0" };
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: deps }));
      writeFileSync(join(root, "package-lock.json"), JSON.stringify(lockFor(deps)));
      commit(root); return root;
    };
    // The cloud review's case: the baseline's evil@1.0.0 has the record, and the lodash candidate adds evil@1.0.1.
    let docker = 0;
    const counted = fakeCommand();
    const stopped = await patchDependencies(project(), true, { fetchFn: npm, client: osvFor(["evil@1.0.0", "evil@1.0.1"]), command: async args => { docker++; return counted(args); }, testRun: async () => {} });
    expect(stopped.receipt).toMatchObject({ outcome: "failed", reason: expect.stringContaining("MAL- record for an installed package (evil@1.0.0 MAL-2026-0001)") });
    expect(stopped.receipt?.fixes[0]?.reason).toContain("Not validated:");
    expect(docker).toBe(0);
    // Only the candidate's added evil@1.0.1 has the record: that fix stops.
    const command = fakeCommand();
    const result = await patchDependencies(project(), true, { fetchFn: npm, client: osvFor(["evil@1.0.1"]), testRun: async () => {}, command: async args => {
      const output = await command(args), out = args.find(a => a.startsWith("type=local,dest="))?.slice("type=local,dest=".length);
      if (out?.endsWith("candidate-1-export")) {
        const locked = JSON.parse(readFileSync(join(out, "package-lock.json"), "utf8"));
        locked.packages["node_modules/lodash/node_modules/evil"] = { version: "1.0.1", resolved: "https://registry.npmjs.org/evil/-/evil-1.0.1.tgz", integrity: integrityOf("evil", "1.0.1") };
        writeFileSync(join(out, "package-lock.json"), JSON.stringify(locked));
      }
      return output;
    } });
    expect(result.receipt?.fixes[0]).toMatchObject({ outcome: "failed", branch: null });
    expect(result.receipt?.fixes[0]?.reason).toContain("evil@1.0.1 MAL-2026-0001");
  });
  it("stops on a record that names MAL- only as an alias, before any Docker work", async () => {
    const evil: Advisory = { id: "GHSA-evil-0001", summary: "Malicious code in evil", aliases: ["MAL-2026-0001"], affected: [{ package: { ecosystem: "npm", name: "evil" }, ranges: [{ events: [{ introduced: "0" } as { fixed?: string }] }] }] };
    const osv = new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response(String(url).endsWith(evil.id) ? evil : advisory);
      return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => q.version === "4.17.20" ? { vulns: [{ id: advisory.id }] } : q.package.name === "evil" ? { vulns: [{ id: evil.id }] } : {}) });
    });
    const root = fixture(), deps = { lodash: "4.17.20", evil: "1.0.0" };
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: deps }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lockFor(deps)));
    commit(root);
    let docker = 0;
    const command = fakeCommand();
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: osv, command: async args => { docker++; return command(args); }, testRun: async () => {} });
    expect(result.receipt).toMatchObject({ outcome: "failed", reason: expect.stringContaining("MAL- record for an installed package (evil@1.0.0 GHSA-evil-0001)") });
    expect(docker).toBe(0);
  });
  it("stops a fix that leaves another copy of its package at a version the baseline had, still affected", async () => {
    // lodash 4.17.20 at the top and 3.10.0 under `other`, both affected: one fix with two changes. The candidate moves
    // only the top copy. 3.10.0's finding is one the baseline had, so only "nothing left on the fix's package" stops it.
    const { root, osv, npm } = twoCopies();
    const command = fakeCommand();
    const result = await patchDependencies(root, false, { fetchFn: npm, client: osv, testRun: async () => {}, command: async args => {
      const output = await command(args), out = args.find(a => a.startsWith("type=local,dest="))?.slice("type=local,dest=".length);
      if (out?.endsWith("candidate-1-export")) {
        const locked = JSON.parse(readFileSync(join(out, "package-lock.json"), "utf8"));
        locked.packages["node_modules/lodash"] = entry("lodash", "4.17.21");
        locked.packages["node_modules/other/node_modules/lodash"] = entry("lodash", "3.10.0");
        writeFileSync(join(out, "package-lock.json"), JSON.stringify(locked));
      }
      return output;
    } });
    const fix = result.receipt!.fixes[0]!;
    expect(fix.changes.map(c => [c.from, c.to])).toEqual([["4.17.20", "4.17.21"], ["3.10.0", "3.10.2"]]);
    expect(fix).toMatchObject({ outcome: "failed", candidate_passed: false });
    expect(fix.reason).toContain("Candidate still contains known advisory findings or incomplete inventory (lodash@3.10.0 GHSA-test-0011)");
  });
  it("stops only the fix of a package with a finding that has no supported fix, and reports such findings", async () => {
    // OSV answers by name@version.
    const osvOf = (found: Record<string, Advisory[]>) => new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response(Object.values(found).flat().find(a => String(url).endsWith(`/${a.id}`)));
      return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => found[`${q.package.name}@${q.version}`] ? { vulns: found[`${q.package.name}@${q.version}`]!.map(a => ({ id: a.id })) } : {}) });
    });
    const on = (name: string, id: string, fixed: string): Advisory => ({ ...advisory, id, affected: [{ package: { ecosystem: "npm", name }, ranges: [{ events: [{ fixed }] }] }] });
    const npm = registry({ minimist: { created: "2013-06-25T08:12:47.000Z", versions: { "1.2.5": "2020-03-12T00:00:00.000Z", "1.2.6": "2022-03-21T00:00:00.000Z" } }, other: { created: "2015-01-01T00:00:00.000Z", versions: { "1.0.0": "2015-01-01T00:00:00.000Z", "1.0.1": "2016-01-01T00:00:00.000Z" } } });
    const project = (deps: Record<string, string>) => {
      const root = fixture();
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: deps }));
      writeFileSync(join(root, "package-lock.json"), JSON.stringify(lockFor(deps)));
      commit(root); return root;
    };
    // lodash also has an advisory fixed only in the next major: its fix stops; minimist's goes on.
    const first = await patchDependencies(project({ lodash: "4.17.20", minimist: "1.2.5" }), true, { fetchFn: npm, client: osvOf({ "lodash@4.17.20": [advisory, on("lodash", "GHSA-test-0009", "5.0.0")], "minimist@1.2.5": [on("minimist", "GHSA-test-0002", "1.2.6")] }), command: fakeCommand(), testRun: async () => {} });
    expect(first.receipt?.fixes.map(f => [f.package, f.outcome])).toEqual([["lodash", "failed"], ["minimist", "applied"]]);
    expect(first.receipt?.fixes[0]?.reason).toContain("finding without a supported fix: lodash@4.17.20: GHSA-test-0009");
    expect(first.receipt?.outcome).toBe("partial");
    // A package with only such a finding has no fix: the run is partial and says so.
    const second = await patchDependencies(project({ lodash: "4.17.20", other: "1.0.0" }), true, { fetchFn: npm, client: osvOf({ "lodash@4.17.20": [advisory], "other@1.0.0": [on("other", "GHSA-test-0010", "2.0.0")] }), command: fakeCommand(), testRun: async () => {} });
    expect(second.receipt?.fixes.map(f => [f.package, f.outcome])).toEqual([["lodash", "applied"]]);
    expect(second.receipt).toMatchObject({ outcome: "partial", reason: expect.stringContaining("Findings without a supported fix: other@1.0.0: GHSA-test-0010") });
    // The candidate holding another copy of that package stops the fix, under the same advisory or a new one.
    for (const [extra, outcome] of [["GHSA-test-0010", "failed"], ["GHSA-test-0011", "failed"]] as const) {
      const command = fakeCommand();
      const result = await patchDependencies(project({ lodash: "4.17.20", other: "1.0.0" }), true, { fetchFn: npm, testRun: async () => {},
        client: osvOf({ "lodash@4.17.20": [advisory], "other@1.0.0": [on("other", "GHSA-test-0010", "2.0.0")], "other@1.0.1": [on("other", extra, "2.0.0")] }),
        command: async args => {
          const output = await command(args), out = args.find(a => a.startsWith("type=local,dest="))?.slice("type=local,dest=".length);
          if (out?.endsWith("candidate-1-export")) {
            const locked = JSON.parse(readFileSync(join(out, "package-lock.json"), "utf8"));
            locked.packages["node_modules/lodash/node_modules/other"] = { version: "1.0.1", resolved: "https://registry.npmjs.org/other/-/other-1.0.1.tgz", integrity: integrityOf("other", "1.0.1") };
            writeFileSync(join(out, "package-lock.json"), JSON.stringify(locked));
          }
          return output;
        } });
      expect(result.receipt?.fixes[0]?.outcome).toBe(outcome);
      expect(result.receipt?.fixes[0]?.reason).toContain(`other@1.0.1 ${extra}`);
    }
    // Only findings without a supported fix: nothing to validate, and the run fails.
    const none = await patchDependencies(project({ other: "1.0.0" }), true, { fetchFn: npm, client: osvOf({ "other@1.0.0": [on("other", "GHSA-test-0010", "2.0.0")] }), command: fakeCommand(), testRun: async () => {} });
    expect(none.receipt).toMatchObject({ outcome: "failed", fixes: [], reason: expect.stringContaining("other@1.0.0: GHSA-test-0010") });
  });
  it("stops a fix whose candidate has an entry without a supported fix the baseline did not have, on any package", async () => {
    // A Composer candidate that adds a dependency whose Packagist advisories cannot be read gives such an entry with no
    // finding, so only the comparison of the two scans' entries catches it. The same entry in the baseline does not stop.
    const entry = "other@1.0.0: Packagist's advisories for other cannot be read.";
    const osv = (inBaseline: boolean): OsvClient => {
      const real = client();
      let calls = 0;
      return { scan: async (inv: Inventory) => {
        const result = await real.scan(inv), candidate = ++calls > 1;
        return candidate || inBaseline ? { ...result, blocked: [...result.blocked, entry] } : result;
      } } as unknown as OsvClient;
    };
    const added = await patchDependencies((() => { const root = fixture(); commit(root); return root; })(), true, { fetchFn: registry(), client: osv(false), command: fakeCommand(), testRun: async () => {} });
    expect(added.receipt?.fixes[0]).toMatchObject({ package: "lodash", outcome: "failed", branch: null, candidate_passed: false });
    expect(added.receipt?.fixes[0]?.reason).toContain("Candidate still contains known advisory findings");
    const kept = await patchDependencies((() => { const root = fixture(); commit(root); return root; })(), true, { fetchFn: registry(), client: osv(true), command: fakeCommand(), testRun: async () => {} });
    expect(kept.receipt?.fixes[0]).toMatchObject({ package: "lodash", outcome: "applied", branch: "ludion/npm/lodash-4.17.21" });
    expect(kept.receipt).toMatchObject({ outcome: "partial", reason: expect.stringContaining(`Findings without a supported fix: ${entry}`) });
  });
  it("validates only the first of two fixes whose branch names are the same", async () => {
    // "@a/b" and "a-b" both clean to "a-b".
    const deps = { "@a/b": "1.0.0", "a-b": "1.0.0" };
    const root = fixture();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: deps }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lockFor(deps)));
    commit(root);
    const on = (name: string, id: string): Advisory => ({ ...advisory, id, affected: [{ package: { ecosystem: "npm", name }, ranges: [{ events: [{ fixed: "1.0.1" }] }] }] });
    const found: Record<string, Advisory> = { "@a/b": on("@a/b", "GHSA-test-0021"), "a-b": on("a-b", "GHSA-test-0022") };
    const osv = new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response(Object.values(found).find(a => String(url).endsWith(`/${a.id}`)));
      return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => q.version === "1.0.0" ? { vulns: [{ id: found[q.package.name]!.id }] } : {}) });
    });
    const npm = registry({ "@a/b": { created: "2020-01-01T00:00:00.000Z", versions: { "1.0.0": "2020-01-01T00:00:00.000Z", "1.0.1": "2021-01-01T00:00:00.000Z" } }, "a-b": { created: "2020-01-01T00:00:00.000Z", versions: { "1.0.0": "2020-01-01T00:00:00.000Z", "1.0.1": "2021-01-01T00:00:00.000Z" } } }, undefined, undefined, { "@a/b@1.0.0": found["@a/b"]!, "a-b@1.0.0": found["a-b"]! });
    let tests = 0;
    const result = await patchDependencies(root, true, { fetchFn: npm, client: osv, command: fakeCommand(), testRun: async () => { tests++; } });
    expect(result.receipt?.fixes.map(f => [f.package, f.outcome, f.branch])).toEqual([["@a/b", "applied", "ludion/npm/a-b-1.0.1"], ["a-b", "failed", null]]);
    expect(result.receipt?.fixes[1]?.reason).toContain("Another fix of this run has the branch name ludion/npm/a-b-1.0.1");
    expect(tests).toBe(2);
  });
  it("fails a fix whose branch name already holds another change, and leaves that branch alone", async () => {
    const root = fixture(), head = commit(root);
    git(root, "branch", "ludion/npm/lodash-4.17.21", head);
    let docker = 0;
    const counted = fakeCommand();
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: async args => { docker++; return counted(args); }, testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.fixes[0]).toMatchObject({ outcome: "failed", branch: null });
    expect(result.receipt?.fixes[0]?.reason).toContain("holds another change (\"fixture\")");
    expect(docker).toBe(0);
    expect(git(root, "rev-parse", "ludion/npm/lodash-4.17.21")).toBe(head);
  });
  it("leaves a fix whose branch exists unchanged and does not validate it again", async () => {
    const root = fixture(); commit(root);
    const first = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => {} });
    const branch = first.receipt!.fixes[0]!.commit;
    let tests = 0;
    const second = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => { tests++; } });
    expect(second.receipt?.fixes[0]).toMatchObject({ outcome: "skipped", branch: "ludion/npm/lodash-4.17.21", commit: null });
    expect(second.receipt?.outcome).toBe("skipped");
    expect(second.receipt?.reason).toContain("already has its branch");
    expect(tests).toBe(0);
    expect(git(root, "rev-parse", "ludion/npm/lodash-4.17.21")).toBe(branch);
  });
  it("refuses --apply before any Docker work outside Git, and when the files differ from the last commit", async () => {
    let docker = 0;
    const counted = fakeCommand(), command = async (args: string[]) => { docker++; return counted(args); };
    const outside = await patchDependencies(fixture(), true, { fetchFn: registry(), client: client(), command, testRun: async () => {} });
    expect(outside.receipt?.outcome).toBe("failed");
    expect(outside.receipt?.reason).toContain("not in a Git work tree");
    expect(outside.receipt?.fixes[0]?.reason).toContain("Not validated:");
    for (const change of [
      (root: string) => writeFileSync(join(root, "untracked.txt"), "x"),
      (root: string) => writeFileSync(join(root, "package.json"), JSON.stringify({ name: "changed", dependencies: { lodash: "4.17.20" } })),
    ]) {
      const root = fixture(); commit(root); change(root);
      const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command, testRun: async () => {} });
      expect(result.receipt?.reason).toContain("differ from it");
    }
    // No git outside the project on PATH: refused the same way.
    const path = process.env.PATH, root = fixture(); commit(root);
    process.env.PATH = mkdtempSync(join(tmpdir(), "ludion-no-git-"));
    try {
      const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command, testRun: async () => {} });
      expect(result.receipt).toMatchObject({ outcome: "failed", reason: expect.stringContaining("--apply needs git, and none was found") });
      expect(result.receipt?.fixes[0]).toMatchObject({ outcome: "failed", branch: null, reason: expect.stringContaining("Not validated:") });
    } finally { process.env.PATH = path; }
    expect(docker).toBe(0);
    // Without --apply, Git is not needed.
    expect((await patchDependencies(fixture(), false, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => {} })).receipt?.outcome).toBe("validated");
  });
  it("puts the fix of a project in a repository's subfolder on a branch named for that folder", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ludion-monorepo-")), root = join(repo, "apps", "web");
    mkdirSync(root, { recursive: true });
    for (const name of ["package.json", "package-lock.json", "ludion.security.json"]) writeFileSync(join(root, name), readFileSync(join(fixture(), name)));
    writeFileSync(join(repo, "README.md"), "other files of the repository are not compared");
    const head = commit(repo);
    writeFileSync(join(repo, "README.md"), "changed outside the project");
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.fixes[0]).toMatchObject({ outcome: "applied", branch: "ludion/apps-web/npm/lodash-4.17.21" });
    expect(git(repo, "diff", "--name-only", head, "ludion/apps-web/npm/lodash-4.17.21").split("\n")).toEqual(["apps/web/package-lock.json", "apps/web/package.json"]);
  });
  it("groups every planned change of one package into one fix", () => {
    const fix = (name: string, from: string, to: string) => ({ name, from, to, advisories: ["A"] });
    expect(fixesOf([fix("a", "1.0.0", "1.0.1"), fix("b", "2.0.0", "2.0.1"), fix("a", "1.1.0", "1.1.2")]).map(f => f.map(c => `${c.name}@${c.to}`))).toEqual([["a@1.0.1", "a@1.1.2"], ["b@2.0.1"]]);
  });
  it.each([1, 2])("makes no branch when baseline/candidate test %s fails", async at => {
    const root = fixture(); commit(root); const before = snapshot(root); let count = 0;
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => { if (++count === at) throw new Error("failure"); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(snapshot(root)).toBe(before);
    expect(result.receipt?.fixes[0]?.reason).toContain(at === 1 ? "Not validated: failure" : "failure");
    expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  });
  it("refuses an application-compatible candidate that still has advisory findings", async () => {
    const root = fixture(); commit(root); const before = snapshot(root);
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(true), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.fixes[0]?.reason).toContain("still contains"); expect(snapshot(root)).toBe(before);
    expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  });
  it.each([false, true])("rejects source mutations even when not applying (apply=%s)", async apply => {
    const root = fixture(); commit(root); let count = 0;
    const result = await patchDependencies(root, apply, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => { if (++count === 2) mkdirSync(join(root, "new-empty-directory")); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.fixes[0]?.reason).toContain("Project changed");
  });
  it("does not apply after a received stop request", async () => {
    const root = fixture(); commit(root); const before = snapshot(root), abort = new AbortController(); let count = 0;
    const result = await patchDependencies(root, true, { signal: abort.signal, fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => { if (++count === 2) abort.abort(); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.fixes[0]?.reason).toContain("cancelled"); expect(snapshot(root)).toBe(before);
    expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  });
  it("blocks another update when an interrupted transaction needs recovery", () => {
    const root = fixture(), state = privateState(root); mkdirSync(join(state, "transaction-interrupted"));
    writeFileSync(join(state, "transaction-interrupted/journal.json"), JSON.stringify({ phase: "applying" }));
    expect(() => privateState(root)).toThrow("manual recovery");
  });
});

describe("review regressions: public acquisition boundaries and compatibility", () => {
  it("does not reject a graph merely because two existing majors coexist", () => {
    const before: Inventory = { ecosystem: "npm", files: [], scope: "locked", limitations: [], packages: [
      { ecosystem: "npm", name: "lib", version: "1.0.0", direct: true }, { ecosystem: "npm", name: "lib", version: "2.0.0", direct: false },
    ] };
    expect(() => compatible(before, before)).not.toThrow();
    expect(() => compatible(before, { ...before, packages: before.packages.map(p => ({ ...p, version: p.version === "1.0.0" ? "1.0.1" : "2.0.1" })) })).not.toThrow();
    expect(() => compatible(before, { ...before, packages: [{ ecosystem: "npm", name: "lib", version: "3.0.0", direct: true }] })).toThrow();
  });
  it("strips the online Maven build model and pins every repository to public Central", () => {
    const dangerous = pom.replace("</project>", '<build><plugins><plugin><artifactId>maven-dependency-plugin</artifactId><configuration><outputFile>/arbitrary</outputFile></configuration><dependencies><dependency><groupId>evil</groupId><artifactId>goal</artifactId><version>1.0</version></dependency></dependencies></plugin></plugins></build></project>');
    const safe = acquisitionPom(dangerous);
    expect(safe).not.toContain("<build>"); expect(safe).not.toContain("<plugin>"); expect(safe).not.toContain("evil");
    expect(parsePom(safe).dependencies[0]?.name).toBe("org.apache.commons:commons-text");
    expect(MAVEN_SETTINGS).toContain("<mirrorOf>*</mirrorOf>"); expect(MAVEN_SETTINGS).toContain("https://repo.maven.apache.org/maven2");
    expect(resolverDockerfile("maven", `maven@${DIGEST}`, false)).toContain('"--settings","/app/ludion-settings.xml"');
  });
  it("requires the npm version that enforces direct and transitive source restrictions", () => {
    const file = resolverDockerfile("npm", `node@${DIGEST}`, true, false, [{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: ["A"] }]);
    expect(file).toContain('"npm@12.2.1"');
    expect(file.indexOf('"chown","-R","65534:65534","/tmp/npm"')).toBeLessThan(file.indexOf("USER 65534:65534"));
    for (const flag of ["--ignore-scripts", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none"]) expect(file).toContain(flag);
  });
  it.each(["https://host.docker.internal:8443/private/action.zip", "https://127.0.0.1/archive.zip", "https://github.com.example.org/a/b.zip", "https://user:secret@api.github.com/repos/a/b/zipball/" + "a".repeat(40)])("rejects an untrusted or credential-bearing archive URL: %s", url => {
    expect(() => publicArchiveUrl(url)).toThrow();
  });
  it("checks each archive redirect before contacting its target", async () => {
    const root = fixture(), dest = mkdtempSync(join(tmpdir(), "ludion-archives-out-")), cache = mkdtempSync(join(tmpdir(), "ludion-archives-cache-")); let requests = 0;
    writeFileSync(join(root, "composer.lock"), JSON.stringify({ packages: [{ name: "v/p", version: "1.0.0", dist: { type: "zip", url: `https://api.github.com/repos/owner/repo/zipball/${"a".repeat(40)}` } }] }));
    await expect(localComposerLock(root, dest, cache, async () => { requests++; return new Response(null, { status: 302, headers: { location: "https://host.docker.internal:8443/private/action.zip" } }); })).rejects.toThrow(/public|policy/);
    expect(requests).toBe(1);
  });
  it("uses local verified archives without a source fallback and preserves cached redirect evidence", async () => {
    const root = fixture(), dest = mkdtempSync(join(tmpdir(), "ludion-archives-out-")), cache = mkdtempSync(join(tmpdir(), "ludion-archives-cache-")); let requests = 0;
    const original = `https://api.github.com/repos/owner/repo/zipball/${"a".repeat(40)}`, final = `https://codeload.github.com/owner/repo/legacy.zip/${"a".repeat(40)}`;
    writeFileSync(join(root, "composer.lock"), JSON.stringify({ packages: [{ name: "v/p", version: "1.0.0", source: { url: "ssh://internal/private" }, dist: { type: "zip", url: original } }] }));
    const fetchFn: typeof fetch = async url => { requests++; return String(url) === original ? new Response(null, { status: 302, headers: { location: final } }) : new Response("owned fixture archive"); };
    const one = await localComposerLock(root, dest, cache, fetchFn);
    const two = await localComposerLock(root, dest, cache, fetchFn);
    expect(one[0]?.final_url).toBe(final); expect(two[0]?.final_url).toBe(final); expect(requests).toBe(2);
    const locked = JSON.parse(readFileSync(join(dest, "composer.lock"), "utf8"));
    expect(locked.packages[0].source).toBeUndefined(); expect(locked.packages[0].dist.url).toMatch(/^file:\/\/\/archives\/[a-f0-9]{64}\.zip$/);
  });
  it("receives stop requests while acquiring an archive batch", async () => {
    const root = fixture(), dest = mkdtempSync(join(tmpdir(), "ludion-archives-out-")), cache = mkdtempSync(join(tmpdir(), "ludion-archives-cache-")), abort = new AbortController();
    writeFileSync(join(root, "composer.lock"), JSON.stringify({ packages: [{ name: "v/p", version: "1.0.0", dist: { type: "zip", url: `https://api.github.com/repos/owner/repo/zipball/${"a".repeat(40)}` } }] }));
    await expect(localComposerLock(root, dest, cache, async () => { abort.abort(); return new Response("fixture"); }, abort.signal)).rejects.toThrow("cancelled");
  });
  it("keeps auto scanning a saved PHP Dockerfile outside the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "ludion-php-path-")); mkdirSync(join(root, "docker"));
    writeFileSync(join(root, "docker/php.Dockerfile"), "FROM php:8.4.26-cli-alpine\n");
    writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ schema: 1, dockerfile: "docker/php.Dockerfile", test: ["php", "tests.php"], timeout_seconds: 30 }));
    vi.stubGlobal("fetch", async () => response({ "8.4.27": { date: "21 Oct 2026", tags: ["security"] } }));
    try { const result = await scanProject(root); expect(result.checks[0]?.ecosystem).toBe("php"); expect(result.status).toBe("attention_required"); }
    finally { vi.unstubAllGlobals(); }
  });
});

describe("the smallest fix (docs/design.md)", () => {
  const fix = (name: string, from: string, to: string) => ({ name, from, to, advisories: ["A"] });
  it("keeps the project's requirement style and raises only its floor", () => {
    expect(raisedRequirement("a", "4.17.20", "4.17.21")).toBe("4.17.21");
    expect(raisedRequirement("a", "=v4.17.20", "4.17.21")).toBe("4.17.21");
    expect(raisedRequirement("a", "^4.17.0", "4.17.21")).toBe("^4.17.21");
    expect(raisedRequirement("a", "^5.4", "5.4.54")).toBe("^5.4.54");
    expect(raisedRequirement("a", "~1.2.3", "1.2.5")).toBe("~1.2.5");
    for (const spec of [">=1.0.0 <2.0.0", "1.x", "*", "^1.0.0 || ^2.0.0", "~1.2", "latest", 7, undefined]) {
      expect(() => raisedRequirement("a", spec, "1.2.5"), String(spec)).toThrow(/review/);
    }
    expect(() => raisedRequirement("a", "^1.0.0", "1.2.5-beta.1")).toThrow("stable");
  });
  it("pins npm direct fixes exactly and transitive ones as overrides only in the first resolution step", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "t", dependencies: { lodash: "^4.17.0" }, overrides: { other: "1.0.0" } }));
    const plan = [fix("lodash", "4.17.20", "4.17.21"), fix("minimist", "1.2.5", "1.2.8")];
    const pinned = JSON.parse(changedManifest(root, "npm", plan, true)), final = JSON.parse(changedManifest(root, "npm", plan));
    expect(pinned.dependencies.lodash).toBe("4.17.21");
    // Scoped to the vulnerable version, so another installed minimist keeps its own resolution.
    expect(pinned.overrides).toEqual({ other: "1.0.0", "minimist@1.2.5": "1.2.8" });
    expect(final.dependencies.lodash).toBe("^4.17.21");
    expect(final.overrides).toEqual({ other: "1.0.0" });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "t", dependencies: { lodash: "^4.17.0" }, overrides: { minimist: "1.2.6" } }));
    expect(() => changedManifest(root, "npm", plan, true)).toThrow("already overrides minimist");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "t", dependencies: { lodash: "^4.17.0" }, overrides: { "minimist@^1.2.0": "1.2.6" } }));
    expect(() => changedManifest(root, "npm", plan, true)).toThrow("already overrides minimist");
    // Two vulnerable versions of a transitive name: one scoped override each. Of a direct name: review.
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "t", dependencies: { lodash: "^4.17.0" } }));
    expect(JSON.parse(changedManifest(root, "npm", [fix("semver", "5.7.0", "5.7.2"), fix("semver", "6.1.1", "6.3.1")], true)).overrides).toEqual({ "semver@5.7.0": "5.7.2", "semver@6.1.1": "6.3.1" });
    expect(() => changedManifest(root, "npm", [fix("lodash", "4.17.20", "4.17.21"), fix("lodash", "3.10.0", "3.10.2")], true)).toThrow("More than one installed version of lodash");
    // A nested override of the same name also decides its version.
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "t", dependencies: { lodash: "^4.17.0" }, overrides: { parent: { minimist: "1.2.6" } } }));
    expect(() => changedManifest(root, "npm", [fix("minimist", "1.2.5", "1.2.8")], true)).toThrow("already overrides minimist");
    // The vulnerable copy is nested under a direct dependency whose own copy is fine: review, not a raised requirement.
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "t", dependencies: { semver: "^6.0.0" } }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/semver": { version: "6.3.1" }, "node_modules/x/node_modules/semver": { version: "5.7.0" } } }));
    expect(() => changedManifest(root, "npm", [fix("semver", "5.7.0", "5.7.2")], true)).toThrow("nested copy of a direct dependency");
  });
  it("resolves npm and Composer candidates for the planned packages only, never a blanket update", () => {
    const npm = resolverDockerfile("npm", `node@${DIGEST}`, true, false, [fix("lodash", "4.17.20", "4.17.21")]);
    expect(npm).not.toContain('"update"');
    const steps = [...npm.matchAll(/^RUN (\[.*\])$/gm)].map(m => JSON.parse(m[1]!) as string[]).filter(a => a[0] === "npm" || a[0] === "cp" || a[0] === "rm");
    expect(steps.map(a => a.slice(0, 3))).toEqual([
      ["npm", "install", "--global"], ["npm", "install", "--package-lock-only"], ["cp", NPM_FINAL_MANIFEST, "package.json"],
      ["npm", "install", "--package-lock-only"], ["rm", NPM_FINAL_MANIFEST], ["npm", "ci", "--ignore-scripts"],
    ]);
    expect(resolverDockerfile("npm", `node@${DIGEST}`, false)).not.toContain("--package-lock-only");
    const composer = resolverDockerfile("composer", `composer@${DIGEST}`, true, false, [fix("symfony/http-foundation", "5.4.0", "5.4.54")]);
    expect(composer).toContain('"composer","update","--with-dependencies","--minimal-changes"');
    // Packages only after --, so no planned coordinate can be read as an option.
    expect(composer).toContain('"--no-progress","--","symfony/http-foundation:5.4.54"]');
    expect(composer).not.toContain("--with-all-dependencies");
    expect(() => resolverDockerfile("npm", `node@${DIGEST}`, true)).toThrow("planned fix");
    expect(() => resolverDockerfile("composer", `composer@${DIGEST}`, true, false, [fix("--with-all-dependencies", "1", "2")])).toThrow();
    expect(() => resolverDockerfile("npm", `node@${DIGEST}`, true, false, [fix("lodash", "4.17.20", "latest")])).toThrow();
  });
  it("stops when the candidate moves a package version that no planned fix replaces", async () => {
    const base: Inventory = { ecosystem: "npm", files: [], scope: "locked_dependencies", limitations: [], packages: [
      { ecosystem: "npm", name: "semver", version: "5.7.0", direct: false }, { ecosystem: "npm", name: "semver", version: "6.1.1", direct: false } ] };
    const plan = [fix("semver", "5.7.0", "5.7.2")];
    const scoped: Inventory = { ...base, packages: [{ ...base.packages[0]!, version: "5.7.2" }, base.packages[1]!, { ecosystem: "npm", name: "new-dep", version: "1.0.0", direct: false }] };
    expect(unplannedRemovals(base, scoped, plan)).toEqual([]);
    // The global-override failure: the other semver drifts to the newest 6.x.
    const drifted: Inventory = { ...base, packages: [{ ...base.packages[0]!, version: "5.7.2" }, { ...base.packages[1]!, version: "6.3.1" }] };
    expect(unplannedRemovals(base, drifted, plan)).toEqual(["semver@6.1.1"]);
    // The project also has a package no fix touches; the fake npm's candidate lockfile drops it.
    const root = fixture(), withOther = lock();
    (withOther.packages as Record<string, unknown>)["node_modules/other"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/other/-/other-1.0.0.tgz" };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(withOther));
    commit(root);
    const before = snapshot(root);
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.fixes[0]?.reason).toContain("moved packages that were not planned (other@1.0.0)");
    expect(result.receipt?.fixes[0]?.changed_packages).toEqual([{ name: "lodash", from: ["4.17.20"], to: ["4.17.21"] }, { name: "other", from: ["1.0.0"], to: [] }]);
    expect(snapshot(root)).toBe(before);
  });
  it("records every changed package, planned or not, and refuses a manifest the package manager rewrote", async () => {
    const base: Inventory = { ecosystem: "npm", files: [], scope: "locked_dependencies", limitations: [], packages: [
      { ecosystem: "npm", name: "lodash", version: "4.17.20", direct: true }, { ecosystem: "npm", name: "a", version: "1.0.0", direct: false } ] };
    const next: Inventory = { ...base, packages: [
      { ecosystem: "npm", name: "lodash", version: "4.17.21", direct: true }, { ecosystem: "npm", name: "a", version: "1.0.0", direct: false }, { ecosystem: "npm", name: "new-dep", version: "0.1.0", direct: false } ] };
    expect(changedPackages(base, next)).toEqual([{ name: "lodash", from: ["4.17.20"], to: ["4.17.21"] }, { name: "new-dep", from: [], to: ["0.1.0"] }]);
    const root = fixture(), command = fakeCommand();
    const result = await patchDependencies(root, false, { fetchFn: registry(), client: client(), testRun: async () => {}, command: async args => {
      const output = await command(args);
      const out = args.find(a => a.startsWith("type=local,dest="));
      if (out?.endsWith("candidate-1-export")) writeFileSync(join(out.slice("type=local,dest=".length), "package.json"), JSON.stringify({ name: "test", dependencies: { lodash: "^4.17.21" } }));
      return output;
    } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.fixes[0]?.reason).toContain("changed the manifest beyond the planned fix");
    const ok = await patchDependencies(fixture(), false, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(ok.receipt?.fixes[0]?.changed_packages).toEqual([{ name: "lodash", from: ["4.17.20"], to: ["4.17.21"] }]);
  });
  it("keeps only the properties the online Maven model uses, and refuses dependency-plugin parameter names", () => {
    const withProps = (props: string, version = "${text.version}") => pom.replace("<properties><text.version>1.9</text.version></properties>", `<properties>${props}</properties>`).replace("<version>${text.version}</version>", `<version>${version}</version>`);
    const safe = acquisitionPom(withProps("<text.version>${base}</text.version><base>1.9</base><excludes>org.yaml:*</excludes><scope>test</scope>"));
    expect(safe).toContain("<text.version>"); expect(safe).toContain("<base>1.9</base>");
    expect(safe).not.toContain("excludes"); expect(safe).not.toContain("<scope>");
    expect(acquisitionPom(withProps("<excludes>org.yaml:*</excludes>", "1.9"))).not.toContain("properties");
    expect(() => acquisitionPom(withProps("<excludes>1.9</excludes>", "${excludes}"))).toThrow("dependency-plugin parameter");
  });
});

describe("Composer plans also read Packagist's advisories", () => {
  const installed = (version = "5.4.10"): Inventory => ({ ecosystem: "composer", files: ["composer.lock"], scope: "locked", limitations: [], packages: [{ ecosystem: "composer", name: "symfony/http-foundation", version, direct: true }] });
  const osvFixed = (fixed: string | null) => ({ ...advisory, id: "GHSA-osv1-osv1-osv1", affected: [{ package: { ecosystem: "Packagist", name: "symfony/http-foundation" }, ranges: [{ events: fixed ? [{ fixed }] : [] }] }] });
  const pksa = (id: string, affectedVersions: string, extra: Record<string, unknown> = {}) => ({ advisoryId: id, packageName: "symfony/http-foundation", title: "Example", affectedVersions, cve: "CVE-2026-0002", sources: [{ name: "GitHub", remoteId: "GHSA-r925-mgvr-h9cc" }], ...extra });
  function withSources(osv: ReturnType<typeof osvFixed> | null, packagist: unknown, seen: string[] = []): OsvClient {
    return new OsvClient(async url => {
      seen.push(String(url));
      if (String(url).startsWith("https://packagist.org/")) return packagist instanceof Response ? packagist : response(packagist);
      if (String(url).includes("/vulns/")) return response(osv);
      return response({ results: [osv ? { vulns: [{ id: osv.id }] } : {}] });
    });
  }

  it("takes Packagist's later fix when OSV's fixed version is still affected there", async () => {
    const seen: string[] = [];
    const result = await withSources(osvFixed("5.4.46"), { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=5.4.1,<5.4.54|>=6.0.1,<6.1.0")] } }, seen).scan(installed());
    expect(result.plan).toEqual([{ name: "symfony/http-foundation", from: "5.4.10", to: "5.4.54", advisories: ["GHSA-osv1-osv1-osv1", "PKSA-aaaa-bbbb-cccc"] }]);
    expect(result.sources).toEqual(["https://osv.dev", "https://packagist.org/api/security-advisories/"]);
    expect(seen.find(u => u.startsWith("https://packagist.org/"))).toBe("https://packagist.org/api/security-advisories/?packages[]=symfony%2Fhttp-foundation");
    expect(result.findings[1]!.advisory.aliases).toEqual(["CVE-2026-0002", "GHSA-r925-mgvr-h9cc"]);
  });
  it("keeps OSV's fix when it is the later one, and finds advisories only Packagist has", async () => {
    expect((await withSources(osvFixed("5.4.60"), { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=5.4.1,<5.4.54")] } }).scan(installed())).plan[0]?.to).toBe("5.4.60");
    const only = await withSources(null, { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=5.0.0,<5.1.0|>=5.1.0,<5.2.0|>=5.4.0,<5.4.54")] } }).scan(installed());
    expect(only.status).toBe("vulnerabilities_found"); expect(only.plan[0]?.to).toBe("5.4.54");
    // A fix that lands in the next range of the same advisory moves on to that range's end.
    expect((await withSources(null, { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=5.0.0,<5.1.0|>=5.1.0,<5.2.0|>=5.2.0,<5.2.9")] } }).scan(installed("5.0.3"))).plan[0]?.to).toBe("5.2.9");
  });
  it("ignores advisories that do not affect the installed version and reports a clean empty answer", async () => {
    const result = await withSources(null, { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=6.0.0,<6.4.14")] } }).scan(installed());
    expect(result.status).toBe("no_known_vulnerabilities"); expect(result.plan).toEqual([]);
    expect((await withSources(null, { advisories: [] }).scan(installed())).status).toBe("no_known_vulnerabilities");
  });
  it("blocks when Packagist leaves no same-major fix or writes a range Ludion cannot read", async () => {
    const open = await withSources(osvFixed("5.4.46"), { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=5.4.1")] } }).scan(installed());
    expect(open.plan).toEqual([]); expect(open.blocked.join(" ")).toContain("Packagist lists 5.4.46 as affected");
    const major = await withSources(null, { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=5.0.0,<6.0.0")] } }).scan(installed());
    expect(major.plan).toEqual([]); expect(major.blocked).toHaveLength(1);
    const odd = await withSources(null, { advisories: { "symfony/http-foundation": [pksa("PKSA-aaaa-bbbb-cccc", ">=5.4.0-beta1,<5.4.54")] } }).scan(installed());
    expect(odd.status).toBe("incomplete"); expect(odd.blocked.join(" ")).toContain("cannot read");
  });
  it.each([
    ["an outage", new Response("", { status: 503 })],
    ["a missing advisories field", { other: 1 }],
    ["a name that was not asked for", { advisories: { "evil/other": [] } }],
    ["a record for another package", { advisories: { "symfony/http-foundation": [{ ...pksa("PKSA-aaaa-bbbb-cccc", "<5.4.54"), packageName: "evil/other" }] } }],
    ["an invalid advisory id", { advisories: { "symfony/http-foundation": [pksa("../../x", "<5.4.54")] } }],
  ])("never treats %s as a clean Packagist answer", async (_label, body) => {
    await expect(withSources(null, body).scan(installed())).rejects.toThrow(/Packagist/);
  });
  it("does not ask Packagist about npm or Maven inventories", async () => {
    const seen: string[] = [];
    await withSources(null, { advisories: [] }, seen).scan(inventory(fixture(), "npm"));
    expect(seen.some(u => u.includes("packagist"))).toBe(false);
  });
});

describe.each([true, false])("the judge on each npm fix, apply %s", apply => {
  const lodash = (fix: object, published = "2021-02-20T15:42:16.891Z") => registry({ lodash: { created: "2012-04-23T16:37:11.912Z", versions: { "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": published } } }, (_name, version) => version === "4.17.21" ? fix : {});
  /** With --apply the working tree never changes, so a refused fix shows as no branch and no commit. */
  const nothingCommitted = (root: string, fix: FixReceipt) => {
    expect(fix).toMatchObject({ branch: null, commit: null, applied_at: null });
    if (apply) expect(git(root, "branch", "--list", `ludion/npm/${fix.package}-*`)).toBe("");
  };
  it.each<[string, typeof fetch, string, string]>([
    ["a deprecated fix", lodash({ deprecated: "use 4.17.22" }), "stop", "The judge stops the candidate: gate 2: lodash@4.17.21 is deprecated: use 4.17.22"],
    ["a fix that adds an install script", lodash({ scripts: { postinstall: "node x.js" } }), "stop", "The judge stops the candidate: gate 2: lodash@4.17.21 adds install scripts: postinstall."],
    // 80h ago: past the normal 72h, inside the 144h a publisher change extends it to.
    ["a fix from another publisher", lodash({ _npmUser: { name: "someone-else" } }, new Date(Date.now() - 80 * 3_600_000).toISOString()), "wait", "The wait is extended: lodash@4.17.21 was published by someone-else, 4.17.20 by unknown."],
    ["a fix published an hour ago", lodash({}, new Date(Date.now() - 3_600_000).toISOString()), "wait", "The judge's wait is not over: not applied before "],
    ["a candidate whose OSV lookup fails", async (url, init) => String(url).startsWith("https://api.osv.dev/") ? new Response("", { status: 503 }) : registry()(url, init), "undecidable", "The judge cannot decide on the candidate: gate 2: A lookup failed: api.osv.dev answered HTTP 503."],
  ])("does not apply %s, and does not run the candidate's tests", async (_label, fetchFn, verdict, reason) => {
    const root = fixture(); commit(root); let tests = 0;
    const result = await patchDependencies(root, apply, { fetchFn, client: client(), command: fakeCommand(), testRun: async () => { tests++; } });
    expect(result.receipt?.outcome).toBe("failed");
    const fix = result.receipt!.fixes[0]!;
    expect(fix.outcome).toBe("failed");
    expect(fix.judgement?.verdict).toBe(verdict);
    expect(fix.reason).toContain(reason);
    expect(fix.candidate_passed).toBe(false);
    expect(tests).toBe(1);
    nothingCommitted(root, fix);
  });
  it("goes on to the candidate's tests when the judge finds nothing, downloading the EPSS list whole and sending no CVE ID", async () => {
    const root = fixture(), seen: string[] = []; commit(root); let tests = 0;
    const result = await patchDependencies(root, apply, { fetchFn: registry({}, () => ({}), seen), client: client(), command: fakeCommand(), testRun: async () => { tests++; } });
    expect(result.receipt?.fixes[0]?.judgement?.verdict).toBe("ready_except_build");
    expect(result.receipt?.fixes[0]?.outcome).toBe(apply ? "applied" : "validated");
    expect(result.receipt?.outcome).toBe(apply ? "applied" : "validated");
    expect(tests).toBe(2);
    expect(seen).toEqual(expect.arrayContaining([EPSS_LIST, EPSS_DAY]));
    expect(seen.filter(s => s.includes("CVE-"))).toEqual([]);
  });
  it("refuses only the fix the judge refuses; the other goes on, and each judgement sees only its own fix's change", async () => {
    const root = fixture(), deps = { lodash: "4.17.20", minimist: "1.2.5" };
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", dependencies: deps }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lockFor(deps)));
    commit(root);
    const osv = new OsvClient(async (url, init) => {
      if (String(url).includes("/vulns/")) return response(String(url).endsWith(minimistAdvisory.id) ? minimistAdvisory : advisory);
      return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => VULNERABLE[`${q.package.name}@${q.version}`] ? { vulns: [{ id: VULNERABLE[`${q.package.name}@${q.version}`]!.id }] } : {}) });
    });
    const tested: string[] = [], seen: string[] = [];
    const fetchFn = registry({ minimist: MINIMIST_RELEASES }, (name, version) => name === "lodash" && version === "4.17.21" ? { deprecated: "use 4.17.22" } : {}, seen);
    const result = await patchDependencies(root, apply, {
      fetchFn, client: osv, command: fakeCommand(),
      testRun: async name => { tested.push(name.replace(/^ludion-check-[^-]+-[^-]+-[^-]+-[^-]+-[^-]+-/, "")); },
    });
    expect(result.receipt?.outcome).toBe("partial");
    const [refused, passed] = result.receipt!.fixes;
    expect(refused).toMatchObject({ package: "lodash", outcome: "failed", candidate_passed: false });
    expect(refused?.judgement?.verdict).toBe("stop");
    expect(refused?.reason).toContain("The judge stops the candidate: gate 2: lodash@4.17.21 is deprecated: use 4.17.22");
    nothingCommitted(root, refused!);
    expect(passed).toMatchObject({ package: "minimist", outcome: apply ? "applied" : "validated", candidate_passed: true });
    expect(passed?.judgement?.verdict).toBe("ready_except_build");
    // The refused fix's candidate was not tested.
    expect(tested).toEqual(["baseline", "candidate-2"]);
    // Each judgement covers only its own fix's lockfile diff.
    expect(refused?.judgement?.changes.map(c => [c.name, c.from, c.to])).toEqual([["lodash", "4.17.20", "4.17.21"]]);
    expect(refused?.judgement?.fixes.map(f => [f.id, f.package])).toEqual([[advisory.id, "lodash"]]);
    expect(passed?.judgement?.changes.map(c => [c.name, c.from, c.to])).toEqual([["minimist", "1.2.5", "1.2.6"]]);
    expect(passed?.judgement?.fixes.map(f => [f.id, f.package])).toEqual([[minimistAdvisory.id, "minimist"]]);
    // KEV and the EPSS list are downloaded whole once per judged fix, and no CVE ID is sent.
    expect(seen.filter(s => s.startsWith("https://www.cisa.gov/"))).toHaveLength(2);
    expect(seen.filter(s => s === EPSS_LIST)).toHaveLength(2);
    expect(seen.filter(s => s.includes("CVE-"))).toEqual([]);
    if (apply) {
      expect(git(root, "branch", "--list", "ludion/*")).toBe("ludion/npm/minimist-1.2.6");
      expect(JSON.parse(git(root, "show", "ludion/npm/minimist-1.2.6:package.json")).dependencies).toEqual({ lodash: "4.17.20", minimist: "1.2.6" });
    } else expect(passed).toMatchObject({ branch: null, commit: null });
  });
});

describe("the judge on npm fixes, when it throws", () => {
  it.each([false, true])("fails that fix and commits nothing (apply=%s)", async apply => {
    // Two lockfile paths that differ only in case: the inventory reads them, the judge's lockfile reader refuses them.
    const root = fixture(), withCase = lock() as any;
    withCase.packages["node_modules/other"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/other/-/other-1.0.0.tgz", integrity: integrityOf("other", "1.0.0") };
    withCase.packages["node_modules/Other"] = { ...withCase.packages["node_modules/other"] };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(withCase));
    commit(root);
    const command = fakeCommand(); let tests = 0;
    const result = await patchDependencies(root, apply, { fetchFn: registry(), client: client(), testRun: async () => { tests++; }, command: async args => {
      const output = await command(args);
      const out = args.find(a => a.startsWith("type=local,dest="));
      if (out?.endsWith("candidate-1-export")) {
        const file = join(out.slice("type=local,dest=".length), "package-lock.json"), candidate = JSON.parse(readFileSync(file, "utf8"));
        Object.assign(candidate.packages, { "node_modules/other": withCase.packages["node_modules/other"], "node_modules/Other": withCase.packages["node_modules/Other"] });
        writeFileSync(file, JSON.stringify(candidate));
      }
      return output;
    } });
    expect(result.receipt?.outcome).toBe("failed");
    const fix = result.receipt!.fixes[0]!;
    expect(fix.outcome).toBe("failed");
    expect(fix.reason).toBe("Two package-lock paths differ only in case: node_modules/Other.");
    expect(fix.judgement).toBeUndefined();
    expect(tests).toBe(1);
    expect(fix).toMatchObject({ branch: null, commit: null, applied_at: null });
    if (apply) expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  });
});

describe("the time cap on candidates", () => {
  const inv = (ecosystem: "npm" | "composer", packages: [string, string][]): Inventory => ({ ecosystem, files: [], scope: "locked_dependencies", limitations: [], packages: packages.map(([name, version]) => ({ ecosystem, name, version, direct: false })) });
  const plan = [{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: ["GHSA-test-0001"] }];
  it("stops a version the candidate adds that was published at or after the fix, and a young new package", async () => {
    const before = inv("npm", [["lodash", "4.17.20"], ["old", "1.0.0"]]);
    const fetchFn = registry({
      old: { created: "2015-01-01T00:00:00Z", versions: { "1.0.0": "2015-01-01T00:00:00Z", "1.1.0": "2021-02-20T15:42:16.891Z" } },
      fresh: { created: "2021-02-19T00:00:00Z", versions: { "1.0.0": "2021-02-19T00:00:00Z" } },
      settled: { created: "2020-01-01T00:00:00Z", versions: { "2.0.0": "2021-01-01T00:00:00Z" } },
    });
    const cap = await candidateTimeCap("npm", before, inv("npm", [["lodash", "4.17.21"], ["old", "1.0.0"], ["old", "1.1.0"], ["fresh", "1.0.0"], ["settled", "2.0.0"]]), plan, fetchFn);
    expect(cap).toMatchObject({ t: "2021-02-20T15:42:16.891Z", targets: ["lodash@4.17.21"], after_t: ["old@1.1.0"], young: ["fresh (first published 2021-02-19T00:00:00.000Z)"], undecidable: [], wait_hours: 168 });
    const clean = await candidateTimeCap("npm", before, inv("npm", [["lodash", "4.17.21"], ["old", "1.0.0"], ["settled", "2.0.0"]]), plan, fetchFn);
    expect(clean).toMatchObject({ after_t: [], young: [], undecidable: [] });
    expect(renderTimeCap(clean)).toEqual(["Published at or after T (2021-02-20T15:42:16.891Z, the fix's publish time): 0 version(s)"]);
  });
  it("lets an npm sibling of the same release move, from the registry's publisher and provenance", async () => {
    const commit = "535e26d3c69de49df8bd17618a424cbe65ec897b";
    const integrity = "sha512-" + "B".repeat(86) + "==", sha512 = Buffer.from(integrity.slice(7), "base64").toString("hex");
    const statement = (name: string, version: string, sha: string) => ({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify({ subject: [{ name: `pkg:npm/${name}@${version}`, digest: { sha512 } }], predicate: { buildDefinition: { externalParameters: { workflow: { repository: "https://github.com/lodash/lodash", path: ".github/workflows/release.yml" } }, resolvedDependencies: [{ digest: { gitCommit: sha } }] } } })).toString("base64") } } }] });
    // No provenance: lodash.sib@4.17.21 10 s after the fix, lodash.late@4.17.21 16 minutes after, same publisher and
    // version. lodash.prov@1.0.0: an hour after, with provenance from `commit`.
    const times: Record<string, Record<string, string>> = {
      lodash: { "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": "2021-02-20T15:42:16.891Z" },
      "lodash.sib": { "4.17.20": "2020-08-13T16:54:00.000Z", "4.17.21": "2021-02-20T15:42:26.891Z" },
      "lodash.late": { "4.17.20": "2020-08-13T16:54:00.000Z", "4.17.21": "2021-02-20T15:58:16.891Z" },
      "lodash.prov": { "0.9.0": "2020-08-13T16:54:00.000Z", "1.0.0": "2021-02-20T16:42:16.891Z" },
    };
    /**
     * The fix's provenance commit (null: none), the attestation endpoint's status, the publisher every version records,
     * and the package lodash.prov's statement names (another one, to test the subject check).
     */
    const fetchFn = (fixCommit: string | null, attestationStatus = 200, npmUser: object = { name: "bnjmn" }, provSubject = "lodash.prov"): typeof fetch => async url => {
      const u = decodeURIComponent(String(url));
      const att = /\/-\/npm\/v1\/attestations\/(.+)@([^@]+)$/.exec(u);
      if (att) return attestationStatus === 200 ? response(statement(att[1] === "lodash.prov" ? provSubject : att[1]!, att[2]!, att[1] === "lodash" ? fixCommit! : commit)) : new Response("", { status: attestationStatus });
      const name = u.replace("https://registry.npmjs.org/", "");
      if (!times[name]) return new Response("", { status: 404 });
      const attested = (v: string) => (name === "lodash" && v === "4.17.21" && fixCommit !== null) || (name === "lodash.prov" && v === "1.0.0");
      return response({ time: { created: "2012-04-23T16:37:11.912Z", ...times[name] }, versions: Object.fromEntries(Object.keys(times[name]!).map(v => [v, { dependencies: {}, _npmUser: npmUser, dist: { integrity, ...(attested(v) ? { attestations: { url: "x" } } : {}) } }])) });
    };
    const before = inv("npm", [["lodash", "4.17.20"], ["lodash.sib", "4.17.20"], ["lodash.late", "4.17.20"], ["lodash.prov", "0.9.0"]]);
    const after = inv("npm", [["lodash", "4.17.21"], ["lodash.sib", "4.17.21"], ["lodash.late", "4.17.21"], ["lodash.prov", "1.0.0"]]);
    // The fix without provenance: the publisher branch allows lodash.sib only; provenance on one side does not count.
    const plain = await candidateTimeCap("npm", before, after, plan, fetchFn(null));
    expect(plain.same_release).toEqual([{ version: "lodash.sib@4.17.21", target: "lodash@4.17.21", basis: "publisher" }]);
    expect(plain.after_t).toEqual(["lodash.late@4.17.21", "lodash.prov@1.0.0"]);
    // The fix with provenance from the same commit: lodash.prov only; the siblings without provenance stop.
    const built = await candidateTimeCap("npm", before, after, plan, fetchFn(commit));
    expect(built.same_release).toEqual([{ version: "lodash.prov@1.0.0", target: "lodash@4.17.21", basis: "provenance" }]);
    expect(built.after_t).toEqual(["lodash.late@4.17.21", "lodash.sib@4.17.21"]);
    // From another commit: everything after T stops.
    expect((await candidateTimeCap("npm", before, after, plan, fetchFn("0".repeat(40)))).after_t).toEqual(["lodash.late@4.17.21", "lodash.prov@1.0.0", "lodash.sib@4.17.21"]);
    // The attestation read fails: undecidable, and the receipt still has T and the count.
    const failed = await candidateTimeCap("npm", before, after, plan, fetchFn(commit, 500));
    expect(failed.t).toBe("2021-02-20T15:42:16.891Z");
    expect(failed.after_t).toEqual(["lodash.late@4.17.21", "lodash.prov@1.0.0", "lodash.sib@4.17.21"]);
    expect(failed.undecidable).toEqual([expect.stringContaining("The publisher and provenance for the same-release check could not be read: registry.npmjs.org answered HTTP 500")]);
    // A statement naming another package: refused, so undecidable.
    expect((await candidateTimeCap("npm", before, after, plan, fetchFn(commit, 200, { name: "bnjmn" }, "lodash.other"))).undecidable).toEqual([expect.stringContaining("does not name lodash.prov@1.0.0 and its tarball")]);
    // Trusted publishing's shared user, as the registry records it: no account, so the publisher branch allows nothing.
    const oidc = { name: "GitHub Actions", email: "npm-oidc-no-reply@github.com", trustedPublisher: { id: "github", oidcConfigId: "oidc:x" } };
    const shared = await candidateTimeCap("npm", before, after, plan, fetchFn(null, 200, oidc));
    expect(shared.same_release).toEqual([]);
    expect(shared.after_t).toEqual(["lodash.late@4.17.21", "lodash.prov@1.0.0", "lodash.sib@4.17.21"]);
  });
  it("takes only the plan's own versions as targets, so another copy of a planned package is checked against T", async () => {
    const fetchFn = registry({ lodash: { created: "2012-04-23T16:37:11.912Z", versions: { "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": "2021-02-20T15:42:16.891Z", "4.17.30": "2026-01-01T00:00:00Z" } } });
    const cap = await candidateTimeCap("npm", inv("npm", [["lodash", "4.17.20"]]), inv("npm", [["lodash", "4.17.21"], ["lodash", "4.17.30"]]), plan, fetchFn);
    expect(cap).toMatchObject({ t: "2021-02-20T15:42:16.891Z", targets: ["lodash@4.17.21"], after_t: ["lodash@4.17.30"] });
  });
  it("lets nothing published at or after T move in a Composer candidate", async () => {
    const p2 = (name: string, list: unknown[]) => response({ minified: "composer/2.0", packages: { [name]: list } });
    const fetchFn: typeof fetch = async url => {
      const u = String(url);
      if (u.endsWith("/p2/vendor/lib.json")) return p2("vendor/lib", [{ name: "vendor/lib", version: "2.0.1", time: "2026-05-01T00:00:00+00:00" }, { version: "2.0.0", time: "2026-01-01T00:00:00+00:00" }]);
      if (u.endsWith("/p2/vendor/lib-sib.json")) return p2("vendor/lib-sib", [{ name: "vendor/lib-sib", version: "2.0.1", time: "2026-05-01T00:00:05+00:00" }, { version: "2.0.0", time: "2026-01-01T00:00:00+00:00" }]);
      return new Response("", { status: 404 });
    };
    const cap = await candidateTimeCap("composer", inv("composer", [["vendor/lib", "2.0.0"], ["vendor/lib-sib", "2.0.0"]]), inv("composer", [["vendor/lib", "2.0.1"], ["vendor/lib-sib", "2.0.1"]]), [{ name: "vendor/lib", from: "2.0.0", to: "2.0.1", advisories: ["PKSA-x"] }], fetchFn);
    expect(cap).toMatchObject({ after_t: ["vendor/lib-sib@2.0.1"], same_release: [] });
  });
  it("is undecidable when a time is missing, and a failed registry read fails the candidate", async () => {
    const before = inv("npm", [["lodash", "4.17.20"]]);
    const noTime = registry({ lodash: { created: "2012-04-23T16:37:11.912Z", versions: { "4.17.20": "2020-08-13T16:53:54.152Z" } } });
    expect((await candidateTimeCap("npm", before, inv("npm", [["lodash", "4.17.21"]]), plan, noTime)).undecidable).toEqual(["lodash@4.17.21 has no publish time, so T is unknown."]);
    await expect(candidateTimeCap("npm", before, inv("npm", [["lodash", "4.17.21"], ["gone", "1.0.0"]]), plan, registry())).rejects.toThrow("HTTP 404");
    const root = fixture(); commit(root); const snap = snapshot(root);
    const result = await patchDependencies(root, true, { fetchFn: noTime, client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.fixes[0]?.reason).toContain("The time cap could not be checked: lodash@4.17.21 has no publish time");
    // The fix's publish time could not be read either: null, and the receipt says so.
    expect(result.receipt?.fixes[0]).toMatchObject({ fix_published_at: null, fix_published_note: "Not found: the registry gives no publish time for lodash@4.17.21." });
    expect(snapshot(root)).toBe(snap);
  });
  it("reads Packagist's minified metadata for Composer release times and requirements", async () => {
    const p2 = (name: string, list: unknown[]) => response({ minified: "composer/2.0", packages: { [name]: list } });
    const fetchFn: typeof fetch = async url => {
      const u = String(url);
      if (u.endsWith("/p2/vendor/lib.json")) return p2("vendor/lib", [
        { name: "vendor/lib", version: "v2.0.1", time: "2026-05-01T00:00:00+00:00", require: { php: ">=8.1", "vendor/new": "^1.0", "vendor/dep": "^1.0" } },
        { version: "v2.0.0", time: "2026-01-01T00:00:00+00:00", require: { php: ">=8.1", "vendor/dep": "^1.0" } },
        { version: "v1.0.0", time: "2025-01-01T00:00:00+00:00", require: "__unset" },
      ]);
      if (u.endsWith("/p2/vendor/dep.json")) return p2("vendor/dep", [{ name: "vendor/dep", version: "1.1.0", time: "2026-05-02T00:00:00+00:00" }, { version: "1.0.0", time: "2024-01-01T00:00:00+00:00" }]);
      if (u.endsWith("/p2/vendor/new.json")) return p2("vendor/new", [{ name: "vendor/new", version: "1.0.0", time: "2026-04-28T00:00:00+00:00" }]);
      return new Response("", { status: 404 });
    };
    const releases = await packagistReleases("vendor/lib", fetchFn);
    expect(releases.created).toBe("2025-01-01T00:00:00.000Z");
    expect(releases.requires.get("2.0.0")).toEqual(["vendor/dep"]);
    expect(releases.requires.get("1.0.0")).toEqual([]);
    const cap = await candidateTimeCap("composer", inv("composer", [["vendor/lib", "2.0.0"], ["vendor/dep", "1.0.0"], ["vendor/new", "1.0.0"]]), inv("composer", [["vendor/lib", "2.0.1"], ["vendor/dep", "1.0.0"], ["vendor/dep", "1.1.0"], ["vendor/new", "1.0.0"]]), [{ name: "vendor/lib", from: "2.0.0", to: "2.0.1", advisories: ["PKSA-x"] }], fetchFn);
    // vendor/new was already locked, is newly required by the fix, and first appeared 3 days before T: younger than 168h.
    expect(cap).toMatchObject({ t: "2026-05-01T00:00:00.000Z", after_t: ["vendor/dep@1.1.0"], young: ["vendor/new (first published 2026-04-28T00:00:00.000Z)"], undecidable: [] });
    await expect(packagistReleases("../etc/passwd", fetchFn)).rejects.toThrow("Invalid Composer package name");
  });
});

describe.each([false, true])("the next smallest fix when the smallest cannot be used (LV), apply %s", apply => {
  const LODASH = { created: "2012-04-23T16:37:11.912Z", versions: { "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": "2021-02-20T15:42:16.891Z", "4.17.22": "2021-03-01T00:00:00.000Z", "4.17.23": "2021-03-02T00:00:00.000Z" } };
  const later: Advisory = { ...advisory, id: "GHSA-test-0009", aliases: [], affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ events: [{ introduced: "4.17.21" } as { fixed?: string }, { fixed: "4.17.22" }] }] }] };
  /** Every version published by one npm account, so the version taken passes the publisher check (next-fix.ts). */
  const one = (manifest: (name: string, version: string) => object = () => ({})) => (name: string, version: string) => ({ _npmUser: { name: "jdalton" }, ...manifest(name, version) });
  const mal: Advisory = { id: "MAL-2026-0009", summary: "Malicious code in lodash", aliases: [], affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [] }] };
  const run = async (fetchFn: typeof fetch) => {
    const root = fixture(), head = commit(root), before = snapshot(root), tested: string[] = [];
    const result = await patchDependencies(root, apply, { fetchFn, client: client(), command: fakeCommand(), testRun: async name => { tested.push(name.replace(/^ludion-check-[^-]+-[^-]+-[^-]+-[^-]+-[^-]+-/, "")); } });
    expect(snapshot(root)).toBe(before);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    return { root, result, fix: result.receipt!.fixes[0]!, tested };
  };
  /** OSV batch queries the fetch saw, as name@version lists. */
  const batches = (seen: string[]) => seen.filter(s => s.startsWith('{"queries"')).map(s => JSON.parse(s).queries.map((q: any) => `${q.package.name}@${q.version}`));
  /** The fix went on with `version`: tested, judged, and with --apply committed on that version's branch. */
  const took = (root: string, fix: FixReceipt, version: string) => {
    expect(fix).toMatchObject({ outcome: apply ? "applied" : "validated", candidate_passed: true, changes: [{ name: "lodash", from: "4.17.20", to: version }] });
    expect(fix.judgement).toMatchObject({ verdict: "ready_except_build", changes: [expect.objectContaining({ name: "lodash", from: "4.17.20", to: version })] });
    expect(fix.fix_published_at).toBe(LODASH.versions[version as keyof typeof LODASH.versions]);
    expect(fix.fix_published_note).toContain("The smallest fixed version was passed over (version_choice)");
    if (apply) {
      expect(fix.branch).toBe(`ludion/npm/lodash-${version}`);
      expect(JSON.parse(git(root, "show", `${fix.branch}:package.json`)).dependencies.lodash).toBe(version);
      expect(git(root, "log", "-1", "--format=%s", fix.commit!)).toBe(`ludion: lodash 4.17.20 -> ${version} (npm)`);
      expect(git(root, "branch", "--list", "ludion/*")).toBe(`ludion/npm/lodash-${version}`);
    } else expect(fix).toMatchObject({ branch: null, commit: null });
  };

  it("takes the next smallest when the smallest is deprecated, and keeps the smallest in the plan", async () => {
    const seen: string[] = [];
    const { root, result, fix, tested } = await run(registry({ lodash: LODASH }, one((_name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : {}), seen));
    expect(result.receipt?.outcome).toBe(apply ? "applied" : "validated");
    const jdalton = { publisher: "jdalton", provenance: null };
    expect(fix.version_choice).toEqual([{
      package: "lodash", smallest: "4.17.21", chosen: "4.17.22", skipped: [{ version: "4.17.21", reason: "deprecated: Bad release" }],
      publisher_check: { version: "4.17.22", smallest: jdalton, candidate: jdalton, result: "publisher", detail: "The same publisher account: 4.17.21 has no provenance and was published by the npm account jdalton; 4.17.22 has no provenance and was published by the npm account jdalton." },
      note: expect.stringContaining("cannot be used (deprecated: Bad release). 4.17.22 is the next smallest 4.x version the registry lists that is not deprecated and that no OSV record names, so it is taken instead. The same publisher account: "),
    }]);
    took(root, fix, "4.17.22");
    expect(tested).toEqual(["baseline", "candidate-1"]);
    // The scan's plan, in the receipt, still names the smallest fixed version.
    expect(result.receipt?.before.plan).toEqual([{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: [advisory.id] }]);
    // OSV was asked about the listed versions that are not deprecated, by name and version only.
    expect(batches(seen)[0]).toEqual(["lodash@4.17.22", "lodash@4.17.23"]);
  });
  /** The fix stopped at gate 2 by the publisher check: no validation, no test, no branch, the smallest still in `changes`. */
  const stoppedBy = (root: string, result: Awaited<ReturnType<typeof run>>["result"], fix: FixReceipt, tested: string[], detail: string) => {
    expect(fix.version_choice).toEqual([expect.objectContaining({ smallest: "4.17.21", chosen: null, publisher_check: expect.objectContaining({ version: "4.17.22", result: "stop", detail }) })]);
    expect(fix.version_choice?.[0]?.note).toContain("4.17.22 is the next smallest 4.x version the registry lists that is not deprecated and that no OSV record names, but it is not taken, and this fix stops: it must come from the same publisher account or provenance repository and workflow as 4.17.21 (docs/decisions/2026-10-30-next-fix-same-publisher.md).");
    expect(fix).toMatchObject({ outcome: "failed", changes: [{ to: "4.17.21" }], branch: null, commit: null, candidate_passed: false });
    expect(fix.reason).toBe(`Gate 2 stops this fix: ${fix.version_choice?.[0]?.note}`);
    expect(fix.reason).toContain(detail);
    expect(fix.judgement).toBeUndefined();
    expect(result.receipt?.outcome).toBe("failed");
    // The only fix stopped before any Docker work: no baseline either.
    expect(tested).toEqual([]);
    if (apply) expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  };
  it("stops when the registry no longer lists the smallest, as there is no publisher or provenance to compare", async () => {
    const npm = registry({ lodash: LODASH }, one());
    const fetchFn: typeof fetch = async (url, init) => {
      const r = await npm(url, init);
      if (String(url) !== "https://registry.npmjs.org/lodash") return r;
      const doc = await r.json(); delete doc.versions["4.17.21"];
      return response(doc);
    };
    const { root, result, fix, tested } = await run(fetchFn);
    expect(fix.version_choice?.[0]?.skipped).toEqual([{ version: "4.17.21", reason: "no longer listed by the registry (unpublished or withdrawn)" }]);
    stoppedBy(root, result, fix, tested, "4.17.21 is no longer listed by the registry, so there is no publisher or provenance to compare 4.17.22 with.");
  });
  it("stops when the version that qualifies was published by another account", async () => {
    const { root, result, fix, tested } = await run(registry({ lodash: LODASH }, one((_name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : version === "4.17.22" ? { _npmUser: { name: "mallory" } } : {})));
    stoppedBy(root, result, fix, tested, "The publishers differ, or one is no single account: 4.17.21 has no provenance and was published by the npm account jdalton; 4.17.22 has no provenance and was published by the npm account mallory.");
    expect(fix.version_choice?.[0]?.publisher_check).toMatchObject({ smallest: { publisher: "jdalton", provenance: null }, candidate: { publisher: "mallory", provenance: null } });
  });
  it("stops when the publisher and provenance cannot be read", async () => {
    // 4.17.22 has an attestation record, which this registry does not serve (HTTP 404).
    const { root, result, fix, tested } = await run(registry({ lodash: LODASH }, one((name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : version === "4.17.22" ? { dist: { integrity: integrityOf(name, version), attestations: { url: "x" } } } : {})));
    stoppedBy(root, result, fix, tested, "The publishers and provenance of 4.17.21 and 4.17.22 could not be read (registry.npmjs.org answered HTTP 404.).");
  });
  it("keeps the gate 2 stop as the reason when a branch of the smallest's name already exists", async () => {
    const root = fixture(), head = commit(root);
    git(root, "branch", "ludion/npm/lodash-4.17.21");
    const result = await patchDependencies(root, apply, { fetchFn: registry({ lodash: LODASH }, one((_name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : version === "4.17.22" ? { _npmUser: { name: "mallory" } } : {})), client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.fixes[0]).toMatchObject({ outcome: "failed", branch: null, commit: null });
    expect(result.receipt?.fixes[0]?.reason).toMatch(/^Gate 2 stops this fix: .*The publishers differ/);
    expect(git(root, "rev-parse", "ludion/npm/lodash-4.17.21")).toBe(head);
  });
  it.each<[string, () => Record<string, Advisory>, string]>([
    ["has an OSV MAL- record", () => ({ "lodash@4.17.21": mal }), "in OSV's malicious-package records (MAL-2026-0009)"],
    ["is named by another advisory", () => ({ "lodash@4.17.21": later }), "OSV names it in GHSA-test-0009"],
  ])("takes the next smallest when the smallest %s", async (_label, found, reason) => {
    const { root, fix } = await run(registry({ lodash: LODASH }, one(), [], { ...VULNERABLE, ...found() }));
    expect(fix.version_choice?.[0]).toMatchObject({ smallest: "4.17.21", chosen: "4.17.22", skipped: [{ version: "4.17.21", reason }] });
    took(root, fix, "4.17.22");
  });
  it("passes over every version that cannot be used, and looks only at later stable versions of the same major", async () => {
    const seen: string[] = [];
    const docs = { lodash: { ...LODASH, versions: { ...LODASH.versions, "4.17.22-rc.1": "2021-02-25T00:00:00.000Z", "5.0.0": "2021-02-26T00:00:00.000Z", "4.17.19": "2020-07-01T00:00:00.000Z" } } };
    const { root, fix } = await run(registry(docs, one((_name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : {}), seen, { ...VULNERABLE, "lodash@4.17.22": mal }));
    expect(fix.version_choice?.[0]).toMatchObject({ chosen: "4.17.23", skipped: [{ version: "4.17.21", reason: "deprecated: Bad release" }, { version: "4.17.22", reason: "in OSV's malicious-package records (MAL-2026-0009)" }] });
    took(root, fix, "4.17.23");
    expect(batches(seen)[0]).toEqual(["lodash@4.17.22", "lodash@4.17.23"]);
  });
  it("keeps the smallest, which then stops as before, when no later same-major version qualifies", async () => {
    const docs = { lodash: { ...LODASH, versions: { ...LODASH.versions, "5.0.0": "2021-02-26T00:00:00.000Z" } } };
    const { root, result, fix, tested } = await run(registry(docs, one((_name, version) => ["4.17.21", "4.17.22"].includes(version) ? { deprecated: "Bad release" } : {}), [], { ...VULNERABLE, "lodash@4.17.23": later }));
    expect(fix.version_choice).toEqual([{ package: "lodash", smallest: "4.17.21", chosen: null, skipped: [{ version: "4.17.21", reason: "deprecated: Bad release" }, { version: "4.17.22", reason: "deprecated: Bad release" }, { version: "4.17.23", reason: "OSV names it in GHSA-test-0009" }], note: expect.stringContaining("no later 4.x version qualifies (2 looked at); the smallest stays") }]);
    expect(result.receipt?.outcome).toBe("failed");
    expect(fix).toMatchObject({ outcome: "failed", changes: [{ to: "4.17.21" }], branch: null, commit: null });
    expect(fix.reason).toContain("The judge stops the candidate: gate 2: lodash@4.17.21 is deprecated: Bad release");
    expect(tested).toEqual(["baseline"]);
    if (apply) expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  });
  it("keeps the smallest when the check cannot be made, and the judge checks it again", async () => {
    // The first OSV batch (the check's) fails; the judge's own lookups work.
    const failFirst = (inner: typeof fetch): typeof fetch => { let calls = 0; return async (url, init) => String(url) === "https://api.osv.dev/v1/querybatch" && calls++ === 0 ? new Response("", { status: 503 }) : inner(url, init); };
    const ok = await run(failFirst(registry({ lodash: LODASH }, one())));
    expect(ok.fix.version_choice).toEqual([{ package: "lodash", smallest: "4.17.21", chosen: null, skipped: [], note: expect.stringContaining("could not be read (api.osv.dev answered HTTP 503.); it stays, and the judge checks it again.") }]);
    expect(ok.fix).toMatchObject({ outcome: apply ? "applied" : "validated", changes: [{ to: "4.17.21" }] });
    expect(ok.fix.fix_published_note).not.toContain("passed over");
    // A deprecated smallest that the check could not see is still stopped by the judge.
    const stopped = await run(failFirst(registry({ lodash: LODASH }, one((_name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : {}))));
    expect(stopped.fix).toMatchObject({ outcome: "failed", changes: [{ to: "4.17.21" }], branch: null });
    expect(stopped.fix.reason).toContain("lodash@4.17.21 is deprecated: Bad release");
  });
  it("replaces only the change whose smallest cannot be used, when one fix has two changes of the package", async () => {
    const { root, osv, npm } = twoCopies(one((_name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : {}));
    const result = await patchDependencies(root, apply, { fetchFn: npm, client: osv, command: fakeCommand(), testRun: async () => {} });
    const fix = result.receipt!.fixes[0]!;
    expect(fix.changes.map(c => [c.from, c.to])).toEqual([["4.17.20", "4.17.22"], ["3.10.0", "3.10.2"]]);
    expect(fix.version_choice).toEqual([expect.objectContaining({ smallest: "4.17.21", chosen: "4.17.22" })]);
    expect(result.receipt?.before.plan.map(c => [c.from, c.to])).toEqual([["4.17.20", "4.17.21"], ["3.10.0", "3.10.2"]]);
  });
  it("adds the passed-over sentence to fix_published_note only when a publish time was read", async () => {
    const npm = registry({ lodash: LODASH }, one((_name, version) => version === "4.17.21" ? { deprecated: "Bad release" } : {}));
    // The registry lists 4.17.22 but gives no publish time for it.
    const fetchFn: typeof fetch = async (url, init) => {
      const r = await npm(url, init);
      if (String(url) !== "https://registry.npmjs.org/lodash") return r;
      const doc = await r.json(); delete doc.time["4.17.22"];
      return response(doc);
    };
    const { fix } = await run(fetchFn);
    expect(fix.version_choice?.[0]).toMatchObject({ chosen: "4.17.22" });
    expect(fix.fix_published_at).toBeNull();
    expect(fix.fix_published_note).toBe("Not found: the registry gives no publish time for lodash@4.17.22.");
  });
  it("records nothing when the smallest can be used", async () => {
    const { root, fix } = await run(registry({ lodash: LODASH }, one()));
    expect(fix.version_choice).toBeUndefined();
    expect(fix).toMatchObject({ outcome: apply ? "applied" : "validated", changes: [{ to: "4.17.21" }] });
    expect(fix.fix_published_note).not.toContain("passed over");
    if (apply) expect(git(root, "branch", "--list", "ludion/*")).toBe("ludion/npm/lodash-4.17.21");
  });
});

describe("the next smallest fix is npm only", () => {
  it("looks nothing up for a Composer fix", async () => {
    const root = mkdtempSync(join(tmpdir(), "ludion-dependency-test-")), seen: string[] = [];
    writeFileSync(join(root, "composer.json"), JSON.stringify({ require: { "vendor/lib": "1.0.0" } }));
    writeFileSync(join(root, "composer.lock"), JSON.stringify({ packages: [{ name: "vendor/lib", version: "1.0.0" }] }));
    writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ schema: 1, ecosystem: "composer", test: ["php", "test.php"], timeout_seconds: 30 }));
    const lib: Advisory = { ...advisory, id: "GHSA-test-0010", affected: [{ package: { ecosystem: "Packagist", name: "vendor/lib" }, ranges: [{ events: [{ fixed: "1.0.1" }] }] }] };
    const osv = new OsvClient(async (url, init) => {
      if (String(url).startsWith("https://packagist.org/")) return response({ advisories: [] });
      if (String(url).includes("/vulns/")) return response(lib);
      return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => q.version === "1.0.0" ? { vulns: [{ id: lib.id }] } : {}) });
    });
    const result = await patchDependencies(root, false, { client: osv, fetchFn: async url => { seen.push(String(url)); return new Response("", { status: 404 }); }, command: async () => { throw new Error("no Docker in this test"); }, testRun: async () => {} });
    expect(result.scan.plan).toEqual([{ name: "vendor/lib", from: "1.0.0", to: "1.0.1", advisories: [lib.id] }]);
    // The run stops later, at the acquisition policy (no distribution archive); nothing asked npm or OSV for a version list.
    expect(result.receipt?.reason).toContain("distribution archive");
    expect(result.receipt?.fixes[0]?.version_choice).toBeUndefined();
    expect(seen).toEqual([]);
  });
});

describe("nextFix", () => {
  /** Each object manifest published by one account (alice), so a version that qualifies passes the publisher check. */
  const doc = (versions: Record<string, object>) => response({ time: {}, versions: Object.fromEntries(Object.entries(versions).map(([v, m]) => [v, m && typeof m === "object" && !Array.isArray(m) ? { _npmUser: { name: "alice" }, ...m } : m])) });
  /** OSV's batch answers by version from `found`; a record is withdrawn when `withdrawn` names it. */
  const stub = (versions: Record<string, object | null | string>, found: Record<string, string[]> = {}, seen: string[] = [], withdrawn: string[] = []): typeof fetch => async (url, init) => {
    seen.push(String(url), init?.body === undefined ? "" : String(init.body));
    if (String(url) === "https://api.osv.dev/v1/querybatch") return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => found[q.version] ? { vulns: found[q.version]!.map(id => ({ id })) } : {}) });
    if (String(url).startsWith("https://api.osv.dev/v1/vulns/")) {
      const id = decodeURIComponent(String(url).slice("https://api.osv.dev/v1/vulns/".length));
      return response({ id, affected: [{ package: { ecosystem: "npm", name: "tiny" } }], ...(withdrawn.includes(id) ? { withdrawn: "2026-10-01T00:00:00Z" } : {}) });
    }
    return String(url) === "https://registry.npmjs.org/tiny" ? doc(versions as Record<string, object>) : new Response("", { status: 404 });
  };
  const queried = (seen: string[]) => seen.filter(s => s.startsWith('{"queries"')).map(s => JSON.parse(s).queries.map((q: any) => q.version));
  it("stays in the same minor below 1.0.0", async () => {
    const choice = await nextFix("tiny", "0.3.2", stub({ "0.3.2": { deprecated: "Bad release" }, "0.3.3": { deprecated: "also bad" }, "0.4.0": {} }));
    expect(choice).toMatchObject({ chosen: null, skipped: [{ version: "0.3.2" }, { version: "0.3.3", reason: "deprecated: also bad" }], note: expect.stringContaining("no later 0.3 version qualifies (1 looked at)") });
    expect((await nextFix("tiny", "0.3.2", stub({ "0.3.2": { deprecated: "Bad release" }, "0.3.10": {}, "0.3.3": { deprecated: "x" } })))?.chosen).toBe("0.3.10");
  });
  it("looks at no more than NEXT_FIX_LIMIT later versions", async () => {
    const versions: Record<string, object> = { "1.0.0": { deprecated: "Bad release" } };
    for (let patch = 1; patch <= NEXT_FIX_LIMIT + 5; patch++) versions[`1.0.${patch}`] = { deprecated: "Bad release" };
    versions["1.1.0"] = {};
    const choice = await nextFix("tiny", "1.0.0", stub(versions));
    expect(choice).toMatchObject({ chosen: null, note: expect.stringContaining(`(${NEXT_FIX_LIMIT} looked at of ${NEXT_FIX_LIMIT + 6})`) });
    expect(choice?.skipped).toHaveLength(NEXT_FIX_LIMIT + 1);
  });
  it("writes a deprecation message as one line of at most 200 characters", async () => {
    const choice = await nextFix("tiny", "1.0.0", stub({ "1.0.0": { deprecated: `line one\nline two\u001b[31m${"x".repeat(300)}` }, "1.0.1": {} }));
    expect(choice?.skipped[0]?.reason).toBe(`deprecated: ${`line one line two [31m${"x".repeat(300)}`.slice(0, 200)}`);
    expect(choice?.chosen).toBe("1.0.1");
  });
  it("returns null for a usable smallest, asking OSV about the smallest alone, and sends only the package's name and versions", async () => {
    const seen: string[] = [];
    expect(await nextFix("tiny", "1.0.0", stub({ "1.0.0": {}, "1.0.1": {}, "2.0.0": {} }, {}, seen))).toBeNull();
    expect(seen.filter(s => s.startsWith("{"))).toEqual([JSON.stringify({ queries: [{ package: { ecosystem: "npm", name: "tiny" }, version: "1.0.0" }] })]);
  });
  it("asks OSV about later versions only after the smallest cannot be used", async () => {
    const seen: string[] = [];
    expect((await nextFix("tiny", "1.0.0", stub({ "1.0.0": {}, "1.0.1": {}, "1.0.2": { deprecated: "x" } }, { "1.0.0": ["GHSA-tiny-0001"] }, seen)))?.chosen).toBe("1.0.1");
    expect(queried(seen)).toEqual([["1.0.0"], ["1.0.1"]]);
  });
  it("does not count a record OSV marks withdrawn, as OsvClient.scan does not", async () => {
    // Only a withdrawn record names the smallest: it can be used.
    const seen: string[] = [];
    expect(await nextFix("tiny", "1.0.0", stub({ "1.0.0": {}, "1.0.1": {} }, { "1.0.0": ["MAL-2026-0100"] }, seen, ["MAL-2026-0100"]))).toBeNull();
    expect(seen).toContain("https://api.osv.dev/v1/vulns/MAL-2026-0100");
    // A later version named only by a withdrawn record is taken; one named by a record still in force is not.
    const choice = await nextFix("tiny", "1.0.0", stub({ "1.0.0": { deprecated: "Bad release" }, "1.0.1": {}, "1.0.2": {} }, { "1.0.1": ["GHSA-tiny-0002", "GHSA-tiny-0003"], "1.0.2": ["GHSA-tiny-0003"] }, [], ["GHSA-tiny-0003"]));
    expect(choice).toMatchObject({ chosen: "1.0.2", skipped: [{ version: "1.0.0" }, { version: "1.0.1", reason: "OSV names it in GHSA-tiny-0002" }] });
    // A record that cannot be read throws, so the smallest stays.
    await expect(nextFix("tiny", "1.0.0", async (url, init) => String(url).includes("/vulns/") ? new Response("", { status: 503 }) : stub({ "1.0.0": {} }, { "1.0.0": ["GHSA-tiny-0004"] })(url, init))).rejects.toThrow("OSV lookup failed (HTTP 503)");
  });
  it.each([null, "1.0.1", 7, []])("throws when a version's manifest is not an object (%j), as nothing about it can be judged", async manifest => {
    await expect(nextFix("tiny", "1.0.0", stub({ "1.0.0": { deprecated: "Bad release" }, "1.0.1": manifest as any }))).rejects.toThrow("Invalid registry manifest for tiny@1.0.1");
  });
  it("throws on a failed lookup, a bad registry document or a version that is not semver", async () => {
    await expect(nextFix("tiny", "1.0.0", async () => new Response("", { status: 503 }))).rejects.toThrow("registry.npmjs.org answered HTTP 503");
    await expect(nextFix("tiny", "1.0.0", async () => response({ versions: [] }))).rejects.toThrow("Invalid registry document for tiny");
    await expect(nextFix("tiny", "1.0.0", async url => String(url).includes("osv") ? response({ results: [] }) : doc({ "1.0.0": {} }))).rejects.toThrow("OSV batch result count mismatch");
    await expect(nextFix("tiny", "latest", stub({}))).rejects.toThrow("not a semver version");
    await expect(nextFix("../x", "1.0.0", stub({}))).rejects.toThrow("Invalid npm package name");
  });
  it("throws, so the smallest stays, when OSV's batch item is not an answer", async () => {
    for (const item of [null, 7, { vulnerabilities: [] }, { vulns: null }]) {
      await expect(nextFix("tiny", "1.0.0", async (url, init) => String(url) === "https://api.osv.dev/v1/querybatch" ? response({ results: [item] }) : stub({ "1.0.0": { deprecated: "Bad release" }, "1.0.1": {} })(url, init))).rejects.toThrow("Invalid OSV batch item");
    }
  });
});

describe("the next smallest fix's publisher check (docs/decisions/2026-10-30-next-fix-same-publisher.md)", () => {
  const release = { repository: "https://github.com/acme/tiny", workflow: ".github/workflows/release.yml" };
  /** tiny 1.0.0 is deprecated; 1.0.1 qualifies. `smallest` and `next` are their manifests' other fields. */
  const check = async (smallest: object, next: object, fetchFn?: (inner: typeof fetch) => typeof fetch) => {
    const seen: string[] = [];
    const versions = { "1.0.0": { deprecated: "Bad release", ...smallest }, "1.0.1": next };
    const inner: typeof fetch = async url => {
      seen.push(String(url));
      if (String(url) === "https://api.osv.dev/v1/querybatch") return response({ results: [{}] });
      const attested = /\/attestations\/tiny@(.+)$/.exec(String(url));
      if (attested) {
        const m = versions[attested[1] as "1.0.0"] as any, sha512 = Buffer.from(integrityOf("tiny", attested[1]!).slice(7), "base64").toString("hex");
        const statement = { subject: [{ name: `pkg:npm/tiny@${m.subject ?? attested[1]}`, digest: { sha512 } }], predicate: { buildDefinition: { externalParameters: { workflow: { repository: m.provenance.repository, path: m.provenance.workflow } }, resolvedDependencies: [{ digest: { gitCommit: (attested[1] === "1.0.0" ? "a" : "b").repeat(40) } }] } } };
        return response({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] });
      }
      return response({ time: {}, versions: Object.fromEntries(Object.entries(versions).map(([v, m]) => [v, { _npmUser: { name: "alice" }, dist: { integrity: integrityOf("tiny", v), ...("provenance" in m ? { attestations: { url: "x" } } : {}) }, ...m }])) });
    };
    const choice = await nextFix("tiny", "1.0.0", fetchFn ? fetchFn(inner) : inner);
    return { choice: choice!, check: choice!.publisher_check!, seen };
  };
  const stops = (choice: VersionChoice, detail: string) => {
    expect(choice).toMatchObject({ chosen: null, publisher_check: { version: "1.0.1", result: "stop", detail } });
    expect(choice.note).toContain("1.0.1 is the next smallest 1.x version the registry lists that is not deprecated and that no OSV record names, but it is not taken, and this fix stops");
    expect(choice.note).toContain(detail);
  };
  it("takes the version when both have provenance from the same repository and workflow, from different commits", async () => {
    const { choice, check: c } = await check({ provenance: release }, { provenance: release });
    expect(choice.chosen).toBe("1.0.1");
    expect(c).toEqual({ version: "1.0.1", smallest: { publisher: "alice", provenance: { ...release, commit: "a".repeat(40) } }, candidate: { publisher: "alice", provenance: { ...release, commit: "b".repeat(40) } }, result: "provenance", detail: "The same provenance repository and workflow: 1.0.0 has provenance from repository https://github.com/acme/tiny, workflow .github/workflows/release.yml; 1.0.1 has provenance from repository https://github.com/acme/tiny, workflow .github/workflows/release.yml." });
    // With provenance on both, the publisher account is not what is compared: trusted publishing's shared user is fine.
    const oidc = { _npmUser: { name: "GitHub Actions", email: "npm-oidc-no-reply@github.com", trustedPublisher: { id: "github" } } };
    expect((await check({ provenance: release, ...oidc }, { provenance: release, ...oidc })).choice.chosen).toBe("1.0.1");
  });
  it("takes the version when neither has provenance and the same account published both", async () => {
    const { choice, check: c, seen } = await check({}, {});
    expect(choice.chosen).toBe("1.0.1");
    expect(c).toMatchObject({ result: "publisher", smallest: { publisher: "alice", provenance: null }, candidate: { publisher: "alice", provenance: null } });
    // Only the registry is asked, by package name and version.
    expect(seen.filter(u => u.startsWith("https://registry.npmjs.org/"))).toEqual(["https://registry.npmjs.org/tiny", "https://registry.npmjs.org/tiny"]);
  });
  it("stops when another account published it", async () => {
    stops((await check({}, { _npmUser: { name: "mallory" } })).choice, "The publishers differ, or one is no single account: 1.0.0 has no provenance and was published by the npm account alice; 1.0.1 has no provenance and was published by the npm account mallory.");
  });
  it("stops when either is trusted publishing's shared user without provenance, which is no account", async () => {
    const oidc = { _npmUser: { name: "GitHub Actions", email: "npm-oidc-no-reply@github.com", trustedPublisher: { id: "github" } } };
    stops((await check(oidc, oidc)).choice, "The publishers differ, or one is no single account: 1.0.0 has no provenance and was published by no single account (none, or trusted publishing's shared user); 1.0.1 has no provenance and was published by no single account (none, or trusted publishing's shared user).");
    expect((await check({}, oidc)).check.result).toBe("stop");
    expect((await check({}, { _npmUser: undefined })).check.result).toBe("stop");
  });
  it("stops when the provenance names another repository", async () => {
    stops((await check({ provenance: release }, { provenance: { ...release, repository: "https://github.com/mallory/tiny" } })).choice, "The provenance differs, or names no repository or workflow: 1.0.0 has provenance from repository https://github.com/acme/tiny, workflow .github/workflows/release.yml; 1.0.1 has provenance from repository https://github.com/mallory/tiny, workflow .github/workflows/release.yml.");
  });
  it("stops when the provenance names another workflow", async () => {
    stops((await check({ provenance: release }, { provenance: { ...release, workflow: ".github/workflows/other.yml" } })).choice, "The provenance differs, or names no repository or workflow: 1.0.0 has provenance from repository https://github.com/acme/tiny, workflow .github/workflows/release.yml; 1.0.1 has provenance from repository https://github.com/acme/tiny, workflow .github/workflows/other.yml.");
  });
  it("stops when only one of the two has provenance, either way round, even from the same account", async () => {
    stops((await check({ provenance: release }, {})).choice, "Only one of the two has provenance: 1.0.0 has provenance from repository https://github.com/acme/tiny, workflow .github/workflows/release.yml; 1.0.1 has no provenance and was published by the npm account alice.");
    stops((await check({}, { provenance: release })).choice, "Only one of the two has provenance: 1.0.0 has no provenance and was published by the npm account alice; 1.0.1 has provenance from repository https://github.com/acme/tiny, workflow .github/workflows/release.yml.");
  });
  it("stops when the provenance cannot be read or does not name its version and tarball", async () => {
    const failing = (inner: typeof fetch): typeof fetch => async (url, init) => String(url).includes("/attestations/") ? new Response("", { status: 503 }) : inner(url, init);
    stops((await check({ provenance: release }, { provenance: release }, failing)).choice, "The publishers and provenance of 1.0.0 and 1.0.1 could not be read (registry.npmjs.org answered HTTP 503.).");
    expect((await check({ provenance: release }, { provenance: release }, failing)).check).toMatchObject({ smallest: null, candidate: null });
    stops((await check({ provenance: release }, { provenance: release, subject: "1.0.9" })).choice, "The publishers and provenance of 1.0.0 and 1.0.1 could not be read (The provenance statement does not name tiny@1.0.1 and its tarball.).");
    // The registry fails on the second read of the package document, after the version list was read.
    let reads = 0;
    const second = (inner: typeof fetch): typeof fetch => async (url, init) => String(url) === "https://registry.npmjs.org/tiny" && reads++ === 1 ? new Response("", { status: 500 }) : inner(url, init);
    stops((await check({}, {}, second)).choice, "The publishers and provenance of 1.0.0 and 1.0.1 could not be read (registry.npmjs.org answered HTTP 500.).");
  });
  it("stops when a provenance record names no repository or workflow, even on both", () => {
    const none = { publisher: "alice", provenance: { repository: null, workflow: null, commit: null } };
    expect(comparePublishers("1.0.0", none, "1.0.1", none).result).toBe("stop");
    const noWorkflow = { publisher: "alice", provenance: { repository: release.repository, workflow: null, commit: null } };
    expect(comparePublishers("1.0.0", noWorkflow, "1.0.1", noWorkflow).result).toBe("stop");
    expect(comparePublishers("1.0.0", null, "1.0.1", none)).toEqual({ result: "stop", detail: "1.0.0 is no longer listed by the registry, so there is no publisher or provenance to compare 1.0.1 with." });
    expect(comparePublishers("1.0.0", none, "1.0.1", null).result).toBe("stop");
    // Registry text is made one line of at most 200 characters.
    const odd = { publisher: `eve\n${"x".repeat(300)}`, provenance: null };
    expect(comparePublishers("1.0.0", odd, "1.0.1", { publisher: "alice", provenance: null }).detail).toContain(`the npm account ${`eve ${"x".repeat(300)}`.slice(0, 200)};`);
  });
});
