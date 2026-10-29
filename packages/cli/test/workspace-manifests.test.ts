import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { allChanges, judge, lockEntries, lockEntryChanges, manifestChanges, type Change, type Judgement, type VersionFacts } from "../src/security/judge.ts";
import { judgeCli, workspaceManifests } from "../src/security/judge-cli.ts";
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
    for (const workspaces of [["apps/**"], ["apps/w*"], ["apps/?orker"], ["apps/{worker,site}"], "apps/*", { packages: ["apps/*"] }]) {
      const root = { ...ROOT, workspaces };
      expect(pr161({ root: { before: root, after: root } }), JSON.stringify(workspaces)).toEqual([expect.stringContaining("is not a workspace that the root package.json")]);
    }
    expect(pr161({ root: { before: { ...ROOT, workspaces: ["packages/*"] }, after: ROOT } })).toEqual([expect.stringContaining("is not a workspace that the root package.json")]);
    // A * does not match a dot folder, even one the lockfile records; a literal entry does.
    const hidden = (lock: Record<string, unknown>) => ({ ...lock, "apps/.hidden": lock["apps/worker"] });
    const dotted = (root: unknown) => pr161({ file: "apps/.hidden/package.json", root: { before: root, after: root }, lock: { before: hidden(workerLock("^4.13.13", "4.13.13")), after: hidden(workerLock("^4.13.14", "4.13.14")) } });
    expect(dotted(ROOT)).toEqual([expect.stringContaining("is not a workspace that the root package.json")]);
    expect(dotted({ ...ROOT, workspaces: ["apps/.hidden"] })).toEqual([]);
  });
  it("rule 1: a '!' entry anywhere in the root's workspaces, before or after, names no workspace (npm reads it as an exclusion)", () => {
    const excluded = (entry: string) => [`The root package.json's "workspaces" has "${entry}", an exclusion this check does not read, so apps/worker is not taken as a workspace.`];
    // npm does not make apps/worker a workspace in the first; the others are refused too, as this check does not read exclusions.
    for (const workspaces of [["apps/*", "!apps/worker"], ["!apps/worker", "apps/worker"], ["apps/*", "!apps/site"], ["apps/*", "!!apps/worker"], ["apps/*", "./!apps/worker"], ["apps/*", "apps/!x"], ["!apps/site"]]) {
      const root = { ...ROOT, workspaces }, entry = workspaces.find(w => w.includes("!"))!;
      expect(pr161({ root: { before: root, after: root } }), JSON.stringify(workspaces)).toEqual(excluded(entry));
    }
    const root = { ...ROOT, workspaces: [...ROOT.workspaces, "!apps/worker"] };
    expect(pr161({ root: { before: ROOT, after: root } })).toEqual(excluded("!apps/worker"));
    expect(pr161({ root: { before: root, after: ROOT } })).toEqual(excluded("!apps/worker"));
    // Through the judge's reader too: the file is not taken as agreeing.
    const dirs = checkouts("apps/worker/package.json", SHAPE_161);
    const lock = { before: lockText(SHAPE_161.before.lock), after: lockText(SHAPE_161.after.lock) };
    expect(workspaceManifests(dirs.before, dirs.after, ["package-lock.json", "apps/worker/package.json"], { before: root, after: root }, lock)).toEqual([{ file: "apps/worker/package.json", reasons: excluded("!apps/worker") }]);
  });
  it("rule 2: a workspace the lockfile does not record before and after", () => {
    const { "apps/worker": _, ...unrecorded } = workerLock("^4.13.13", "4.13.13");
    expect(pr161({ lock: { before: unrecorded, after: workerLock("^4.13.14", "4.13.14") } })).toEqual(["The lockfile does not record the workspace apps/worker both before and after."]);
    expect(pr161({ lock: { before: workerLock("^4.13.13", "4.13.13"), after: { ...unrecorded, "node_modules/hono": tarball("hono", "4.13.14") } } })).toEqual(["The lockfile does not record the workspace apps/worker both before and after."]);
    // A folder named like an Object.prototype key is recorded only by the lockfile's own entry.
    const root = { ...ROOT, workspaces: ["*"] }, empty = { name: "x", version: "0.0.0" };
    expect(pr161({ file: "__proto__/package.json", before: empty, after: empty, root: { before: root, after: root }, lock: { before: unrecorded, after: unrecorded } })).toEqual(["The lockfile does not record the workspace __proto__ both before and after."]);
    // JSON.parse makes "__proto__" an own key: recorded after the change only is still not recorded before.
    const ownAfter = JSON.parse('{"__proto__": {}}') as Record<string, unknown>;
    expect(Object.hasOwn(ownAfter, "__proto__")).toBe(true);
    expect(pr161({ file: "__proto__/package.json", before: empty, after: empty, root: { before: root, after: root }, lock: { before: unrecorded, after: ownAfter } })).toEqual(["The lockfile does not record the workspace __proto__ both before and after."]);
    expect(pr161({ file: "__proto__/package.json", before: empty, after: empty, root: { before: root, after: root }, lock: { before: ownAfter, after: unrecorded } })).toEqual(["The lockfile does not record the workspace __proto__ both before and after."]);
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
  it('rule 3: a top-level "__proto__" added, removed or changed (JSON.parse makes it an own key), in a workspace file and in the root', () => {
    const withProto = (manifest: unknown, value: string) => JSON.parse(JSON.stringify(manifest).replace(/^\{/, `{"__proto__":${value},`)) as Record<string, unknown>;
    const added = withProto(worker("^4.13.14"), "{}");
    expect(Object.hasOwn(added, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(added)).toBe(Object.prototype);
    const stop = ['apps/worker/package.json changes "__proto__", which is not a dependency list (scripts, for one, run on install).'];
    expect(pr161({ after: added })).toEqual(stop);
    expect(pr161({ before: withProto(worker("^4.13.13"), "{}") })).toEqual(stop);
    expect(pr161({ before: withProto(worker("^4.13.13"), "{}"), after: withProto(worker("^4.13.14"), '{"scripts":{}}') })).toEqual(stop);
    // The same own key on both sides changes nothing.
    expect(pr161({ before: withProto(worker("^4.13.13"), "{}"), after: added })).toEqual([]);
    // The root package.json goes through the same comparison.
    const rootStop = ['package.json changes "__proto__", which is not a dependency list (scripts, for one, run on install).'];
    expect(manifestChanges(ROOT, withProto(ROOT, "{}"))).toEqual(rootStop);
    expect(manifestChanges(withProto(ROOT, "{}"), ROOT)).toEqual(rootStop);
    // Nothing was assigned onto a prototype.
    expect(({} as Record<string, unknown>).scripts).toBeUndefined();
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
    // A top-level "__proto__" in the record, on one side only, is a change too.
    const proto = JSON.parse(JSON.stringify(lockAfter["apps/worker"]).replace(/^\{/, '{"__proto__":{},')) as Record<string, unknown>;
    expect(pr161({ lock: { before: workerLock("^4.13.13", "4.13.13"), after: { ...lockAfter, "apps/worker": proto } } })).toEqual(['The lockfile\'s record of apps/worker changes "__proto__", which is not a dependency list.']);
    const lockBefore = workerLock("^4.13.13", "4.13.13");
    const protoBefore = JSON.parse(JSON.stringify(lockBefore["apps/worker"]).replace(/^\{/, '{"__proto__":{},')) as Record<string, unknown>;
    expect(pr161({ lock: { before: { ...lockBefore, "apps/worker": protoBefore }, after: lockAfter } })).toEqual(['The lockfile\'s record of apps/worker changes "__proto__", which is not a dependency list.']);
  });
});

// The judge with the rule wired in (judge-cli.ts reads the files, judge.ts leaves agreeing ones out of gate 4's
// changed-files stop): the same checkouts judged with and without it differ only in that stop and one info line.
const factsOf = (changes: Change[]) => {
  const one = (name: string, published_at: string): VersionFacts => ({ published_at, present: true, deprecated: null, publisher: "alice", shared_publisher: false, provenance: { repository: `https://github.com/acme/${name}`, workflow: ".github/workflows/release.yml", commit: "1".repeat(40) }, install_scripts: [], dependencies: [], integrity: INTEGRITY, malicious: [], advisories: [], package_created: "2020-01-01T00:00:00Z" });
  return new Map(changes.flatMap(c => [[`${c.name}@${c.to}`, one(c.name, "2026-10-01T00:00:00Z")] as const, ...(c.from ? [[`${c.name}@${c.from}`, one(c.name, "2026-09-01T00:00:00Z")] as const] : [])]));
};
const lockText = (packages: Record<string, unknown>) => JSON.stringify({ name: "ludion-repo", lockfileVersion: 3, requires: true, packages });
type Side = { manifest?: unknown; lock: Record<string, unknown> };
/** Two checkouts on disk with the root manifest, the lockfile and the workspace's package.json (a side may leave it out). */
const temporary: string[] = [];
afterAll(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });
function checkouts(file: string, sides: { before: Side; after: Side }) {
  const dirs = { before: mkdtempSync(join(tmpdir(), "ludion-l9-before-")), after: mkdtempSync(join(tmpdir(), "ludion-l9-after-")) };
  temporary.push(dirs.before, dirs.after);
  for (const side of ["before", "after"] as const) {
    writeFileSync(join(dirs[side], "package.json"), JSON.stringify(ROOT));
    writeFileSync(join(dirs[side], "package-lock.json"), lockText(sides[side].lock));
    const manifest = sides[side].manifest;
    if (manifest === undefined) continue;
    mkdirSync(join(dirs[side], dirname(file)), { recursive: true });
    writeFileSync(join(dirs[side], file), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  }
  return dirs;
}
function judgeBoth(file: string, sides: { before: Side; after: Side }, files = ["package-lock.json", file]) {
  const dirs = checkouts(file, sides);
  const lock = { before: lockText(sides.before.lock), after: lockText(sides.after.lock) };
  const workspaces = workspaceManifests(dirs.before, dirs.after, files, { before: ROOT, after: ROOT }, lock);
  const changes = allChanges(lock.before, lock.after);
  const input = {
    changes, entries: lockEntryChanges(lockEntries(lock.before), lockEntries(lock.after)), facts: factsOf(changes), fixes: [], files, now: new Date("2027-01-01T00:00:00Z"),
    locked: new Set(lockEntries(lock.before).map(e => `${e.name}@${e.version}`)), created: new Map(changes.map(c => [c.name, "2020-01-01T00:00:00Z"])), direct: changes.map(c => c.name),
  };
  return { workspaces, unfixed: judge(input), fixed: judge({ ...input, workspaces }) };
}
const touches = (j: Judgement) => j.findings.filter(f => f.gate === 4 && f.effect === "stop" && f.message.startsWith("The change also touches"));
const SHAPE_161 = { before: { manifest: worker("^4.13.13"), lock: workerLock("^4.13.13", "4.13.13") }, after: { manifest: worker("^4.13.14"), lock: workerLock("^4.13.14", "4.13.14") } };
const SHAPE_162 = { before: { manifest: site("^7.3.6"), lock: siteLock("^7.3.6", SITE_BEFORE) }, after: { manifest: site("^7.4.2"), lock: siteLock("^7.4.2", SITE_AFTER) } };
const otherWorker = (range: string, version: string) => ({ ...workerLock(range, version), "other/worker": workerLock(range, version)["apps/worker"] });

describe("the judge with workspace package.json files", () => {
  it.each([["#161", "apps/worker/package.json", SHAPE_161], ["#162", "apps/site/package.json", SHAPE_162]] as const)("%s's shape: an agreeing file is no gate 4 stop, and nothing else changes", (_pr, file, shape) => {
    const { workspaces, unfixed, fixed } = judgeBoth(file, shape);
    expect(workspaces).toEqual([{ file, reasons: [] }]);
    expect(touches(unfixed)).toEqual([expect.objectContaining({ message: expect.stringContaining(`touches ${file};`) })]);
    expect(unfixed.verdict).toBe("stop");
    expect(touches(fixed)).toEqual([]);
    expect(fixed.verdict).toBe("ready_except_build");
    const info = { gate: 4, effect: "info", message: `${file}: a workspace's dependency lists change, and before and after they equal the lockfile's record of that workspace.` };
    const sorted = (findings: unknown[]) => findings.map(f => JSON.stringify(f)).sort();
    expect(sorted(fixed.findings)).toEqual(sorted([...unfixed.findings.filter(f => !touches(unfixed).includes(f)), info]));
  });
  it("keeps the stop for other files next to an agreeing one", () => {
    const { fixed } = judgeBoth("apps/worker/package.json", SHAPE_161, ["package-lock.json", "apps/worker/package.json", "apps/worker/src/index.ts"]);
    expect(touches(fixed).map(f => f.message)).toEqual([expect.stringContaining("touches apps/worker/src/index.ts;")]);
    expect(fixed.verdict).toBe("stop");
  });
  it.each([
    ["a range the lockfile does not record", "apps/worker/package.json", { ...SHAPE_161, after: { ...SHAPE_161.after, lock: workerLock("^4.13.13", "4.13.14") } }, "is not the lockfile's record of apps/worker"],
    ["a new install script", "apps/worker/package.json", { ...SHAPE_161, after: { ...SHAPE_161.after, manifest: { ...worker("^4.13.14"), scripts: { postinstall: "node x.js" } } } }, 'changes "scripts"'],
    ["a spec outside the registry", "apps/worker/package.json", { ...SHAPE_161, after: { manifest: worker("github:evil/hono"), lock: workerLock("github:evil/hono", "4.13.14") } }, "not a registry range"],
    ["a top-level __proto__ added", "apps/worker/package.json", { ...SHAPE_161, after: { ...SHAPE_161.after, manifest: JSON.stringify(worker("^4.13.14")).replace(/^\{/, '{"__proto__":{},') } }, 'changes "__proto__"'],
    ["a file that is not JSON", "apps/worker/package.json", { ...SHAPE_161, after: { ...SHAPE_161.after, manifest: "{ not json" } }, "is not a JSON object on both sides"],
    ["a folder the root's workspaces do not name", "other/worker/package.json", { before: { manifest: worker("^4.13.13"), lock: otherWorker("^4.13.13", "4.13.13") }, after: { manifest: worker("^4.13.14"), lock: otherWorker("^4.13.14", "4.13.14") } }, "is not a workspace that the root package.json"],
  ] as const)("stops %s, with the file still in the changed-files stop", (_name, file, shape, reason) => {
    const { workspaces, fixed } = judgeBoth(file, shape);
    expect(workspaces).toEqual([{ file, reasons: [expect.stringContaining(reason)] }]);
    expect(touches(fixed)).toEqual([expect.objectContaining({ message: expect.stringContaining(`touches ${file};`) })]);
    expect(fixed.findings).toContainEqual({ gate: 4, effect: "stop", message: expect.stringContaining(reason) });
    expect(fixed.findings.some(f => f.effect === "info" && f.message.includes("equal the lockfile's record"))).toBe(false);
    expect(fixed.verdict).toBe("stop");
  });
  it("is undecidable when a side was not given or is not a regular file (judge.yml gives neither side today)", () => {
    for (const shape of [{ ...SHAPE_161, before: { lock: SHAPE_161.before.lock } }, { ...SHAPE_161, after: { lock: SHAPE_161.after.lock } }, { before: { lock: SHAPE_161.before.lock }, after: { lock: SHAPE_161.after.lock } }]) {
      const { workspaces, fixed } = judgeBoth("apps/worker/package.json", shape);
      expect(workspaces).toEqual([{ file: "apps/worker/package.json", reasons: null }]);
      expect(touches(fixed)).toHaveLength(1);
      expect(fixed.findings).toContainEqual({ gate: 4, effect: "stop", message: "apps/worker/package.json could not be read both before and after the change, so whether it agrees with the lockfile is undecidable." });
      expect(fixed.verdict).toBe("undecidable");
    }
    const dirs = checkouts("apps/worker/package.json", SHAPE_161);
    const real = join(dirs.after, "apps/worker/real.json");
    renameSync(join(dirs.after, "apps/worker/package.json"), real);
    symlinkSync(real, join(dirs.after, "apps/worker/package.json"));
    const lock = { before: lockText(SHAPE_161.before.lock), after: lockText(SHAPE_161.after.lock) };
    expect(workspaceManifests(dirs.before, dirs.after, ["package-lock.json", "apps/worker/package.json"], { before: ROOT, after: ROOT }, lock)).toEqual([{ file: "apps/worker/package.json", reasons: null }]);
  });
  it("is wired into ludion judge (offline: every lookup fails, so the verdict is undecidable either way)", async () => {
    const cli = async (shape: { before: Side; after: Side }) => {
      const dirs = checkouts("apps/worker/package.json", shape);
      const lines: string[] = [];
      vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
      const log = vi.spyOn(console, "log").mockImplementation((line: string) => { lines.push(line); });
      try { await judgeCli(["--before", dirs.before, "--after", dirs.after, "--files", "package-lock.json,apps/worker/package.json", "--now", "2027-01-01T00:00:00Z", "--json"]); }
      finally { log.mockRestore(); vi.unstubAllGlobals(); }
      return JSON.parse(lines.join("\n")) as Judgement;
    };
    const agreeing = await cli(SHAPE_161);
    expect(touches(agreeing)).toEqual([]);
    expect(agreeing.findings).toContainEqual(expect.objectContaining({ gate: 4, effect: "info", message: expect.stringContaining("apps/worker/package.json: a workspace's dependency lists change") }));
    const scripts = await cli({ ...SHAPE_161, after: { ...SHAPE_161.after, manifest: { ...worker("^4.13.14"), scripts: { postinstall: "node x.js" } } } });
    expect(touches(scripts)).toHaveLength(1);
    expect(scripts.findings).toContainEqual(expect.objectContaining({ gate: 4, effect: "stop", message: expect.stringContaining('changes "scripts"') }));
    const missing = await cli({ ...SHAPE_161, after: { lock: SHAPE_161.after.lock } });
    expect(missing.findings).toContainEqual(expect.objectContaining({ gate: 4, effect: "stop", message: expect.stringContaining("could not be read both before and after") }));
  });
  it("reads no file outside a plain workspace folder, and only listed package.json files", () => {
    const dirs = checkouts("apps/worker/package.json", SHAPE_161);
    const lock = { before: lockText(SHAPE_161.before.lock), after: lockText(SHAPE_161.after.lock) };
    expect(workspaceManifests(dirs.before, dirs.after, ["package-lock.json", "../apps/worker/package.json", "node_modules/hono/package.json"], { before: ROOT, after: ROOT }, lock)).toEqual([
      { file: "../apps/worker/package.json", reasons: [expect.stringContaining("is not the package.json of a plain workspace folder")] },
      { file: "node_modules/hono/package.json", reasons: [expect.stringContaining("is not the package.json of a plain workspace folder")] },
    ]);
    expect(workspaceManifests(dirs.before, dirs.after, ["package.json", "package-lock.json", "apps/worker/src/index.ts"], { before: ROOT, after: ROOT }, lock)).toEqual([]);
    expect(workspaceManifests(dirs.before, dirs.after, null, { before: ROOT, after: ROOT }, lock)).toEqual([]);
    // An agreeing file that the PR's changed files do not list is ignored.
    const changes = allChanges(lock.before, lock.after);
    const result = judge({ changes, facts: factsOf(changes), fixes: [], files: ["package-lock.json"], now: new Date("2027-01-01T00:00:00Z"), workspaces: [{ file: "apps/worker/package.json", reasons: [] }] });
    expect(result.findings.some(f => f.gate === 4)).toBe(false);
  });
});
