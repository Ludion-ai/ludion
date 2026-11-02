// The real cases of gate 3's new type, on examples/nextjs-security: real Docker, real builds, real pages. Used by
// gate3-docker.test.ts and gate3-docker-run.ts. Imports no package, so it can run where the host's Docker socket is.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeGate3, type Gate3Deps, type Gate3Result, type Sides, type Verdict } from "../src/security/gate3.ts";

const read = (path: string) => readFileSync(path, "utf8");
const sides = (dir: string): Sides => ({ manifest: read(join(dir, "package.json")), lock: read(join(dir, "package-lock.json")) });

export const CASES = {
  /** next 15.5.6 -> 15.5.7, the fix of CVE-2025-66478: nothing a page uses changes. */
  a: { expected: "not_broken" as Verdict, title: "an update that breaks nothing" },
  /** lodash 3.10.1 -> 4.17.21: _.pluck is gone, and /report answers 500. The build does not reach the call. */
  b: { expected: "broken" as Verdict, title: "an update that makes one page answer 500" },
  /** The example with every page throwing on old: no page has status 200. */
  c: { expected: "undecidable" as Verdict, title: "no page answers 200 on old" },
  /** A type error the build is told to ignore, and a failing test: both must be seen on every run, and take no part. */
  d: { expected: "not_broken" as Verdict, title: "types and tests that fail on old" },
  /** The same manifest on both sides, on Next.js 16's default build (Turbopack): the box and the crawl hold on it. */
  e: { expected: "not_broken" as Verdict, title: "next 16.4.4 against itself" },
};
export type CaseName = keyof typeof CASES;

export async function runCase(name: CaseName, examples: string, deps: Gate3Deps): Promise<Gate3Result> {
  const app = join(examples, "nextjs-security"), cases = join(examples, "nextjs-security-cases");
  if (name === "a") return judgeGate3({ dir: app, old: sides(app), new: sides(join(cases, "next-15.5.7")) }, deps);
  if (name === "b") return judgeGate3({ dir: app, old: sides(app), new: sides(join(cases, "lodash-4.17.21")) }, deps);
  if (name === "e") return judgeGate3({ dir: app, old: sides(join(cases, "next-16.4.4")), new: sides(join(cases, "next-16.4.4")) }, deps);
  const work = mkdtempSync(join(tmpdir(), "ludion-gate3-case-"));
  try {
    cpSync(app, work, { recursive: true });
    if (name === "c") {
      for (const page of ["app/about", "app/report", "app/items", "pages"]) rmSync(join(work, page), { recursive: true, force: true });
      writeFileSync(join(work, "app", "page.tsx"), 'export const dynamic = "force-dynamic";\nexport default function Home(): never {\n  throw new Error("This page fails on every version.");\n}\n');
    } else {
      writeFileSync(join(work, "lib", "wrong-type.ts"), 'export const count: number = "not a number";\n');
      writeFileSync(join(work, "next.config.mjs"), "export default { typescript: { ignoreBuildErrors: true } };\n");
      writeFileSync(join(work, "tests", "smoke.test.cjs"), 'require("node:test")("fails", () => { throw new Error("This test fails on every version."); });\n');
    }
    return await judgeGate3({ dir: work, old: sides(app), new: sides(join(cases, "next-15.5.7")) }, deps);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** What a case must show besides its verdict; empty when it does. */
export function caseProblems(name: CaseName, result: Gate3Result): string[] {
  const problems: string[] = [];
  const expect = (ok: boolean, what: string) => { if (!ok) problems.push(what); };
  expect(result.verdict === CASES[name].expected, `verdict ${result.verdict}, expected ${CASES[name].expected}: ${JSON.stringify([result.broken, result.undecidable])}`);
  const paths = result.pages.map(p => p.path);
  if (name === "c") {
    expect(result.runs.length === 2, "the new version was run though old has no specification");
    expect(result.specification_pages === 0, "a specification page on old");
    expect(paths.join() === "/", `pages ${paths.join()}`);
    return problems;
  }
  // Both routers' pages are in the list, and their API routes and the dynamic route are not.
  expect(paths.join() === "/,/about,/legacy,/report", `pages ${paths.join()}`);
  expect(result.specification_pages === 4, `${result.specification_pages} specification pages`);
  const report = result.pages.find(p => p.path === "/report");
  // The page draws the time, a random number and an id. With the clock stopped only the id differs between the two runs.
  expect(report?.noise_elements === 1, `${report?.noise_elements} noisy elements on /report`);
  if (name === "d") {
    expect(result.runs.length === 3 && result.runs.every(r => r.run?.types.status === "failed"), "types did not fail on every run");
    expect(result.runs.every(r => r.run?.tests.status === "failed"), "tests did not fail on every run");
    expect(result.notes.some(n => n.startsWith("Types")) && result.notes.some(n => n.startsWith("Tests")), `notes: ${result.notes.join(" ")}`);
  } else if (name === "a" || name === "e") {
    expect(result.pages.every(p => p.dom === "same"), `DOM: ${result.pages.map(p => p.dom).join()}`);
    expect(result.runs.every(r => r.run?.tests.status === "passed"), "tests did not pass on every run");
    expect(result.runs.every(r => r.run?.types.status === "passed"), "types did not pass on every run");
  } else {
    expect(result.broken.some(reason => reason.startsWith("/report answered 500")), `reasons: ${result.broken.join(" ")}`);
    expect(!result.broken.some(reason => !reason.startsWith("/report")), `other pages broke: ${result.broken.join(" ")}`);
  }
  return problems;
}
