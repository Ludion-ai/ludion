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
import { lockEntries, newUnmetRequirements, readLock } from "../src/security/judge.ts";

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
    expect(written).toHaveLength(60);
    // npm 7.10.0 writes v2 when v3 is asked; bundled entries are not written from manifests alone.
    expect(written.filter(e => e.asked === "v3" && e.lockfileVersion === 2).map(e => e.npm)).toEqual(Array(5).fill("7.10.0"));
    expect(corpus.filter(e => !e.written).map(e => e.shape)).toEqual(Array(12).fill("bundled"));
    expect(locks).toHaveLength(60 + 272);
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

  // G2 is judged against npm 12.2.1, which writes Ludion's candidates (docs/decisions/2026-10-31-lock-corpus-npm12.md).
  // It is not met, and this test says by how much: npm takes a copy of another package under a required name (V3,
  // `name: "left-pad"` at a path a range requires) as meeting the range, since it checks a range's version and not the
  // package; Ludion refuses it, and is not changed to take it (docs/bench/2026-10-31-lb2a-npm-corpus/README.md). Every
  // other variant agrees. A new disagreement of any kind fails here.
  it("G2 (not met for V3): a change leaves a requirement unmet exactly when npm 12.2.1 reports a new missing or invalid", () => {
    const disagree: string[] = [];
    let compared = 0;
    for (const e of written) {
      const baseText = read(`${dir(e)}package-lock.json`), manifest = JSON.parse(read(`${dir(e)}package.json`)) as unknown;
      for (const v of e.variants ?? []) {
        const npm = npmUnmet(e, v, "12.2.1");
        const ours = newUnmetRequirements({ lock: baseText, manifest }, { lock: read(`${dir(e)}variants/${v}/package-lock.json`), manifest });
        compared++;
        if (npm !== ours.length > 0) disagree.push(`${dir(e)}variants/${v}/: npm ${npm ? "reports" : "does not report"} a new problem; Ludion ${ours.length ? `finds ${ours[0]}` : "finds none"}`);
      }
    }
    expect(compared).toBe(272);
    const substituted = /\/variants\/V3\/: npm does not report a new problem; Ludion finds package-lock\.json's [^:]+: (?:the project|\S+) requires \S+ [^,]+, and node_modules\/\S+ has left-pad@[^ ]+, which is not that\.$/;
    expect(disagree.filter(d => !substituted.test(d))).toEqual([]);
    // 56 of the 60 V3. The other four agree only because npm 7.10.0, which does not read `overrides`, left the copy
    // outside the override in the base: npm 12.2.1 already reports it invalid there, and reports the renamed copy as a
    // new invalid line ("minimist@npm:left-pad@1.2.8").
    expect(disagree).toHaveLength(56);
    expect(written.filter(e => e.variants?.includes("V3") && !disagree.some(d => d.startsWith(`${dir(e)}variants/V3/`))).map(dir))
      .toEqual(["7.10.0/v2/nested-overrides/", "7.10.0/v2/overrides/", "7.10.0/v3/nested-overrides/", "7.10.0/v3/overrides/"]);
  });

  it("npm 11.19.1 and npm 12.2.1 say the same of every variant", () => {
    const differ = written.flatMap(e => (e.variants ?? []).filter(v => npmUnmet(e, v, "11.19.1") !== npmUnmet(e, v, "12.2.1")).map(v => `${dir(e)}variants/${v}/`));
    expect(differ).toEqual([]);
  });
});

// npm 12.2.1's reports are npm's own: it runs again in Docker, with no network, on every lock. As in action.test.ts, it
// is skipped only when Docker is missing outside CI; in CI it runs, and fails without Docker.
const docker = spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0;
describe.skipIf(!docker && !process.env.CI)("the npm corpus, against npm 12.2.1 run again in Docker", () => {
  const work = mkdtempSync(join(tmpdir(), "ludion-npm-corpus-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("npm 12.2.1's counted problems on every lock are the committed ones", () => {
    const image = "ludion-test-npm-12.2.1";
    const build = spawnSync("docker", ["build", "-q", "-t", image, "-"], { input: read("npm-12.2.1.Dockerfile"), encoding: "utf8", timeout: 300_000 });
    expect(build.status, build.stderr).toBe(0);
    // Each lock's folder, then its report's problems as one JSON line.
    writeFileSync(join(work, "ls.sh"), [
      "set -u",
      "cp -r /in /tmp/w && cd /tmp/w",
      "for d in */v*/*/ */v*/*/variants/*/; do",
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
    expect([...live.keys()].sort()).toEqual([...locks].sort());
    const differ = locks.filter(lock => JSON.stringify([...live.get(lock)!].sort()) !== JSON.stringify([...counted(lock, "12.2.1")].sort()));
    expect(differ).toEqual([]);
  }, 900_000);
});
