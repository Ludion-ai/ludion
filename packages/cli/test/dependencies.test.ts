import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import semver from "semver";
import { acquisitionPolicy, applyFiles, candidateTimeCap, changedPackages, compatible, NPM_FINAL_MANIFEST, patchDependencies, resolverDockerfile, unplannedRemovals } from "../src/security/dependency-patch.ts";
import { acquisitionPom, localComposerLock, MAVEN_SETTINGS, publicArchiveUrl } from "../src/security/acquisition.ts";
import { changedManifest, inventory, mavenGraph, parsePom, raisedRequirement, type Inventory } from "../src/security/inventory.ts";
import { OsvClient, type Advisory } from "../src/security/osv.ts";
import { privateState, snapshot } from "../src/security/project.ts";
import { scanProject } from "../src/security/scan.ts";
import { packagistReleases, renderTimeCap } from "../src/security/time-cap.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;
/** The fixture registry's sha512 for a version's tarball (fixtures only, not a real hash). */
const integrityOf = (name: string, version: string) => `sha512-${Buffer.from(`${name}@${version}`.padEnd(64, "#")).toString("base64")}`;
const lock = (version = "4.17.20") => ({ lockfileVersion: 3, packages: { "": { dependencies: { lodash: version } }, "node_modules/lodash": { version, resolved: `https://registry.npmjs.org/lodash/-/lodash-${version}.tgz`, integrity: integrityOf("lodash", version) } } });
const advisory: Advisory = { id: "GHSA-test-0001", summary: "Example advisory", aliases: ["CVE-2026-0001"], affected: [{ package: { ecosystem: "npm", name: "lodash" }, ranges: [{ events: [{ fixed: "4.17.21" }] }] }] };
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
 * catalog and no EPSS scores.
 */
function registry(extra: Record<string, { created: string; versions: Record<string, string> }> = {}, manifest: (name: string, version: string) => object = () => ({})): typeof fetch {
  const docs: Record<string, { created: string; versions: Record<string, string> }> = { lodash: { created: "2012-04-23T16:37:11.912Z", versions: { "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": "2021-02-20T15:42:16.891Z" } }, ...extra };
  return async (url, init) => {
    const u = String(url);
    if (u === "https://api.osv.dev/v1/querybatch") return response({ results: JSON.parse(String(init?.body)).queries.map((q: any) => q.package.name === "lodash" && q.version === "4.17.20" ? { vulns: [{ id: advisory.id }] } : {}) });
    if (u.startsWith("https://api.osv.dev/v1/vulns/")) return response(advisory);
    if (u.startsWith("https://www.cisa.gov/")) return response({ vulnerabilities: [] });
    if (u.startsWith("https://api.first.org/")) return response({ data: [] });
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
        writeFileSync(join(dest, "package-lock.json"), JSON.stringify(lock(semver.minVersion(manifest.dependencies.lodash)!.version)));
      }
    }
    return "";
  };
}

describe("dependency patch gates and recoverable application", () => {
  it("refuses a lookalike official registry in tool-image evidence", async () => {
    const root = fixture(), before = snapshot(root), command = fakeCommand();
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: async args => args.includes("{{json .RepoDigests}}") ? JSON.stringify([`dockerXio/library/node@${DIGEST}`]) : command(args), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("digest is unavailable");
    expect(snapshot(root)).toBe(before);
  });
  it.each([false, true])("applies both dependency files only under explicit policy (apply=%s)", async apply => {
    const root = fixture(), before = snapshot(root);
    const tools: string[] = [];
    const result = await patchDependencies(root, apply, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async (_name, _image, _command, _timeout, tool) => { tools.push(tool); } });
    expect(result.receipt?.outcome).toBe(apply ? "applied" : "validated");
    // Baseline and candidate tests both run with the npm tool's fixed scratch directories.
    expect(tools).toEqual(["npm", "npm"]);
    expect(result.receipt?.after?.findings).toEqual([]);
    expect(result.receipt?.files).toHaveLength(2);
    // The judge's parts of gates 1, 2 and 4 and its wait found nothing to stop or wait for.
    expect(result.receipt?.judgement).toMatchObject({ verdict: "ready_except_build", urgency: "normal", fixes: [expect.objectContaining({ id: advisory.id, package: "lodash", from: "4.17.20", to: "4.17.21" })] });
    if (apply) expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies.lodash).toBe("4.17.21");
    else expect(snapshot(root)).toBe(before);
    expect(existsSync(join(root, ".ludion/security/patch.lock"))).toBe(false);
  });
  it.each([1, 2])("keeps source unchanged when baseline/candidate test %s fails", async at => {
    const root = fixture(), before = snapshot(root); let count = 0;
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => { if (++count === at) throw new Error("failure"); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(snapshot(root)).toBe(before);
  });
  it("refuses an application-compatible candidate that still has advisory findings", async () => {
    const root = fixture(), before = snapshot(root);
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(true), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.reason).toContain("still contains"); expect(snapshot(root)).toBe(before);
  });
  it.each([false, true])("rejects source mutations even when not applying (apply=%s)", async apply => {
    const root = fixture(); let count = 0;
    const result = await patchDependencies(root, apply, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => { if (++count === 2) mkdirSync(join(root, "new-empty-directory")); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.reason).toContain("Project changed");
  });
  it("does not apply after a received stop request", async () => {
    const root = fixture(), before = snapshot(root), abort = new AbortController(); let count = 0;
    const result = await patchDependencies(root, true, { signal: abort.signal, fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => { if (++count === 2) abort.abort(); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.reason).toContain("cancelled"); expect(snapshot(root)).toBe(before);
  });
  it("rolls back our first file if writing the second fails and records a journal", () => {
    const root = fixture(), state = privateState(root), before = snapshot(root); let count = 0;
    const files = ["package.json", "package-lock.json"].map(path => ({ path, before: readFileSync(join(root, path), "utf8"), after: "updated" }));
    expect(() => applyFiles(root, state, "rollback-case", files, (old, next) => { if (++count === 2) throw new Error("simulated disk failure"); renameSync(old, next); })).toThrow("rolled back");
    expect(snapshot(root)).toBe(before);
    expect(JSON.parse(readFileSync(join(state, "transaction-rollback-case/journal.json"), "utf8")).phase).toBe("rolled_back");
    expect(() => privateState(root)).not.toThrow();
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
    const before = snapshot(root);
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("moved packages that were not planned (other@1.0.0)");
    expect(result.receipt?.changed_packages).toEqual([{ name: "lodash", from: ["4.17.20"], to: ["4.17.21"] }, { name: "other", from: ["1.0.0"], to: [] }]);
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
      if (out?.endsWith("candidate-export")) writeFileSync(join(out.slice("type=local,dest=".length), "package.json"), JSON.stringify({ name: "test", dependencies: { lodash: "^4.17.21" } }));
      return output;
    } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("changed the manifest beyond the planned fix");
    const ok = await patchDependencies(fixture(), false, { fetchFn: registry(), client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(ok.receipt?.changed_packages).toEqual([{ name: "lodash", from: ["4.17.20"], to: ["4.17.21"] }]);
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

describe("the judge on npm candidates", () => {
  const lodash = (fix: object, published = "2021-02-20T15:42:16.891Z") => registry({ lodash: { created: "2012-04-23T16:37:11.912Z", versions: { "4.17.20": "2020-08-13T16:53:54.152Z", "4.17.21": published } } }, (_name, version) => version === "4.17.21" ? fix : {});
  it.each<[string, typeof fetch, string, string]>([
    ["a deprecated fix", lodash({ deprecated: "use 4.17.22" }), "stop", "The judge stops the candidate: gate 2: lodash@4.17.21 is deprecated: use 4.17.22"],
    ["a fix that adds an install script", lodash({ scripts: { postinstall: "node x.js" } }), "stop", "The judge stops the candidate: gate 2: lodash@4.17.21 adds install scripts: postinstall."],
    // 80h ago: past the normal 72h, inside the 144h a publisher change extends it to.
    ["a fix from another publisher", lodash({ _npmUser: { name: "someone-else" } }, new Date(Date.now() - 80 * 3_600_000).toISOString()), "wait", "The wait is extended: lodash@4.17.21 was published by someone-else, 4.17.20 by unknown."],
    ["a fix published an hour ago", lodash({}, new Date(Date.now() - 3_600_000).toISOString()), "wait", "The judge's wait is not over: not applied before "],
    ["a candidate whose OSV lookup fails", async (url, init) => String(url).startsWith("https://api.osv.dev/") ? new Response("", { status: 503 }) : registry()(url, init), "undecidable", "The judge cannot decide on the candidate: gate 2: A lookup failed: api.osv.dev answered HTTP 503."],
  ])("does not apply %s, and does not run the candidate's tests", async (_label, fetchFn, verdict, reason) => {
    const root = fixture(), before = snapshot(root); let tests = 0;
    const result = await patchDependencies(root, true, { fetchFn, client: client(), command: fakeCommand(), testRun: async () => { tests++; } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.judgement?.verdict).toBe(verdict);
    expect(result.receipt?.reason).toContain(reason);
    expect(result.receipt?.candidate_passed).toBe(false);
    expect(tests).toBe(1);
    expect(snapshot(root)).toBe(before);
  });
});

describe("the judge on npm candidates, when it throws", () => {
  it("fails the receipt and applies nothing", async () => {
    // Two lockfile paths that differ only in case: the inventory reads them, the judge's lockfile reader refuses them.
    const root = fixture(), withCase = lock() as any;
    withCase.packages["node_modules/other"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/other/-/other-1.0.0.tgz", integrity: integrityOf("other", "1.0.0") };
    withCase.packages["node_modules/Other"] = { ...withCase.packages["node_modules/other"] };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(withCase));
    const before = snapshot(root), command = fakeCommand(); let tests = 0;
    const result = await patchDependencies(root, true, { fetchFn: registry(), client: client(), testRun: async () => { tests++; }, command: async args => {
      const output = await command(args);
      const out = args.find(a => a.startsWith("type=local,dest="));
      if (out?.endsWith("candidate-export")) {
        const file = join(out.slice("type=local,dest=".length), "package-lock.json"), candidate = JSON.parse(readFileSync(file, "utf8"));
        Object.assign(candidate.packages, { "node_modules/other": withCase.packages["node_modules/other"], "node_modules/Other": withCase.packages["node_modules/Other"] });
        writeFileSync(file, JSON.stringify(candidate));
      }
      return output;
    } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toBe("Two package-lock paths differ only in case: node_modules/Other.");
    expect(result.receipt?.judgement).toBeUndefined();
    expect(tests).toBe(1);
    expect(snapshot(root)).toBe(before);
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
    const root = fixture(), snap = snapshot(root);
    const result = await patchDependencies(root, true, { fetchFn: noTime, client: client(), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("The time cap could not be checked: lodash@4.17.21 has no publish time");
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
