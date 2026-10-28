import { describe, expect, it } from "vitest";
import { workspaceDir, workspaceManifestChanges } from "../src/security/workspace-manifests.ts";

const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
const tarball = (name: string, version: string) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`, integrity: INTEGRITY, license: "MIT" });
const ROOT = { name: "ludion-repo", private: true, type: "module", workspaces: ["packages/*", "tools/*", "apps/*"], devDependencies: { vitest: "^4.1.12" } };

// #161's shape: apps/worker raises one range, and one locked version changes.
const worker = (hono: string) => ({ name: "@ludion/worker", version: "0.0.0", private: true, type: "module", dependencies: { hono }, devDependencies: { "@cloudflare/workers-types": "^5.20261007.1" } });
const workerLock = (hono: string, version: string) => ({
  "": { name: "ludion-repo", workspaces: ROOT.workspaces, devDependencies: ROOT.devDependencies },
  "apps/worker": { name: "@ludion/worker", version: "0.0.0", dependencies: { hono }, devDependencies: { "@cloudflare/workers-types": "^5.20261007.1" } },
  "node_modules/@ludion/worker": { resolved: "apps/worker", link: true },
  "node_modules/hono": tarball("hono", version),
});
const pr161 = (over: Partial<Parameters<typeof workspaceManifestChanges>[0]> = {}) => workspaceManifestChanges({
  file: "apps/worker/package.json", before: worker("^4.13.13"), after: worker("^4.13.14"),
  root: { before: ROOT, after: ROOT }, lock: { before: workerLock("^4.13.13", "4.13.13"), after: workerLock("^4.13.14", "4.13.14") }, ...over,
});

// #162's shape: apps/site raises one range, and many locked versions change (some added).
const SITE_DEPS = { "@fontsource-variable/jetbrains-mono": "^5.3.0", "@fontsource-variable/schibsted-grotesk": "^5.3.0", semver: "^7.8.5", three: "0.186.1" };
const site = (astro: string) => ({ name: "@ludion/site", version: "0.0.0", private: true, type: "module", scripts: { build: "astro build", dev: "astro dev" }, dependencies: { ...SITE_DEPS, astro } });
const siteLock = (astro: string, versions: Record<string, string>) => ({
  "": { name: "ludion-repo", workspaces: ROOT.workspaces },
  "apps/site": { name: "@ludion/site", version: "0.0.0", dependencies: { ...SITE_DEPS, astro } },
  "node_modules/@ludion/site": { resolved: "apps/site", link: true },
  ...Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, tarball(name, version)])),
});
const SITE_BEFORE = { astro: "7.3.6", "@astrojs/internal-helpers": "0.12.0", "unist-util-visit": "5.0.0" };
const SITE_AFTER = { astro: "7.4.2", "@astrojs/internal-helpers": "0.13.0", "unist-util-visit": "5.2.0", "unist-util-visit-parents": "6.1.0", "std-env": "4.1.0" };
const pr162 = (over: Partial<Parameters<typeof workspaceManifestChanges>[0]> = {}) => workspaceManifestChanges({
  file: "apps/site/package.json", before: site("^7.3.6"), after: site("^7.4.2"),
  root: { before: ROOT, after: ROOT }, lock: { before: siteLock("^7.3.6", SITE_BEFORE), after: siteLock("^7.4.2", SITE_AFTER) }, ...over,
});

describe("a workspace package.json that agrees with the lockfile", () => {
  it("is a dependency update: #161's and #162's shapes give no reason to stop", () => {
    expect(pr161()).toEqual([]);
    expect(pr162()).toEqual([]);
  });
  it("ignores the key order of a list and counts a missing list as empty", () => {
    const after = { ...site("^7.4.2"), dependencies: { astro: "^7.4.2", ...SITE_DEPS }, devDependencies: {} };
    expect(pr162({ after })).toEqual([]);
  });
  it("accepts an npm: alias of a registry range, a literal workspace entry and a ./ prefix", () => {
    const aliased = (spec: string) => ({ ...worker("^4.13.14"), dependencies: { hono: spec } });
    const lockAfter = { ...workerLock("^4.13.14", "4.13.14"), "apps/worker": { ...workerLock("^4.13.14", "4.13.14")["apps/worker"], dependencies: { hono: "npm:hono@^4.13.14" } } };
    expect(pr161({ after: aliased("npm:hono@^4.13.14"), lock: { before: workerLock("^4.13.13", "4.13.13"), after: lockAfter } })).toEqual([]);
    for (const workspaces of [["apps/worker"], ["./apps/*"], ["apps/*/"]]) {
      const root = { ...ROOT, workspaces };
      expect(pr161({ root: { before: root, after: root } }), workspaces[0]).toEqual([]);
    }
  });
});

describe("a workspace package.json that does not agree with the lockfile stops", () => {
  it("rule 1: a folder that is not plain, or that the root's workspaces do not name on both sides", () => {
    for (const file of ["package.json", "node_modules/hono/package.json", "apps/../apps/worker/package.json", "./apps/worker/package.json", "apps/worker/package.json.bak", "apps\\worker/package.json"]) {
      expect(workspaceDir(file), file).toBeNull();
      expect(pr161({ file }), file).toEqual([expect.stringContaining("is not the package.json of a plain workspace folder")]);
    }
    expect(pr161({ file: "examples/npm-security/package.json" })).toEqual([expect.stringContaining("is not a workspace that the root package.json")]);
    for (const workspaces of [["apps/**"], ["apps/w*"], ["apps/?orker"], ["apps/{worker,site}"], ["!apps/site"], "apps/*", { packages: ["apps/*"] }]) {
      const root = { ...ROOT, workspaces };
      expect(pr161({ root: { before: root, after: root } }), JSON.stringify(workspaces)).toEqual([expect.stringContaining("is not a workspace that the root package.json")]);
    }
    expect(pr161({ root: { before: { ...ROOT, workspaces: ["packages/*"] }, after: ROOT } })).toEqual([expect.stringContaining("is not a workspace that the root package.json")]);
  });
  it("rule 2: a workspace the lockfile does not record before and after", () => {
    const { "apps/worker": _, ...unrecorded } = workerLock("^4.13.13", "4.13.13");
    expect(pr161({ lock: { before: unrecorded, after: workerLock("^4.13.14", "4.13.14") } })).toEqual(["The lockfile does not record the workspace apps/worker both before and after."]);
    expect(pr161({ lock: { before: workerLock("^4.13.13", "4.13.13"), after: { ...unrecorded, "node_modules/hono": tarball("hono", "4.13.14") } } })).toEqual(["The lockfile does not record the workspace apps/worker both before and after."]);
  });
  it("rule 3: a side that is missing or not an object, a field other than the dependency lists, a spec outside the registry, overrides", () => {
    expect(pr161({ before: undefined })).toEqual(["apps/worker/package.json is not a JSON object on both sides (before and after)."]);
    expect(pr161({ after: [] })).toEqual(["apps/worker/package.json is not a JSON object on both sides (before and after)."]);
    expect(pr162({ after: { ...site("^7.4.2"), scripts: { build: "astro build", postinstall: "node x.js" } } })).toEqual(['apps/site/package.json changes "scripts", which is not a dependency list (scripts, for one, run on install).']);
    for (const spec of ["github:evil/hono", "file:../hono", "https://example.com/hono.tgz", "workspace:*"]) {
      expect(pr161({ after: worker(spec), lock: { before: workerLock("^4.13.13", "4.13.13"), after: workerLock(spec, "4.13.14") } }), spec).toEqual([`apps/worker/package.json dependencies.hono is "${spec}", not a registry range.`]);
    }
    expect(pr161({ after: { ...worker("^4.13.14"), overrides: { hono: "4.13.14" } } })).toEqual(['apps/worker/package.json changes "overrides", which npm reads only in the root package.json; the lockfile cannot show it.']);
  });
  it("rule 4: a dependency list that is not the lockfile's record, after or before", () => {
    // Dependabot raised the range in package.json but the lockfile still records the old one.
    expect(pr161({ lock: { before: workerLock("^4.13.13", "4.13.13"), after: workerLock("^4.13.13", "4.13.14") } })).toEqual(["After the change, apps/worker/package.json dependencies is not the lockfile's record of apps/worker."]);
    // A dependency added to package.json only.
    expect(pr162({ after: { ...site("^7.4.2"), devDependencies: { "left-pad": "^1.3.0" } } })).toEqual(["After the change, apps/site/package.json devDependencies is not the lockfile's record of apps/site."]);
    expect(pr161({ before: worker("^4.0.0") })).toEqual(["Before the change, apps/worker/package.json dependencies is not the lockfile's record of apps/worker."]);
  });
  it("rule 5: the lockfile's record of the workspace changes more than the dependency lists", () => {
    const lockAfter = workerLock("^4.13.14", "4.13.14");
    const record = { ...lockAfter["apps/worker"], bin: { worker: "x.js" } };
    expect(pr161({ lock: { before: workerLock("^4.13.13", "4.13.13"), after: { ...lockAfter, "apps/worker": record } } })).toEqual(['The lockfile\'s record of apps/worker changes "bin", which is not a dependency list.']);
  });
});
