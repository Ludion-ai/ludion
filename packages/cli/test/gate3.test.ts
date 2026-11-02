// Gate 3's new type, without Docker: the definition's table (docs/decisions/2026-11-02-gate-3-type-definition.md), the
// reading of what the box prints, and the failure paths of one judgement. The real runs are in gate3-docker.test.ts.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { runInNewContext, Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContainerOutcome } from "../../sandbox/src/docker.ts";
import { acquisitionPolicy, resolverDockerfile } from "../src/security/dependency-patch.ts";
import { acquireDockerfile, ACQUIRE_IMAGE, BOX_IMAGE, boxDockerfile, compareRuns, dummyEnv, judgeGate3, parseRun, specificationPages, type Gate3Page, type Gate3Run, type StepStatus } from "../src/security/gate3.ts";
import { BOX_DRIVER, FREEZE_CLOCK, MAX_PAGES, RESULT_MARKER } from "../src/security/gate3-box.ts";
import { snapshot } from "../src/security/project.ts";

const passed = { status: "passed" as StepStatus, seconds: 1 };
const absent = { status: "absent" as StepStatus, seconds: 0 };
const page = (path: string, over: Partial<Gate3Page> = {}): Gate3Page => ({ path, status: 200, exceptions: [], console: [], dom: ["aaaaaaaa", "bbbbbbbb"], screenshot: "0".repeat(32), ...over });
const run = (pages: Gate3Page[], over: Partial<Gate3Run> = {}): Gate3Run => ({ build: passed, types: passed, start: passed, crawl: passed, tests: passed, too_many_pages: false, pages, seconds: 2, memory_peak_bytes: 1, memory_swap_peak_bytes: 0, memory_oom_kills: 0, ...over });
const failed = { status: "failed" as StepStatus, seconds: 1 }, timedOut = { status: "timed_out" as StepStatus, seconds: 1 };
const old = () => run([page("/"), page("/about")]);

describe("the definition's table", () => {
  it("not_broken: everything compared is the same", () => {
    const result = compareRuns(old(), old(), old());
    expect(result).toMatchObject({ verdict: "not_broken", broken: [], undecidable: [], specification_pages: 2 });
    expect(result.pages.map(p => p.dom)).toEqual(["same", "same"]);
  });

  it("the denominator: a page must have status 200 and no exception in both runs of old", () => {
    const a = run([page("/one"), page("/two"), page("/three", { status: 500 }), page("/four", { exceptions: ["0123456789abcdef"] })]);
    const b = run([page("/one"), page("/two", { status: 503 }), page("/three", { status: 500 }), page("/four")]);
    expect(specificationPages(a, b)).toEqual(["/one"]);
    const none = run([page("/", { status: 500 })]);
    const result = compareRuns(none, none, none);
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable[0]).toContain("no denominator");
    expect(result.specification_pages).toBe(0);
  });

  it.each<[string, Partial<Gate3Run>, RegExp]>([
    ["new does not build", { build: failed, pages: [] }, /New did not build/],
    ["new's server does not start", { start: failed, crawl: absent, pages: [] }, /server did not start/],
    ["types pass on old and fail on new", { types: failed }, /Types passed on both runs of old and fail on new/],
    ["tests pass on old and fail on new", { tests: failed }, /Tests passed on both runs of old and fail on new/],
  ])("broken: %s", (_name, over, reason) => {
    const result = compareRuns(old(), old(), run(old().pages, over));
    expect(result.verdict).toBe("broken");
    expect(result.broken.join(" ")).toMatch(reason);
  });

  it.each<[string, Partial<Gate3Page> | null, RegExp]>([
    ["a page is no longer in new's list", null, /not in new's/],
    ["a page answers 500", { status: 500 }, /answered 500 on new and 200 on old/],
    ["a page answers nothing", { status: null, dom: null, screenshot: null }, /answered nothing on new/],
    ["a page answers 404", { status: 404 }, /answered 404/],
    ["an exception on new", { exceptions: ["server:0123456789abcdef"] }, /1 exception/],
    ["a console error on new", { console: ["error:0123456789abcdef"] }, /1 console error/],
    ["an element differs", { dom: ["aaaaaaaa", "cccccccc"] }, /differs from old's in 1 element/],
    ["fewer elements", { dom: ["aaaaaaaa"] }, /has 1 elements on new and 2 on old/],
    ["no DOM could be read", { dom: null }, /has no elements on new/],
  ])("broken: %s", (_name, over, reason) => {
    const result = compareRuns(old(), old(), run([page("/"), ...(over === null ? [] : [page("/about", over)])]));
    expect(result.verdict).toBe("broken");
    expect(result.broken.join(" ")).toMatch(reason);
  });

  it("broken: a page that answered under 500 on old answers 500 or over on new, though it is not a specification page", () => {
    const pages = (status: number) => run([page("/"), page("/gone", { status })]);
    expect(compareRuns(pages(404), pages(404), pages(500)).broken).toEqual(["/gone answered under 500 on old and 500 on new."]);
    // Worse by a status under 500 is not in the table's row; on a page that fails on both, it is only counted.
    expect(compareRuns(pages(404), pages(404), pages(404))).toMatchObject({ verdict: "not_broken", broken_on_both: 1 });
    expect(compareRuns(pages(500), pages(500), pages(500))).toMatchObject({ verdict: "not_broken", broken_on_both: 1 });
  });

  it.each<[string, Partial<Gate3Run>, RegExp]>([
    ["new's build timed out", { build: timedOut, pages: [] }, /New's build timed out/],
    ["new's crawl did not finish", { crawl: failed, pages: [] }, /crawl did not finish/],
    ["new has too many pages", { too_many_pages: true, pages: [] }, /more than 200 pages/],
    ["types time out on new", { types: timedOut }, /Types timed out on new/],
    ["tests time out on new", { tests: timedOut }, /Tests timed out on new/],
    ["tests no longer run on new", { tests: absent }, /Tests did not run on new/],
  ])("undecidable: %s", (_name, over, reason) => {
    const result = compareRuns(old(), old(), run(old().pages, over));
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable.join(" ")).toMatch(reason);
  });

  it("undecidable: another level's new console message, and a screenshot alone", () => {
    const warned = compareRuns(old(), old(), run([page("/"), page("/about", { console: ["warning:0123456789abcdef"] })]));
    expect(warned.verdict).toBe("undecidable");
    expect(warned.undecidable.join(" ")).toMatch(/1 console message\(s\) of another level/);
    const pictured = compareRuns(old(), old(), run([page("/"), page("/about", { screenshot: "1".repeat(32) })]));
    expect(pictured.verdict).toBe("undecidable");
    expect(pictured.undecidable.join(" ")).toMatch(/same DOM, and its screenshot differs/);
    const noShot = compareRuns(old(), old(), run([page("/"), page("/about", { screenshot: null })]));
    expect(noShot.verdict).toBe("undecidable");
  });

  it("broken wins over undecidable, and every reason is listed", () => {
    const result = compareRuns(old(), old(), run([page("/", { status: 500 }), page("/about", { console: ["info:0123456789abcdef"] })]));
    expect(result.verdict).toBe("broken");
    expect(result.broken.length).toBeGreaterThan(0);
    expect(result.undecidable.length).toBeGreaterThan(0);
  });

  describe("noise, what differs between the two runs of old", () => {
    it("an element that differs between them is left out by its position, and another still counts", () => {
      const a = run([page("/", { dom: ["aaaaaaaa", "11111111"] })]), b = run([page("/", { dom: ["aaaaaaaa", "22222222"] })]);
      const same = compareRuns(a, b, run([page("/", { dom: ["aaaaaaaa", "33333333"] })]));
      expect(same.verdict).toBe("not_broken");
      expect(same.pages[0]).toMatchObject({ dom: "same", noise_elements: 1 });
      expect(compareRuns(a, b, run([page("/", { dom: ["cccccccc", "33333333"] })])).verdict).toBe("broken");
    });

    it("a different number of elements makes that page's DOM not comparable, and all such pages undecidable", () => {
      const a = run([page("/", { dom: ["aaaaaaaa"] }), page("/two")]), b = run([page("/", { dom: ["aaaaaaaa", "bbbbbbbb"] }), page("/two")]);
      const one = compareRuns(a, b, run([page("/", { dom: ["ffffffff"] }), page("/two")]));
      expect(one.verdict).toBe("not_broken");
      expect(one.pages[0]!.dom).toBe("noise");
      expect(one.notes.join(" ")).toContain("differs in size");
      const all = compareRuns(run([page("/", { dom: ["aaaaaaaa"] })]), run([page("/", { dom: null })]), run([page("/", { dom: ["ffffffff"] })]));
      expect(all.verdict).toBe("undecidable");
      expect(all.undecidable[0]).toContain("noise");
    });

    it("a screenshot that differs between them is not compared; a console message in one of them is not new", () => {
      const shots = compareRuns(run([page("/", { screenshot: "1".repeat(32) })]), run([page("/", { screenshot: "2".repeat(32) })]), run([page("/", { screenshot: "3".repeat(32) })]));
      expect(shots.verdict).toBe("not_broken");
      expect(shots.notes.join(" ")).toContain("screenshot differs between");
      const message = "error:0123456789abcdef";
      expect(compareRuns(run([page("/", { console: [message] })]), run([page("/")]), run([page("/", { console: [message] })])).verdict).toBe("not_broken");
    });

    it("a page with an exception in only one run of old is no specification page, so its exception on new does not count", () => {
      const a = run([page("/"), page("/flaky", { exceptions: ["0123456789abcdef"] })]), b = run([page("/"), page("/flaky")]);
      const result = compareRuns(a, b, run([page("/"), page("/flaky", { exceptions: ["0123456789abcdef"] })]));
      expect(result.verdict).toBe("not_broken");
      expect(result.pages.find(p => p.path === "/flaky")!.role).toBe("other");
    });
  });

  it("types and tests that fail on old take no part, and the result says so", () => {
    const a = run(old().pages, { types: failed, tests: failed });
    const result = compareRuns(a, a, run(old().pages, { types: failed, tests: failed }));
    expect(result.verdict).toBe("not_broken");
    expect(result.notes).toEqual(["Types did not pass on both runs of old, so they take no part in the comparison.", "Tests did not pass on both runs of old, so they take no part in the comparison."]);
    // In only one run of old they do not count either: that is noise.
    expect(compareRuns(run(old().pages, { tests: failed }), old(), run(old().pages, { tests: failed })).verdict).toBe("not_broken");
    // A project with no test script is not asked for one.
    const none = run(old().pages, { tests: absent });
    expect(compareRuns(none, none, none)).toMatchObject({ verdict: "not_broken", notes: [] });
  });
});

describe("parseRun: what the box prints is data the candidate could have written", () => {
  const good = { schema: 1, ...run([page("/")]) };
  const print = (value: unknown) => `build output\n${RESULT_MARKER}${JSON.stringify(value)}\n`;

  it("reads the driver's shape, and the last marked line", () => {
    expect(parseRun(print(good))?.pages[0]!.path).toBe("/");
    expect(parseRun(`${RESULT_MARKER}{"schema":1}\n${print(good)}`)?.pages.length).toBe(1);
  });

  it.each<[string, string]>([
    ["no marker", "nothing here\n"],
    ["not JSON", `${RESULT_MARKER}{`],
    ["another schema", print({ ...good, schema: 2 })],
    ["the driver's own failure", print({ schema: 1, driver_failed: true })],
    ["a step's status it does not know", print({ ...good, build: { status: "fine", seconds: 1 } })],
    ["a page that is not a path", print({ ...good, pages: [page("https://example.com/")] })],
    ["the same page twice", print({ ...good, pages: [page("/"), page("/")] })],
    ["a status out of range", print({ ...good, pages: [page("/", { status: 999 })] })],
    ["text where a hash belongs", print({ ...good, pages: [page("/", { dom: ["<p>secret</p>"] })] })],
    ["a console message with its text", print({ ...good, pages: [page("/", { console: ["error:the text"] })] })],
    ["an exception with its text", print({ ...good, pages: [page("/", { exceptions: ["TypeError"] })] })],
    ["a screenshot that is not a hash", print({ ...good, pages: [page("/", { screenshot: "x" })] })],
    ["too many pages", print({ ...good, pages: Array.from({ length: MAX_PAGES + 1 }, (_, i) => page(`/${i}`)) })],
    ["memory that is not a number", print({ ...good, memory_oom_kills: "0" })],
  ])("no result: %s", (_name, stdout) => {
    expect(parseRun(stdout)).toBeNull();
  });
});

describe("dummyEnv", () => {
  it("gives each key a dummy value and reads no value of the project's", () => {
    expect(dummyEnv("# a comment\nNEXT_PUBLIC_SITE_NAME=my real name\r\nexport API_URL=https://real.example\n  SPACED = x\nnot a key\n=novalue\n")).toEqual({
      env: { NEXT_PUBLIC_SITE_NAME: "ludion-dummy", API_URL: "http://127.0.0.1:9/", SPACED: "ludion-dummy" }, left_out: [],
    });
  });

  it("leaves out what the run itself reads: a project's file cannot move the clock or the driver", () => {
    const { env, left_out } = dummyEnv("NODE_OPTIONS=--require=/x\nPATH=/x\nLD_PRELOAD=/x\nHOME=/x\nPORT=1\nnpm_config_x=1\nNPM_CONFIG_CACHE=/x\nOK=1\n");
    expect(env).toEqual({ OK: "ludion-dummy" });
    expect(left_out).toEqual(["NODE_OPTIONS", "PATH", "LD_PRELOAD", "HOME", "PORT", "npm_config_x", "NPM_CONFIG_CACHE"]);
  });

  it("stops at a limit", () => {
    const { env, left_out } = dummyEnv(Array.from({ length: 205 }, (_, i) => `K${i}=`).join("\n"));
    expect(Object.keys(env).length).toBe(200);
    expect(left_out.length).toBe(5);
  });
});

describe("what goes into the box", () => {
  it("the acquisition is the same text as `ludion patch`'s, so the limits on it cannot drift apart", () => {
    expect(acquireDockerfile(ACQUIRE_IMAGE)).toBe(resolverDockerfile("npm", ACQUIRE_IMAGE, false));
  });

  it("every image is pinned by digest", () => {
    for (const image of [ACQUIRE_IMAGE, BOX_IMAGE]) expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
  });

  it("the box's image ends as a non-root user, and the acquired image holds the dependencies", () => {
    const text = boxDockerfile("ludion-acquired", BOX_IMAGE);
    expect(text.startsWith(`FROM ${BOX_IMAGE}\n`)).toBe(true);
    expect(text).toContain("COPY --from=ludion-acquired");
    expect(text.trimEnd().endsWith("USER 65534:65534")).toBe(true);
  });

  it("the driver and the preload are valid scripts in a bundled file's strings", () => {
    for (const script of [BOX_DRIVER, FREEZE_CLOCK]) {
      expect(() => new Script(script)).not.toThrow();
      expect(script).not.toContain("`");
    }
    expect(BOX_DRIVER).toContain(RESULT_MARKER);
    expect(BOX_DRIVER).toContain(`routes.length > ${MAX_PAGES}`);
    expect(BOX_DRIVER).not.toContain("${");
  });

  it("the driver prints hashes of what it reads, and starts a browser only with no port open", () => {
    expect(BOX_DRIVER).toContain("--remote-debugging-pipe");
    expect(BOX_DRIVER).not.toContain("--remote-debugging-port");
    // Only a loopback address, and no address on the network.
    expect(BOX_DRIVER.match(/https?:\/\/[^"' ]+/g)).toEqual(["http://127.0.0.1:"]);
  });

  it("gate3-fits-box-at-50-pages: webpack's cache folder, and nothing else, is read-only before the build starts", async () => {
    // The driver itself, with Node.js's modules stood in for: the measurement on real builds is in the progress record.
    const events: string[] = [];
    let printed = "";
    const missing = () => { throw new Error("not in this stand-in"); };
    const fs = {
      readFileSync: (path: string) => path === "/ludion/config.json" ? JSON.stringify({ env: {}, freeze: "" }) : missing(),
      readdirSync: () => [], copyFileSync: () => {}, symlinkSync: () => {},
      mkdirSync: (path: string) => { events.push(`mkdir ${path}`); },
      chmodSync: (path: string, mode: number) => { events.push(`chmod ${mode.toString(8)} ${path}`); },
    };
    const spawn = (_program: string, args: string[]) => {
      events.push(`spawn ${args[args.length - 1]}`);
      const child = new EventEmitter();
      setImmediate(() => child.emit("close", 1));
      return child;
    };
    const modules: Record<string, unknown> = { "node:child_process": { spawn }, "node:crypto": { createHash }, "node:fs": fs, "node:net": {}, "node:path": posix };
    await new Promise<void>(done => {
      const stream = { write: (text: string, callback?: () => void) => { printed += text; callback?.(); return true; } };
      const box = { env: {}, execPath: "node", hrtime: process.hrtime, kill: () => {}, stderr: { write: () => true }, stdout: stream, exit: () => done() };
      new Script(BOX_DRIVER).runInNewContext({ Buffer, clearTimeout, process: box, require: (name: string) => modules[name], setTimeout });
    });
    const cache = "/tmp/next/cache/webpack";
    expect(events.filter(e => e.startsWith("chmod"))).toEqual([`chmod 555 ${cache}`]);
    expect(events.indexOf(`mkdir ${cache}`)).toBeLessThan(events.indexOf(`chmod 555 ${cache}`));
    expect(events.indexOf(`chmod 555 ${cache}`)).toBeLessThan(events.indexOf("spawn build"));
    expect(parseRun(printed)?.build.status).toBe("failed");
  });

  it("the preload stops the clock and fixes the random numbers, and a date given still is that date", () => {
    const reading = () => runInNewContext(`${FREEZE_CLOCK}; ({ now: Date.now(), made: new Date().toISOString(), called: Date(), given: new Date(0).toISOString(), isDate: new Date() instanceof Date, random: [Math.random(), Math.random()] })`);
    const first = reading(), second = reading();
    expect(first.made).toBe("2026-01-01T00:00:00.000Z");
    expect(first.now).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(first.called).toContain("2026");
    expect(first.given).toBe("1970-01-01T00:00:00.000Z");
    expect(first.isDate).toBe(true);
    expect(first.random[0]).not.toBe(first.random[1]);
    expect(first.random[0]).toBeGreaterThanOrEqual(0);
    expect(first.random[0]).toBeLessThan(1);
    expect(second).toEqual(first);
  });
});

describe("examples/nextjs-security", () => {
  const examples = resolve(import.meta.dirname, "../../../examples");
  const app = join(examples, "nextjs-security");
  const packagesOf = (dir: string): Record<string, { version: string; resolved?: string; integrity?: string }> => JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")).packages;
  /** Install paths whose version differs from the example's, and the paths only one side has. */
  const moved = (dir: string) => {
    const a = packagesOf(app), b = packagesOf(dir);
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(path => path && a[path]?.version !== b[path]?.version).sort();
  };

  it("passes the real acquisition policy and snapshot, on every side of every case", () => {
    expect(() => acquisitionPolicy(app, "npm")).not.toThrow();
    for (const name of ["next-15.5.7", "lodash-4.17.21"]) expect(() => acquisitionPolicy(join(examples, "nextjs-security-cases", name), "npm")).not.toThrow();
    const copy = mkdtempSync(join(tmpdir(), "ludion-gate3-example-"));
    try { expect(() => snapshot(app, copy)).not.toThrow(); expect(existsSync(join(copy, ".env.example"))).toBe(false); }
    finally { rmSync(copy, { recursive: true, force: true }); }
  });

  it("pins every direct dependency, and has every locked package with a resolved URL and an integrity", () => {
    const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
    for (const version of Object.values({ ...manifest.dependencies, ...manifest.devDependencies }) as string[]) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [path, entry] of Object.entries(packagesOf(app))) if (path) {
      expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, path).toMatch(/^sha512-/);
    }
  });

  it("each case moves what its name says, and nothing else", () => {
    const cases = join(examples, "nextjs-security-cases");
    expect(moved(join(cases, "lodash-4.17.21"))).toEqual(["node_modules/lodash"]);
    const next = moved(join(cases, "next-15.5.7"));
    expect(next).toContain("node_modules/next");
    expect(next.every(path => /^node_modules\/(?:next|@next\/[\w-]+)$/.test(path))).toBe(true);
    expect(packagesOf(app)["node_modules/next"]!.version).toBe("15.5.6");
    expect(packagesOf(join(cases, "next-15.5.7"))["node_modules/next"]!.version).toBe("15.5.7");
    expect(packagesOf(app)["node_modules/lodash"]!.version).toBe("3.10.1");
  });
});

describe("one judgement, with Docker stood in for", () => {
  let dir: string;
  const manifest = JSON.stringify({ name: "x", dependencies: { next: "15.5.6" } });
  const sides = { manifest, lock: "{}" };
  /** A stand-in for the docker image commands: records each call, and what each build's context holds. */
  const docker = (failOn?: RegExp) => {
    const calls: string[][] = [], contexts: { network: string; files: Record<string, boolean>; dockerfile: string; config?: string }[] = [];
    return {
      calls, contexts,
      command: async (args: string[]) => {
        calls.push(args);
        if (failOn?.test(args.join(" "))) throw new Error("Docker image command failed (1): no");
        if (args[0] === "build") {
          const context = args[args.length - 1]!;
          contexts.push({
            network: args[1]!,
            dockerfile: readFileSync(join(context, "Dockerfile"), "utf8"),
            files: Object.fromEntries(["source/app.tsx", "source/.env", "source/.env.example", "source/node_modules", "source/.git", "manifests/package.json", "manifests/package-lock.json", "ludion/driver.cjs"].map(f => [f, existsSync(join(context, f))])),
            ...(existsSync(join(context, "ludion/config.json")) ? { config: readFileSync(join(context, "ludion/config.json"), "utf8") } : {}),
          });
        }
        return args[0] === "image" && args[1] === "inspect" ? `sha256:${"a".repeat(64)}` : "";
      },
    };
  };
  const printed = (r: Gate3Run) => `${RESULT_MARKER}${JSON.stringify({ schema: 1, ...r })}\n`;
  const exited = (stdout: string, over: Partial<Extract<ContainerOutcome, { kind: "exited" }>> = {}): ContainerOutcome => ({ kind: "exited", exitCode: 0, stdout, stderr: "the build's messages", timedOut: false, ...over });
  /** A stand-in for the box: answers each run in turn. */
  const boxes = (...answers: ContainerOutcome[]) => {
    const names: string[] = [];
    return { names, box: async (name: string) => { names.push(name); return answers.shift()!; } };
  };
  const deps = (d: ReturnType<typeof docker>, b: ReturnType<typeof boxes>) => ({ policy: () => {}, snapshot, command: d.command, box: b.box });
  const removed = (d: ReturnType<typeof docker>) => d.calls.filter(c => c[0] === "image" && c[1] === "rm").map(c => c[2]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ludion-gate3-test-"));
    writeFileSync(join(dir, "app.tsx"), "export default 1;\n");
    writeFileSync(join(dir, ".env"), "SECRET=real\n");
    writeFileSync(join(dir, ".env.example"), "API_URL=https://real.example\nSECRET=not-this\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("old twice and new once, then the comparison, and nothing left behind", async () => {
    const d = docker(), b = boxes(exited(printed(old())), exited(printed(old())), exited(printed(old())));
    const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
    expect(result.verdict).toBe("not_broken");
    expect(b.names.map(n => n.split("-").slice(-2).join("-"))).toEqual(["old-1", "old-2", expect.stringMatching(/-new$/)]);
    expect(result.runs.map(r => r.outcome)).toEqual(["ran", "ran", "ran"]);
    expect(result.limits.join(" ")).toContain("GET pages only");
    expect(Object.values(result.seconds).every(s => typeof s === "number")).toBe(true);
    expect(removed(d).length).toBe(4);
    expect("logs" in result).toBe(false);
  });

  it("acquires from the manifests alone on a network, then builds with none, without credentials or installed files", async () => {
    const d = docker(), b = boxes(exited(printed(old())), exited(printed(old())), exited(printed(old())));
    await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
    const acquiring = d.contexts.filter(c => c.network === "--network=default"), building = d.contexts.filter(c => c.network === "--network=none");
    expect(acquiring.length).toBe(2);
    expect(building.length).toBe(2);
    for (const c of acquiring) expect(c.files).toMatchObject({ "manifests/package.json": true, "manifests/package-lock.json": true, "source/app.tsx": false, "ludion/driver.cjs": false });
    for (const c of building) {
      expect(c.files).toMatchObject({ "source/app.tsx": true, "manifests/package.json": true, "ludion/driver.cjs": true, "source/.env": false, "source/.env.example": false, "source/.git": false, "source/node_modules": false });
      // The keys of .env.example, with dummy values and not its own.
      expect(JSON.parse(c.config!).env).toEqual({ API_URL: "http://127.0.0.1:9/", SECRET: "ludion-dummy" });
      expect(c.config).not.toContain("real.example");
    }
  });

  it("stops before Docker on a project that is not Next.js, or a package.json it cannot read", async () => {
    for (const manifestText of [JSON.stringify({ dependencies: { react: "19.0.0" } }), "{"]) {
      const d = docker(), b = boxes();
      const result = await judgeGate3({ dir, old: { manifest: manifestText, lock: "{}" }, new: sides }, deps(d, b));
      expect(result.verdict).toBe("undecidable");
      expect(d.calls).toEqual([]);
      expect(b.names).toEqual([]);
    }
  });

  it("does not build or run new when old has no specification page", async () => {
    const none = run([page("/", { status: 500 })]);
    const d = docker(), b = boxes(exited(printed(none)), exited(printed(none)));
    const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable[0]).toContain("no denominator");
    expect(result.pages[0]!.status).toEqual([500, 500, null]);
    expect(b.names.length).toBe(2);
    expect(d.contexts.length).toBe(2);
  });

  it.each<[string, Partial<Gate3Run>, RegExp]>([
    ["does not build", { build: failed, pages: [] }, /did not build/],
    ["has too many pages", { too_many_pages: true, pages: [] }, /more than 200 pages/],
    ["does not start", { start: failed, pages: [] }, /server did not start/],
    ["its crawl does not finish", { crawl: failed, pages: [] }, /crawl did not finish/],
  ])("undecidable when old %s, and new is not looked at", async (_name, over, reason) => {
    const d = docker(), b = boxes(exited(printed(run([], over))));
    const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable[0]).toMatch(reason);
    expect(b.names.length).toBe(1);
  });

  it("undecidable when a run times out, or prints nothing that can be read, in any position", async () => {
    const good = exited(printed(old()));
    for (const [answers, runs] of [
      [[exited("", { timedOut: true })], 1],
      [[exited("garbage", { exitCode: 137 })], 1],
      [[good, exited("", { timedOut: true })], 2],
      [[good, exited(`${RESULT_MARKER}{"schema":1,"driver_failed":true}`)], 2],
      [[good, good, exited("", { timedOut: true })], 3],
      [[good, good, exited("killed", { exitCode: 137 })], 3],
    ] as [ContainerOutcome[], number][]) {
      const d = docker(), b = boxes(...answers);
      const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
      expect(result.verdict).toBe("undecidable");
      expect(b.names.length).toBe(runs);
      expect(removed(d).length).toBeGreaterThan(0);
    }
  });

  it("a result that says all is well does not count when the box timed out", async () => {
    const d = docker(), b = boxes(exited(printed(old())), exited(printed(old())), exited(printed(old()), { timedOut: true }));
    expect((await judgeGate3({ dir, old: sides, new: sides }, deps(d, b))).verdict).toBe("undecidable");
  });

  it("undecidable, with no silent fallback, when Docker cannot be started", async () => {
    const d = docker(), b = boxes({ kind: "spawn_error", message: "docker was not found" });
    const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable[0]).toContain("Docker unavailable");
    expect(removed(d).length).toBeGreaterThan(0);
  });

  it("undecidable when an image cannot be pulled, or a side cannot be acquired or built", async () => {
    for (const [failOn, reason, runs] of [
      [/^pull /, /Gate 3 could not run/, 0],
      [/--network=default/, /Old's dependencies or image could not be prepared/, 0],
      [/--network=none/, /Old's dependencies or image could not be prepared/, 0],
    ] as [RegExp, RegExp, number][]) {
      const d = docker(failOn), b = boxes();
      const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
      expect(result.verdict).toBe("undecidable");
      expect(result.undecidable[0]).toMatch(reason);
      expect(b.names.length).toBe(runs);
    }
  });

  it("undecidable, not broken, when new's dependencies cannot be acquired: it may be the network", async () => {
    let builds = 0;
    const d = docker(), b = boxes(exited(printed(old())), exited(printed(old())));
    const command = async (args: string[]) => {
      if (args[0] === "build" && args.includes("--network=default") && ++builds === 2) throw new Error("no network");
      return d.command(args);
    };
    const result = await judgeGate3({ dir, old: sides, new: sides }, { policy: () => {}, snapshot, command, box: b.box });
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable[0]).toContain("New's dependencies");
  });

  it("the acquisition policy runs on each side's manifests; a refusal stops before that side is acquired", async () => {
    const seen: string[] = [];
    const d = docker(), b = boxes();
    const result = await judgeGate3({ dir, old: { manifest, lock: '{"lock":"git"}' }, new: sides }, {
      ...deps(d, b),
      policy: manifests => { seen.push(readFileSync(join(manifests, "package-lock.json"), "utf8")); throw new Error("Automatic npm acquisition accepts only public registry.npmjs.org tarballs."); },
    });
    expect(seen).toEqual(['{"lock":"git"}']);
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable[0]).toContain("registry.npmjs.org");
    expect(d.contexts).toEqual([]);
  });

  it("refuses a project the snapshot refuses, and a .env.example that is a link", async () => {
    if (process.platform !== "win32") {
      rmSync(join(dir, ".env.example"));
      symlinkSync("/etc/passwd", join(dir, ".env.example"));
      const result = await judgeGate3({ dir, old: sides, new: sides }, deps(docker(), boxes()));
      expect(result.verdict).toBe("undecidable");
      expect(result.undecidable[0]).toContain(".env.example");
      rmSync(join(dir, ".env.example"));
      symlinkSync("/etc/passwd", join(dir, "link"));
      expect((await judgeGate3({ dir, old: sides, new: sides }, deps(docker(), boxes()))).undecidable[0]).toContain("symlink");
    }
    writeFileSync(join(dir, ".env.example"), "x".repeat(64 * 1024 + 1));
    chmodSync(join(dir, ".env.example"), 0o644);
    rmSync(join(dir, "link"), { force: true });
    expect((await judgeGate3({ dir, old: sides, new: sides }, deps(docker(), boxes()))).undecidable[0]).toContain(".env.example");
  });

  it("works without a .env.example, and keeps the box's stderr only when asked", async () => {
    rmSync(join(dir, ".env.example"));
    const d = docker(), b = boxes(exited(printed(old())), exited(printed(old())), exited(printed(old())));
    const result = await judgeGate3({ dir, old: sides, new: sides }, { ...deps(d, b), keepLogs: true });
    expect(result.verdict).toBe("not_broken");
    expect(JSON.parse(d.contexts.find(c => c.config)!.config!).env).toEqual({});
    expect(result.logs).toEqual({ "old-1": "the build's messages", "old-2": "the build's messages", new: "the build's messages" });
  });

  it("says which keys of .env.example it left out", async () => {
    writeFileSync(join(dir, ".env.example"), "NODE_OPTIONS=x\nOK=1\n");
    const b = boxes(exited(printed(old())), exited(printed(old())), exited(printed(old())));
    const result = await judgeGate3({ dir, old: sides, new: sides }, deps(docker(), b));
    expect(result.notes.join(" ")).toContain("NODE_OPTIONS");
  });
});
