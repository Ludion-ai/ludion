// The lock reader against what npm writes and what npm reports (docs/decisions/2026-10-31-lock-corpus-against-npm.md and
// docs/decisions/2026-10-31-lock-corpus-npm12.md). The corpus under fixtures/npm-corpus/ was written once by npm 7.10.0,
// 8.19.4, 9.8.1, 10.8.2, 11.19.1 and 12.2.1 in node images pinned by digest (docs/bench/2026-10-31-lb2a-npm-corpus), and
// npm 12.2.1 and npm 11.19.1 each reported on every lock. The first tests read only those files; the last runs npm
// 12.2.1 again in Docker.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { computedFlags, lockEntries, newUnmetRequirements, readLock, unmetRequirements, writtenFlags } from "../src/security/judge.ts";

const root = new URL("fixtures/npm-corpus/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
type Entry = { npm: string; asked: string; shape: string; written: boolean; lockfileVersion?: number; variants?: string[] };
const corpus = JSON.parse(read("corpus.json")) as Entry[];
const written = corpus.filter(e => e.written);
const dir = (e: Entry) => `${e.npm}/${e.asked}/${e.shape}/`;
/** Every lock of the corpus, as its folder: each written base, then its variants. */
const locks = written.flatMap(e => [dir(e), ...(e.variants ?? []).map(v => `${dir(e)}variants/${v}/`)]);

/** main's reader (judge.ts at c84d73c): any JSON with `packages` and lockfileVersion 2 or 3. */
function mainReads(text: string): boolean {
  try { const lock = JSON.parse(text); return !!lock.packages && typeof lock.packages === "object" && [2, 3].includes(Number(lock.lockfileVersion)); } catch { return false; }
}
const prReads = (text: string) => { try { readLock(text); lockEntries(text); return true; } catch { return false; } };
/**
 * npm's counted problems (missing, invalid) in an `npm ls --all --package-lock-only --json` report. An `invalid` line
 * names the copy's folder; the project's own folder in it is cut, so a base and its variant name a copy alike.
 */
const countedIn = (report: string) => new Set<string>(((JSON.parse(report) as { problems?: string[] }).problems ?? [])
  .filter(p => /^(missing|invalid): /.test(p)).map(p => p.replace(/ \/(?:out|tmp\/w)\/[^ ]*?\/v\d\/[^/ ]+\/(?:variants\/V\d\/)?/, " <project>/")));
const counted = (lock: string, npm: string) => countedIn(read(`${lock}ls-${npm}.json`));
/** Whether npm's report on a variant has a counted problem its report on the base has not. */
const npmUnmet = (e: Entry, v: string, npm: string) => { const base = counted(dir(e), npm); return [...counted(`${dir(e)}variants/${v}/`, npm)].some(p => !base.has(p)); };
const npmVersions = ["10.8.2", "11.19.1", "12.2.1", "7.10.0", "8.19.4", "9.8.1"];

describe("the npm corpus", () => {
  it("holds what the decisions asked for: npm 7 to 12, lockfileVersion 2 and 3, every shape, two reports on each lock", () => {
    expect([...new Set(corpus.map(e => e.npm))]).toEqual(npmVersions);
    expect(written).toHaveLength(72);
    // npm 7.10.0 writes v2 when v3 is asked; bundled entries are not written from manifests alone.
    expect(written.filter(e => e.asked === "v3" && e.lockfileVersion === 2).map(e => e.npm)).toEqual(Array(6).fill("7.10.0"));
    expect(corpus.filter(e => !e.written).map(e => e.shape)).toEqual(Array(12).fill("bundled"));
    expect([...new Set(written.map(e => e.shape))].sort()).toEqual(["alias", "legacy-peer-deps", "nested-overrides", "overrides", "peer-devoptional-alias", "workspaces"]);
    expect(locks).toHaveLength(72 + 320);
    for (const lock of locks) for (const npm of ["12.2.1", "11.19.1"]) expect(() => counted(lock, npm), `${lock} ${npm}`).not.toThrow();
  });

  it("G3: reads every lock npm writes", () => {
    const unread = written.filter(e => !prReads(read(`${dir(e)}package-lock.json`))).map(e => `${dir(e)}: ${(() => { try { lockEntries(read(`${dir(e)}package-lock.json`)); return ""; } catch (error) { return String(error); } })()}`);
    expect(unread).toEqual([]);
  });

  it("G1: reads every lock and variant that main's reader reads (no narrowing)", () => {
    const narrowed = locks.filter(lock => { const text = read(`${lock}package-lock.json`); return mainReads(text) && !prReads(text); });
    expect(narrowed).toEqual([]);
  });

  /** Each variant with npm 12.2.1's answer (a new missing or invalid) and Ludion's (newUnmetRequirements). */
  const answers = written.flatMap(e => {
    const baseText = read(`${dir(e)}package-lock.json`), manifest = JSON.parse(read(`${dir(e)}package.json`)) as unknown;
    return (e.variants ?? []).map(v => ({ at: `${dir(e)}variants/${v}/`, v, npm: npmUnmet(e, v, "12.2.1"), ours: newUnmetRequirements({ lock: baseText, manifest }, { lock: read(`${dir(e)}variants/${v}/package-lock.json`), manifest }) }));
  });

  // G2 is judged against npm 12.2.1, which writes Ludion's candidates (docs/decisions/2026-10-31-lock-corpus-npm12.md),
  // on every variant but V3 (next test).
  it("G2: apart from V3, a change leaves a requirement unmet exactly when npm 12.2.1 reports a new missing or invalid", () => {
    expect(answers).toHaveLength(320);
    const disagree = answers.filter(a => a.v !== "V3" && a.npm !== a.ours.length > 0).map(a => `${a.at}: npm ${a.npm ? "reports" : "does not report"} a new problem; Ludion ${a.ours.length ? `finds ${a.ours[0]}` : "finds none"}`);
    expect(disagree).toEqual([]);
  });

  // V3 adds `name: "left-pad"` at a location a range requires. npm ls does not look at which package a location holds:
  // it checks a range against the copy's version only. Ludion does look, and refuses: the package at a location must be
  // the one its spec names (docs/decisions/2026-10-31-lock-corpus-alias.md). So the expected answer is fixed as
  // "refused", whatever npm reports.
  it("V3: npm ls does not look at a package's identity; Ludion does, and refuses every V3", () => {
    const v3 = answers.filter(a => a.v === "V3");
    expect(v3).toHaveLength(72);
    expect(v3.filter(a => !a.ours.length).map(a => a.at)).toEqual([]);
    for (const a of v3) expect(a.ours.join("\n"), a.at).toMatch(/has left-pad@\S+, which is not that\./);
    // npm reports nothing new for 68 of them. The other four are npm 7.10.0's overrides locks, whose copy npm 12.2.1
    // already finds outside the project's override in the base (npm 7 does not read overrides); it reports the renamed
    // copy as a new invalid line ("minimist@npm:left-pad@1.2.8").
    expect(v3.filter(a => a.npm).map(a => a.at)).toEqual(["7.10.0/v2/nested-overrides/variants/V3/", "7.10.0/v2/overrides/variants/V3/", "7.10.0/v3/nested-overrides/variants/V3/", "7.10.0/v3/overrides/variants/V3/"]);
  });

  // A1 and A2 (docs/decisions/2026-10-31-lock-corpus-alias.md): the locks npm writes with an alias under another real
  // package's name, at the top (`"minimist": "npm:left-pad@1.3.0"`) and nested (a workspace's `"is-number":
  // "npm:left-pad@1.2.0"`, beside the project's is-number 7.0.0), are read and leave no requirement unmet.
  it("A1, A2: every alias lock npm 7 to 12 wrote is read and taken, at the top and nested", () => {
    const alias = written.filter(e => e.shape === "alias");
    expect(alias).toHaveLength(12);
    for (const e of alias) {
      const text = read(`${dir(e)}package-lock.json`), manifest = JSON.parse(read(`${dir(e)}package.json`)) as unknown;
      expect(mainReads(text), dir(e)).toBe(true);
      expect(prReads(text), dir(e)).toBe(true);
      expect([...unmetRequirements(text, manifest).values()], dir(e)).toEqual([]);
      const entries = lockEntries(text);
      expect(entries.find(x => x.path === "node_modules/minimist"), dir(e)).toMatchObject({ name: "left-pad", version: "1.3.0" });
      expect(entries.find(x => x.path === "node_modules/mkdirp/node_modules/minimist"), dir(e)).toMatchObject({ name: "minimist", version: "0.0.8" });
      expect(entries.find(x => /^(?:packages\/a|node_modules\/a)\/node_modules\/is-number$/.test(x.path)), dir(e)).toMatchObject({ name: "left-pad", version: "1.2.0" });
      expect(counted(dir(e), "12.2.1"), dir(e)).toEqual(new Set());
    }
  });

  it("npm 11.19.1 and npm 12.2.1 say the same of every variant", () => {
    const differ = written.flatMap(e => (e.variants ?? []).filter(v => npmUnmet(e, v, "11.19.1") !== npmUnmet(e, v, "12.2.1")).map(v => `${dir(e)}variants/${v}/`));
    expect(differ).toEqual([]);
  });
});

// The locks added for review 6538813186 (docs/decisions/2026-10-31-lock-flags-only.md), under fixtures/npm-corpus/extra/,
// written as the corpus was (docs/bench/2026-10-31-lb2a-npm-corpus/scripts/gen-extra.sh).
const inBundle = npmVersions.flatMap(npm => ["v2", "v3"].map(v => `extra/inbundle/${npm}/${v}/`));
const nodeFetch = ["v2", "v3"].flatMap(v => [`extra/node-fetch/${v}/base/`, `extra/node-fetch/${v}/fix/`]);
// LFLAGS (docs/decisions/2026-10-31-lock-flags-from-graph.md, section 3; docs/bench/2026-10-31-lflags): X1, X2, X4 and X5,
// written by npm 12.2.1, and the forged variants B, C, E, P and R of extra/node-fetch's fix locks.
const pairs = ["optional", "peer", "optional-peer-other", "optional-peer-in-range"].flatMap(x => ["v2", "v3"].flatMap(v => [`extra/${x}/${v}/base/`, `extra/${x}/${v}/fix/`]));
const forgedPeers = ["B", "C", "E", "P", "R"].flatMap(x => ["v2", "v3"].map(v => `extra/optional-peer-forged/${x}/${v}/`));
const extraLocks = [...inBundle, ...nodeFetch, ...pairs, ...forgedPeers];

describe("the npm corpus's bundled entries and B1's pair", () => {
  // N1: npm 10.9.2 bundles its dependencies, so every npm writes its 215 of them as inBundle entries.
  it("N1: every lock with inBundle entries npm 7 to 12 wrote is read by main's reader and this one, and leaves no requirement unmet", () => {
    expect(inBundle).toHaveLength(12);
    for (const lock of inBundle) {
      const text = read(`${lock}package-lock.json`), manifest = JSON.parse(read(`${lock}package.json`)) as unknown;
      expect(Number(read(`${lock}npm.exit`)), lock).toBe(0);
      expect(JSON.parse(text).lockfileVersion, lock).toBe(lock.startsWith("extra/inbundle/7.10.0/") || lock.endsWith("/v2/") ? 2 : 3);
      expect(Object.values(JSON.parse(text).packages as Record<string, { inBundle?: boolean }>).filter(e => e.inBundle === true), lock).toHaveLength(215);
      expect(mainReads(text), lock).toBe(true);
      expect(prReads(text), lock).toBe(true);
      expect(lockEntries(text), lock).toHaveLength(216);
      expect([...unmetRequirements(text, manifest).values()], lock).toEqual([]);
      for (const npm of ["12.2.1", "11.19.1"]) expect(counted(lock, npm), `${lock} ${npm}`).toEqual(new Set());
    }
  });

  // N2: a changed lock npm takes. G2's other variants are all ones npm reports.
  it("N2: B1's node-fetch fix, which npm 12.2.1 wrote and reports nothing new on, leaves no requirement unmet", () => {
    for (const v of ["v2", "v3"]) {
      const [base, fix] = [`extra/node-fetch/${v}/base/`, `extra/node-fetch/${v}/fix/`];
      for (const lock of [base, fix]) {
        expect(Number(read(`${lock}npm.exit`)), lock).toBe(0);
        expect(JSON.parse(read(`${lock}package-lock.json`)).lockfileVersion, lock).toBe(Number(v.slice(1)));
        expect(mainReads(read(`${lock}package-lock.json`)) && prReads(read(`${lock}package-lock.json`)), lock).toBe(true);
      }
      for (const npm of ["12.2.1", "11.19.1"]) expect([...counted(fix, npm)].filter(p => !counted(base, npm).has(p)), `${v} ${npm}`).toEqual([]);
      const side = (lock: string) => ({ lock: read(`${lock}package-lock.json`), manifest: JSON.parse(read(`${lock}package.json`)) as unknown });
      expect(newUnmetRequirements(side(base), side(fix)), v).toEqual([]);
    }
  });
});

describe("LFLAGS: the flags from the lock's graph, and optional peers (docs/decisions/2026-10-31-lock-flags-from-graph.md)", () => {
  const side = (lock: string) => ({ lock: read(`${lock}package-lock.json`), manifest: JSON.parse(read(`${lock}package.json`)) as unknown });
  const newProblems = (base: string, lock: string, npm: string) => [...counted(lock, npm)].filter(p => !counted(base, npm).has(p));

  /** Every lock npm wrote, with the npm that wrote it. X4's fix lock is its base's (npm stopped), so it counts once. */
  const npmWrote = [
    ...written.map(e => ({ lock: dir(e), npm: e.npm })),
    ...inBundle.map(lock => ({ lock, npm: lock.split("/")[2]! })),
    ...[...nodeFetch, ...pairs.filter(p => !p.startsWith("extra/optional-peer-other/") || p.endsWith("/base/"))].map(lock => ({ lock, npm: "12.2.1" })),
  ];
  /** Each entry whose written flags are not the computed ones, as "lock path: written / computed". */
  const differences = (lock: string) => {
    const text = read(`${lock}package-lock.json`), computed = computedFlags(text);
    return Object.entries(readLock(text)).filter(([path]) => computed.has(path)).map(([path, item]) => [path, writtenFlags(item), computed.get(path)] as const)
      .filter(([, w, c]) => w !== c).map(([path, w, c]) => `${lock}${path}: ${w || "none"} / ${c || "none"}`);
  };

  it("F1: the computed flags are the ones npm 12.2.1 wrote, at every entry of every lock it wrote", () => {
    const ours = npmWrote.filter(l => l.npm === "12.2.1");
    expect(ours).toHaveLength(12 + 2 + 4 + 14);
    // Every lock has flags to compute: the corpus's and the extra locks' entries number in the thousands.
    expect(ours.reduce((n, l) => n + computedFlags(read(`${l.lock}package-lock.json`)).size, 0)).toBeGreaterThan(400);
    expect(ours.flatMap(l => differences(l.lock))).toEqual([]);
  });

  it("F1: the other npm versions' locks, as they are", () => {
    const other = npmWrote.filter(l => l.npm !== "12.2.1");
    expect(other).toHaveLength(60 + 10);
    expect(other.flatMap(l => differences(l.lock))).toEqual([]);
  });

  it("X1, X2, X5: npm 12.2.1 writes the fix, reports nothing new on it, and Ludion finds no requirement unmet", () => {
    for (const x of ["optional", "peer", "optional-peer-in-range"]) for (const v of ["v2", "v3"]) {
      const [base, fix] = [`extra/${x}/${v}/base/`, `extra/${x}/${v}/fix/`];
      for (const lock of [base, fix]) {
        expect(Number(read(`${lock}npm.exit`)), lock).toBe(0);
        expect(JSON.parse(read(`${lock}package-lock.json`)).lockfileVersion, lock).toBe(Number(v.slice(1)));
      }
      for (const npm of ["12.2.1", "11.19.1"]) expect(newProblems(base, fix, npm), `${fix} ${npm}`).toEqual([]);
      expect(newUnmetRequirements(side(base), side(fix)), fix).toEqual([]);
    }
  });

  it("X4: npm 12.2.1 refuses the fix whose optional peer finds another package (ERESOLVE), so rule 2 refuses nothing npm writes", () => {
    for (const v of ["v2", "v3"]) {
      const [base, fix] = [`extra/optional-peer-other/${v}/base/`, `extra/optional-peer-other/${v}/fix/`];
      expect(Number(read(`${base}npm.exit`)), base).toBe(0);
      expect(Number(read(`${fix}npm.exit`)), fix).toBe(1);
      expect(read(`${fix}npm.log`), fix).toContain("npm error code ERESOLVE");
      expect(read(`${fix}npm.log`), fix).toContain("peerOptional encoding@\"^0.1.0\" from node-fetch@2.6.7");
      expect(read(`${fix}package-lock.json`), fix).toBe(read(`${base}package-lock.json`));
    }
  });

  // Each step of the computation on a small graph (arborist's calc-dep-flags.js and node.js `_loadDeps` of npm 12.2.1).
  it("computedFlags, step by step", () => {
    const flags = (packages: Record<string, unknown>) => Object.fromEntries(computedFlags(JSON.stringify({ name: "x", lockfileVersion: 3, packages })));
    const v = (more: Record<string, unknown> = {}) => ({ version: "1.0.0", ...more });
    // dev, optional, and devOptional where the dev and optional trees meet; written without dev and optional.
    expect(flags({ "": { devDependencies: { a: "1" }, optionalDependencies: { b: "1" }, dependencies: { p: "1" } }, "node_modules/a": v({ dependencies: { c: "1" } }), "node_modules/b": v({ dependencies: { c: "1" } }), "node_modules/c": v(), "node_modules/p": v() }))
      .toEqual({ "node_modules/a": "dev", "node_modules/b": "optional", "node_modules/c": "devOptional", "node_modules/p": "" });
    // A required peer of a production package keeps `peer`; an optional peer leaves its target extraneous; a peer that
    // the package also lists as a dependency is a dependency (a later group replaces an earlier one).
    const peers = (b: Record<string, unknown>) => flags({ "": { dependencies: { a: "1" } }, "node_modules/a": v(b), "node_modules/b": v() })["node_modules/b"];
    expect(peers({ peerDependencies: { b: "1" } })).toBe("peer");
    expect(peers({ peerDependencies: { b: "1" }, peerDependenciesMeta: { b: { optional: true } } })).toBe("extraneous");
    expect(peers({ peerDependencies: { b: "1" }, dependencies: { b: "1" } })).toBe("");
    // devDependencies come last at the root: npm 12.2.1 writes `dev` on a package the project lists in both groups
    // (docs/bench/2026-10-31-lflags/logs/probe-dev-and-prod.log).
    expect(flags({ "": { dependencies: { b: "1" }, devDependencies: { b: "1" } }, "node_modules/b": v() })).toEqual({ "node_modules/b": "dev" });
    // An installed package's devDependencies are not installed for it.
    expect(peers({ devDependencies: { b: "1" } })).toBe("extraneous");
    // A workspace: the root's edge to its link, which passes its flags to the folder; a link a dev dependency reaches.
    expect(flags({ "": { workspaces: ["packages/*"] }, "node_modules/a": { resolved: "packages/a", link: true }, "packages/a": { name: "a", version: "1.0.0", dependencies: { b: "1" } }, "node_modules/b": v() }))
      .toEqual({ "packages/a": "", "node_modules/b": "" });
    expect(flags({ "": { devDependencies: { a: "*" } }, "node_modules/a": { resolved: "packages/a", link: true }, "packages/a": { name: "a", version: "1.0.0", dependencies: { b: "1" } }, "node_modules/b": v() }))
      .toEqual({ "packages/a": "dev", "node_modules/b": "dev" });
    // A package that is not extraneous makes the extraneous one it is installed under not extraneous (its other flags stay).
    expect(flags({ "": { dependencies: { x: "*" } }, "node_modules/x": { resolved: "node_modules/a/node_modules/c", link: true }, "node_modules/a": v(), "node_modules/a/node_modules/c": v() }))
      .toEqual({ "node_modules/a": "dev,optional,peer", "node_modules/a/node_modules/c": "" });
    // What nothing reaches, and a lock with no root entry.
    expect(flags({ "node_modules/a": v() })).toEqual({ "node_modules/a": "extraneous" });
  });

  // P1: npm's own report on each forged variant, as it is. Ludion refuses every one (deliver.test.ts); here, which ones
  // the requirement check refuses (rule 2), and that R, in range, is left to the walk (rule 1).
  it("P1: npm reports C and E, not B, P or R; Ludion's requirement check finds B, C, E and P unmet, and R met", () => {
    for (const v of ["v2", "v3"]) for (const x of ["B", "C", "E", "P", "R"]) {
      const lock = `extra/optional-peer-forged/${x}/${v}/`, base = `extra/node-fetch/${v}/fix/`;
      for (const npm of ["12.2.1", "11.19.1"]) expect(newProblems(base, lock, npm).length > 0, `${lock} ${npm}`).toBe(x === "C" || x === "E");
      expect(newUnmetRequirements(side(`extra/node-fetch/${v}/base/`), side(lock)).length > 0, lock).toBe(x !== "R");
    }
    // R's encoding, reached only through node-fetch's optional peer, stays extraneous, as npm 12.2.1 computes it.
    expect(computedFlags(read("extra/optional-peer-forged/R/v3/package-lock.json")).get("node_modules/node-fetch/node_modules/encoding")).toBe("extraneous");
  });

  // Rule 2 for the project's own optional peers too (judge.ts, projects): present, the copy must be in range; missing, met.
  it("the project's optional peer: met when missing, checked when there", () => {
    const lock = (x: Record<string, unknown> | null) => JSON.stringify({ name: "x", lockfileVersion: 3, packages: { "": { peerDependencies: { x: "^1.0.0" }, peerDependenciesMeta: { x: { optional: true } } }, ...(x ? { "node_modules/x": x } : {}) } });
    expect([...unmetRequirements(lock(null)).values()]).toEqual([]);
    expect([...unmetRequirements(lock({ version: "1.2.0", peer: true })).values()]).toEqual([]);
    expect(newUnmetRequirements({ lock: lock({ version: "1.2.0" }) }, { lock: lock({ version: "2.0.0" }) })).toEqual(["package-lock.json's packages: the project requires x ^1.0.0, and node_modules/x has x@2.0.0, which is not that."]);
  });
});

// npm 12.2.1's reports are npm's own: it runs again in Docker, with no network, on every lock. As in action.test.ts, it
// is skipped only when Docker is missing outside CI; in CI it runs, and fails without Docker.
const docker = spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0;
describe.skipIf(!docker && !process.env.CI)("the npm corpus, against npm 12.2.1 run again in Docker", () => {
  const work = mkdtempSync(join(tmpdir(), "ludion-npm-corpus-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("npm 12.2.1's counted problems on every lock, the extra ones included, are the committed ones", () => {
    const image = "ludion-test-npm-12.2.1";
    const build = spawnSync("docker", ["build", "-q", "-t", image, "-"], { input: read("npm-12.2.1.Dockerfile"), encoding: "utf8", timeout: 300_000 });
    expect(build.status, build.stderr).toBe(0);
    // Each lock's folder, then its report's problems as one JSON line.
    writeFileSync(join(work, "ls.sh"), [
      "set -u",
      "cp -r /in /tmp/w && cd /tmp/w",
      "for d in */v*/*/ */v*/*/variants/*/ extra/inbundle/*/v*/ extra/node-fetch/v*/*/ extra/optional/v*/*/ extra/peer/v*/*/ extra/optional-peer-other/v*/*/ extra/optional-peer-in-range/v*/*/ extra/optional-peer-forged/*/v*/; do",
      '  [ -f "$d/package-lock.json" ] || continue',
      '  (cd "$d" && npm ls --all --package-lock-only --json > /tmp/ls.json 2>/dev/null)',
      '  printf "%s\\t" "$d"; node /s/problems.js /tmp/ls.json',
      "done",
    ].join("\n"));
    writeFileSync(join(work, "problems.js"), 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")).problems ?? []));\n');
    chmodSync(work, 0o755);
    const run = spawnSync("docker", ["run", "--rm", "--network", "none", "--cap-drop", "ALL", "--user", "node", "--memory", "2g",
      "-v", `${fileURLToPath(root)}:/in:ro`, "-v", `${work}:/s:ro`, image, "sh", "/s/ls.sh"], { encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    expect(run.status, run.stderr).toBe(0);
    const live = new Map(run.stdout.trim().split("\n").map(line => { const [lock, problems] = line.split("\t"); return [lock!.replace(/\/\/+/g, "/"), countedIn(JSON.stringify({ problems: JSON.parse(problems!) }))]; }));
    expect([...live.keys()].sort()).toEqual([...locks, ...extraLocks].sort());
    const differ = [...locks, ...extraLocks].filter(lock => JSON.stringify([...live.get(lock)!].sort()) !== JSON.stringify([...counted(lock, "12.2.1")].sort()));
    expect(differ).toEqual([]);
  }, 900_000);
});
