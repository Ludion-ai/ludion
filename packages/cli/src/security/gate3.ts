// Gate 3's new type, a first form (docs/decisions/2026-11-02-gate-3-type-definition.md): the old version is the
// specification. One project, its lockfile before and after a fix: build, types, start, a crawl of every GET page and the
// tests, old twice and new once, each in packages/sandbox's box. Nothing calls this from `ludion patch` yet (docs/status.md).
// This file imports only Node.js's own modules and Ludion's, no package: its heavy check runs with the host's Docker socket.
import { randomUUID } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { runContainer, runDockerImageCommand, type ContainerOutcome } from "../../../sandbox/src/docker.ts";
import { BOX_DRIVER, FREEZE_CLOCK, MAX_PAGES, RESULT_MARKER } from "./gate3-box.ts";

/** Runs the crawl: Node.js and Chromium, pinned by digest. The image of the repository's own Playwright version. */
export const BOX_IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27";
/** Acquires dependencies, on a network, from the manifests alone. */
export const ACQUIRE_IMAGE = "node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413";
const BOX_TIMEOUT_MS = 20 * 60_000;
const MAX_ENV_KEYS = 200;

export const LIMITS = [
  "GET pages only: API routes, Server Actions and dynamic routes are not touched, nothing behind a login is seen, and no button or form is pressed.",
  "A page that needs an outside service sees none in the box, on both versions, so only a difference shows.",
  "The candidate's code runs in the same box as the crawl, so a candidate that means harm can write the result it likes: this says whether an update breaks things, not whether it is honest.",
];

export type Sides = { manifest: string; lock: string };
export type Gate3Input = { dir: string; old: Sides; new: Sides };
export type Gate3Deps = {
  /** The project's acquisition policy (dependency-patch.ts's acquisitionPolicy), run on each side's manifests before they are acquired. */
  policy: (manifests: string) => void;
  /** Copies the project without what must not reach a box: project.ts's snapshot, which leaves out credentials, .git and node_modules. */
  snapshot: (root: string, destination: string) => unknown;
  command?: (args: string[], timeoutMs: number) => Promise<string>;
  box?: (name: string, image: string, command: readonly string[], timeoutMs: number) => Promise<ContainerOutcome>;
  /** Keeps the box's stderr in the result. Off by default: the build's messages can quote source. */
  keepLogs?: boolean;
};

export type StepStatus = "passed" | "failed" | "timed_out" | "absent";
export type Gate3Page = { path: string; status: number | null; exceptions: string[]; console: string[]; dom: string[] | null; screenshot: string | null };
export type Gate3Run = {
  build: { status: StepStatus; seconds: number }; types: { status: StepStatus; seconds: number }; start: { status: StepStatus; seconds: number };
  crawl: { status: StepStatus; seconds: number }; tests: { status: StepStatus; seconds: number };
  too_many_pages: boolean; pages: Gate3Page[]; seconds: number;
  /** The peak counts the page cache, so it reaches the box's limit without anything having run out. */
  memory_peak_bytes: number | null; memory_swap_peak_bytes: number | null; memory_oom_kills: number | null;
};
export type Verdict = "not_broken" | "broken" | "undecidable";
export type PageResult = { path: string; role: "specification" | "other"; status: [number | null, number | null, number | null]; dom: "same" | "differs" | "noise" | "not_compared"; noise_elements: number };
export type Comparison = {
  verdict: Verdict; broken: string[]; undecidable: string[]; notes: string[];
  specification_pages: number; broken_on_both: number; pages: PageResult[];
};
export type Gate3Result = Comparison & {
  schema: 1; limits: string[];
  images: { box: string; acquire: string };
  /** Seconds of each step: acquire and image on the host, and each run's own steps in its box. */
  seconds: { pull: number | null; acquire_old: number | null; acquire_new: number | null; image_old: number | null; image_new: number | null; compare: number | null; total: number };
  runs: { label: string; outcome: "ran" | "timed_out" | "unreadable" | "not_run"; run: Omit<Gate3Run, "pages"> | null }[];
  logs?: Record<string, string>;
};

/** A lockfile's acquisition: the same text as dependency-patch.ts's resolverDockerfile("npm", image, false), which a test holds it to. */
export function acquireDockerfile(image: string): string {
  const run = (args: string[]) => `RUN ${JSON.stringify(args)}\n`;
  const flags = ["--ignore-scripts", "--no-audit", "--no-fund", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none", "--registry=https://registry.npmjs.org"];
  return `FROM ${image} AS resolve\nUSER root\nRUN mkdir -p /app /opt/ludion-m2 && chown -R 65534:65534 /app /opt/ludion-m2\nWORKDIR /app\nENV HOME=/tmp COMPOSER_HOME=/tmp/composer MAVEN_CONFIG=/tmp/maven NPM_CONFIG_CACHE=/tmp/npm\n`
    + run(["npm", "install", "--global", "npm@12.2.1", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"])
    + run(["chown", "-R", "65534:65534", "/tmp/npm"])
    + "COPY --chown=65534:65534 manifests/ ./\nUSER 65534:65534\n"
    + run(["node", "-e", "if(require('/usr/local/lib/node_modules/npm/package.json').version!=='12.2.1')process.exit(1)"])
    + run(["npm", "ci", ...flags]);
}

/**
 * The image one side runs in: its acquired dependencies, the source, then the driver. Built with no network. The run
 * writes only to /tmp, so `.next` is a link there, and in a TypeScript project so are the two files the build writes in the
 * project; their contents are kept in /ludion/original, and the driver copies them to the scratch space first. The build
 * looks for next-env.d.ts before writing it and stops on a link to nothing, so without one an empty file stands in.
 */
export function boxDockerfile(acquired: string, image: string): string {
  const typescript = "if [ -f tsconfig.json ]; then cp tsconfig.json /ludion/original/; if [ -f next-env.d.ts ]; then cp next-env.d.ts /ludion/original/; else : > /ludion/original/next-env.d.ts; fi; rm -f tsconfig.json next-env.d.ts; ln -s /tmp/scratch/tsconfig.json tsconfig.json; ln -s /tmp/scratch/next-env.d.ts next-env.d.ts; chown -h 65534:65534 tsconfig.json next-env.d.ts; fi";
  return `FROM ${image}\nUSER root\nCOPY --from=${acquired} --chown=65534:65534 /app /app\nCOPY --chown=65534:65534 source/ /app/\nCOPY --chown=65534:65534 manifests/ /app/\nCOPY ludion/ /ludion/\nWORKDIR /app\n`
    + `RUN ["sh", "-c", "rm -rf /app/.next && ln -s /tmp/next /app/.next && chown -h 65534:65534 /app/.next && mkdir -p /ludion/original && ${typescript} && chmod -R a+rX /ludion"]\nENV HOME=/tmp NPM_CONFIG_CACHE=/tmp/npm\nUSER 65534:65534\n`;
}

/** Keys the driver and Node.js themselves read: a project's .env.example does not set them. */
const RESERVED_ENV = /^(?:NODE_|NPM_|LD_|DYLD_|npm_)|^(?:PATH|HOME|PORT|HOSTNAME|CI|NEXT_TELEMETRY_DISABLED|TMPDIR)$/;

/** The keys of a .env.example, each with a dummy value. Its values are not read: they are the project's data. */
export function dummyEnv(text: string): { env: Record<string, string>; left_out: string[] } {
  const env: Record<string, string> = {}, leftOut: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!key) continue;
    if (RESERVED_ENV.test(key) || Object.keys(env).length >= MAX_ENV_KEYS) { leftOut.push(key); continue; }
    env[key] = /URL|URI|ENDPOINT/i.test(key) ? "http://127.0.0.1:9/" : "ludion-dummy";
  }
  return { env, left_out: leftOut };
}

/** The project's .env.example as text, empty without one. A link or anything too large to be a list of keys is refused. */
function envExample(dir: string): string {
  const path = join(dir, ".env.example");
  let stat;
  try { stat = lstatSync(path); } catch { return ""; }
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error(".env.example is not a regular file of at most 64 KiB.");
  return readFileSync(path, "utf8");
}

const STATUSES: readonly string[] = ["passed", "failed", "timed_out", "absent"];
const isStep = (v: any) => v && typeof v === "object" && STATUSES.includes(v.status) && typeof v.seconds === "number";
const isText = (v: unknown, pattern: RegExp) => typeof v === "string" && pattern.test(v);
const isList = (v: unknown, pattern: RegExp) => Array.isArray(v) && v.every(x => isText(x, pattern));
const HASH8 = /^[a-f0-9]{8}$/, HASH16 = /^(?:server:)?[a-f0-9]{16}$/, CONSOLE = /^[a-zA-Z]{1,20}:[a-f0-9]{16}$/, HASH32 = /^[a-f0-9]{32}$/;

/**
 * The box's result, from its stdout. It is data the candidate's code could have written: anything not in the shape the
 * driver prints is no result. The last marked line counts, and null means none could be read.
 */
export function parseRun(stdout: string): Gate3Run | null {
  const line = stdout.split("\n").reverse().find(l => l.startsWith(RESULT_MARKER));
  if (!line) return null;
  let value: any;
  try { value = JSON.parse(line.slice(RESULT_MARKER.length)); } catch { return null; }
  if (!value || value.schema !== 1 || !["build", "types", "start", "crawl", "tests"].every(k => isStep(value[k]))) return null;
  if (typeof value.too_many_pages !== "boolean" || !Array.isArray(value.pages) || value.pages.length > MAX_PAGES || typeof value.seconds !== "number") return null;
  const paths = new Set<string>();
  for (const p of value.pages) {
    if (!p || !isText(p.path, /^\/[^\s]{0,2000}$|^\/$/) || paths.has(p.path)) return null;
    paths.add(p.path);
    if (p.status !== null && !(Number.isInteger(p.status) && p.status >= 100 && p.status < 600)) return null;
    if (!isList(p.exceptions, HASH16) || !isList(p.console, CONSOLE)) return null;
    if (p.dom !== null && !isList(p.dom, HASH8)) return null;
    if (p.screenshot !== null && !isText(p.screenshot, HASH32)) return null;
  }
  for (const key of ["memory_peak_bytes", "memory_swap_peak_bytes", "memory_oom_kills"]) if (value[key] !== null && typeof value[key] !== "number") return null;
  return { build: value.build, types: value.types, start: value.start, crawl: value.crawl, tests: value.tests, too_many_pages: value.too_many_pages, pages: value.pages, seconds: value.seconds, memory_peak_bytes: value.memory_peak_bytes, memory_swap_peak_bytes: value.memory_swap_peak_bytes, memory_oom_kills: value.memory_oom_kills };
}

const byPath = (run: Gate3Run) => new Map(run.pages.map(p => [p.path, p]));
const isSpecification = (p: Gate3Page | undefined): p is Gate3Page => !!p && p.status === 200 && p.exceptions.length === 0;

/** The pages that are the specification: status 200 and no exception in both runs of old. */
export function specificationPages(a: Gate3Run, b: Gate3Run): string[] {
  const other = byPath(b);
  return a.pages.filter(p => isSpecification(p) && isSpecification(other.get(p.path))).map(p => p.path);
}

/** Why a run of old gives no specification, or null when it can be used. */
function oldProblem(run: Gate3Run, label: string): string | null {
  if (run.build.status !== "passed") return `${label} did not build (${run.build.status}), so nothing can be compared with it.`;
  if (run.too_many_pages) return `${label} has more than ${MAX_PAGES} pages, so not all of them could be opened.`;
  if (run.start.status !== "passed") return `${label}'s server did not start, so no page has a specification.`;
  if (run.crawl.status !== "passed") return `${label}'s crawl did not finish.`;
  return null;
}

/** The definition's table: two runs of old against one of new. Every reason is listed, and broken wins over undecidable. */
export function compareRuns(oldA: Gate3Run, oldB: Gate3Run, next: Gate3Run): Comparison {
  const broken: string[] = [], undecidable: string[] = [], notes: string[] = [], pages: PageResult[] = [];
  const a = byPath(oldA), b = byPath(oldB), n = byPath(next);
  const specification = specificationPages(oldA, oldB), isSpec = new Set(specification);
  let compared = 0, brokenOnBoth = 0;

  if (!specification.length) undecidable.push("No page has status 200 and no exception in both runs of old, so this project and fix have no denominator.");
  if (next.build.status === "failed") broken.push("New did not build; old did.");
  else if (next.build.status !== "passed") undecidable.push(`New's build ${next.build.status === "timed_out" ? "timed out" : "did not run"}.`);
  else if (next.start.status !== "passed") broken.push("New's server did not start; old's did.");
  else if (next.too_many_pages) undecidable.push(`New has more than ${MAX_PAGES} pages, so not all of them could be opened.`);
  else if (next.crawl.status !== "passed") undecidable.push("New's crawl did not finish.");

  for (const [label, step] of [["Types", "types"], ["Tests", "tests"]] as const) {
    if (oldA[step].status === "absent" && oldB[step].status === "absent") continue;
    if (oldA[step].status !== "passed" || oldB[step].status !== "passed") { notes.push(`${label} did not pass on both runs of old, so they take no part in the comparison.`); continue; }
    if (next[step].status === "failed") broken.push(`${label} passed on both runs of old and fail on new.`);
    else if (next[step].status === "timed_out") undecidable.push(`${label} timed out on new.`);
    else if (next[step].status === "absent" && next.build.status === "passed") undecidable.push(`${label} did not run on new.`);
  }

  const newPagesRead = next.build.status === "passed" && next.start.status === "passed" && next.crawl.status === "passed" && !next.too_many_pages;
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const pa = a.get(path), pb = b.get(path), pn = n.get(path);
    const result: PageResult = { path, role: isSpec.has(path) ? "specification" : "other", status: [pa?.status ?? null, pb?.status ?? null, pn?.status ?? null], dom: "not_compared", noise_elements: 0 };
    pages.push(result);
    if (!isSpec.has(path)) {
      const under500 = (p: Gate3Page | undefined) => !!p && p.status !== null && p.status < 500;
      if (under500(pa) && under500(pb) && pn && pn.status !== null && pn.status >= 500) broken.push(`${path} answered under 500 on old and ${pn.status} on new.`);
      else if (pa && pb && pa.status !== 200 && pa.status === pb.status && pn?.status === pa.status) brokenOnBoth++;
      continue;
    }
    if (!newPagesRead) continue;
    if (!pn) { broken.push(`${path} is in old's list of pages and not in new's.`); continue; }
    if (pn.status !== 200) broken.push(`${path} answered ${pn.status ?? "nothing"} on new and 200 on old.`);
    if (pn.exceptions.length) broken.push(`${path} has ${pn.exceptions.length} exception(s) on new and none on old.`);
    const known = new Set([...pa!.console, ...pb!.console]);
    const added = [...new Set(pn.console)].filter(m => !known.has(m));
    const errors = added.filter(m => m.startsWith("error:"));
    if (errors.length) broken.push(`${path} has ${errors.length} console error(s) on new that old did not have.`);
    if (added.length > errors.length) undecidable.push(`${path} has ${added.length - errors.length} console message(s) of another level on new that old did not have.`);

    const domA = pa!.dom, domB = pb!.dom;
    if (!domA || !domB || domA.length !== domB.length) { result.dom = "noise"; notes.push(`${path}'s DOM differs in size between the two runs of old, so it is not compared.`); }
    else {
      compared++;
      const noise = domA.map((h, i) => h !== domB[i]);
      result.noise_elements = noise.filter(Boolean).length;
      const domN = pn.dom;
      if (!domN || domN.length !== domA.length) { result.dom = "differs"; broken.push(`${path}'s DOM has ${domN?.length ?? "no"} elements on new and ${domA.length} on old.`); }
      else {
        const differing = domN.filter((h, i) => !noise[i] && h !== domA[i]).length;
        result.dom = differing ? "differs" : "same";
        if (differing) broken.push(`${path}'s DOM differs from old's in ${differing} element(s) outside the noise.`);
      }
      if (result.dom === "same" && pn.status === 200) {
        if (pa!.screenshot && pa!.screenshot === pb!.screenshot) {
          if (pn.screenshot !== pa!.screenshot) undecidable.push(`${path} has the same DOM, and its screenshot differs from old's.`);
        } else notes.push(`${path}'s screenshot differs between the two runs of old, so it is not compared.`);
      }
    }
  }
  if (specification.length && newPagesRead && !compared) undecidable.push("Every specification page's DOM is noise, so no page's DOM could be compared.");
  const verdict: Verdict = broken.length ? "broken" : undecidable.length ? "undecidable" : "not_broken";
  return { verdict, broken, undecidable, notes, specification_pages: specification.length, broken_on_both: brokenOnBoth, pages };
}

const emptyComparison = (reason: string, notes: string[] = []): Comparison => ({ verdict: "undecidable", broken: [], undecidable: [reason], notes, specification_pages: 0, broken_on_both: 0, pages: [] });
const elapsed = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e9;

/** Judges one fix. Anything that goes wrong outside the comparison is undecidable, with its reason; nothing here applies anything. */
export async function judgeGate3(input: Gate3Input, deps: Gate3Deps): Promise<Gate3Result> {
  const command = deps.command ?? runDockerImageCommand;
  const box = deps.box ?? ((name, image, argv, timeoutMs) => runContainer(name, image, argv, timeoutMs, "npm"));
  const id = randomUUID(), images: string[] = [], started = process.hrtime.bigint();
  const seconds: Gate3Result["seconds"] = { pull: null, acquire_old: null, acquire_new: null, image_old: null, image_new: null, compare: null, total: 0 };
  const runs: Gate3Result["runs"] = [];
  const logs: Record<string, string> = {};
  let temp = "";
  const finish = (comparison: Comparison): Gate3Result => {
    seconds.total = elapsed(started);
    return { ...comparison, schema: 1, limits: LIMITS, images: { box: BOX_IMAGE, acquire: ACQUIRE_IMAGE }, seconds, runs, ...(deps.keepLogs ? { logs } : {}) };
  };
  try {
    for (const [label, side] of [["old", input.old], ["new", input.new]] as const) {
      let manifest: any;
      try { manifest = JSON.parse(side.manifest); } catch { return finish(emptyComparison(`${label}'s package.json cannot be read.`)); }
      if (!manifest?.dependencies?.next && !manifest?.devDependencies?.next) return finish(emptyComparison(`${label}'s package.json has no next dependency: this first form covers only Next.js projects.`));
    }
    temp = mkdtempSync(join(tmpdir(), "ludion-gate3-"));
    const source = join(temp, "source"); mkdirSync(source);
    deps.snapshot(input.dir, source);
    const example = dummyEnv(envExample(input.dir));
    const notes = example.left_out.length ? [`.env.example's keys ${example.left_out.join(", ")} were left out: the run itself sets them, or there were too many.`] : [];
    const ludion = join(temp, "ludion"); mkdirSync(ludion);
    writeFileSync(join(ludion, "driver.cjs"), BOX_DRIVER);
    writeFileSync(join(ludion, "freeze-clock.cjs"), FREEZE_CLOCK);
    writeFileSync(join(ludion, "config.json"), JSON.stringify({ env: example.env, freeze: FREEZE_CLOCK }));

    /** Acquires one side's dependencies from its manifests alone, then builds the image its runs use. Returns the image id. */
    const prepare = async (label: "old" | "new", side: Sides): Promise<string> => {
      const context = join(temp, label), manifests = join(context, "manifests");
      mkdirSync(manifests, { recursive: true });
      writeFileSync(join(manifests, "package.json"), side.manifest);
      writeFileSync(join(manifests, "package-lock.json"), side.lock);
      deps.policy(manifests);
      writeFileSync(join(context, "Dockerfile"), acquireDockerfile(ACQUIRE_IMAGE));
      const acquired = `ludion-gate3-${id}-${label}-acquired`; images.push(acquired);
      const acquireStarted = process.hrtime.bigint();
      await command(["build", "--network=default", "--pull=false", "--target", "resolve", "--tag", acquired, context], 900_000);
      seconds[`acquire_${label}`] = elapsed(acquireStarted);
      // The application's build context holds the source, the manifests and the driver, and nothing else.
      const app = join(temp, `${label}-app`);
      mkdirSync(join(app, "manifests"), { recursive: true });
      writeFileSync(join(app, "manifests", "package.json"), side.manifest);
      writeFileSync(join(app, "manifests", "package-lock.json"), side.lock);
      writeFileSync(join(app, "Dockerfile"), boxDockerfile(acquired, BOX_IMAGE));
      cpSync(source, join(app, "source"), { recursive: true });
      cpSync(ludion, join(app, "ludion"), { recursive: true });
      const tag = `ludion-gate3-${id}-${label}-box`; images.push(tag);
      const imageStarted = process.hrtime.bigint();
      await command(["build", "--network=none", "--pull=false", "--tag", tag, app], 300_000);
      seconds[`image_${label}`] = elapsed(imageStarted);
      return command(["image", "inspect", tag, "--format", "{{.Id}}"], 15_000);
    };
    /** One run in a fresh box. Null means no result could be read from it. */
    const once = async (label: string, image: string): Promise<Gate3Run | null> => {
      const outcome = await box(`ludion-gate3-${id}-${label}`, image, ["node", "/ludion/driver.cjs"], BOX_TIMEOUT_MS);
      if (outcome.kind === "spawn_error") throw new Error(`Docker unavailable: ${outcome.message}`);
      if (deps.keepLogs) logs[label] = outcome.stderr.slice(-4000);
      const run = outcome.timedOut ? null : parseRun(outcome.stdout);
      let summary: Omit<Gate3Run, "pages"> | null = null;
      if (run) { const { pages: _pages, ...rest } = run; summary = rest; }
      runs.push({ label, outcome: outcome.timedOut ? "timed_out" : run ? "ran" : "unreadable", run: summary });
      return run;
    };

    const pullStarted = process.hrtime.bigint();
    for (const image of [ACQUIRE_IMAGE, BOX_IMAGE]) await command(["pull", image], 900_000);
    seconds.pull = elapsed(pullStarted);
    let oldImage: string;
    try { oldImage = await prepare("old", input.old); }
    catch (error) { return finish(emptyComparison(`Old's dependencies or image could not be prepared: ${message(error)}`, notes)); }
    const oldA = await once("old-1", oldImage);
    if (!oldA) return finish(emptyComparison("The first run of old gave no result: it timed out or ran out of what the box allows.", notes));
    const problemA = oldProblem(oldA, "Old");
    if (problemA) return finish(emptyComparison(problemA, notes));
    const oldB = await once("old-2", oldImage);
    if (!oldB) return finish(emptyComparison("The second run of old gave no result: it timed out or ran out of what the box allows.", notes));
    const problemB = oldProblem(oldB, "Old's second run");
    if (problemB) return finish(emptyComparison(problemB, notes));
    if (!specificationPages(oldA, oldB).length) {
      const compareStarted = process.hrtime.bigint();
      const comparison = compareRuns(oldA, oldB, { ...oldA, pages: [] });
      seconds.compare = elapsed(compareStarted);
      return finish({ ...emptyComparison(comparison.undecidable[0]!, notes), pages: comparison.pages });
    }
    let newImage: string;
    try { newImage = await prepare("new", input.new); }
    catch (error) { return finish(emptyComparison(`New's dependencies or image could not be prepared: ${message(error)}`, notes)); }
    const next = await once("new", newImage);
    if (!next) return finish(emptyComparison("The run of new gave no result: it timed out or ran out of what the box allows.", notes));
    const compareStarted = process.hrtime.bigint();
    const comparison = compareRuns(oldA, oldB, next);
    seconds.compare = elapsed(compareStarted);
    return finish({ ...comparison, notes: [...notes, ...comparison.notes] });
  } catch (error) {
    return finish(emptyComparison(`Gate 3 could not run: ${message(error)}`));
  } finally {
    for (const image of images.reverse()) await command(["image", "rm", image], 15_000).catch(() => {});
    if (temp && resolve(temp).startsWith(resolve(tmpdir()) + sep)) rmSync(temp, { recursive: true, force: true });
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2000);
