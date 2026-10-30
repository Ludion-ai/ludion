// The lock reader against what npm writes and what npm reports (docs/decisions/2026-10-31-lock-corpus-against-npm.md).
// The corpus under fixtures/npm-corpus/ was written once by npm 7.10.0, 8.19.4, 9.8.1, 10.8.2 and 11.19.1 in official
// node images pinned by digest (docs/bench/2026-10-31-lb2a-npm-corpus); these tests read only those files.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lockEntries, newUnmetRequirements, readLock } from "../src/security/judge.ts";

const root = new URL("fixtures/npm-corpus/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
type Entry = { npm: string; asked: string; shape: string; written: boolean; lockfileVersion?: number; variants?: string[] };
const corpus = JSON.parse(read("corpus.json")) as Entry[];
const written = corpus.filter(e => e.written);
const dir = (e: Entry) => `${e.npm}/${e.asked}/${e.shape}/`;

/** main's reader (judge.ts at c84d73c): any JSON with `packages` and lockfileVersion 2 or 3. */
function mainReads(text: string): boolean {
  try { const lock = JSON.parse(text); return !!lock.packages && typeof lock.packages === "object" && [2, 3].includes(Number(lock.lockfileVersion)); } catch { return false; }
}
const prReads = (text: string) => { try { readLock(text); lockEntries(text); return true; } catch { return false; } };
/** npm's counted problems (missing, invalid) in an `npm ls --all --package-lock-only --json` report. */
const counted = (path: string) => new Set<string>((JSON.parse(read(path)) as { problems?: string[] }).problems?.filter(p => /^(missing|invalid): /.test(p)) ?? []);
// npm 7.10.0 has no `npm ls --package-lock-only`: it reports from node_modules, which the corpus does not install, so
// its report cannot say whether a lock meets its requirements (docs/bench/2026-10-31-lb2a-npm-corpus/README.md).
const npmReports = (e: Entry) => e.npm !== "7.10.0";

describe("the npm corpus", () => {
  it("holds what the decision asked for: npm 7 to 11, lockfileVersion 2 and 3, every shape", () => {
    expect([...new Set(corpus.map(e => e.npm))]).toEqual(["10.8.2", "11.19.1", "7.10.0", "8.19.4", "9.8.1"]);
    expect(written).toHaveLength(50);
    // npm 7.10.0 writes v2 when v3 is asked; bundled entries are not written from manifests alone.
    expect(written.filter(e => e.asked === "v3" && e.lockfileVersion === 2).map(e => e.npm)).toEqual(Array(5).fill("7.10.0"));
    expect(corpus.filter(e => !e.written).map(e => e.shape)).toEqual(Array(10).fill("bundled"));
    expect(written.reduce((n, e) => n + (e.variants?.length ?? 0), 0)).toBe(226);
  });

  it("G3: reads every lock npm writes", () => {
    const unread = written.filter(e => !prReads(read(`${dir(e)}package-lock.json`))).map(e => `${dir(e)}: ${(() => { try { lockEntries(read(`${dir(e)}package-lock.json`)); return ""; } catch (error) { return String(error); } })()}`);
    expect(unread).toEqual([]);
  });

  it("G1: reads every lock and variant that main's reader reads (no narrowing)", () => {
    const narrowed: string[] = [];
    for (const e of written) for (const name of ["", ...(e.variants ?? []).map(v => `variants/${v}/`)]) {
      const text = read(`${dir(e)}${name}package-lock.json`);
      if (mainReads(text) && !prReads(text)) narrowed.push(`${dir(e)}${name}`);
    }
    expect(narrowed).toEqual([]);
  });

  // G2 is not met, and this test says by how much: npm 8 to 11 take a copy of another package under a required name
  // (V3, `name: "left-pad"` at a path a range requires) as meeting the range, since npm checks a range's version and
  // not the package; Ludion refuses it, and is not changed to take it (docs/bench/2026-10-31-lb2a-npm-corpus/README.md).
  // Every other variant agrees. A new disagreement of any kind fails here.
  it("G2 (not met for V3): a change leaves a requirement unmet exactly when npm ls reports a new missing or invalid", () => {
    const disagree: string[] = [];
    let compared = 0;
    for (const e of written.filter(npmReports)) {
      const baseText = read(`${dir(e)}package-lock.json`), manifest = JSON.parse(read(`${dir(e)}package.json`)) as unknown, base = counted(`${dir(e)}ls.json`);
      for (const v of e.variants ?? []) {
        const at = `${dir(e)}variants/${v}/`, text = read(`${at}package-lock.json`);
        if (!prReads(text) || !existsSync(new URL(`${at}ls.json`, root))) continue;
        const npmUnmet = [...counted(`${at}ls.json`)].some(p => !base.has(p));
        const ours = newUnmetRequirements({ lock: baseText, manifest }, { lock: text, manifest });
        compared++;
        if (npmUnmet !== ours.length > 0) disagree.push(`${at}: npm ${npmUnmet ? "reports" : "does not report"} a new problem; Ludion ${ours.length ? `finds ${ours[0]}` : "finds none"}`);
      }
    }
    // Every variant of npm 8 to 11 is compared: none is skipped as unread or unreported.
    expect(compared).toBe(written.filter(npmReports).reduce((n, e) => n + (e.variants?.length ?? 0), 0));
    const substituted = /\/variants\/V3\/: npm does not report a new problem; Ludion finds package-lock\.json's [^:]+: (?:the project|\S+) requires (\S+) [^,]+, and node_modules\/(\S+) has left-pad@[^ ]+, which is not that\.$/;
    expect(disagree.filter(d => !substituted.test(d))).toEqual([]);
    expect(disagree.filter(d => substituted.test(d))).toHaveLength(written.filter(npmReports).filter(e => e.variants?.includes("V3")).length);
    expect(disagree).toHaveLength(40);
  });
});
