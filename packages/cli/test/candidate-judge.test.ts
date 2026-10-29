import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateRefusal, judgeNpmCandidate, NO_SPLIT } from "../src/security/candidate-judge.ts";
import { EXPLOITED_UNCOMPARABLE_HOURS, EXTENDED_MIN_HOURS, registryTarball, WAIT_HOURS } from "../src/security/judge.ts";

// A project moves lodash 4.17.20 -> 4.17.21 (the fix, published at T). The candidate also moves helper 1.0.0 -> 1.1.0,
// published before T: a package in the lockfile diff that is not the fix, so every check must reach it too.
const T = "2026-10-01T00:00:00.000Z";
const hours = (h: number) => new Date(Date.parse(T) + h * 3_600_000);
const LATER = hours(24 * 90);

type Version = { published: string; npmUser?: object; deprecated?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; provenance?: { repository: string; workflow: string }; absent?: boolean };
type World = { packages: Record<string, { created?: string; versions: Record<string, Version> }>; osv?: Record<string, string[]>; severity?: string; kev?: boolean; failing?: string };
const integrityOf = (name: string, version: string) => `sha512-${Buffer.from(`${name}@${version}`.padEnd(64, "#")).toString("base64")}`;
const json = (value: unknown) => new Response(JSON.stringify(value));

function base(): World {
  return {
    packages: {
      lodash: { versions: { "4.17.20": { published: "2020-08-13T16:53:54.152Z" }, "4.17.21": { published: T } } },
      helper: { versions: { "1.0.0": { published: "2020-01-01T00:00:00.000Z" }, "1.1.0": { published: "2026-09-01T00:00:00.000Z" } } },
      "old-dep": { versions: { "1.0.0": { published: "2015-01-01T00:00:00.000Z" } } },
    },
    osv: { "lodash@4.17.20": ["GHSA-test-0001"] },
  };
}

/** registry.npmjs.org (packuments and attestations), OSV, KEV and EPSS as the world says. */
function fetchOf(world: World): typeof fetch {
  return async (url, init) => {
    const u = decodeURIComponent(String(url));
    if (world.failing && u.startsWith(world.failing)) return new Response("", { status: 500 });
    if (u === "https://api.osv.dev/v1/querybatch") return json({ results: JSON.parse(String(init?.body)).queries.map((q: any) => ({ vulns: (world.osv?.[`${q.package.name}@${q.version}`] ?? []).map(id => ({ id })) })) });
    if (u.startsWith("https://api.osv.dev/v1/vulns/")) return json({ id: u.split("/").at(-1), aliases: ["CVE-2026-0001"], ...(world.severity ? { database_specific: { severity: world.severity } } : {}) });
    if (u.startsWith("https://www.cisa.gov/")) return json({ vulnerabilities: world.kev ? [{ cveID: "CVE-2026-0001" }] : [] });
    if (u.startsWith("https://api.first.org/")) return json({ data: [] });
    const att = /^https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/attestations\/(.+)@([^@]+)$/.exec(u);
    if (att) {
      const [, name, version] = att as unknown as [string, string, string];
      const v = world.packages[name]!.versions[version]!;
      const sha512 = Buffer.from(integrityOf(name, version).slice(7), "base64").toString("hex");
      const statement = { subject: [{ name: `pkg:npm/${name}@${version}`, digest: { sha512 } }], predicate: { buildDefinition: { externalParameters: { workflow: { repository: v.provenance!.repository, path: v.provenance!.workflow } }, resolvedDependencies: [{ digest: { gitCommit: "a".repeat(40) } }] } } };
      return json({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] });
    }
    const name = u.replace("https://registry.npmjs.org/", ""), doc = world.packages[name];
    if (!doc) return new Response("", { status: 404 });
    const versions = Object.entries(doc.versions).filter(([, v]) => !v.absent).map(([version, v]) => [version, {
      dependencies: v.dependencies ?? {}, _npmUser: v.npmUser ?? { name: "bnjmn" }, scripts: v.scripts, deprecated: v.deprecated,
      dist: { integrity: integrityOf(name, version), ...(v.provenance ? { attestations: { url: "x" } } : {}) },
    }]);
    return json({ time: { created: doc.created ?? Object.values(doc.versions)[0]!.published, ...Object.fromEntries(Object.entries(doc.versions).map(([version, v]) => [version, v.published])) }, versions: Object.fromEntries(versions) });
  };
}

/** A project folder with package.json and package-lock.json: lodash (direct) and the other packages given. */
function project(lodash: string, others: [string, string][], dev: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "ludion-candidate-judge-"));
  const entry = (name: string, version: string) => [`node_modules/${name}`, { version, resolved: registryTarball(name, version), integrity: integrityOf(name, version), ...(dev.includes(name) ? { dev: true } : {}) }];
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", dependencies: { lodash } }));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "app", dependencies: { lodash } }, ...Object.fromEntries([entry("lodash", lodash), ...others.map(([n, v]) => entry(n, v))]) } }));
  return dir;
}
const before = () => project("4.17.20", [["helper", "1.0.0"]]);
const after = (others: [string, string][] = [["helper", "1.1.0"]], dev: string[] = []) => project("4.17.21", others, dev);
const run = (world: World, now = LATER, to = after()) => judgeNpmCandidate(before(), to, fetchOf(world), now);
const stops = (j: Awaited<ReturnType<typeof run>>) => j.findings.filter(f => f.effect === "stop").map(f => f.message);

describe("the judge on a patch candidate: every package in the lockfile diff", () => {
  it("lets a clean candidate go on once the wait is over, counting every version as production", async () => {
    const j = await run(base(), LATER, after([["helper", "1.1.0"]], ["helper"]));
    expect(j.verdict).toBe("ready_except_build");
    expect(j.changes.map(c => `${c.name} ${c.from} -> ${c.to} dev=${c.dev}`)).toEqual(["helper 1.0.0 -> 1.1.0 dev=false", "lodash 4.17.20 -> 4.17.21 dev=false"]);
    expect(j.fixes.map(f => f.id)).toEqual(["GHSA-test-0001"]);
    expect(j.findings[0]).toEqual({ gate: 1, effect: "info", message: NO_SPLIT });
    expect(j.time_cap).toMatchObject({ t: T, targets: ["lodash@4.17.21"], after_t: [], young: [], undecidable: [] });
    expect(candidateRefusal(j)).toBeNull();
  });

  const helperTo = (change: Partial<Version>, from: Partial<Version> = {}): World => {
    const world = base(), helper = world.packages.helper!.versions;
    Object.assign(helper["1.0.0"]!, from); Object.assign(helper["1.1.0"]!, change);
    return world;
  };
  const provenance = { repository: "https://github.com/acme/helper", workflow: ".github/workflows/release.yml" };
  it.each<[string, World, string]>([
    ["lost provenance", helperTo({}, { provenance }), "helper@1.0.0 had build provenance and 1.1.0 has none."],
    ["another repository", helperTo({ provenance: { ...provenance, repository: "https://github.com/evil/helper" } }, { provenance }), "helper@1.1.0 was built from https://github.com/evil/helper"],
    ["another workflow", helperTo({ provenance: { ...provenance, workflow: ".github/workflows/other.yml" } }, { provenance }), "helper@1.1.0 was built from https://github.com/acme/helper .github/workflows/other.yml"],
    ["a new install script", helperTo({ scripts: { postinstall: "node setup.js" } }), "helper@1.1.0 adds install scripts: postinstall."],
    ["a MAL- record", { ...base(), osv: { ...base().osv, "helper@1.1.0": ["MAL-2026-1"] } }, "helper@1.1.0 is in OSV's malicious-package records (MAL-2026-1)."],
    ["deprecation", helperTo({ deprecated: "do not use" }), "helper@1.1.0 is deprecated: do not use"],
    ["withdrawal", helperTo({ absent: true }), "helper@1.1.0 is no longer listed by the registry (unpublished or withdrawn)."],
  ])("stops %s on a package that is not the fix", async (_label, world, message) => {
    const j = await run(world);
    expect(j.verdict).toBe("stop");
    expect(stops(j)).toEqual(expect.arrayContaining([expect.stringContaining(message)]));
    expect(candidateRefusal(j)).toContain("The judge stops the candidate: ");
    expect(candidateRefusal(j)).toContain(message.slice(0, 40));
  });

  it("stops the same checks on the fix itself", async () => {
    const world = base(); world.packages.lodash!.versions["4.17.21"]!.scripts = { preinstall: "curl x" };
    expect(stops(await run(world))).toEqual(["lodash@4.17.21 adds install scripts: preinstall."]);
  });

  it.each<[string, World, [string, string][]]>([
    ["a publisher change", helperTo({ npmUser: { name: "someone-else" } }), [["helper", "1.1.0"]]],
    ["a new dependency", helperTo({ dependencies: { "old-dep": "^1.0.0" } }), [["helper", "1.1.0"], ["old-dep", "1.0.0"]]],
  ])("extends the wait for %s and does not apply before it ends", async (_label, world, others) => {
    const to = after(others);
    const extended = Math.max(WAIT_HOURS.normal * 2, EXTENDED_MIN_HOURS);
    const early = await run(world, hours(WAIT_HOURS.normal + 1), to);
    expect(early).toMatchObject({ verdict: "wait", urgency: "normal", wait_hours: extended, newest_publish: T, wait_until: hours(extended).toISOString() });
    expect(early.findings.some(f => f.effect === "extend")).toBe(true);
    expect(candidateRefusal(early)).toBe(`The judge's wait is not over: not applied before ${hours(extended).toISOString()} (urgency normal, ${extended}h from the newest publish, ${T}). Run the patch again after it.`);
    expect((await run(world, hours(extended), to)).verdict).toBe("ready_except_build");
  });

  it.each<[string, Partial<World>, number]>([
    ["normal", {}, WAIT_HOURS.normal],
    ["high", { severity: "CRITICAL" }, WAIT_HOURS.high],
    // No provenance to compare, so an exploited fix waits 24h instead of 12h.
    ["exploited", { kev: true }, EXPLOITED_UNCOMPARABLE_HOURS],
  ])("waits by the wait table: %s", async (urgency, extra, wait) => {
    const world = { ...base(), ...extra };
    const early = await run(world, hours(wait - 1));
    expect(early).toMatchObject({ verdict: "wait", urgency, wait_hours: wait });
    expect(candidateRefusal(early)).toContain("wait is not over");
    expect((await run(world, hours(wait))).verdict).toBe("ready_except_build");
  });

  it("waits 12h for an exploited fix when every changed version's provenance compares", async () => {
    const world: World = { ...base(), kev: true };
    for (const p of ["lodash", "helper"]) for (const v of Object.values(world.packages[p]!.versions)) v.provenance = { repository: `https://github.com/acme/${p}`, workflow: ".github/workflows/release.yml" };
    expect(await run(world, hours(WAIT_HOURS.exploited - 1))).toMatchObject({ verdict: "wait", urgency: "exploited", wait_hours: WAIT_HOURS.exploited });
  });

  it("cannot decide when a lookup fails, and says so", async () => {
    for (const failing of ["https://registry.npmjs.org/helper", "https://api.osv.dev/", "https://www.cisa.gov/"]) {
      const j = await run({ ...base(), failing });
      expect(j.verdict).toBe("undecidable");
      expect(candidateRefusal(j)).toMatch(/^The judge cannot decide on the candidate: gate 2: A lookup failed: .* answered HTTP 500/);
    }
  });

  it("stops a version the candidate adds after the fix, as the time cap does", async () => {
    const world = base(); world.packages.helper!.versions["1.1.0"]!.published = hours(1).toISOString();
    const j = await run(world, LATER);
    expect(j.verdict).toBe("stop");
    expect(stops(j)).toContain(`helper@1.1.0 was published at or after the fix (T = ${T}); only versions already locked or published before T may move with it.`);
  });
});
