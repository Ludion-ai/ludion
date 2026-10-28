import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import semver from "semver";
import { acquisitionPolicy, applyFiles, compatible, patchDependencies, resolverDockerfile } from "../src/security/dependency-patch.ts";
import { acquisitionPom, localComposerLock, MAVEN_SETTINGS, publicArchiveUrl } from "../src/security/acquisition.ts";
import { changedManifest, inventory, mavenGraph, parsePom, type Inventory } from "../src/security/inventory.ts";
import { OsvClient, type Advisory } from "../src/security/osv.ts";
import { privateState, snapshot } from "../src/security/project.ts";
import { scanProject } from "../src/security/scan.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;
const lock = (version = "4.17.20") => ({ lockfileVersion: 3, packages: { "": { dependencies: { lodash: version } }, "node_modules/lodash": { version, resolved: `https://registry.npmjs.org/lodash/-/lodash-${version}.tgz` } } });
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
      writeFileSync(join(dest, "package.json"), JSON.stringify(manifest));
      // Baseline must be byte-identical; candidate represents npm's produced resolution.
      if (dest.endsWith("baseline-export")) writeFileSync(join(dest, "package-lock.json"), readFileSync(join(context, "manifests/package-lock.json")));
      else writeFileSync(join(dest, "package-lock.json"), JSON.stringify(lock(semver.minVersion(manifest.dependencies.lodash)!.version)));
    }
    return "";
  };
}

describe("dependency patch gates and recoverable application", () => {
  it("refuses a lookalike official registry in tool-image evidence", async () => {
    const root = fixture(), before = snapshot(root), command = fakeCommand();
    const result = await patchDependencies(root, true, { client: client(), command: async args => args.includes("{{json .RepoDigests}}") ? JSON.stringify([`dockerXio/library/node@${DIGEST}`]) : command(args), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("digest is unavailable");
    expect(snapshot(root)).toBe(before);
  });
  it.each([false, true])("applies both dependency files only under explicit policy (apply=%s)", async apply => {
    const root = fixture(), before = snapshot(root);
    const tools: string[] = [];
    const result = await patchDependencies(root, apply, { client: client(), command: fakeCommand(), testRun: async (_name, _image, _command, _timeout, tool) => { tools.push(tool); } });
    expect(result.receipt?.outcome).toBe(apply ? "applied" : "validated");
    // Baseline and candidate tests both run with the npm tool's fixed scratch directories.
    expect(tools).toEqual(["npm", "npm"]);
    expect(result.receipt?.after?.findings).toEqual([]);
    expect(result.receipt?.files).toHaveLength(2);
    if (apply) expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies.lodash).toBe(">=4.17.21 <5.0.0");
    else expect(snapshot(root)).toBe(before);
    expect(existsSync(join(root, ".ludion/security/patch.lock"))).toBe(false);
  });
  it.each([1, 2])("keeps source unchanged when baseline/candidate test %s fails", async at => {
    const root = fixture(), before = snapshot(root); let count = 0;
    const result = await patchDependencies(root, true, { client: client(), command: fakeCommand(), testRun: async () => { if (++count === at) throw new Error("failure"); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(snapshot(root)).toBe(before);
  });
  it("refuses an application-compatible candidate that still has advisory findings", async () => {
    const root = fixture(), before = snapshot(root);
    const result = await patchDependencies(root, true, { client: client(true), command: fakeCommand(), testRun: async () => {} });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.reason).toContain("still contains"); expect(snapshot(root)).toBe(before);
  });
  it.each([false, true])("rejects source mutations even when not applying (apply=%s)", async apply => {
    const root = fixture(); let count = 0;
    const result = await patchDependencies(root, apply, { client: client(), command: fakeCommand(), testRun: async () => { if (++count === 2) mkdirSync(join(root, "new-empty-directory")); } });
    expect(result.receipt?.outcome).toBe("failed"); expect(result.receipt?.reason).toContain("Project changed");
  });
  it("does not apply after a received stop request", async () => {
    const root = fixture(), before = snapshot(root), abort = new AbortController(); let count = 0;
    const result = await patchDependencies(root, true, { signal: abort.signal, client: client(), command: fakeCommand(), testRun: async () => { if (++count === 2) abort.abort(); } });
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
    const file = resolverDockerfile("npm", `node@${DIGEST}`, true);
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
