// The oldest version in range (docs/decisions/2026-11-03-oldest-resolution-in-product.md). No test here leaves the
// machine: the registry is the packument copies in fixtures/oldest-packuments (docs/bench/lold2/scripts/record.mjs) or a
// few written by hand, and OSV is a map.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { Change } from "../src/security/inventory.ts";
import type { Finding } from "../src/security/osv.ts";
import { fixResolution, noAnswerIn, noAnswerReason, RECEIPT_ANSWERS, registryRequirement, REQUIREMENT_LIMIT, requirementsOf, resolutionAssert, resolutionTime, resolveOldest, resolverScript, tableFile, unneededMoves, type ResolutionTable } from "../src/security/oldest.ts";

type Doc = { time: Record<string, unknown>; versions: Record<string, any> };
const recorded = (name: string): Doc => JSON.parse(readFileSync(new URL(`fixtures/oldest-packuments/${name}.json`, import.meta.url), "utf8"));
const json = (value: unknown) => new Response(JSON.stringify(value));
type World = { docs: Record<string, Doc>; osv?: Record<string, string[]>; withdrawn?: string[]; failing?: string; asked?: string[] };
function fetchOf(world: World): typeof fetch {
  return async (url, init) => {
    const u = decodeURIComponent(String(url));
    if (world.failing && u.startsWith(world.failing)) return new Response("", { status: 503 });
    if (u === "https://api.osv.dev/v1/querybatch") {
      const queries = JSON.parse(String(init?.body)).queries as { package: { name: string }; version: string }[];
      world.asked?.push(...queries.map(q => `${q.package.name}@${q.version}`));
      return json({ results: queries.map(q => ({ vulns: (world.osv?.[`${q.package.name}@${q.version}`] ?? []).map(id => ({ id })) })) });
    }
    if (u.startsWith("https://api.osv.dev/v1/vulns/")) {
      const id = u.split("/").at(-1)!;
      return json({ id, affected: [], aliases: [], ...(world.withdrawn?.includes(id) ? { withdrawn: "2026-01-01T00:00:00Z" } : {}) });
    }
    const doc = world.docs[u.replace("https://registry.npmjs.org/", "")];
    return doc ? json(doc) : new Response("", { status: 404 });
  };
}
const lockOf = (packages: Record<string, unknown>, root: Record<string, unknown> = { name: "app", dependencies: {} }) => JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "": root, ...packages } });
const change = (name: string, from: string, to: string, advisories = ["GHSA-test-0001"]): Change => ({ name, from, to, advisories });
const finding = (id: string, published?: string) => ({ advisory: { id, ...(published ? { published } : {}) } }) as unknown as Finding;
/** A hand-written document: version to publish time, with fields per version. */
const doc = (versions: Record<string, string>, fields: Record<string, Record<string, unknown>> = {}, gone: string[] = []): Doc => ({
  time: { created: "2010-01-01T00:00:00.000Z", modified: "2026-01-01T00:00:00.000Z", ...versions },
  versions: Object.fromEntries(Object.keys(versions).filter(v => !gone.includes(v)).map(v => [v, { ...fields[v] }])),
});
const FIX_AT = "2026-06-01T00:00:00.000Z";
/** A fix of `fixed` 1.0.0 -> 1.0.1, published at FIX_AT, requiring what is given. */
const withFix = (requires: Record<string, unknown>, others: Record<string, Doc> = {}): Record<string, Doc> => ({ fixed: doc({ "1.0.0": "2020-01-01T00:00:00.000Z", "1.0.1": FIX_AT }, { "1.0.1": requires }), ...others });
const resolve = (world: World, base: Record<string, unknown> = { "node_modules/fixed": { version: "1.0.0" } }, findings: Finding[] = [], limit?: number) =>
  resolveOldest({ plan: [change("fixed", "1.0.0", "1.0.1")], baseLock: lockOf(base), finalManifest: JSON.stringify({ name: "app", dependencies: { fixed: "^1.0.1" } }), findings, fetchFn: fetchOf(world), ...(limit ? { limit } : {}) });

describe("which version a requirement gets", () => {
  it("oldest-by-publish-time: the earliest published in range, not the lowest version number (recorded semver)", async () => {
    const world = { docs: withFix({ dependencies: { semver: "^6.3.1 || ^7.0.0" } }, { semver: recorded("semver") }) };
    const table = await resolve(world);
    // 6.3.1 is the lowest version in range, and was published in 2023, after 7.0.0.
    expect(Date.parse(recorded("semver").time["6.3.1"] as string)).toBeGreaterThan(Date.parse(recorded("semver").time["7.0.0"] as string));
    expect(table.answers["semver@^6.3.1 || ^7.0.0"]).toMatchObject({ version: "7.0.0", role: "oldest", published_at: new Date(recorded("semver").time["7.0.0"] as string).toISOString() });
  });
  it("oldest-recorded-transitive: LOLD's braces fix, on the recorded packuments: fill-range moves to 7.1.1, the rest is the base's", async () => {
    const docs = Object.fromEntries(["braces", "fill-range", "to-regex-range", "is-number"].map(name => [name, recorded(name)]));
    const base = { "node_modules/micromatch": { version: "4.0.5", dependencies: { braces: "^3.0.2" } }, "node_modules/braces": { version: "3.0.2", dependencies: { "fill-range": "^7.0.1" } }, "node_modules/fill-range": { version: "7.0.1", dependencies: { "to-regex-range": "^5.0.1" } }, "node_modules/to-regex-range": { version: "5.0.1", dependencies: { "is-number": "^7.0.0" } }, "node_modules/is-number": { version: "7.0.0" } };
    const plan = [change("braces", "3.0.2", "3.0.3", ["GHSA-grv7-fg5c-xmjg"])];
    const table = await resolveOldest({ plan, baseLock: lockOf(base), finalManifest: JSON.stringify({ name: "app", dependencies: { micromatch: "4.0.5" } }), findings: [finding("GHSA-grv7-fg5c-xmjg", "2024-05-21T09:59:11.390Z")], fetchFn: fetchOf({ docs }) });
    expect(table.t).toBe("2024-05-21T09:59:11.390Z");
    expect(table.answers["braces@3.0.3"]).toMatchObject({ version: "3.0.3", role: "v" });
    expect(table.answers["fill-range@^7.1.1"]).toMatchObject({ version: "7.1.1", role: "oldest", published_at: "2024-05-21T08:45:51.224Z" });
    expect(table.answers["to-regex-range@^5.0.1"]).toMatchObject({ version: "5.0.1", role: "reused_base" });
    expect(table.answers["is-number@^7.0.0"]).toMatchObject({ version: "7.0.0", role: "reused_base" });
  });
  it("oldest-vulnerable-next: an oldest version OSV names gives way to the next oldest", async () => {
    const world = { docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep: doc({ "1.0.0": "2021-01-01T00:00:00.000Z", "1.1.0": "2022-01-01T00:00:00.000Z", "1.2.0": "2023-01-01T00:00:00.000Z" }) }), osv: { "dep@1.0.0": ["GHSA-old-0001"] } };
    const answer = (await resolve(world)).answers["dep@^1.0.0"]!;
    expect(answer).toMatchObject({ version: "1.1.0", role: "oldest", excluded: { in_range: 3, advisory: 1, deprecated: 0, withdrawn: 0 } });
    expect(answer.passed_over).toEqual([{ version: "1.0.0", reason: "OSV names it in GHSA-old-0001" }]);
  });
  it("oldest-withdrawn-record: a record OSV marks withdrawn does not count, and a MAL- record does", async () => {
    const dep = doc({ "1.0.0": "2021-01-01T00:00:00.000Z", "1.1.0": "2022-01-01T00:00:00.000Z" });
    expect((await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep }), osv: { "dep@1.0.0": ["GHSA-gone-0001"] }, withdrawn: ["GHSA-gone-0001"] })).answers["dep@^1.0.0"]).toMatchObject({ version: "1.0.0" });
    expect((await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep }), osv: { "dep@1.0.0": ["MAL-2026-0001"] } })).answers["dep@^1.0.0"]).toMatchObject({ version: "1.1.0" });
  });
  it("oldest-skips-deprecated-withdrawn: a deprecated version and one the registry no longer lists are passed over", async () => {
    const dep = doc({ "1.0.0": "2021-01-01T00:00:00.000Z", "1.1.0": "2022-01-01T00:00:00.000Z", "1.2.0": "2023-01-01T00:00:00.000Z", "1.3.0": "2023-06-01T00:00:00.000Z" }, { "1.0.0": { deprecated: "do not use" } }, ["1.1.0"]);
    const answer = (await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep }) })).answers["dep@^1.0.0"]!;
    expect(answer).toMatchObject({ version: "1.2.0", excluded: { deprecated: 1, withdrawn: 1 } });
    expect(answer.passed_over.map(p => p.version)).toEqual(["1.0.0", "1.1.0"]);
  });
  it("oldest-nothing-left: every version in range excluded gives no answer, and no newer or excluded version (recorded uuid)", async () => {
    const uuid = recorded("uuid");
    // uuid@^9.0.1 has one version, and it is deprecated: LOLD's R09. 10.0.0 and later are out of range and stay out.
    const answer = (await resolve({ docs: withFix({ dependencies: { uuid: "^9.0.1" } }, { uuid }) })).answers["uuid@^9.0.1"]!;
    expect(uuid.versions["9.0.1"].deprecated).toBeTruthy();
    expect(answer).toMatchObject({ version: null, role: null, excluded: { in_range: 1, deprecated: 1 } });
    expect(answer.reason).toContain("nothing is left in range");
    // All of it named by OSV.
    const named = (await resolve({ docs: withFix({ dependencies: { dep: "1.0.0" } }, { dep: doc({ "1.0.0": "2021-01-01T00:00:00.000Z", "2.0.0": "2021-02-01T00:00:00.000Z" }) }), osv: { "dep@1.0.0": ["GHSA-only-0001"] } })).answers["dep@1.0.0"]!;
    expect(named).toMatchObject({ version: null, excluded: { in_range: 1, advisory: 1 } });
    // A package the registry does not have.
    expect((await resolve({ docs: withFix({ dependencies: { missing: "^1.0.0" } }) })).answers["missing@^1.0.0"]).toMatchObject({ version: null, reason: "the registry lists no such package" });
  });
  it("oldest-keeps-locked: a version already locked comes first, even one published after T, unless it is excluded", async () => {
    const dep = doc({ "1.0.0": "2021-01-01T00:00:00.000Z", "1.1.0": "2022-01-01T00:00:00.000Z", "1.5.0": "2026-07-01T00:00:00.000Z" });
    const base = { "node_modules/fixed": { version: "1.0.0" }, "node_modules/other/node_modules/dep": { version: "1.5.0" } };
    expect((await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep }) }, base)).answers["dep@^1.0.0"]).toMatchObject({ version: "1.5.0", role: "reused_base" });
    // Named by OSV: not taken again, and the oldest clean version answers.
    expect((await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep }), osv: { "dep@1.5.0": ["GHSA-new-0001"] } }, base)).answers["dep@^1.0.0"]).toMatchObject({ version: "1.0.0", role: "oldest" });
    // Of two locked, the earliest published.
    const both = { ...base, "node_modules/a/node_modules/dep": { version: "1.1.0" } };
    expect((await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep }) }, both)).answers["dep@^1.0.0"]).toMatchObject({ version: "1.1.0", role: "reused_base" });
  });
  it("oldest-v-itself: a requirement that includes V gets V, deprecated or not, and one that does not goes by the rule", async () => {
    const docs = { fixed: doc({ "1.0.0": "2020-01-01T00:00:00.000Z", "1.0.1": FIX_AT, "1.0.2": "2026-06-02T00:00:00.000Z" }, { "1.0.1": { deprecated: "later than the fix", dependencies: { a: "^1.0.0" } } }), a: doc({ "1.0.0": "2021-01-01T00:00:00.000Z" }, { "1.0.0": { dependencies: { fixed: ">=1.0.0" } } }) };
    const table = await resolve({ docs });
    expect(table.answers["fixed@1.0.1"]).toMatchObject({ version: "1.0.1", role: "v" });
    expect(table.answers["fixed@^1.0.1"]).toMatchObject({ version: "1.0.1", role: "v" });
    expect(table.answers["fixed@>=1.0.0"]).toMatchObject({ version: "1.0.1", role: "v" });
  });
  it("oldest-t-cuts: a version published after T is not taken; only V's same release is, and the time cap's rule decides that", async () => {
    const sibling = (user: string) => doc({ "1.0.0": "2020-01-01T00:00:00.000Z", "1.0.1": "2026-06-01T00:10:00.000Z" }, { "1.0.0": { _npmUser: { name: user } }, "1.0.1": { _npmUser: { name: user } } });
    const docs = (user: string) => withFix({ dependencies: { sib: "1.0.1" }, _npmUser: { name: "alice" } }, { sib: sibling(user) });
    // The sibling came ten minutes after V, from V's publisher, at V's version number.
    expect((await resolve({ docs: docs("alice") })).answers["sib@1.0.1"]).toMatchObject({ version: "1.0.1", role: "same_release", excluded: { after_t: 0 } });
    // From another publisher it is not the same release, and nothing is left.
    const other = (await resolve({ docs: docs("mallory") })).answers["sib@1.0.1"]!;
    expect(other).toMatchObject({ version: null, excluded: { in_range: 1, after_t: 1 } });
    expect(other.reason).toContain("1 published after T");
    // A later advisory moves T past it: then it is simply the oldest.
    expect((await resolve({ docs: docs("mallory") }, undefined, [finding("GHSA-test-0001", "2026-06-02T00:00:00.000Z")])).answers["sib@1.0.1"]).toMatchObject({ version: "1.0.1", role: "oldest" });
    // A same release OSV names is not taken, and is counted once.
    const named = (await resolve({ docs: docs("alice"), osv: { "sib@1.0.1": ["GHSA-sib-0001"] } })).answers["sib@1.0.1"]!;
    expect(named).toMatchObject({ version: null, excluded: { in_range: 1, after_t: 0, advisory: 1 } });
  });
  it("oldest-asks-oldest-first: OSV is asked in chunks, oldest first, and only as far as the first clean version", async () => {
    const versions = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`1.${i}.0`, new Date(Date.UTC(2021, 0, 1 + i)).toISOString()]));
    const asked: string[] = [];
    const answer = (await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep: doc(versions) }), asked })).answers["dep@^1.0.0"]!;
    expect(answer.version).toBe("1.0.0");
    expect(asked.filter(a => a.startsWith("dep@"))).toHaveLength(25);
    const osv = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`dep@1.${i}.0`, ["GHSA-many-0001"]]));
    const later = (await resolve({ docs: withFix({ dependencies: { dep: "^1.0.0" } }, { dep: doc(versions) }), osv })).answers["dep@^1.0.0"]!;
    expect(later).toMatchObject({ version: "1.30.0", excluded: { advisory: 30 } });
    expect(later.passed_over).toHaveLength(20);
  });
  it("oldest-walks: answers' own requirements, non-optional peers and aliases; not optional peers, Git or URL specs; a tag has no answer", async () => {
    const docs = withFix({ dependencies: { a: "^1.0.0", "my-b": "npm:b@^2.0.0", git: "github:o/r", url: "https://example.org/x.tgz", tagged: "latest" }, peerDependencies: { peer: "^3.0.0", maybe: "^4.0.0" }, peerDependenciesMeta: { maybe: { optional: true } }, optionalDependencies: { opt: "^5.0.0" } }, {
      a: doc({ "1.0.0": "2021-01-01T00:00:00.000Z" }, { "1.0.0": { dependencies: { deep: "^1.0.0" } } }), b: doc({ "2.0.0": "2021-01-01T00:00:00.000Z" }), peer: doc({ "3.0.0": "2021-01-01T00:00:00.000Z" }), opt: doc({ "5.0.0": "2021-01-01T00:00:00.000Z" }),
      deep: doc({ "1.0.0": "2021-01-01T00:00:00.000Z" }), tagged: doc({ "1.0.0": "2021-01-01T00:00:00.000Z" }),
    });
    const table = await resolve({ docs });
    expect(Object.keys(table.answers).sort()).toEqual(["a@^1.0.0", "b@^2.0.0", "deep@^1.0.0", "fixed@1.0.1", "fixed@^1.0.1", "opt@^5.0.0", "peer@^3.0.0", "tagged@latest"]);
    expect(table.answers["tagged@latest"]).toMatchObject({ version: null, reason: expect.stringContaining("is a tag") });
    expect(requirementsOf({ dependencies: { "__proto__x": "1" }, peerDependencies: { p: "1" } })).toEqual([{ name: "__proto__x", spec: "1" }, { name: "p", spec: "1" }]);
    expect(registryRequirement("x", "npm:@scope/y@^1.2.3")).toEqual({ name: "@scope/y", spec: "^1.2.3" });
    expect(registryRequirement("x", "npm:y")).toEqual({ name: "y", spec: "*" });
    expect(registryRequirement("x", "")).toEqual({ name: "x", spec: "*" });
    expect(registryRequirement("x", "file:../y")).toBeNull();
    expect(registryRequirement("x", 1)).toBeNull();
  });
  it("oldest-overrides: what a project's overrides name is in the table", async () => {
    const table = await resolveOldest({ plan: [change("fixed", "1.0.0", "1.0.1")], baseLock: lockOf({ "node_modules/fixed": { version: "1.0.0" } }), findings: [], fetchFn: fetchOf({ docs: withFix({}, { a: doc({ "1.0.0": "2021-01-01T00:00:00.000Z" }), b: doc({ "2.0.0": "2021-01-01T00:00:00.000Z" }), c: doc({ "3.0.0": "2021-01-01T00:00:00.000Z" }) }) }),
      finalManifest: JSON.stringify({ name: "app", dependencies: { fixed: "^1.0.1", c: "^3.0.0" }, overrides: { a: "1.0.0", "b@2": "2.0.0", fixed: { ".": "1.0.1", c: "$c" } } }) });
    expect(Object.keys(table.answers).sort()).toEqual(["a@1.0.0", "b@2.0.0", "fixed@1.0.1", "fixed@^1.0.1"]);
  });
  it("oldest-fails-closed: a read that fails throws, V with no publish time throws, and the table has a limit", async () => {
    const docs = withFix({ dependencies: { dep: "^1.0.0" } }, { dep: doc({ "1.0.0": "2021-01-01T00:00:00.000Z" }) });
    await expect(resolve({ docs, failing: "https://registry.npmjs.org/dep" })).rejects.toThrow("HTTP 503");
    await expect(resolve({ docs, failing: "https://api.osv.dev/v1/querybatch" })).rejects.toThrow("HTTP 503");
    await expect(resolve({ docs: {} })).rejects.toThrow("The time cap could not be checked: fixed@1.0.1 has no publish time");
    await expect(resolve({ docs }, undefined, [], 2)).rejects.toThrow("more than 2 requirements");
    expect(REQUIREMENT_LIMIT).toBe(5000);
  });
  it("oldest-t: T is the later of V's publish time and the earliest advisory of the fix; other advisories do not move it", () => {
    const at = Date.parse(FIX_AT), plan = [change("fixed", "1.0.0", "1.0.1", ["A", "B"])];
    expect(resolutionTime([at], plan, [])).toMatchObject({ t: at, note: expect.stringContaining("OSV gives no publish time") });
    expect(resolutionTime([at], plan, [finding("A", "2026-06-03T00:00:00Z"), finding("B", "2026-06-02T00:00:00Z"), finding("C", "2026-05-01T00:00:00Z")]).t).toBe(Date.parse("2026-06-02T00:00:00Z"));
    // An advisory older than V does not bring T before V.
    expect(resolutionTime([at], plan, [finding("A", "2026-01-01T00:00:00Z")]).t).toBe(at);
    expect(resolutionTime([at, at + 1000], plan, []).t).toBe(at + 1000);
    expect(resolutionTime([at], plan, [finding("A", "not a date")]).t).toBe(at);
  });
});

describe("the asserts on the diff as npm wrote it", () => {
  const T = "2026-06-01T00:00:00.000Z", HOUR = 3_600_000, hoursAfterT = (h: number) => new Date(Date.parse(T) + h * HOUR);
  const answer = (name: string, version: string, role: "oldest" | "reused_base" | "same_release") => ({ requirement: `${name}@${version}`, name, version, role, published_at: null, passed_over: [], excluded: { in_range: 1, no_time: 0, after_t: 0, withdrawn: 0, deprecated: 0, advisory: 0 } });
  const table = (answers: ReturnType<typeof answer>[] = [], locked: string[] = []): ResolutionTable => ({ t: T, t_note: "", v: { fixed: ["1.0.1"] }, locked: new Set(locked), publishedAt: async () => null, answers: Object.fromEntries(answers.map(a => [a.requirement, a])) });
  const run = (t: ResolutionTable, versions: Record<string, string | null>, wait: number, pushedAt: Date) => resolutionAssert({ table: t, waitHours: wait, pushedAt, published: (name, version) => versions[`${name}@${version}`], changes: Object.keys(versions).map(id => ({ path: `node_modules/${id.split("@")[0]}`, name: id.split("@")[0]!, to: id.split("@")[1]! })) });

  it("assert-youngest-sets-the-line: each version's age is read, and the youngest decides when the fix may go", () => {
    const t = table([answer("old", "1.0.0", "oldest"), answer("young", "1.0.0", "oldest")]);
    const versions = { "fixed@1.0.1": "2026-05-31T00:00:00.000Z", "old@1.0.0": "2020-01-01T00:00:00.000Z", "young@1.0.0": "2026-05-31T12:00:00.000Z" };
    const early = run(t, versions, 72, hoursAfterT(24));
    expect(early.youngest).toBe("young@1.0.0");
    expect(early.wait_until).toBe("2026-06-03T12:00:00.000Z");
    expect(early.waits).toEqual(expect.arrayContaining([expect.stringContaining("young@1.0.0"), expect.stringContaining("fixed@1.0.1")]));
    expect(early.waits.join(" ")).not.toContain("old@1.0.0");
    expect(early.problems).toEqual([]);
    expect(early.versions.find(v => v.name === "young")).toMatchObject({ role: "oldest", age_hours: 36 });
    // A moment before the line it still waits, for the youngest alone; at the line nothing waits.
    expect(run(t, versions, 72, new Date(Date.parse("2026-06-03T12:00:00.000Z") - 1000)).waits).toEqual([expect.stringContaining("young@1.0.0")]);
    expect(run(t, versions, 72, new Date("2026-06-03T12:00:00.000Z")).waits).toEqual([]);
  });
  it("assert-push-too-early: a push before the wait of any version in the diff fails, at every row of the wait table", () => {
    for (const wait of [12, 24, 72]) {
      const versions = { "fixed@1.0.1": T };
      expect(run(table(), versions, wait, hoursAfterT(wait - 0.01)).waits).toHaveLength(1);
      expect(run(table(), versions, wait, hoursAfterT(wait)).waits).toEqual([]);
    }
  });
  it("assert-resolution-time: the resolution time is at most push − wait, and the literal comparison of T stops nothing", () => {
    // Every version long old, the advisory just seen: push at once; T is later than push − wait.
    const versions = { "fixed@1.0.1": "2020-01-01T00:00:00.000Z" };
    const now = run(table(), versions, 72, hoursAfterT(1));
    expect(now).toMatchObject({ t_before_push_less_wait: false, waits: [], problems: [], resolved_at: new Date(hoursAfterT(1).getTime() - 72 * HOUR).toISOString() });
    // Later on, T is the earlier of the two.
    const later = run(table(), versions, 72, hoursAfterT(100));
    expect(later).toMatchObject({ t_before_push_less_wait: true, resolved_at: T });
    expect(Date.parse(now.resolved_at)).toBeLessThanOrEqual(hoursAfterT(1).getTime() - 72 * HOUR);
  });
  it("assert-landing: a version younger than the wait, after older ones were passed over, makes the fix wait", () => {
    const t = table([answer("dep", "2.0.0", "oldest")]);
    const landed = run(t, { "fixed@1.0.1": "2026-01-01T00:00:00.000Z", "dep@2.0.0": "2026-05-31T23:00:00.000Z" }, 24, hoursAfterT(2));
    expect(landed.waits).toEqual([expect.stringContaining("dep@2.0.0")]);
    expect(landed.wait_until).toBe("2026-06-01T23:00:00.000Z");
    expect(landed.problems).toEqual([]);
  });
  it("assert-landing-stops: a version the table did not give, one published after T, or one with no publish time stops the fix", () => {
    const old = "2020-01-01T00:00:00.000Z";
    expect(run(table(), { "fixed@1.0.1": old, "dep@9.9.9": old }, 12, hoursAfterT(100)).problems).toEqual([expect.stringContaining("dep@9.9.9 at node_modules/dep is not a version the table")]);
    expect(run(table([answer("dep", "1.0.0", "oldest")]), { "dep@1.0.0": "2026-06-01T00:00:01.000Z" }, 12, hoursAfterT(100)).problems).toEqual([expect.stringContaining("published after T")]);
    expect(run(table([answer("dep", "1.0.0", "oldest")]), { "dep@1.0.0": null }, 12, hoursAfterT(100)).problems).toEqual([expect.stringContaining("has no publish time")]);
    expect(run(table([answer("dep", "1.0.0", "oldest")]), { "dep@1.0.0": null }, 12, hoursAfterT(100)).wait_until).toBeNull();
  });
  it("assert-allows: the same release as V and a locked version may be published after T, and still wait", () => {
    const t = table([answer("sib", "1.0.1", "same_release"), answer("dep", "2.0.0", "reused_base")], ["kept@1.0.0"]);
    const versions = { "sib@1.0.1": "2026-06-01T00:10:00.000Z", "dep@2.0.0": "2026-06-02T00:00:00.000Z", "kept@1.0.0": "2026-06-03T00:00:00.000Z" };
    const out = run(t, versions, 12, hoursAfterT(100));
    expect(out.problems).toEqual([]);
    expect(out.versions.map(v => v.role)).toEqual(["same_release", "reused_base", "reused_base"]);
    expect(run(t, versions, 12, hoursAfterT(48)).waits).toEqual([expect.stringContaining("kept@1.0.0")]);
  });
});

describe("a version already locked does not move while it satisfies the range", () => {
  const plan = [{ name: "fixed", from: "1.0.0", to: "1.0.1" }];
  const base = { "node_modules/fixed": { version: "1.0.0", dependencies: { dep: "^1.0.0" } }, "node_modules/dep": { version: "1.0.0" }, "node_modules/stay": { version: "1.0.0", dependencies: { dep: "^1.0.0" } } };
  const moved = (from: string, to: string) => ({ path: "node_modules/dep", name: "dep", from, to });
  it("moves-forced: moving is allowed when a package that loads the path no longer takes the old version", () => {
    const after = { "node_modules/fixed": { version: "1.0.1", dependencies: { dep: "^1.1.0" } }, "node_modules/dep": { version: "1.1.0" }, "node_modules/stay": { version: "1.0.0", dependencies: { dep: "^1.0.0" } } };
    expect(unneededMoves(lockOf(base), lockOf(after), plan)).toEqual([]);
  });
  it("moves-unneeded: moving is refused when every package that loads the path still takes the old version", () => {
    const after = { "node_modules/fixed": { version: "1.0.1", dependencies: { dep: "^1.0.0" } }, "node_modules/dep": { version: "1.2.0" }, "node_modules/stay": { version: "1.0.0", dependencies: { dep: "^1.0.0" } } };
    expect(unneededMoves(lockOf(base), lockOf(after), plan)).toEqual([moved("1.0.0", "1.2.0")]);
  });
  it("moves-unneeded: nothing at all loading it, a spec that is not a range, an optional peer: none of these shows a need", () => {
    const lone = { "node_modules/fixed": { version: "1.0.0" }, "node_modules/dep": { version: "1.0.0" } };
    expect(unneededMoves(lockOf(lone), lockOf({ "node_modules/fixed": { version: "1.0.1" }, "node_modules/dep": { version: "1.1.0" } }), plan)).toEqual([moved("1.0.0", "1.1.0")]);
    expect(unneededMoves(lockOf(lone), lockOf({ "node_modules/fixed": { version: "1.0.1", dependencies: { dep: "latest" } }, "node_modules/dep": { version: "1.1.0" } }), plan)).toEqual([moved("1.0.0", "1.1.0")]);
    expect(unneededMoves(lockOf(lone), lockOf({ "node_modules/fixed": { version: "1.0.1", peerDependencies: { dep: "^1.1.0" }, peerDependenciesMeta: { dep: { optional: true } } }, "node_modules/dep": { version: "1.1.0" } }), plan)).toEqual([moved("1.0.0", "1.1.0")]);
    // A peer that is not optional, an alias's own range and the project's requirement do show one.
    expect(unneededMoves(lockOf(lone), lockOf({ "node_modules/fixed": { version: "1.0.1", peerDependencies: { dep: "^1.1.0" } }, "node_modules/dep": { version: "1.1.0" } }), plan)).toEqual([]);
    expect(unneededMoves(lockOf(lone), lockOf({ "node_modules/fixed": { version: "1.0.1", dependencies: { dep: "npm:dep@^1.1.0" } }, "node_modules/dep": { version: "1.1.0" } }), plan)).toEqual([]);
    expect(unneededMoves(lockOf(lone), lockOf({ "node_modules/fixed": { version: "1.0.1" }, "node_modules/dep": { version: "1.1.0" } }, { name: "app", devDependencies: { dep: "^1.1.0" } }), plan)).toEqual([]);
  });
  it("moves-looks-up-by-node: a package that loads a nested copy says nothing about the copy at the top", () => {
    const after = { "node_modules/fixed": { version: "1.0.1", dependencies: { dep: "^2.0.0" } }, "node_modules/fixed/node_modules/dep": { version: "2.0.0" }, "node_modules/dep": { version: "1.5.0" }, "node_modules/stay": { version: "1.0.0", dependencies: { dep: "^1.0.0" } } };
    expect(unneededMoves(lockOf(base), lockOf(after), plan)).toEqual([moved("1.0.0", "1.5.0")]);
  });
  it("moves-another-package: another package at the path is refused, whatever its range", () => {
    const after = { "node_modules/fixed": { version: "1.0.1", dependencies: { dep: "^1.1.0" } }, "node_modules/dep": { name: "evil", version: "1.1.0" }, "node_modules/stay": { version: "1.0.0", dependencies: { dep: "^1.0.0" } } };
    expect(unneededMoves(lockOf(base), lockOf(after), plan)).toEqual([moved("1.0.0", "1.1.0")]);
  });
  it("moves-removed: a removal is allowed when all that loaded the path has moved, not when one stays or none did", () => {
    const only = { "node_modules/fixed": { version: "1.0.0", dependencies: { dep: "^1.0.0" } }, "node_modules/dep": { version: "1.0.0" } };
    expect(unneededMoves(lockOf(only), lockOf({ "node_modules/fixed": { version: "1.0.1" } }), plan)).toEqual([]);
    const gone = { path: "node_modules/dep", name: "dep", from: "1.0.0", to: null };
    expect(unneededMoves(lockOf(base), lockOf({ "node_modules/fixed": { version: "1.0.1" }, "node_modules/stay": { version: "1.0.0", dependencies: { dep: "^1.0.0" } } }), plan)).toEqual([gone]);
    expect(unneededMoves(lockOf({ "node_modules/fixed": { version: "1.0.0" }, "node_modules/dep": { version: "1.0.0" } }), lockOf({ "node_modules/fixed": { version: "1.0.1" } }), plan)).toEqual([gone]);
    expect(unneededMoves(lockOf(only, { name: "app", dependencies: { dep: "^1.0.0" } }), lockOf({ "node_modules/fixed": { version: "1.0.1" } }, { name: "app", dependencies: { dep: "^1.0.0" } }), plan)).toEqual([gone]);
  });
  it("moves-nothing: the fix's own path, an unchanged path and a flag change are not moves", () => {
    const after = { "node_modules/fixed": { version: "1.0.1", dependencies: { dep: "^1.0.0" } }, "node_modules/dep": { version: "1.0.0", dev: true }, "node_modules/stay": { version: "1.0.0", dependencies: { dep: "^1.0.0" } } };
    expect(unneededMoves(lockOf(base), lockOf(after), plan)).toEqual([]);
  });
});

describe("the script in the resolver's container", () => {
  /** The script with npm's modules replaced: `real` records what npm's own manifest function would be asked. */
  function load(table: Record<string, string | null>) {
    const asked: unknown[] = [];
    const pacote: Record<string, any> = { manifest: async (spec: unknown, opts: unknown) => { asked.push([spec, opts]); return { spec }; } };
    let started: string | null = null;
    const npa = (spec: string) => { const at = spec.lastIndexOf("@"); return { type: "version", registry: true, name: spec.slice(0, at), rawSpec: spec.slice(at + 1) }; };
    const process = { argv: ["node", "script"] };
    const sandbox: Record<string, unknown> = { process, __dirname: "/opt/x", Object, JSON, String, Error, Promise, require: (id: string) => {
      if (id === "node:fs") return { readFileSync: (path: string) => { expect(path).toBe("/opt/x/table.json"); return JSON.stringify(table); } };
      if (id.endsWith("node_modules/pacote")) return pacote;
      if (id.endsWith("node_modules/npm-package-arg")) return npa;
      if (id.endsWith("bin/npm-cli.js")) { started = id; return {}; }
      throw new Error(`unexpected require: ${id}`);
    } };
    runInContext(resolverScript(["--ignore-scripts", "--allow-git=none"]), createContext(sandbox));
    return { pacote, asked, process, started: () => started };
  }
  it("script-answers: a range becomes the table's exact version, an alias keeps its name, and it starts npm's own install", async () => {
    const { pacote, asked, process, started } = load({ "dep@^1.0.0": "1.0.0", "dep@*": "1.1.0" });
    await pacote.manifest({ type: "range", registry: true, name: "dep", rawSpec: "^1.0.0" }, { a: 1 });
    await pacote.manifest({ type: "range", registry: true, name: "dep", rawSpec: "" }, {});
    await pacote.manifest({ type: "alias", name: "mine", subSpec: { type: "range", registry: true, name: "dep", rawSpec: "^1.0.0" } }, {});
    await pacote.manifest("dep@^1.0.0", {});
    expect(asked.map(a => (a as unknown[])[0])).toEqual(["dep@1.0.0", "dep@1.1.0", "mine@npm:dep@1.0.0", "dep@1.0.0"]);
    expect((asked[0] as unknown[])[1]).toEqual({ a: 1 });
    expect(process.argv.slice(1)).toEqual(["/usr/local/lib/node_modules/npm/bin/npm-cli.js", "install", "--package-lock-only", "--ignore-scripts", "--allow-git=none"]);
    expect(started()).toBe("/usr/local/lib/node_modules/npm/bin/npm-cli.js");
  });
  it("script-no-answer: nothing allowed and a question the table does not hold fail that question, and never reach npm's own function", async () => {
    const { pacote, asked } = load({ "dep@^1.0.0": null });
    await expect(pacote.manifest({ type: "range", registry: true, name: "dep", rawSpec: "^1.0.0" }, {})).rejects.toThrow("LUDION_NO_ANSWER dep@^1.0.0 (nothing allowed)");
    await expect(pacote.manifest({ type: "range", registry: true, name: "other", rawSpec: "^1.0.0" }, {})).rejects.toThrow("LUDION_NO_ANSWER other@^1.0.0 (not in the table)");
    await expect(pacote.manifest({ type: "tag", registry: true, name: "__proto__", rawSpec: "x" }, {})).rejects.toThrow("not in the table");
    expect(asked).toEqual([]);
  });
  it("script-other-specs: a Git or URL spec goes to npm, whose flags refuse it", async () => {
    const { pacote, asked } = load({});
    const git = { type: "git", registry: false, name: "dep", rawSpec: "github:o/r" };
    await pacote.manifest(git, {});
    expect((asked[0] as unknown[])[0]).toBe(git);
  });
  it("script-table: the file holds versions and nulls only; the error text names the requirement, and the table says why", () => {
    const answers = { "dep@^1.0.0": { requirement: "dep@^1.0.0", name: "dep", version: null, role: null, published_at: null, passed_over: [], excluded: { in_range: 1, no_time: 0, after_t: 0, withdrawn: 0, deprecated: 1, advisory: 0 }, reason: "nothing is left in range: 1 in range" }, "a@1": { requirement: "a@1", name: "a", version: "1.0.0", role: "oldest", published_at: null, passed_over: [], excluded: { in_range: 1, no_time: 0, after_t: 0, withdrawn: 0, deprecated: 0, advisory: 0 } } } as ResolutionTable["answers"];
    const table: ResolutionTable = { t: "x", t_note: "", answers, v: {}, locked: new Set(), publishedAt: async () => null };
    expect(JSON.parse(tableFile(table))).toEqual({ "dep@^1.0.0": null, "a@1": "1.0.0" });
    const text = "#13 1.546 npm error LUDION_NO_ANSWER dep@^1.0.0 (nothing allowed)\n";
    expect(noAnswerIn(text)).toBe("dep@^1.0.0");
    expect(noAnswerIn("npm error code ERESOLVE")).toBeNull();
    expect(noAnswerIn("npm error LUDION_NO_ANSWER dep@>=1.0.0 <2 || 3.x (nothing allowed)\nnpm error A complete log")).toBe("dep@>=1.0.0 <2 || 3.x");
    expect(noAnswerIn("npm error LUDION_NO_ANSWER dep@^1 (not in the table)")).toBe("dep@^1");
    expect(noAnswerIn("LUDION_NO_ANSWER cut off by Docker's limit")).toBeNull();
    expect(noAnswerReason(table, "dep@^1.0.0")).toEqual({ stopped_no_allowed: true, reason: expect.stringContaining("nothing is left in range") });
    expect(noAnswerReason(table, "dep@^1.0.0").reason).toContain("no newer or excluded version is taken");
    expect(noAnswerReason(table, "b@^1.0.0")).toEqual({ stopped_no_allowed: false, reason: expect.stringContaining("does not hold") });
  });
  it("receipt-size: the receipt keeps the answers the diff used and those with none, not the whole table", () => {
    const answers: ResolutionTable["answers"] = {};
    const row = (i: number, version: string | null) => ({ requirement: `p${i}@1`, name: `p${i}`, version, role: version ? "oldest" as const : null, published_at: null, passed_over: [], excluded: { in_range: 1, no_time: 0, after_t: 0, withdrawn: 0, deprecated: 0, advisory: 0 } });
    for (let i = 0; i < 5000; i++) answers[`p${i}@1`] = row(i, "1.0.0");
    answers["none@1"] = { ...row(9999, null), requirement: "none@1", name: "none" };
    const kept = fixResolution({ t: "x", t_note: "", answers, v: {}, locked: new Set(), publishedAt: async () => null }, [{ name: "p7", to: "1.0.0" }]);
    expect(kept.requirements).toBe(5001);
    expect(kept.answers.map(a => a.requirement)).toEqual(["p7@1", "none@1"]);
    const many = Array.from({ length: RECEIPT_ANSWERS + 50 }, (_, i) => ({ name: `p${i}`, to: "1.0.0" }));
    expect(fixResolution({ t: "x", t_note: "", answers, v: {}, locked: new Set(), publishedAt: async () => null }, many).answers).toHaveLength(RECEIPT_ANSWERS);
  });
  it("script-short: its Dockerfile line stays short, so a failure's reason stays in the end of Docker's text", () => {
    expect(resolverScript([]).length).toBeLessThan(2000);
  });
});
