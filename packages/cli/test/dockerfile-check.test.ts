// The Dockerfile check reads a file in the order BuildKit does (docs/mistakes/2026-11-02-dockerfile-check-not-as-buildkit-reads.md).
// For the input shapes listed here, the lock and Dockerfile readers' time grows less than 8 times from n to 4n, at the
// sizes listed here; that says nothing of any other shape or size, and one lock shape is quadratic in a key's length
// (lock-key-many-deps; docs/mistakes/2026-11-02-linear-said-with-fixed-ms.md). Nothing here runs Docker. Which forms were built
// once with `docker build --network=none --pull=false`, and what it did, is in docs/progress/2026-11-02-ldock-dockerfile-check.md.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { isMainThread } from "node:worker_threads";
import { afterAll, describe, expect, it } from "vitest";
import { lockEntries, lockExtraneous, lockKey, lockLinks, readLock, resolveFrom } from "../src/security/judge.ts";
import { packageLockInputs } from "../src/security/judge-cli.ts";
import { namesNodeImage, nodeImage } from "../src/security/node.ts";
import { officialImage, phpImage, replaceImage, type RuntimeImage } from "../src/security/php.ts";

const PHP = "FROM php:8.4.25-cli", NODE = "FROM node:22.11.0-alpine";
const URL_LINE = "https://ludion.ai/robots.txt /r";
const READING = "Dockerfile frontend directives and continuations are not supported in this preview.";
const STAGES = "Expected one FROM stage. Multi-stage and missing-base projects need manual review.";
const BUILD_INPUT = "ADD, external COPY and RUN network/mount overrides are not supported by the offline validator.";
const SEPARATOR = "A carriage return or Unicode line separator inside a Dockerfile line is not supported in this preview.";

/** Both images read through officialImage, so each form is refused for both, with its own reason. */
const refusedByBoth = (form: (base: string) => string, reason: string) => {
  expect(() => phpImage(form(PHP))).toThrow(reason);
  expect(() => nodeImage(form(NODE))).toThrow(reason);
};

describe("the Dockerfile check refuses what BuildKit reads as an instruction it must refuse", () => {
  // The table of a first-principles audit: `docker build --network=none --pull=false` fetched the URL, or took the second
  // FROM, for each of these, past the expressions that were here before.
  it.each<[string, (base: string) => string, string]>([
    ["U+0085 before ADD and a URL", base => `${base}\n\u0085ADD ${URL_LINE}\n`, BUILD_INPUT],
    ["U+0085 before COPY --from", base => `${base}\n\u0085COPY --from=evil / /app\n`, BUILD_INPUT],
    ["U+0085 before a second FROM", base => `${base}\n\u0085FROM scratch\n`, STAGES],
    ["U+0085 before an escape directive, then a backtick continuation", base => `\u0085# escape=\`\n${base}\nAD\`\nD ${URL_LINE}\n`, READING],
    ["U+0085 before RUN --network", base => `${base}\n\u0085RUN --network=host true\n`, BUILD_INPUT],
    ["U+0085 before a syntax directive", base => `\u0085# syntax=evil/build\n${base}\n`, READING],
    ["U+0085 between ADD and its URL", base => `${base}\nADD\u0085${URL_LINE}\n`, BUILD_INPUT],
    ["U+0085 before the one FROM, which the old expression did not count as a stage", base => `\u0085${base}\n`, "exact"],
    ["U+0085 between FROM and the image", base => `${base.replace("FROM ", "FROM\u0085")}\n`, "exact"],
    ["U+0085 after the image", base => `${base}\u0085\n`, "exact"],
  ])("dockerfile-check-u0085: %s", (_name, form, reason) => refusedByBoth(form, reason));

  it.each<[string, (base: string) => string, string]>([
    ["AD, a backslash and a space, then D and a URL", base => `${base}\nAD\\ \nD ${URL_LINE}\n`, READING],
    ["AD, a backslash and a tab, then D and a URL", base => `${base}\nAD\\\t\nD ${URL_LINE}\n`, READING],
    ["a backslash, spaces and tabs, with a CRLF line end", base => `${base}\r\nAD\\ \t \r\nD ${URL_LINE}\r\n`, READING],
    ["COPY, a backslash and a space, then --from", base => `${base}\nCOPY \\ \n--from=evil / /app\n`, READING],
    ["FR, a backslash and a space, then OM", base => `${base}\nFR\\ \nOM scratch\n`, READING],
    ["FR, a backslash and a tab, then OM", base => `${base}\nFR\\\t\nOM scratch\n`, READING],
    ["RUN, a backslash and a space, then --network", base => `${base}\nRUN \\ \n--network=host true\n`, READING],
    ["a bare backslash line end, as before", base => `${base}\nRUN true \\\n  && true\n`, READING],
    ["a backslash and CRLF, as before", base => `${base}\r\nRUN true \\\r\n  && true\r\n`, READING],
    ["a comment ending in a backslash and a space", base => `${base}\n# a comment \\ \nRUN true\n`, READING],
    ["a backslash and a space at the end of the file", base => `${base}\nRUN true \\ `, READING],
  ])("dockerfile-check-backslash-space: %s", (_name, form, reason) => refusedByBoth(form, reason));

  // `docker build` reads these the same way: a flag's name may be quoted or escaped, and `//` also gives a syntax directive.
  it.each<[string, (base: string) => string, string]>([
    ["COPY's flag with a quoted name", base => `${base}\nCOPY --fr"om"=evil / /app\n`, BUILD_INPUT],
    ["COPY's flag with a single-quoted name", base => `${base}\nCOPY --'from'=evil / /app\n`, BUILD_INPUT],
    ["COPY's flag with an escaped name", base => `${base}\nCOPY --fr\\om=evil / /app\n`, BUILD_INPUT],
    ["COPY's flag in another case, as before", base => `${base}\nCOPY --FROM=evil / /app\n`, BUILD_INPUT],
    ["RUN's flag in another case, as before", base => `${base}\nRUN --NETWORK=host true\n`, BUILD_INPUT],
    ["RUN's flag with a quoted name", base => `${base}\nRUN --net"work"=host true\n`, BUILD_INPUT],
    ["RUN's mount flag with an escaped name", base => `${base}\nRUN --mo\\unt=type=cache,target=/c true\n`, BUILD_INPUT],
    ["a syntax directive with //", base => `//syntax=evil/build\n${base}\n`, READING],
    ["a syntax directive with // and spaces, in another case", base => `// SYNTAX = evil/build\n${base}\n`, READING],
    ["a syntax directive as JSON: a file with no FROM line", () => `{"syntax": "evil/build", "x": "FROM php:8.4.25-cli"}\n`, STAGES],
    ["a syntax directive after a shebang", base => `#!/usr/bin/env docker\n# syntax=evil/build\n${base}\n`, READING],
    ["no-break space before ADD", base => `${base}\n ADD ${URL_LINE}\n`, BUILD_INPUT],
    ["ADD in lower case after a tab, as before", base => `${base}\n\tadd ${URL_LINE}\n`, BUILD_INPUT],
  ])("dockerfile-check-flags-and-directives: %s", (_name, form, reason) => refusedByBoth(form, reason));

  // What the old expressions refused by treating more than a line feed as a line's end, or by reading across one. A
  // line with no line feed in it stays refused, though BuildKit reads it as one line.
  it.each<[string, (base: string) => string, string]>([
    ["a carriage return inside a line, before ADD", base => `${base}\nLABEL a=b\rADD ${URL_LINE}\n`, SEPARATOR],
    ["a line separator inside a line, before ADD", base => `${base}\nLABEL a=b ADD ${URL_LINE}\n`, SEPARATOR],
    ["a paragraph separator inside a line, before FROM", base => `${base}\nLABEL a=b FROM scratch\n`, SEPARATOR],
    ["a file of carriage returns alone", base => `${base}\rWORKDIR /app\r`, SEPARATOR],
    ["a line of its own before a directive's name", base => `#\nsyntax=evil/build\n${base}\n`, READING],
    ["a line of its own before a directive's equals sign", base => `# escape\n=\`\n${base}\n`, READING],
    ["COPY alone, with its flag on the next line", base => `${base}\nCOPY\n--from=evil / /app\n`, BUILD_INPUT],
    ["RUN alone, with its flag on the next line", base => `${base}\nRUN\n--network=host true\n`, BUILD_INPUT],
    ["COPY --from at a line's end", base => `${base}\nCOPY --from\n`, BUILD_INPUT],
    ["RUN --mount at a line's end, with CRLF", base => `${base}\r\nRUN --mount\r\n`, BUILD_INPUT],
    ["ADD alone", base => `${base}\nADD\n`, BUILD_INPUT],
  ])("dockerfile-check-across-lines: %s", (_name, form, reason) => refusedByBoth(form, reason));

  it("dockerfile-check-from-on-the-next-line: FROM alone reads no image, though the old expression took the next line's", () => {
    expect(() => phpImage("FROM\nphp:8.4.25-cli\n")).toThrow("exact");
    expect(() => nodeImage("FROM\nnode:22.11.0-alpine\n")).toThrow("exact");
    expect(() => phpImage(`${PHP}\nFROM\n`)).toThrow(STAGES);
  });
});

describe("the Dockerfile check takes what it took", () => {
  it("takes the examples' Dockerfiles", () => {
    const example = (name: string) => readFileSync(new URL(`../../../examples/${name}/Dockerfile`, import.meta.url), "utf8");
    expect(phpImage(example("php-security"))).toMatchObject({ reference: "php:8.4.26-cli-alpine", version: "8.4.26", branch: "8.4", flavor: "-cli-alpine" });
    expect(nodeImage(example("node-security"))).toMatchObject({ reference: "node:22.22.0-alpine", version: "22.22.0", branch: "22", flavor: "-alpine" });
  });
  it.each<[string, string]>([
    ["CRLF line ends", `${PHP}\r\nWORKDIR /app\r\nCOPY --chown=65534:65534 . /app\r\n`],
    ["a byte-order mark", `\u{FEFF}${PHP}\nWORKDIR /app\n`],
    ["comments that name what is refused", `# ADD https://example.com, COPY --from=x, FROM y\n${PHP}\n# RUN --network=host\n`],
    ["a comment with U+0085 inside", `# a\u0085b\n${PHP}\n`],
    ["no line feed at the end", PHP],
    ["blank lines, spaces and tabs", `\n  \n\t${PHP}   \n\n   \n`],
    ["FROM in lower case", `from php:8.4.25-cli\n`],
    ["a backslash inside a line", `${PHP}\nRUN printf 'a\\nb' > /tmp/x\n`],
    ["a line that ends in a backtick: the escape is always a backslash", `${PHP}\nRUN echo \`date\`\n`],
    ["an instruction with a word that starts like one that is refused", `${PHP}\nLABEL ADD=1\nRUN echo ADD FROM\nENV COPY=1\n`],
    ["a heredoc, read line by line as before", `${PHP}\nRUN <<EOF\necho hi\nEOF\n`],
  ])("takes %s", (_name, text) => {
    expect(phpImage(text)).toMatchObject({ reference: "php:8.4.25-cli", version: "8.4.25" });
  });
  it.each<[string, string]>([
    ["plain", "FROM php:8.4.25-cli\nWORKDIR /app\n"],
    ["a run of spaces, and spaces after the image", "FROM   php:8.4.25-cli  \nWORKDIR /app\n"],
    ["left spaces and CRLF", "  \t FROM\tphp:8.4.25-cli \r\nWORKDIR /app\r\n"],
    ["a byte-order mark", "\u{FEFF}FROM php:8.4.25-cli\n"],
    ["lines before it", "# a comment\n\n  \nFROM php:8.4.25-cli\r\r\n"],
    ["no line end", "\u{FEFF}# a\r\n FROM php:8.4.25-cli"],
  ])("gives the image's place in the file, and changes only it: %s", (_name, text) => {
    const image = phpImage(text);
    expect(text.slice(image.start, image.end).trim()).toBe("php:8.4.25-cli");
    const next = replaceImage(text, image, "php:8.4.28-cli");
    expect(next.replace("php:8.4.28-cli", "")).toBe(text.slice(0, image.start) + text.slice(image.end));
    expect(phpImage(next)).toMatchObject({ reference: "php:8.4.28-cli" });
  });
});

describe("namesNodeImage finds a FROM behind whitespace or a continuation, so it is a check that failed, not a skipped one", () => {
  it.each<[string, string]>([
    ["U+0085 before FROM", "\u0085FROM node:22-alpine\n"],
    ["no-break space before FROM", " FROM node:22-alpine\n"],
    ["a lines-long lead", "\n\n  \u0085\t\nFROM node:22-alpine\n"],
    ["FR, a backslash and a space, then OM", "FR\\ \nOM node:22-alpine\n"],
    ["FROM, a backslash, then the image on the next line", "FROM \\\nnode:22-alpine\n"],
    ["a backtick continuation", "# escape=`\nFR`\nOM node:22-alpine\n"],
    ["a comment that ends in a backslash, then the line itself", "# a \\\nFROM node:22-alpine\n"],
    ["a comment inside a continuation", "FROM \\\n# a comment\nnode:22-alpine\n"],
    ["an indented comment inside a continuation", "FROM \\\n  # a comment\nnode:22-alpine\n"],
    ["spaces and a tab before FROM", "  \t FROM node:22-alpine\n"],
    ["a line that ends in a backtick, which continues nothing here, then the line itself", "RUN echo `date`\nFROM node:22-alpine\n"],
  ])("dockerfile-check-names-node: %s", (_name, text) => {
    expect(namesNodeImage(text)).toBe(true);
  });
  // BuildKit also splits an instruction from its arguments, and its arguments, at these three (a review of this PR, B1).
  it.each<[string, string]>([
    ["a form feed after FROM", "FROM\fnode:22.11.0-alpine\n"],
    ["a vertical tab after FROM", "FROM\vnode:22.11.0-alpine\n"],
    ["a carriage return after FROM", "FROM\rnode:22.11.0-alpine\n"],
    ["a form feed after a flag", "FROM --platform=linux/amd64\fnode:22\n"],
    ["a vertical tab after a flag", "FROM --platform=linux/amd64\vnode:22\n"],
    ["a carriage return after a flag", "FROM --platform=linux/amd64\rnode:22\n"],
    ["a form feed after the image", "FROM node\fAS x\n"],
    ["a vertical tab after the image", "FROM node\vAS x\n"],
  ])("dockerfile-check-names-node-separator: %s", (_name, text) => {
    expect(namesNodeImage(text)).toBe(true);
  });
  // A continuation under each line end: `docker build` built each of these forms with scratch (a review of this PR, B2).
  // When a policy names node, the check refuses each as a continuation.
  it.each<[string, string]>([
    ["a backslash, LF, the image", "FROM \\\nnode:22.11.0-alpine\n"],
    ["a backslash, CRLF, the image", "FROM \\\r\nnode:22.11.0-alpine\r\n"],
    ["a backslash, two carriage returns and a line feed, the image", "FROM \\\r\r\nnode:22.11.0-alpine\r\n"],
    ["a backslash, a space, CRLF, the image", "FROM \\ \r\nnode:22.11.0-alpine\r\n"],
    ["a name split by a backslash and CRLF", "FROM no\\\r\nde:22.11.0-alpine\r\n"],
    ["a comment with CRLF, then the continuation", "# c\r\nFROM \\\r\nnode:22.11.0-alpine\r\n"],
    ["a comment inside a continuation with CRLF", "FROM \\\r\n# c\r\nnode:22.11.0-alpine\r\n"],
    ["a blank line inside a continuation with CRLF", "FROM \\\r\n\r\nnode:22.11.0-alpine\r\n"],
    ["a backtick continuation with CRLF", "# escape=`\r\nFR`\r\nOM node:22.11.0-alpine\r\n"],
    ["a backslash right after FROM, then the image indented, with LF", "FROM\\\n  node:22.11.0-alpine\n"],
    ["a backslash right after FROM, then the image after a tab, with CRLF", "FROM\\\r\n\tnode:22.11.0-alpine\r\n"],
  ])("dockerfile-check-names-node-crlf: %s", (_name, text) => {
    expect(namesNodeImage(text)).toBe(true);
    expect(() => nodeImage(text)).toThrow(READING);
  });
  // `docker build` built each of these forms with scratch: what follows the name on its line is taken off.
  it.each<[string, string]>([
    ["a backslash on the last line", "FROM node\\\n"],
    ["a backslash at the end of the file", "FROM node\\"],
    ["a backslash on the last line, with CRLF", "FROM node\\\r\n"],
    ["a no-break space after the name", "FROM node \n"],
    ["U+0085 after the name", "FROM node\u0085\n"],
    ["U+0085 after the name, with CRLF", "FROM node\u0085\r\n"],
    ["U+2003 after the name", "FROM node \n"],
  ])("dockerfile-check-names-node-line-end: %s", (_name, text) => {
    expect(namesNodeImage(text)).toBe(true);
  });
  // BuildKit fails on FROM alone, under either line end, so neither is a FROM it reads; nor is a heredoc's body.
  it.each(["FROM\nnode:22.11.0-alpine\n", "FROM\r\nnode:22.11.0-alpine\r\n", "FROM --platform=linux/amd64\r\nnode:22.11.0-alpine\r\n", "RUN <<EOF\r\nfrom\r\nnode x\r\nEOF\r\n", "# c\r\nFROM php:8.4.26-cli-alpine\r\nCOPY --chown=node:node . .\r\n",
    // BuildKit fails on these too: the join makes FROMnode, and FR and OM stay two words.
    "FROM\\\nnode:22.11.0-alpine\n", "FR\\\n  OM node:22.11.0-alpine\n"])("dockerfile-check-names-node-crlf: does not take %j for one", text => {
    expect(namesNodeImage(text)).toBe(false);
  });
  // What each of these forms does when a policy names node, so finding them gives the check that image reads or refuses.
  it("dockerfile-check-names-node-separator: nodeImage takes a form feed and a vertical tab after FROM, and refuses a carriage return", () => {
    expect(nodeImage("FROM\fnode:22.11.0-alpine\n")).toMatchObject({ reference: "node:22.11.0-alpine" });
    expect(nodeImage("FROM\vnode:22.11.0-alpine\n")).toMatchObject({ reference: "node:22.11.0-alpine" });
    expect(() => nodeImage("FROM\rnode:22.11.0-alpine\n")).toThrow(SEPARATOR);
    expect(() => nodeImage("FROM --platform=linux/amd64\fnode:22\n")).toThrow("exact version");
  });
  it.each([
    "# FROM node:22\n", "FROM php:8.4.26-cli-alpine\nCOPY --chown=node:node . .\n", "RUN echo FROM node\n", "# a \\ \n# FROM node\n",
    "FROM php:8.4.26-cli-alpine\r\nCOPY --chown=node:node . .\r\n", "FROM\fnodejs:22\n", "FROM php:8.4.26-cli-alpine\fAS node\n", "RUN echo FROM\fnode\n", "FROM\nnode:22\n",
  ])("does not take %j for one", text => {
    expect(namesNodeImage(text)).toBe(false);
  });
  // `docker build` reads these forms too (built with scratch), and they are not found, so an unconfigured scan says
  // nothing about them: docs/mistakes/2026-11-02-dockerfile-check-not-as-buildkit-reads.md says so. A policy that names
  // node refuses each. When detection reads them, this test goes, and that sentence with it.
  it.each([
    `FROM "node:22.11.0-alpine"\n`, `FROM 'node:22.11.0-alpine'\n`, `FROM no"de":22.11.0-alpine\n`, "ARG X=node:22.11.0-alpine\nFROM $X\n", "FROM ${X:-node:22.11.0-alpine}\n",
    // `--` alone ends the flags. A backslash inside the name. A raw byte 0x85 or 0xA0 after a flag ends the flag in
    // BuildKit, and a file read as UTF-8 gives U+FFFD there, which reads as part of the flag.
    "FROM -- node:22.11.0-alpine\n", "FROM --platform=linux/amd64 -- node:22.11.0-alpine\n", "FROM no\\de:22.11.0-alpine\n", "FROM --platform=linux/amd64\u{FFFD}node:22.11.0-alpine\n",
  ])("dockerfile-check-names-node-gap: does not find %j, and nodeImage refuses it", text => {
    expect(namesNodeImage(text)).toBe(false);
    expect(() => nodeImage(text)).toThrow("exact version");
  });
});

/** The line for "grows as n does, here": a time that grows with n gives a ratio near 4 from n to 4n, and with n² near 16. */
const RATIO_LINE = 8, SAMPLES = 7, FEWEST_SAMPLES = 3, MIN_SAMPLE_MS = 4;
/**
 * The guards stop a sample that would hang, as a backtracking expression's would: synchronous code cannot be stopped by
 * the test's own timeout. The budget ends the samples of one measure early, down to FEWEST_SAMPLES, and fails nothing.
 * All three are clock time. None of them says anything about how the time grows; the ratio does that.
 */
const GUARD_DOCKERFILE_MS = 5_000, GUARD_LOCK_MS = 30_000, MEASURE_BUDGET_MS = 15_000;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

const guardContext = createContext({ call: () => {} });
/** The CPU time this whole process has used, in ms, V8's helper threads included. A wait for a CPU is not in it. */
const cpuMs = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1_000; };
/** The CPU time `calls` calls of fn take, in ms. A refusal is an answer, and counts as one. */
function timed(fn: () => unknown, calls: number, guard: number): number {
  let took = 0;
  (guardContext as { call: () => void }).call = () => {
    const start = cpuMs();
    for (let i = 0; i < calls; i++) { try { fn(); } catch { /* a refusal */ } }
    took = cpuMs() - start;
  };
  try {
    runInContext("call()", guardContext, { timeout: guard });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    throw new Error(`No answer in ${guard} ms, where the guard stopped it.`);
  }
  return took;
}

/**
 * The CPU time of `atN` and of `at4N`, which read the same shape at n and 4n, each the median of up to SAMPLES samples
 * taken in turn. CPU time, as on a limited or busy machine the wait for a CPU does not fall evenly on clock time: under
 * `--cpus 0.25` a sample of 4 ms ran with no wait and the sample of 16 ms after it took 89 ms, a ratio of 22 on a plain
 * scan (docs/progress/2026-11-02-lratio-scaling-ratio.md). A time that uses no CPU, as a wait does, is not seen here.
 * A sample repeats the call often enough that the smaller takes MIN_SAMPLE_MS of CPU, and both repeat it the same number
 * of times, as a reader's 64 KiB limit leaves no larger n. The first round of samples is thrown away, as the code is
 * still warming up.
 */
function ratioOf(atN: () => unknown, at4N: () => unknown, guard: number) {
  const started = performance.now();
  timed(atN, 1, guard);
  timed(at4N, 1, guard);
  const once = Math.min(timed(atN, 1, guard), timed(atN, 1, guard), timed(atN, 1, guard));
  const calls = Math.max(1, Math.ceil(MIN_SAMPLE_MS / Math.max(once, 0.0001)));
  const small: number[] = [], large: number[] = [];
  timed(atN, calls, guard);
  timed(at4N, calls, guard);
  for (let sample = 0; sample < SAMPLES && (sample < FEWEST_SAMPLES || performance.now() - started < MEASURE_BUDGET_MS); sample++) {
    small.push(timed(atN, calls, guard));
    large.push(timed(at4N, calls, guard));
  }
  return { ratio: median(large) / median(small), atN: median(small) / calls, at4N: median(large) / calls, calls };
}

// One line for each measure, so that a run's log shows how close each came to its line.
const measured: string[] = [];
const measure = (name: string, atN: () => unknown, at4N: () => unknown, guard: number) => {
  const result = ratioOf(atN, at4N, guard);
  measured.push(`${result.ratio.toFixed(2)}\t${result.atN.toFixed(4)} ms\t${result.at4N.toFixed(4)} ms\t${result.calls}\t${name}`);
  return result;
};
/**
 * Holds one measure under the line. The line stays at 8. A measure at or over it is taken once more, that measure alone
 * and once only, and it fails when both are at or over the line: a chance failure then has to come twice, where a real n²
 * is over the line both times (docs/progress/2026-11-02-lratio-scaling-ratio.md). A sample the guard stops is not taken
 * again. Each measure taken again goes in `again`, so a run's log says how many there were and where, passed or failed.
 */
function heldUnderTheLine(name: string, take: (again: boolean) => ReturnType<typeof ratioOf>, again: string[]) {
  const first = take(false), taken = first.ratio < RATIO_LINE ? [first] : [first, take(true)];
  const ratios = taken.map(({ ratio }) => ratio.toFixed(2)).join(", then "), last = taken.at(-1)!;
  if (taken.length > 1) again.push(`${ratios}\t${name}`);
  expect(last.ratio, `${name}: ${ratios}; measured again ${taken.length - 1} time here, ${again.length} in this file so far; ${last.atN} ms a call at n, ${last.at4N} ms at 4n`).toBeLessThan(RATIO_LINE);
}
const measuredAgain: string[] = [];
const underTheLine = (name: string, atN: () => unknown, at4N: () => unknown, guard: number) =>
  heldUnderTheLine(name, again => measure(again ? `${name}, measured again` : name, atN, at4N, guard), measuredAgain);
afterAll(() => {
  console.log(["scaling ratios: ratio, CPU time of a call at n, of a call at 4n, calls in a sample, what", ...measured].join("\n"));
  console.log([`measured again: ${measuredAgain.length} (ratios, what)`, ...measuredAgain].join("\n"));
});

let controlSum = 0;
describe("the ratio tells these two apart on this machine", () => {
  const text = "ab".repeat(16_000), scan = (size: number) => { for (let i = 0; i < size; i++) controlSum += text.charCodeAt(i); };
  const scanEachPrefix = (size: number) => { for (let i = 0; i < size; i++) for (let j = 0; j <= i; j++) controlSum += text.charCodeAt(j); };
  it("gate-reader-scaling-ratio-control: this file is not in a worker thread, as the CPU time read is the whole process's", () => {
    expect(isMainThread).toBe(true);
  });
  it("gate-reader-scaling-ratio-control: a scan of n gives under the line", () => {
    underTheLine("control: a scan of 8,000, then 32,000", () => scan(8_000), () => scan(32_000), GUARD_DOCKERFILE_MS);
  }, 60_000);
  it.each<[string, number[], number, boolean]>([
    ["under the line: taken once, and passes", [7.99, 16], 1, true],
    ["over it, then under it: taken twice, and passes", [16, 3, 16], 2, true],
    ["over it twice: taken twice, and fails, with no third", [16, 16, 3], 2, false],
    ["at the line counts as over it", [8, 8, 3], 2, false],
  ])("gate-reader-scaling-ratio-control: a measure is taken again once at most: %s", (_name, ratios, times, passes) => {
    const left = [...ratios], again: string[] = [];
    const held = () => heldUnderTheLine("a shape", () => ({ ratio: left.shift()!, atN: 1, at4N: 1, calls: 1 }), again);
    if (passes) held();
    else expect(held).toThrow(`a shape: ${ratios.slice(0, 2).map(ratio => ratio.toFixed(2)).join(", then ")}; measured again 1 time here, 1 in this file so far`);
    expect(ratios.length - left.length).toBe(times);
    expect(again.length).toBe(times - 1);
  });
  it("gate-reader-scaling-ratio-control: a scan of each prefix of n, which is n², gives over the line", () => {
    expect(measure("control: a scan of each prefix of 2,000, then 8,000", () => scanEachPrefix(2_000), () => scanEachPrefix(8_000), GUARD_DOCKERFILE_MS).ratio).toBeGreaterThanOrEqual(RATIO_LINE);
    expect(controlSum).toBeGreaterThan(0);
  }, 60_000);
});

const KIB16 = 16 * 1024, KIB64 = 64 * 1024;
/** `unit` repeated, with `before` and `after` round it, to just under `size`. */
const fill = (size: number, unit: string, before = "", after = "") => `${before}${unit.repeat(Math.floor((size - before.length - after.length) / unit.length))}${after}`;
/** Up to 32,000 of a line feed and of a space at 64 KiB, the shape the old expression was cubic on, with 8,000 at 16 KiB. */
const half = (size: number) => Math.floor(size * 32_000 / KIB64);
describe("the Dockerfile readers' time grows less than 8 times from 16 KiB to 64 KiB, on these shapes", () => {
  it.each<[string, (size: number) => string]>([
    ["line feeds", size => fill(size, "\n")],
    ["spaces", size => fill(size, " ")],
    ["spaces, then a line that is not a directive", size => fill(size, " ", "", "x")],
    ["CRLF pairs", size => fill(size, "\r\n")],
    ["U+0085", size => fill(size, "\u0085")],
    ["lines of a space", size => fill(size, " \n")],
    ["COPY and spaces", size => fill(size, " ", `${PHP}\nCOPY`, "x")],
    ["line feeds, COPY and spaces", size => `${PHP}${"\n".repeat(half(size))}COPY${" ".repeat(half(size))}x`],
    ["line feeds, RUN and spaces", size => `${PHP}${"\n".repeat(half(size))}RUN${" ".repeat(half(size))}x`],
    ["COPY, tabs and spaces", size => fill(size, " \t", `${PHP}\nCOPY `, "x")],
    ["RUN and spaces", size => fill(size, " ", `${PHP}\nRUN`, "x")],
    ["RUN and runs of --network", size => fill(size, "--network", `${PHP}\nRUN `)],
    ["COPY and runs of --fro", size => fill(size, "--fro", `${PHP}\nCOPY `)],
    ["COPY and quotes", size => fill(size, '"', `${PHP}\nCOPY --`)],
    ["ADD and spaces", size => fill(size, " ", `${PHP}\nADD`)],
    ["many COPY lines", size => fill(size, "COPY \n", `${PHP}\n`)],
    ["# and spaces", size => fill(size, " ", "#", "x")],
    ["lines of #", size => fill(size, "#\n")],
    ["lines of //", size => fill(size, "//\n")],
    ["lines of # and spaces, with no directive", size => fill(size, "# \n \n")],
    ["# syntax and spaces", size => fill(size, " ", "# syntax", "x")],
    ["many FROM lines", size => fill(size, "FROM x\n")],
    ["FROM and spaces", size => fill(size, " ", "FROM")],
    ["FROM and spaces, then an image", size => fill(size, " ", "FROM ", "php:8.4.25-cli")],
    ["FROM and a long image", size => fill(size, "a", "FROM ")],
    ["FROM and a long flavor", size => fill(size, "a-", "FROM php:8.4.25-cli-", "!")],
    ["FROM, flags and spaces", size => fill(size, "--a ", "FROM ", "x")],
    ["FROM, flags and form feeds", size => fill(size, "--a\f", "FROM ", "x")],
    ["FROM, flags and carriage returns", size => fill(size, "--a\r", "FROM ", "x")],
    ["FROM and carriage returns", size => fill(size, "FROM\r")],
    ["FROM and form feeds", size => fill(size, "\f", "FROM", "x")],
    ["a run of carriage returns", size => fill(size, "\r")],
    ["a run of carriage returns, then a letter", size => fill(size, "\r", "FROM \\", "x")],
    ["two carriage returns and a line feed, many times", size => fill(size, "\r\r\n")],
    ["a backslash and CRLF, many times", size => fill(size, "\\\r\n")],
    ["a comment and CRLF, many times", size => fill(size, "#\r\n")],
    ["backslashes and spaces", size => fill(size, "\\ ")],
    ["a backslash and spaces to the end", size => fill(size, " ", `${PHP}\n\\`)],
    ["backticks and spaces", size => fill(size, "` ")],
    ["backslash-newline pairs", size => fill(size, "\\\n")],
    ["a line of many words", size => fill(size, "a ", `${PHP}\nRUN `)],
  ])("gate-reader-scaling-ratio: %s", (name, shape) => {
    const small = shape(KIB16), large = shape(KIB64);
    expect(large.length).toBeLessThanOrEqual(KIB64);
    for (const [reader, read] of [["phpImage", phpImage], ["nodeImage", nodeImage], ["namesNodeImage", namesNodeImage]] as const) {
      underTheLine(`${name}, ${reader}`, () => read(small), () => read(large), GUARD_DOCKERFILE_MS);
    }
  }, 60_000);
  it("still refuses a file over 64 KiB before reading it", () => {
    expect(() => phpImage(`${PHP}\n${" ".repeat(KIB64)}`)).toThrow("exceeds 64 KiB");
  });
});

const LONGEST = "A package-lock path is longer than 4096 characters.";
const lockOf = (packages: Record<string, unknown>) => JSON.stringify({ name: "a", lockfileVersion: 3, packages: { "": { name: "a" }, ...packages } });
describe("lockKey: a key's length", () => {
  const exactly = (size: number) => `node_modules/${"a".repeat(size - "node_modules/".length)}`;
  it("takes a key of 4,096 characters and refuses one of 4,097, whatever its form, without repeating it", () => {
    expect(lockKey(exactly(4096), {})).toBe("install");
    for (const key of [exactly(4097), `packages/${"a".repeat(5000)}`, `node_modules/${"a\\".repeat(5000)}`, `${"node_modules/a/".repeat(400)}!`]) {
      for (const item of [{}, { extraneous: true }]) {
        expect(() => lockKey(key, item)).toThrow(LONGEST);
        try { lockKey(key, item); } catch (error) { expect((error as Error).message).toBe(LONGEST); }
      }
    }
  });
  it("refuses a long key through every reader of a lock, as a refused key", () => {
    const lock = lockOf({ [exactly(4097)]: { version: "1.0.0" } });
    for (const read of [readLock, lockEntries, lockExtraneous, lockLinks]) expect(() => read(lock)).toThrow(LONGEST);
    // A key of the longest size is read as any other.
    expect(lockEntries(lockOf({ [exactly(4096)]: { version: "1.0.0" } }))).toMatchObject([{ path: exactly(4096), version: "1.0.0" }]);
  });
});

const MIB1 = 1024 * 1024, MIB4 = 4 * MIB1;
/** A key out of form: every segment could start a node_modules part, and the last is out of form. The old expression backtracked most on this. */
const badKey = (size: number, lead = "") => `${lead}${"node_modules/a/".repeat(Math.floor((size - lead.length - 1) / "node_modules/a/".length))}!`;
const oneLongKey = (size: number) => lockOf({ [badKey(size - 256)]: { version: "1.0.0" } });
const oneLongFolder = (size: number) => lockOf({ [badKey(size - 256)]: { extraneous: true } });
/** `count` keys of `keyLength` characters, each out of form and marked extraneous: refused by nothing but read by every reader. */
const manyExtraneous = (count: number, keyLength: number) => lockOf(Object.fromEntries(Array.from({ length: count }, (_, i) => [badKey(keyLength, `w${i}/`), { extraneous: true }])));
const manyInstalled = (keyLength: number) => lockOf(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`w${i}/${"node_modules/a/".repeat(Math.floor((keyLength - 32) / "node_modules/a/".length))}node_modules/z`, { version: "1.0.0" }])));
const same = (lock: string) => () => packageLockInputs({ before: lock, after: lock }, { before: "{}", after: "{}" });
const allKeys = (lock: string) => { const keys = Object.keys(readLock(lock)); return () => { for (const key of keys) lockKey(key, { extraneous: true }); }; };
describe("the lock readers' time grows less than 8 times from n to 4n, on these shapes", () => {
  // A key's length and the number of keys are two ways to grow: the old expression was quadratic only in the first.
  it.each<[string, string, string, (lock: string) => () => unknown]>([
    ["lockEntries, one key of 1 MiB, then 4 MiB", oneLongKey(MIB1), oneLongKey(MIB4), lock => () => lockEntries(lock)],
    ["lockEntries, one extraneous key of 1 MiB, then 4 MiB", oneLongFolder(MIB1), oneLongFolder(MIB4), lock => () => lockEntries(lock)],
    ["lockExtraneous, one extraneous key of 1 MiB, then 4 MiB", oneLongFolder(MIB1), oneLongFolder(MIB4), lock => () => lockExtraneous(lock)],
    ["lockEntries, 1,000 extraneous keys of 1,024 characters, then 4,096", manyExtraneous(1000, 1024), manyExtraneous(1000, 4096), lock => () => lockEntries(lock)],
    ["lockExtraneous, 1,000 extraneous keys of 1,024 characters, then 4,096", manyExtraneous(1000, 1024), manyExtraneous(1000, 4096), lock => () => lockExtraneous(lock)],
    ["lockKey, 1,000 extraneous keys of 1,024 characters, then 4,096", manyExtraneous(1000, 1024), manyExtraneous(1000, 4096), allKeys],
    ["lockEntries, 1,000 install paths of about 1,024 characters, then 4,096", manyInstalled(1024), manyInstalled(4096), lock => () => lockEntries(lock)],
    ["packageLockInputs, 1,000 extraneous keys of 1,024 characters, then 4,096", manyExtraneous(1000, 1024), manyExtraneous(1000, 4096), same],
    ["lockEntries, 250 extraneous keys of 4,096 characters, then 1,000", manyExtraneous(250, 4096), manyExtraneous(1000, 4096), lock => () => lockEntries(lock)],
    ["lockExtraneous, 250 extraneous keys of 4,096 characters, then 1,000", manyExtraneous(250, 4096), manyExtraneous(1000, 4096), lock => () => lockExtraneous(lock)],
    ["packageLockInputs, 250 extraneous keys of 4,096 characters, then 1,000", manyExtraneous(250, 4096), manyExtraneous(1000, 4096), same],
  ])("gate-reader-scaling-ratio: %s", (name, small, large, read) => {
    expect(large.length).toBeLessThanOrEqual(MIB4);
    underTheLine(name, read(small), read(large), GUARD_LOCK_MS);
  }, 120_000);
});

// Not linear, and written down as it is. One install path of `segments` node_modules parts, with `deps` dependencies that
// nothing in the lock meets, so each lookup climbs the whole path. The fix belongs in another PR; when it lands, the two
// tests that say "from 8 up to 32" fail, and go with this comment.
const QUADRATIC_FROM = RATIO_LINE, QUADRATIC_BELOW = 32;
const keyOf = (segments: number) => `${"node_modules/a/".repeat(segments)}node_modules/z`;
const manyDeps = (segments: number, deps: number) => lockOf({ [keyOf(segments)]: { version: "1.0.0", dependencies: Object.fromEntries(Array.from({ length: deps }, (_, i) => [`d${i}`, "1.0.0"])) } });
describe("lock-key-many-deps: one key with many dependencies is quadratic in the key's length today", () => {
  it("lock-key-many-deps: packageLockInputs, 200 dependencies, a key of 1,019 characters, then 4,034: from 8 up to 32 times, not under 8", () => {
    const { ratio, atN, at4N } = measure("lock-key-many-deps: packageLockInputs, 200 deps, key of 1,019, then 4,034", same(manyDeps(67, 200)), same(manyDeps(268, 200)), GUARD_LOCK_MS);
    expect(ratio, `${atN} ms a call at n, ${at4N} ms at 4n`).toBeGreaterThanOrEqual(QUADRATIC_FROM);
    expect(ratio, `${atN} ms a call at n, ${at4N} ms at 4n`).toBeLessThan(QUADRATIC_BELOW);
  }, 120_000);
  it("lock-key-many-deps: resolveFrom alone, a key of 1,019 characters, then 4,034: from 8 up to 32 times, not under 8", () => {
    const none = new Map<string, unknown>(), at = (segments: number) => `${keyOf(segments)}/`;
    const small = at(67), large = at(268);
    const { ratio, atN, at4N } = measure("lock-key-many-deps: resolveFrom alone, key of 1,019, then 4,034", () => resolveFrom(none, small, "d"), () => resolveFrom(none, large, "d"), GUARD_LOCK_MS);
    expect(ratio, `${atN} ms a call at n, ${at4N} ms at 4n`).toBeGreaterThanOrEqual(QUADRATIC_FROM);
    expect(ratio, `${atN} ms a call at n, ${at4N} ms at 4n`).toBeLessThan(QUADRATIC_BELOW);
  }, 120_000);
  it("lock-key-many-deps: packageLockInputs, a key of 4,034 characters, 50 dependencies, then 200: under the line, in the number of dependencies alone", () => {
    underTheLine("lock-key-many-deps: packageLockInputs, key of 4,034, 50 deps, then 200", same(manyDeps(268, 50)), same(manyDeps(268, 200)), GUARD_LOCK_MS);
  }, 120_000);
});

// The path pattern's answers before the fix, as digests. The old pattern stays out of the code, because kept as code it
// is the quadratic expression this file refuses: to record them again, put it back behind lockKey with no length limit
// and run this file, as docs/mistakes/2026-11-02-composer-name-regex-backtracking.md did.
//   /^(?:[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*\/)?(?:node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+\/)*node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+$/i
const OLD_ON_SHORT_KEYS = { compared: 299_593, install: 4_871, sha256: "367d5684a291aae33a397fd78b0085f395749ec31b20fac6d87f1f16ad897dbd" };
const OLD_ON_CORPUS = { locks: 434, keys: 5_350, longest: 93, sha256: "f69025d4abd656a1c04bf092a879d81738b4fb9c05a6589a3991a1f7d3e6c2ea" };
const sha256 = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");

const kind = (key: string, item: unknown) => { try { return lockKey(key, item); } catch { return "refused"; } };

describe("lockKey's answers stay as they were", () => {
  it("on every sequence of up to 6 pieces of a key, plain and marked extraneous", () => {
    const pieces = ["node_modules/", "a", "@b", "/", ".", "..", "A", "!"];
    const answers: string[] = [];
    const walk = (key: string, left: number) => {
      answers.push(`${key}\t${kind(key, {})}\t${kind(key, { extraneous: true })}`);
      if (left) for (const piece of pieces) walk(key + piece, left - 1);
    };
    walk("", 6);
    expect({ compared: answers.length, install: answers.filter(line => line.includes("\tinstall\t")).length, sha256: sha256(answers) }).toEqual(OLD_ON_SHORT_KEYS);
  });
  it("on every lock of the npm corpus, whose keys are all within the limit", () => {
    const root = new URL("fixtures/npm-corpus/", import.meta.url);
    const locks = (readdirSync(root, { recursive: true }) as string[]).map(path => path.replaceAll("\\", "/")).filter(path => path.endsWith("/package-lock.json")).sort();
    const lines: string[] = [];
    let keys = 0, longest = 0;
    for (const path of locks) {
      const text = readFileSync(new URL(path, root), "utf8");
      for (const [key, item] of Object.entries((JSON.parse(text) as { packages: Record<string, unknown> }).packages)) {
        keys++;
        longest = Math.max(longest, key.length);
        lines.push(`${path}\t${key}\t${kind(key, item)}`);
      }
      let read: string;
      try { read = JSON.stringify(lockEntries(text)); } catch (error) { read = (error as Error).message; }
      lines.push(`${path}\t${read}`);
    }
    expect(longest).toBeLessThanOrEqual(4096);
    expect({ locks: locks.length, keys, longest, sha256: sha256(lines) }).toEqual(OLD_ON_CORPUS);
  });
});

// What the check takes, on every short file these pieces make, around one FROM. The old expressions took every one of
// these, at the same place in the file: that was compared once, on these and on longer sequences
// (docs/progress/2026-11-02-ldock-dockerfile-check.md). A change to the reader that changes this set repeats that comparison.
const TAKEN = { compared: 43_275, taken: 20_894, sha256: "08d930eebf8ec7d7c9640f9a32caf1ecae117526b20f9e1115e03c41f28d1136" };
describe("what the Dockerfile check takes is pinned", () => {
  it("on every sequence of up to 3 pieces, before and after one FROM", () => {
    const pieces = ["FROM", "from", "ADD", "COPY", "RUN", " ", "\t", "\n", "\r\n", "\r", "\u0085", " ", " ", "\\", "`", "#", "//", "syntax", "=", "--from=x", "--network=host", '"', "php:8.4.25-cli", "x"];
    const ref = /^php:(8\.4\.25)(-cli)$/, take = (text: string): RuntimeImage | null => {
      try { return officialImage(text, ref, "usage", version => version); } catch { return null; }
    };
    const taken: string[] = [];
    let compared = 0;
    const walk = (middle: string, left: number) => {
      for (const text of [`${PHP}\n${middle}`, `${middle}\n${PHP}\n`, `${PHP}${middle}`]) {
        compared++;
        const image = take(text);
        if (image) taken.push(JSON.stringify([text, image.start, image.end]));
      }
      if (left) for (const piece of pieces) walk(middle + piece, left - 1);
    };
    walk("", 3);
    expect({ compared, taken: taken.length, sha256: sha256(taken) }).toEqual(TAKEN);
  });
});
