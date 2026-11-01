// The Dockerfile check reads a file in the order BuildKit does, and the lock and Dockerfile readers decide in linear time
// (docs/mistakes/2026-11-02-dockerfile-check-not-as-buildkit-reads.md). Nothing here runs Docker. Which forms were built
// once with `docker build --network=none --pull=false`, and what it did, is in docs/progress/2026-11-02-ldock-dockerfile-check.md.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { lockEntries, lockExtraneous, lockKey, lockLinks, readLock } from "../src/security/judge.ts";
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

describe("namesNodeImage reads FROM as BuildKit does, so a hidden one is a check that failed, not a skipped one", () => {
  it.each<[string, string]>([
    ["U+0085 before FROM", "\u0085FROM node:22-alpine\n"],
    ["no-break space before FROM", " FROM node:22-alpine\n"],
    ["a lines-long lead", "\n\n  \u0085\t\nFROM node:22-alpine\n"],
    ["FR, a backslash and a space, then OM", "FR\\ \nOM node:22-alpine\n"],
    ["FROM, a backslash, then the image on the next line", "FROM \\\nnode:22-alpine\n"],
    ["a backtick continuation", "# escape=`\nFR`\nOM node:22-alpine\n"],
    ["a comment that ends in a backslash, then the line itself", "# a \\\nFROM node:22-alpine\n"],
    ["a comment inside a continuation", "FROM \\\n# a comment\nnode:22-alpine\n"],
    ["a line that ends in a backtick, which continues nothing here, then the line itself", "RUN echo `date`\nFROM node:22-alpine\n"],
  ])("dockerfile-check-names-node: %s", (_name, text) => {
    expect(namesNodeImage(text)).toBe(true);
  });
  it.each(["# FROM node:22\n", "FROM php:8.4.26-cli-alpine\nCOPY --chown=node:node . .\n", "RUN echo FROM node\n", "# a \\ \n# FROM node\n"])("does not take %j for one", text => {
    expect(namesNodeImage(text)).toBe(false);
  });
});

const LIMIT_DOCKERFILE_MS = 50, LIMIT_LOCK_MS = 1000, LIMIT_LOCK_INPUTS_MS = 4000;
/**
 * Calls fn under a limit Node's VM enforces, as in time-cap-composer-name.test.ts, so an expression that backtracks fails
 * the test at the limit and does not hang it. A busy machine can pause one try, so it gets three; backtracking fails all
 * three. A refusal is an answer: what counts is that the answer came in time.
 */
function answersWithin(limit: number, fn: () => unknown): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      runInNewContext("call()", { call: () => { try { fn(); } catch { /* a refusal */ } } }, { timeout: limit });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    }
  }
  throw new Error(`Over ${limit} ms in each of 3 tries.`);
}

const KIB64 = 64 * 1024;
/** `unit` repeated, with `before` and `after` round it, to just under the 64 KiB the check reads. */
const fill = (unit: string, before = "", after = "") => `${before}${unit.repeat(Math.floor((KIB64 - before.length - after.length) / unit.length))}${after}`;
describe("the Dockerfile readers decide 64 KiB in linear time", () => {
  it.each<[string, string]>([
    ["line feeds", fill("\n")],
    ["spaces", fill(" ")],
    ["spaces, then a line that is not a directive", fill(" ", "", "x")],
    ["CRLF pairs", fill("\r\n")],
    ["U+0085", fill("\u0085")],
    ["lines of a space", fill(" \n")],
    ["COPY and spaces", fill(" ", `${PHP}\nCOPY`, "x")],
    ["line feeds, COPY and spaces: the old expression was cubic here", `${PHP}${"\n".repeat(32_000)}COPY${" ".repeat(32_000)}x`],
    ["line feeds, RUN and spaces: the old expression was cubic here", `${PHP}${"\n".repeat(32_000)}RUN${" ".repeat(32_000)}x`],
    ["COPY, tabs and spaces", fill(" \t", `${PHP}\nCOPY `, "x")],
    ["RUN and spaces", fill(" ", `${PHP}\nRUN`, "x")],
    ["RUN and runs of --network", fill("--network", `${PHP}\nRUN `)],
    ["COPY and runs of --fro", fill("--fro", `${PHP}\nCOPY `)],
    ["COPY and quotes", fill('"', `${PHP}\nCOPY --`)],
    ["ADD and spaces", fill(" ", `${PHP}\nADD`)],
    ["many COPY lines", fill("COPY \n", `${PHP}\n`)],
    ["# and spaces", fill(" ", "#", "x")],
    ["lines of #", fill("#\n")],
    ["lines of //", fill("//\n")],
    ["lines of # and spaces, with no directive", fill("# \n \n")],
    ["# syntax and spaces", fill(" ", "# syntax", "x")],
    ["many FROM lines", fill("FROM x\n")],
    ["FROM and spaces", fill(" ", "FROM")],
    ["FROM and spaces, then an image", fill(" ", "FROM ", "php:8.4.25-cli")],
    ["FROM and a long image", fill("a", "FROM ")],
    ["FROM and a long flavor", fill("a-", "FROM php:8.4.25-cli-", "!")],
    ["FROM, flags and spaces", fill("--a ", "FROM ", "x")],
    ["backslashes and spaces", fill("\\ ")],
    ["a backslash and spaces to the end", fill(" ", `${PHP}\n\\`)],
    ["backticks and spaces", fill("` ")],
    ["backslash-newline pairs", fill("\\\n")],
    ["a line of many words", fill("a ", `${PHP}\nRUN `)],
  ])("gate-reader-linear: %s", (_name, text) => {
    expect(text.length).toBeLessThanOrEqual(KIB64);
    answersWithin(LIMIT_DOCKERFILE_MS, () => phpImage(text));
    answersWithin(LIMIT_DOCKERFILE_MS, () => nodeImage(text));
    answersWithin(LIMIT_DOCKERFILE_MS, () => namesNodeImage(text));
  });
  it("still refuses a file over 64 KiB before reading it", () => {
    expect(() => phpImage(`${PHP}\n${" ".repeat(KIB64)}`)).toThrow("exceeds 64 KiB");
  });
});

const LONGEST = "A package-lock path is longer than 4096 characters.";
const lockOf = (packages: Record<string, unknown>) => JSON.stringify({ name: "a", lockfileVersion: 3, packages: { "": { name: "a" }, ...packages } });
describe("lockKey: a key's length, and its time", () => {
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

  const MIB4 = 4 * 1024 * 1024;
  /** A key the path pattern backtracks most on: every segment could start its node_modules part, and the last is out of form. */
  const badKey = (size: number, lead = "") => `${lead}${"node_modules/a/".repeat(Math.floor((size - lead.length - 1) / "node_modules/a/".length))}!`;
  const oneLongKey = lockOf({ [badKey(MIB4 - 256)]: { version: "1.0.0" } });
  const oneLongFolder = lockOf({ [badKey(MIB4 - 256)]: { extraneous: true } });
  // 4 MiB of keys of 4,096 characters, each out of form and marked extraneous: refused by nothing but read by every reader.
  const manyExtraneous = lockOf(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [badKey(4096, `w${i}/`), { extraneous: true }])));
  const manyInstalled = lockOf(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`w${i}/${"node_modules/a/".repeat(270)}node_modules/z`, { version: "1.0.0" }])));
  it.each<[string, string, () => unknown]>([
    ["lockEntries, one key of 4 MiB", oneLongKey, () => lockEntries(oneLongKey)],
    ["lockEntries, one extraneous key of 4 MiB", oneLongFolder, () => lockEntries(oneLongFolder)],
    ["lockExtraneous, one extraneous key of 4 MiB", oneLongFolder, () => lockExtraneous(oneLongFolder)],
    ["lockEntries, 1,000 extraneous keys of 4,096 characters", manyExtraneous, () => lockEntries(manyExtraneous)],
    ["lockExtraneous, 1,000 extraneous keys of 4,096 characters", manyExtraneous, () => lockExtraneous(manyExtraneous)],
    ["lockEntries, 1,000 install paths of about 4,096 characters", manyInstalled, () => lockEntries(manyInstalled)],
    // 1,000 keys under the limit, read 10 times: the old expression took 2.3 s here, and this one 0.1 s.
    ["lockKey, 10 times over 1,000 extraneous keys of 4,096 characters", manyExtraneous, () => {
      const keys = Object.keys(readLock(manyExtraneous));
      for (let round = 0; round < 10; round++) for (const key of keys) lockKey(key, { extraneous: true });
    }],
  ])("gate-reader-linear: %s", (_name, lock, read) => {
    expect(lock.length).toBeLessThanOrEqual(MIB4);
    answersWithin(LIMIT_LOCK_MS, read);
  }, 30_000);
  // Everything the judge reads from a lock change: each lock is parsed and read over and over, so this has its own limit.
  // The old expression took 9.5 s here and this one 0.6 to 0.7 s, in the same container; GitHub's runner took over 1 s.
  it("gate-reader-linear: packageLockInputs, 1,000 extraneous keys of 4,096 characters", () => {
    expect(manyExtraneous.length).toBeLessThanOrEqual(MIB4);
    answersWithin(LIMIT_LOCK_INPUTS_MS, () => packageLockInputs({ before: manyExtraneous, after: manyExtraneous }, { before: "{}", after: "{}" }));
  }, 30_000);
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
