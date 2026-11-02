// The Composer name check decides in linear time, whatever the name: names reach it from Packagist's metadata
// (docs/mistakes/2026-11-02-composer-name-regex-backtracking.md).
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { isComposerName, packagistReleases } from "../src/security/time-cap.ts";

// The expression before the fix:
//   /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/
// It stays out of the code, because kept as code it is itself the exponential expression CodeQL's js/redos reports. The
// digests below are its answers on these fixed inputs, recorded by running it: to record them again, put it back behind
// isComposerName with no length limit and run this file.
const OLD_ON_RANDOM_NAMES = { compared: 200_000, accepted: 21_865, sha256: "97ca3b4ced9d2ab9ee30b4b69c3eeb1c84fe406432c2caf3d501db69d7441798" };
const OLD_ON_SHORT_STRINGS = { compared: 335_923, accepted: 106, sha256: "11f8c70d2b9dfda3d39bff8f6058f737be9335280f3aa61a689126761f76e8d5" };

const LIMIT_MS = 50;

/**
 * Calls packagistReleases under a limit Node's VM enforces, so an expression that backtracks fails the test at the limit
 * and does not hang it. A busy machine can pause one try, so it gets three; backtracking fails all three.
 */
function callWithinLimit(name: string, fetchFn: typeof fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return runInNewContext("call()", { call: () => packagistReleases(name, fetchFn) }, { timeout: LIMIT_MS }) as Promise<unknown>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw e;
    }
  }
  throw new Error(`The check of a name of ${name.length} characters took over ${LIMIT_MS} ms in each of 3 tries.`);
}

/** A small generator with a fixed seed (mulberry32), so every run compares the same inputs. */
function random(seed: number): (below: number) => number {
  let state = seed;
  return below => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * below);
  };
}

const ALNUM = ["a", "b", "z", "0", "1", "9"];
const SEPARATORS = ["-", "_", ".", "--", "---", "-_", "_.", "..", ""];
const OTHERS = ["A", "Z", "/", "//", " ", "\n", "\r", " ", "!", "@", "é"];

/** One name: mostly well formed, so that both answers are common. Runs stay short, because the old expression is exponential in them. */
function randomName(next: (below: number) => number): string {
  const pick = (from: string[]) => from[next(from.length)]!;
  const run = () => Array.from({ length: 1 + next(4) }, () => pick(ALNUM)).join("");
  const side = () => {
    let text = next(10) === 0 ? pick(SEPARATORS) : "";
    for (let parts = 1 + next(4); parts > 0; parts--) text += run() + (parts > 1 ? pick(SEPARATORS) : "");
    return text + (next(10) === 0 ? pick(SEPARATORS) : "");
  };
  let name = `${side()}/${side()}`;
  if (next(3) === 0) {
    const at = next(name.length + 1), keep = next(2);
    name = name.slice(0, at) + pick(next(2) === 0 ? OTHERS : SEPARATORS) + name.slice(at + keep);
  }
  return name;
}

function* randomNames(): Generator<string> {
  const next = random(20261102);
  for (let i = 0; i < 200_000; i++) yield randomName(next);
}

function* shortStrings(name = ""): Generator<string> {
  yield name;
  if (name.length < 7) for (const c of ["a", "-", "_", ".", "/", "\n"]) yield* shortStrings(name + c);
}

/** isComposerName's answers in order, one character each: one different answer changes the digest. */
function answers(names: Iterable<string>): { compared: number; accepted: number; sha256: string } {
  const hash = createHash("sha256");
  let compared = 0, accepted = 0;
  for (const name of names) {
    const answer = isComposerName(name);
    hash.update(answer ? "1" : "0");
    compared++;
    if (answer) accepted++;
  }
  return { compared, accepted, sha256: hash.digest("hex") };
}

describe("packagistReleases, on a name that makes a backtracking expression explode", () => {
  const a = (n: number) => "a".repeat(n);
  it.each([
    ["composer-name-regex-linear: 10,000 a's then -/x", `${a(10_000)}-/x`],
    ["composer-name-regex-linear: under the length limit, in the vendor", `${a(236)}-/x`],
    ["composer-name-regex-linear: under the length limit, in the package", `x/${a(236)}-`],
  ])("%s is refused within the limit, with no request", async (_, name) => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(callWithinLimit(name, fetchFn)).rejects.toThrow("Invalid Composer package name");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("isComposerName", () => {
  it("composer-name-regex-linear: answers as the old expression did on 200,000 random names", () => {
    expect(answers(randomNames())).toEqual(OLD_ON_RANDOM_NAMES);
  }, 60_000);

  it("composer-name-regex-linear: answers as the old expression did on every short string", () => {
    expect(answers(shortStrings())).toEqual(OLD_ON_SHORT_STRINGS);
  }, 60_000);

  it("composer-name-regex-linear: takes a name of up to 240 characters and refuses a longer one", () => {
    const name = (length: number) => `${"a".repeat(100)}/${"b".repeat(length - 101)}`;
    expect(isComposerName(name(240))).toBe(true);
    expect(isComposerName(name(241))).toBe(false);
  });
});
