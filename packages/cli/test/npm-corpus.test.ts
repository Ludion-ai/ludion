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
import { lockEntries, newUnmetRequirements, readLock, unmetRequirements } from "../src/security/judge.ts";

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
const extraLocks = [...inBundle, ...nodeFetch];

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
      "for d in */v*/*/ */v*/*/variants/*/ extra/inbundle/*/v*/ extra/node-fetch/v*/*/; do",
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
