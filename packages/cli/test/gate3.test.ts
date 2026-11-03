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
import { acquireDockerfile, ACQUIRE_IMAGE, BOX_IMAGE, boxDockerfile, compareRuns, dummyEnv, gate3Refusal, judgeGate3, notCovered, parseRun, specificationPages, TMP_NEARLY_FULL_BYTES, UNDECIDABLE_REASONS, undecidableCounts, type Gate3Page, type Gate3Run, type StepStatus, type UndecidableReason } from "../src/security/gate3.ts";
import { BOX_DRIVER, FREEZE_CLOCK, MAX_PAGES, RESULT_MARKER } from "../src/security/gate3-box.ts";
import { snapshot } from "../src/security/project.ts";

const passed = { status: "passed" as StepStatus, seconds: 1 };
const absent = { status: "absent" as StepStatus, seconds: 0 };
const page = (path: string, over: Partial<Gate3Page> = {}): Gate3Page => ({ path, status: 200, exceptions: [], console: [], dom: ["aaaaaaaa", "bbbbbbbb"], screenshot: "0".repeat(32), ...over });
const run = (pages: Gate3Page[], over: Partial<Gate3Run> = {}): Gate3Run => ({ build: passed, types: passed, start: passed, crawl: passed, tests: passed, too_many_pages: false, pages, seconds: 2, memory_peak_bytes: 1, memory_swap_peak_bytes: 0, memory_swap_max: "0", memory_oom_kills: 0, tmp_min_free_bytes: 40 * 1_048_576, heap_out_lines: 0, enospc_lines: 0, host_cpus: 16, ...over });
const failed = { status: "failed" as StepStatus, seconds: 1 }, timedOut = { status: "timed_out" as StepStatus, seconds: 1 };
const old = () => run([page("/"), page("/about")]);

describe("what `ludion patch` does with a verdict (docs/decisions/2026-11-03-gate3-called-from-patch.md)", () => {
  const comparison = compareRuns(old(), old(), old());
  it("not_broken does not stop a fix", () => expect(gate3Refusal(comparison)).toBeNull());
  it("broken stops it, with its reasons, and says how many more are in the receipt", () => {
    expect(gate3Refusal({ ...comparison, verdict: "broken", broken: ["One."] })).toBe("Gate 3 stops this fix: One.");
    expect(gate3Refusal({ ...comparison, verdict: "broken", broken: ["1", "2", "3", "4", "5", "6", "7"] })).toBe("Gate 3 stops this fix: 1 2 3 4 5 (2 more in the receipt)");
  });
  it("broken wins, whatever the undecidable reasons beside it, not_covered included", () => {
    expect(gate3Refusal({ ...comparison, verdict: "broken", broken: ["One."], undecidable: ["Other."], undecidable_reasons: ["not_covered"] })).toBe("Gate 3 stops this fix: One.");
  });
  it.each(UNDECIDABLE_REASONS.filter(reason => reason !== "not_covered"))("undecidable for %s stops it", reason => {
    expect(gate3Refusal({ ...comparison, verdict: "undecidable", undecidable: ["Why."], undecidable_reasons: [reason] })).toBe("Gate 3 cannot judge this fix, so it stops: Why.");
  });
  it("only not_covered alone goes on: beside another reason it stops, and with no reason named it stops", () => {
    const covered = { ...comparison, verdict: "undecidable" as const, undecidable: ["Why."] };
    expect(notCovered({ ...covered, undecidable_reasons: ["not_covered"] })).toBe(true);
    expect(gate3Refusal({ ...covered, undecidable_reasons: ["not_covered"] })).toBeNull();
    expect(notCovered({ ...covered, undecidable_reasons: ["not_covered", "old_failed"] })).toBe(false);
    expect(gate3Refusal({ ...covered, undecidable_reasons: ["not_covered", "old_failed"] })).toContain("cannot judge");
    expect(notCovered({ ...covered, undecidable_reasons: [] })).toBe(false);
    expect(gate3Refusal({ ...covered, undecidable_reasons: [] })).toContain("cannot judge");
    expect(notCovered({ ...comparison, undecidable_reasons: ["not_covered"] })).toBe(false);
  });
});

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
    const result = compareRuns(old(), old(), run(old().pages, over), run(old().pages, over));
    expect(result.verdict).toBe("broken");
    expect(result.broken.join(" ")).toMatch(reason);
  });

  describe("new failing to build or start: the two runs are read as the definition's Limits say", () => {
    const noBuild = (over: Partial<Gate3Run> = {}) => run([], { build: failed, types: absent, start: absent, crawl: absent, tests: absent, ...over });
    const noStart = (over: Partial<Gate3Run> = {}) => run([], { start: failed, crawl: absent, ...over });
    const up = (over: Partial<Gate3Run> = {}) => run(old().pages, over);
    const failing: [string, typeof noBuild][] = [["build", noBuild], ["start", noStart]];

    it.each(failing)("oom-is-undecidable-not-broken: %s, an OOM kill on either run", (_name, fails) => {
      for (const [first, second] of [[fails({ memory_oom_kills: 2 }), fails()], [fails(), fails({ memory_oom_kills: 1 })], [fails({ memory_oom_kills: 1 }), fails({ memory_oom_kills: 1 })]]) {
        expect(compareRuns(old(), old(), first!, second!)).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
      }
    });

    it("oom-is-undecidable-not-broken: it comes before the second run's own result, and what the first run showed is kept", () => {
      const killed = noBuild({ memory_oom_kills: 1 });
      expect(compareRuns(old(), old(), killed, up()).undecidable_reasons).toEqual(["box_resources_new_only"]);
      expect(compareRuns(old(), old(), noBuild(), up({ memory_oom_kills: 1 })).undecidable_reasons).toEqual(["box_resources_new_only"]);
      expect(compareRuns(old(), old(), killed, null).undecidable_reasons).toEqual(["box_resources_new_only"]);
      expect(compareRuns(old(), old(), killed, noBuild()).notes).toContain("New did not build; old did.");
      // A test that also failed in the first run does not make it broken: the box had run out.
      const result = compareRuns(old(), old(), noStart({ memory_oom_kills: 1, tests: failed }), noStart());
      expect(result).toMatchObject({ verdict: "undecidable", broken: [] });
      expect(result.notes).toContain("Tests passed on both runs of old and fail on new.");
    });

    it.each(failing)("tmp-nearly-full-is-undecidable: %s, under the fixed number on either run, and not at it", (_name, fails) => {
      expect(TMP_NEARLY_FULL_BYTES).toBe(1_048_576);
      for (const free of [0, TMP_NEARLY_FULL_BYTES - 1]) {
        expect(compareRuns(old(), old(), fails({ tmp_min_free_bytes: free }), fails())).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["box_resources_new_only"] });
        expect(compareRuns(old(), old(), fails(), fails({ tmp_min_free_bytes: free }))).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["box_resources_new_only"] });
      }
      expect(compareRuns(old(), old(), fails({ tmp_min_free_bytes: TMP_NEARLY_FULL_BYTES }), fails({ tmp_min_free_bytes: TMP_NEARLY_FULL_BYTES })).verdict).toBe("broken");
    });

    it.each(failing)("heap-out-on-new-is-undecidable: %s, V8 at its heap limit with no OOM kill, on either run", (_name, fails) => {
      expect(fails({ heap_out_lines: 1 }).memory_oom_kills).toBe(0);
      expect(compareRuns(old(), old(), fails({ heap_out_lines: 1 }), fails())).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
      expect(compareRuns(old(), old(), fails(), fails({ heap_out_lines: 3 }))).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
      expect(compareRuns(old(), old(), fails(), up({ heap_out_lines: 1 })).undecidable_reasons).toEqual(["box_resources_new_only"]);
    });

    it.each(failing)("enospc-on-new-is-undecidable: %s, with room at every reading of /tmp, on either run", (_name, fails) => {
      expect(fails({ enospc_lines: 1 }).tmp_min_free_bytes).toBeGreaterThan(TMP_NEARLY_FULL_BYTES);
      expect(compareRuns(old(), old(), fails({ enospc_lines: 1 }), fails())).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
      expect(compareRuns(old(), old(), fails(), fails({ enospc_lines: 2 }))).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
    });

    it("new-only-resource-counted: the mark is there only when both runs of old showed room, and the two are counted apart", () => {
      const ran = [noBuild({ memory_oom_kills: 1 }), noBuild({ heap_out_lines: 1 }), noBuild({ enospc_lines: 1 }), noBuild({ tmp_min_free_bytes: 0 })];
      const newOnly = ran.map(next => compareRuns(old(), old(), next, noBuild()));
      for (const result of newOnly) {
        expect(result).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["box_resources_new_only"] });
        expect(result.undecidable[0]).toContain("the box's limit on new only");
      }
      const short: Partial<Gate3Run>[] = [{ memory_oom_kills: 1 }, { heap_out_lines: 1 }, { enospc_lines: 1 }, { tmp_min_free_bytes: 0 }, { memory_oom_kills: null }, { tmp_min_free_bytes: null }];
      const both = short.flatMap(over => [compareRuns(up(over), old(), noBuild({ heap_out_lines: 1 }), noBuild()), compareRuns(old(), up(over), noBuild({ heap_out_lines: 1 }), noBuild())]);
      for (const result of both) {
        expect(result).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["box_resources"] });
        expect(result.undecidable[0]).not.toContain("new only");
      }
      const counts = undecidableCounts([...newOnly, ...both]);
      expect([counts.box_resources_new_only, counts.box_resources]).toEqual([newOnly.length, both.length]);
    });

    it.each(failing)("flaky-new-is-undecidable: %s failed once and the second run came up, and its pages are not compared", (_name, fails) => {
      expect(compareRuns(old(), old(), fails(), up())).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["flaky_new"] });
      expect(compareRuns(old(), old(), fails(), run([page("/", { status: 500 })]))).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["flaky_new"] });
    });

    it("two-failures-no-figure-explains-are-broken: only then, with the first run's reasons, whichever step failed on each", () => {
      expect(compareRuns(old(), old(), noBuild(), noBuild())).toMatchObject({ verdict: "broken", broken: ["New did not build; old did."], undecidable_reasons: [] });
      expect(compareRuns(old(), old(), noStart(), noStart())).toMatchObject({ verdict: "broken", broken: ["New's server did not start; old's did."] });
      expect(compareRuns(old(), old(), noBuild(), noStart())).toMatchObject({ verdict: "broken", broken: ["New did not build; old did."] });
      expect(compareRuns(old(), old(), noStart(), noBuild())).toMatchObject({ verdict: "broken", broken: ["New's server did not start; old's did."] });
      // The note says what was read, and what was not: it does not say the box had room.
      const notes = compareRuns(old(), old(), noBuild(), noBuild()).notes.join(" ");
      expect(notes).toContain("on both of its runs");
      expect(notes).toContain("The process limit and the wait for the server to start are not read.");
      expect(notes).not.toContain("with room");
    });

    it("one failed run is never broken by itself: no second run, or one that gave no result or timed out", () => {
      for (const fails of [noBuild, noStart]) {
        expect(compareRuns(old(), old(), fails())).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["new_no_result"] });
        expect(compareRuns(old(), old(), fails(), null).undecidable_reasons).toEqual(["new_no_result"]);
        expect(compareRuns(old(), old(), fails(), run([], { build: timedOut })).undecidable_reasons).toEqual(["new_timed_out"]);
        expect(compareRuns(old(), old(), fails(), run([], { build: absent })).undecidable_reasons).toEqual(["new_no_result"]);
      }
    });

    it("a figure that could not be read is not room, on either run, and a figure that says the box ran out still decides", () => {
      for (const missing of [{ memory_oom_kills: null }, { tmp_min_free_bytes: null }]) {
        expect(compareRuns(old(), old(), noBuild(missing), noBuild())).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["box_figures_missing"] });
        expect(compareRuns(old(), old(), noBuild(), noBuild(missing))).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["box_figures_missing"] });
      }
      expect(compareRuns(old(), old(), noBuild({ tmp_min_free_bytes: null, memory_oom_kills: 1 }), noBuild()).undecidable_reasons).toEqual(["box_resources_new_only"]);
      expect(compareRuns(old(), old(), noBuild({ memory_oom_kills: null }), up()).undecidable_reasons).toEqual(["flaky_new"]);
    });

    it("what this does not change: a run that came up reads no figure, so a test or a page that fails on it is broken", () => {
      expect(compareRuns(old(), old(), up({ memory_oom_kills: 3, tmp_min_free_bytes: 0 })).verdict).toBe("not_broken");
      expect(compareRuns(old(), old(), up({ tests: failed, tmp_min_free_bytes: 0 })).verdict).toBe("broken");
      expect(compareRuns(old(), old(), run([page("/", { status: null, dom: null, screenshot: null }), page("/about")], { memory_oom_kills: 1 })).verdict).toBe("broken");
    });
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

  it.each<[string, Partial<Gate3Run>, RegExp, UndecidableReason]>([
    ["new's build timed out", { build: timedOut, pages: [] }, /New's build timed out/, "new_timed_out"],
    ["new's build did not run", { build: absent, pages: [] }, /New's build did not run/, "new_step_absent"],
    ["new's crawl did not finish", { crawl: failed, pages: [] }, /crawl did not finish/, "new_crawl_failed"],
    ["new has too many pages", { too_many_pages: true, pages: [] }, /more than 200 pages/, "too_many_pages"],
    ["types time out on new", { types: timedOut }, /Types timed out on new/, "new_timed_out"],
    ["tests time out on new", { tests: timedOut }, /Tests timed out on new/, "new_timed_out"],
    ["tests no longer run on new", { tests: absent }, /Tests did not run on new/, "new_step_absent"],
  ])("undecidable: %s", (_name, over, reason, name) => {
    const result = compareRuns(old(), old(), run(old().pages, over));
    expect(result.verdict).toBe("undecidable");
    expect(result.undecidable.join(" ")).toMatch(reason);
    expect(result.undecidable_reasons).toEqual([name]);
  });

  it("undecidable: another level's new console message, and a screenshot alone", () => {
    const warned = compareRuns(old(), old(), run([page("/"), page("/about", { console: ["warning:0123456789abcdef"] })]));
    expect(warned.verdict).toBe("undecidable");
    expect(warned.undecidable.join(" ")).toMatch(/1 console message\(s\) of another level/);
    expect(warned.undecidable_reasons).toEqual(["console_other_level"]);
    const pictured = compareRuns(old(), old(), run([page("/"), page("/about", { screenshot: "1".repeat(32) })]));
    expect(pictured.verdict).toBe("undecidable");
    expect(pictured.undecidable.join(" ")).toMatch(/same DOM, and its screenshot differs/);
    expect(pictured.undecidable_reasons).toEqual(["screenshot_differs"]);
    const noShot = compareRuns(old(), old(), run([page("/"), page("/about", { screenshot: null })]));
    expect(noShot.verdict).toBe("undecidable");
  });

  it("broken wins over undecidable, and every reason is listed", () => {
    const result = compareRuns(old(), old(), run([page("/", { status: 500 }), page("/about", { console: ["info:0123456789abcdef"] })]));
    expect(result.verdict).toBe("broken");
    expect(result.broken.length).toBeGreaterThan(0);
    expect(result.undecidable.length).toBeGreaterThan(0);
    expect(result.undecidable_reasons.length).toBe(result.undecidable.length);
  });

  describe("undecidableCounts: what C4 counts", () => {
    const counted = (over: Partial<Record<UndecidableReason, number>>) => ({ ...Object.fromEntries(UNDECIDABLE_REASONS.map(r => [r, 0])), ...over });

    it("every reason is there at 0, so a reason that never happened is written and not left out", () => {
      expect(undecidableCounts([])).toEqual(counted({}));
      expect(Object.keys(undecidableCounts([])).length).toBe(UNDECIDABLE_REASONS.length);
    });

    it("counts real results by reason: one judgement once under each of its reasons, and a broken one not at all", () => {
      const noBuild = run([], { build: failed, types: absent, start: absent, crawl: absent, tests: absent });
      const shot = page("/", { screenshot: "1".repeat(32) });
      const results = [
        compareRuns(old(), old(), noBuild, { ...noBuild, memory_oom_kills: 1 }),
        compareRuns(old(), old(), { ...noBuild, tmp_min_free_bytes: 0 }, noBuild),
        compareRuns(old(), old(), noBuild, old()),
        // Two pages with the same reason are one judgement.
        compareRuns(old(), old(), run([shot, { ...shot, path: "/about" }])),
        compareRuns(old(), old(), run([shot, { ...shot, path: "/about", console: ["info:0123456789abcdef"] }])),
        // Decided by broken, though it also holds an undecidable reason.
        compareRuns(old(), old(), run([page("/", { status: 500 }), page("/about", { console: ["info:0123456789abcdef"] })])),
        compareRuns(old(), old(), noBuild, noBuild),
        compareRuns(old(), old(), old()),
      ];
      expect(undecidableCounts(results)).toEqual(counted({ box_resources_new_only: 2, flaky_new: 1, screenshot_differs: 2, console_other_level: 1 }));
    });
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
    ["a step's exit that is text", print({ ...good, build: { status: "passed", seconds: 1, exit: "Text with spaces, from the box." } })],
    ["a step's exit that is a list", print({ ...good, tests: { status: "passed", seconds: 1, exit: ["Text with spaces, from the box."] } })],
    ["a page that is not a path", print({ ...good, pages: [page("https://example.com/")] })],
    ["the same page twice", print({ ...good, pages: [page("/"), page("/")] })],
    ["a status out of range", print({ ...good, pages: [page("/", { status: 999 })] })],
    ["text where a hash belongs", print({ ...good, pages: [page("/", { dom: ["<p>secret</p>"] })] })],
    ["a console message with its text", print({ ...good, pages: [page("/", { console: ["error:the text"] })] })],
    ["a console level with spaces", print({ ...good, pages: [page("/", { console: [`two words:${"0".repeat(16)}`] })] })],
    ["a console level over 20 letters", print({ ...good, pages: [page("/", { console: [`${"x".repeat(21)}:${"0".repeat(16)}`] })] })],
    ["an exception with its text", print({ ...good, pages: [page("/", { exceptions: ["TypeError"] })] })],
    ["a screenshot that is not a hash", print({ ...good, pages: [page("/", { screenshot: "x" })] })],
    ["too many pages", print({ ...good, pages: Array.from({ length: MAX_PAGES + 1 }, (_, i) => page(`/${i}`)) })],
    ["memory that is not a number", print({ ...good, memory_oom_kills: "0" })],
    ["no memory.swap.max at all", print({ ...good, memory_swap_max: undefined })],
    ["a memory.swap.max that is a number, not its text", print({ ...good, memory_swap_max: 0 })],
    ["text where memory.swap.max belongs", print({ ...good, memory_swap_max: "Text with spaces, from the box." })],
    ["a null memory.swap.max", print({ ...good, memory_swap_max: null })],
    ["a CPU count that is not a number", print({ ...good, host_cpus: "16" })],
    ["a /tmp figure that is not a number", print({ ...good, tmp_min_free_bytes: "0" })],
    ["no /tmp figure at all", print({ ...good, tmp_min_free_bytes: undefined })],
    ["a line of text where a count of heap lines belongs", print({ ...good, heap_out_lines: "FATAL ERROR: secret" })],
    ["a line of text where a count of ENOSPC lines belongs", print({ ...good, enospc_lines: "ENOSPC: /app/secret" })],
    ["a count that is not whole", print({ ...good, enospc_lines: 1.5 })],
    ["a count under 0", print({ ...good, heap_out_lines: -1 })],
    ["a count that is null", print({ ...good, heap_out_lines: null })],
    ["no counts at all", print({ ...good, heap_out_lines: undefined, enospc_lines: undefined })],
  ])("no result: %s", (_name, stdout) => {
    expect(parseRun(stdout)).toBeNull();
  });

  it("parserun-step-rebuilt: a step keeps its status, seconds and exit, and nothing else the box wrote", () => {
    const text = "Text with spaces, from the box.";
    const steps = ["build", "types", "start", "crawl", "tests"] as const;
    const parsed = parseRun(print({ ...good, ...Object.fromEntries(steps.map(s => [s, { status: "passed", seconds: 1, exit: 0, note: text }])), note: text }))!;
    for (const s of steps) expect(parsed[s]).toEqual({ status: "passed", seconds: 1, exit: 0 });
    expect(JSON.stringify(parsed)).not.toContain(text);
    // The driver prints a crawl with no exit, and a build killed by a signal with exit null.
    const exits = parseRun(print({ ...good, crawl: { status: "passed", seconds: 1 }, build: { status: "failed", seconds: 1, exit: null }, tests: { status: "failed", seconds: 1, exit: 137 } }))!;
    expect([exits.crawl.exit, exits.build.exit, exits.tests.exit]).toEqual([null, null, 137]);
  });

  it("parserun-page-rebuilt: a page keeps the fields the driver prints, and nothing else the box wrote", () => {
    const text = "Text with spaces, from the box.";
    const parsed = parseRun(print({ ...good, pages: [{ ...page("/"), note: text }] }))!;
    expect(parsed.pages).toEqual([page("/")]);
    expect(JSON.stringify(parsed)).not.toContain(text);
  });

  it("a page path is the one text that reaches the comparison, as a path with no space, and it reaches the reasons", () => {
    // Hashes and counts have a shape that holds no text. A path does not: it comes out of the box as it was printed.
    const words = "/any-text-without-a-space-can-be-written-here";
    expect(parseRun(print({ ...good, pages: [page(words)] }))?.pages[0]!.path).toBe(words);
    expect(parseRun(print({ ...good, pages: [page(`/${"x".repeat(2000)}`)] }))?.pages.length).toBe(1);
    expect(parseRun(print({ ...good, pages: [page(`/${"x".repeat(2001)}`)] }))).toBeNull();
    expect(parseRun(print({ ...good, pages: [page("/two words")] }))).toBeNull();
    const before = run([page(words)]);
    expect(compareRuns(before, before, run([page(words, { status: 500 })])).broken.join(" ")).toContain(words);
    // A console level is read as up to 20 letters, and the comparison only counts it.
    const level = "Twentylettersoftextx";
    const leveled = parseRun(print({ ...good, pages: [page("/", { console: [`${level}:${"0".repeat(16)}`] })] }))!;
    expect(leveled.pages[0]!.console[0]).toContain(level);
    const comparison = compareRuns(run([page("/")]), run([page("/")]), leveled);
    expect(comparison.undecidable_reasons).toEqual(["console_other_level"]);
    expect(JSON.stringify(comparison)).not.toContain(level);
  });
});

describe("dummyEnv", () => {
  it("gives each key a dummy value and reads no value of the project's", () => {
    expect(dummyEnv("# a comment\nNEXT_PUBLIC_SITE_NAME=my real name\r\nexport API_URL=https://real.example\n  SPACED = x\nnot a key\n=novalue\n")).toEqual({
      env: { NEXT_PUBLIC_SITE_NAME: "ludion-dummy", API_URL: "http://127.0.0.1:9/", SPACED: "ludion-dummy" }, left_out: [],
    });
  });

  it("leaves out what the run itself reads: a project's file cannot move the clock or the driver", () => {
    const { env, left_out } = dummyEnv("NODE_OPTIONS=--require=/x\nPATH=/x\nLD_PRELOAD=/x\nHOME=/x\nPORT=1\nnpm_config_x=1\nNPM_CONFIG_CACHE=/x\nCIRCLE_NODE_TOTAL=64\nOK=1\n");
    expect(env).toEqual({ OK: "ludion-dummy" });
    expect(left_out).toEqual(["NODE_OPTIONS", "PATH", "LD_PRELOAD", "HOME", "PORT", "npm_config_x", "NPM_CONFIG_CACHE", "CIRCLE_NODE_TOTAL"]);
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

  /** The driver itself, up to a build that fails, with Node.js's modules stood in for. It shows nothing about real builds: those are in the progress record. */
  const driverUpToBuild = async (over: { cgroup?: Record<string, string>; env?: Record<string, string>; hostEnv?: Record<string, string>; cpus?: number; statfs?: (state: { inBuild: boolean; ended: boolean }) => { bavail: number; bsize: number }; buildMs?: number; buildExit?: number; stderr?: Record<string, string[]>; noStderrEnd?: boolean; noClose?: boolean } = {}) => {
    const events: string[] = [], envs: Record<string, Record<string, string>> = {}, state = { inBuild: false, ended: false };
    let printed = "", forwarded = "";
    const missing = () => { throw new Error("not in this stand-in"); };
    const fs = {
      readFileSync: (path: string) => path === "/ludion/config.json" ? JSON.stringify({ env: over.env ?? {}, freeze: "" }) : path === "/app/package.json" ? "{}" : over.cgroup?.[path] ?? missing(),
      readdirSync: () => [], copyFileSync: () => {}, symlinkSync: () => {}, existsSync: () => false,
      mkdirSync: (path: string) => { events.push(`mkdir ${path}`); },
      chmodSync: (path: string, mode: number) => { events.push(`chmod ${mode.toString(8)} ${path}`); },
      statfsSync: (path: string) => { events.push(`statfs ${path}`); return (over.statfs ?? (() => ({ bavail: 16_384, bsize: 4096 })))(state); },
    };
    const spawn = (_program: string, args: string[], options: { env: Record<string, string> }) => {
      const name = args[args.length - 1]!;
      events.push(`spawn ${name}`);
      envs[name] = options.env;
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), pid: 1 });
      state.inBuild = true;
      setTimeout(() => {
        for (const chunk of over.stderr?.[name] ?? []) child.stderr.emit("data", Buffer.from(chunk));
        if (!over.noStderrEnd) child.stderr.emit("end");
        state.inBuild = false; state.ended = true;
        const exit = name === "build" ? over.buildExit ?? 1 : 1;
        if (over.noClose) child.emit("exit", exit); else child.emit("close", exit);
      }, over.buildMs ?? 0);
      return child;
    };
    // No server comes up in this stand-in: nothing listens on the port.
    const net = { connect: () => { const socket = new EventEmitter(); setImmediate(() => socket.emit("error")); return socket; } };
    const os = { cpus: () => Array.from({ length: over.cpus ?? 16 }, () => ({})) };
    const modules: Record<string, unknown> = { "node:child_process": { spawn }, "node:crypto": { createHash }, "node:fs": fs, "node:net": net, "node:os": os, "node:path": posix };
    await new Promise<void>(done => {
      const stream = { write: (text: string, callback?: () => void) => { printed += text; callback?.(); return true; } };
      const box = { env: over.hostEnv ?? {}, execPath: "node", hrtime: process.hrtime, kill: () => {}, stderr: { write: (text: unknown) => { forwarded += String(text); return true; } }, stdout: stream, exit: () => done() };
      new Script(BOX_DRIVER).runInNewContext({ Buffer, clearInterval, clearTimeout, process: box, require: (name: string) => modules[name], setInterval, setTimeout });
    });
    return { events, envs, printed, forwarded };
  };

  it("stderr-counts: lines are counted, also when split between chunks, passed on as they came, and no line is in the result", async () => {
    const chunks = ["a line\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out", " of memory at /app/secret-path\nError: ENOSPC: no space left on device, write\n", "ENOSPC with no newline at /app/secret-path"];
    const { printed, forwarded } = await driverUpToBuild({ stderr: { build: chunks } });
    expect(parseRun(printed)).toMatchObject({ heap_out_lines: 1, enospc_lines: 2 });
    expect(forwarded).toContain(chunks.join(""));
    expect(printed).not.toContain("secret-path");
    expect(printed).not.toContain("FATAL");
  });

  it("stderr-counts: 0 with none of the exact text, and one line holding both counts in both", async () => {
    const none = await driverUpToBuild({ stderr: { build: ["No space left on device\nHeap Out Of Memory\nenospc\n"] } });
    expect(parseRun(none.printed)).toMatchObject({ heap_out_lines: 0, enospc_lines: 0 });
    expect(parseRun((await driverUpToBuild()).printed)).toMatchObject({ heap_out_lines: 0, enospc_lines: 0 });
    const both = await driverUpToBuild({ stderr: { build: ["heap out of memory, ENOSPC\n"] } });
    expect(parseRun(both.printed)).toMatchObject({ heap_out_lines: 1, enospc_lines: 1 });
  });

  it("stderr-counts: a last line with no newline counts when the stream has not ended", async () => {
    const { printed } = await driverUpToBuild({ stderr: { build: ["heap out of memory"] }, noStderrEnd: true });
    expect(parseRun(printed)?.heap_out_lines).toBe(1);
  });

  it("stderr-counts: the server's stderr counts too, when the build passed and the server does not start", async () => {
    const { printed, forwarded } = await driverUpToBuild({ buildExit: 0, stderr: { "3000": ["FATAL ERROR: JavaScript heap out of memory\n"] } });
    const result = parseRun(printed);
    expect(result).toMatchObject({ heap_out_lines: 1, enospc_lines: 0 });
    expect(result?.build.status).toBe("passed");
    expect(result?.start.status).toBe("failed");
    expect(forwarded).toContain("heap out of memory");
    // Nothing ends the server's stream but the stream: a last line with no newline counts there too.
    const unended = parseRun((await driverUpToBuild({ buildExit: 0, stderr: { "3000": ["ENOSPC with no newline"] } })).printed);
    expect(unended).toMatchObject({ heap_out_lines: 0, enospc_lines: 1 });
  });

  it("stderr-counts: something left holding the pipe open does not stop the step from ending when the program has exited", async () => {
    const { printed } = await driverUpToBuild({ noClose: true, noStderrEnd: true, stderr: { build: ["ENOSPC\n"] } });
    expect(parseRun(printed)).toMatchObject({ enospc_lines: 1, build: { status: "failed" } });
  });

  it("tmp-min-free: the result holds the lowest /tmp reading of the run, of the box's /tmp, in bytes", async () => {
    const { events, printed } = await driverUpToBuild();
    expect(events).toContain("statfs /tmp");
    expect(events.filter(e => e.startsWith("statfs")).every(e => e === "statfs /tmp")).toBe(true);
    expect(parseRun(printed)?.tmp_min_free_bytes).toBe(16_384 * 4096);
  });

  it("tmp-min-free: a build that fills /tmp and frees it before it exits is still seen, by the readings during the build", async () => {
    const { printed } = await driverUpToBuild({ buildMs: 700, statfs: state => ({ bavail: state.inBuild ? 3 : 16_384, bsize: 4096 }) });
    expect(parseRun(printed)?.tmp_min_free_bytes).toBe(3 * 4096);
  });

  it("tmp-min-free: what is left when the build has ended is read too, before the result is printed", async () => {
    const { printed } = await driverUpToBuild({ statfs: state => ({ bavail: state.ended ? 5 : 16_384, bsize: 4096 }) });
    expect(parseRun(printed)?.tmp_min_free_bytes).toBe(5 * 4096);
  });

  it("tmp-min-free: with no reading the figure is null, not a figure that looks like room, and the run still prints", async () => {
    const { printed } = await driverUpToBuild({ statfs: () => { throw new Error("no statfs here"); } });
    const result = parseRun(printed);
    expect(result?.build.status).toBe("failed");
    expect(result?.tmp_min_free_bytes).toBeNull();
  });

  describe("gate3-result-records-swap-max", () => {
    const SWAP_MAX = "/sys/fs/cgroup/memory.swap.max";
    it.each([["0\n", "0"], ["max\n", "max"], ["536870912\n", "536870912"]])("the driver prints what the box's file says: %j", async (file, value) => {
      const { printed } = await driverUpToBuild({ cgroup: { [SWAP_MAX]: file } });
      expect(parseRun(printed)?.memory_swap_max).toBe(value);
    });
    it("a file it cannot read is unknown, not a number", async () => {
      const { printed } = await driverUpToBuild();
      expect(parseRun(printed)?.memory_swap_max).toBe("unknown");
    });
    it.each(["", "not a figure\n", "-1\n", "0 0\n"])("a file that holds no figure is unknown, not a number: %j", async file => {
      const { printed } = await driverUpToBuild({ cgroup: { [SWAP_MAX]: file } });
      expect(parseRun(printed)?.memory_swap_max).toBe("unknown");
    });
  });

  it("gate3-webpack-cache-read-only-before-build: that folder, and nothing else, is read-only before the build starts", async () => {
    const { events, printed } = await driverUpToBuild();
    const cache = "/tmp/next/cache/webpack";
    expect(events).toContain(`mkdir ${cache}`);
    // Not Turbopack's folder too: Next.js 16's default build stops at once when it cannot open its cache there.
    expect(events.filter(e => e.startsWith("chmod"))).toEqual([`chmod 555 ${cache}`]);
    expect(events.indexOf(`mkdir ${cache}`)).toBeLessThan(events.indexOf(`chmod 555 ${cache}`));
    expect(events.indexOf(`chmod 555 ${cache}`)).toBeLessThan(events.indexOf("spawn build"));
    expect(parseRun(printed)?.build.status).toBe("failed");
  });

  it.each([1, 2, 16, 64])("gate3-one-worker-whatever-the-host: on %i CPUs the build is told one worker, and the result says how many there were", async cpus => {
    const { envs, printed } = await driverUpToBuild({ cpus });
    // Next.js 15.5.6 and 16.4.4: Math.max(1, (Number(process.env.CIRCLE_NODE_TOTAL) || os.cpus().length) - 1). That real builds obey it is in the progress record.
    expect(Math.max(1, Number(envs.build!.CIRCLE_NODE_TOTAL) - 1)).toBe(1);
    expect(parseRun(printed)?.host_cpus).toBe(cpus);
  });

  it("gate3-one-worker-whatever-the-host: neither the project's .env.example nor the environment can raise it", async () => {
    const { envs } = await driverUpToBuild({ env: { CIRCLE_NODE_TOTAL: "64" }, hostEnv: { CIRCLE_NODE_TOTAL: "64" } });
    expect(envs.build!.CIRCLE_NODE_TOTAL).toBe("2");
  });

  it("gate3-turbopack-cache-not-written: the build is told not to write it, and a project's file cannot say otherwise", async () => {
    const { envs } = await driverUpToBuild({ env: { TURBO_ENGINE_READ_ONLY: "" }, hostEnv: { TURBO_ENGINE_READ_ONLY: "" } });
    expect(envs.build!.TURBO_ENGINE_READ_ONLY).toBe("1");
    expect(dummyEnv("TURBO_ENGINE_READ_ONLY=\nOK=1\n")).toEqual({ env: { OK: "ludion-dummy" }, left_out: ["TURBO_ENGINE_READ_ONLY"] });
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
    for (const name of ["next-15.5.7", "lodash-4.17.21", "next-16.4.4"]) expect(() => acquisitionPolicy(join(examples, "nextjs-security-cases", name), "npm")).not.toThrow();
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

  it("the Next.js 16 side has that exact version, with every locked package from the registry with an integrity", () => {
    const packages = packagesOf(join(examples, "nextjs-security-cases", "next-16.4.4"));
    expect(packages["node_modules/next"]!.version).toBe("16.4.4");
    for (const [path, entry] of Object.entries(packages)) if (path) {
      expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, path).toMatch(/^sha512-/);
    }
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

  it("parserun-step-rebuilt: through the whole judgement, what else the box wrote in a run reaches no part of the result", async () => {
    const text = "Text with spaces, from the box.";
    const wrote = { schema: 1, ...old(), note: text, build: { ...passed, exit: 0, note: text }, pages: old().pages.map(p => ({ ...p, note: text })) };
    const answer = exited(`${RESULT_MARKER}${JSON.stringify(wrote)}\n`);
    const result = await judgeGate3({ dir, old: sides, new: sides }, deps(docker(), boxes(answer, answer, answer)));
    expect(result.verdict).toBe("not_broken");
    expect(result.runs[0]!.run!.build).toEqual({ status: "passed", seconds: 1, exit: 0 });
    expect(result.runs.every(r => r.run && !("pages" in r.run))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(text);
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

  it("gate3-result-records-swap-max: each run in the result has the box's memory.swap.max", async () => {
    const d = docker(), b = boxes(exited(printed(old())), exited(printed(run(old().pages, { memory_swap_max: "unknown" }))), exited(printed(run(old().pages, { memory_swap_max: "max" }))));
    const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
    expect(result.runs.map(r => r.run?.memory_swap_max)).toEqual(["0", "unknown", "max"]);
    // Recorded only: no verdict reads it.
    expect(result.verdict).toBe("not_broken");
  });

  it("gate3-boxes-one-at-a-time: a box starts only when the one before it has ended", async () => {
    const noBuild = run([], { build: failed, types: absent, start: absent, crawl: absent, tests: absent });
    const answers = [old(), old(), noBuild, noBuild];
    let running = 0, most = 0, started = 0;
    const box = async () => {
      most = Math.max(most, ++running);
      started++;
      await new Promise(done => setTimeout(done, 5));
      running--;
      return exited(printed(answers.shift()!));
    };
    await judgeGate3({ dir, old: sides, new: sides }, { policy: () => {}, snapshot, command: docker().command, box });
    expect(started).toBe(4);
    expect(most).toBe(1);
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

  describe("new's second run", () => {
    const noBuild = (over: Partial<Gate3Run> = {}) => run([], { build: failed, types: absent, start: absent, crawl: absent, tests: absent, ...over });
    const noStart = (over: Partial<Gate3Run> = {}) => run([], { start: failed, crawl: absent, ...over });
    const judge = async (...news: ContainerOutcome[]) => {
      const d = docker(), b = boxes(exited(printed(old())), exited(printed(old())), ...news);
      const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
      return { d, b, result, labels: result.runs.map(r => r.label) };
    };

    it("is not run when new builds and starts", async () => {
      const { result, labels } = await judge(exited(printed(old())));
      expect(labels).toEqual(["old-1", "old-2", "new"]);
      expect(result.verdict).toBe("not_broken");
    });

    it.each([["build", noBuild], ["start", noStart]] as const)("when new's %s fails: a second, fresh box from the same image, and both are in the result", async (_name, fails) => {
      const { d, b, result, labels } = await judge(exited(printed(fails())), exited(printed(fails())));
      expect(labels).toEqual(["old-1", "old-2", "new", "new-2"]);
      expect(new Set(b.names).size).toBe(4);
      expect(result.runs.every(r => r.outcome === "ran")).toBe(true);
      expect(d.contexts.length).toBe(4);
      expect(result.verdict).toBe("broken");
    });

    it("oom-is-undecidable-not-broken: through the whole judgement, and the second run still runs", async () => {
      const { result, labels } = await judge(exited(printed(noBuild({ memory_oom_kills: 1 }))), exited(printed(noBuild())));
      expect(labels).toEqual(["old-1", "old-2", "new", "new-2"]);
      expect(result).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
      expect(result.runs[2]!.run?.memory_oom_kills).toBe(1);
    });

    it("flaky-new-is-undecidable: through the whole judgement", async () => {
      const { result } = await judge(exited(printed(noBuild())), exited(printed(old())));
      expect(result).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["flaky_new"] });
    });

    it("tmp-nearly-full-is-undecidable: through the whole judgement", async () => {
      const { result } = await judge(exited(printed(noBuild())), exited(printed(noBuild({ tmp_min_free_bytes: 0 }))));
      expect(result).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["box_resources_new_only"] });
    });

    it("heap-out-on-new-is-undecidable: through the whole judgement, and what the box printed reaches the result", async () => {
      const { result } = await judge(exited(printed(noBuild({ heap_out_lines: 1 }))), exited(printed(noBuild({ heap_out_lines: 1 }))));
      expect(result).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
      expect(result.runs[2]!.run).toMatchObject({ heap_out_lines: 1, memory_oom_kills: 0 });
    });

    it("enospc-on-new-is-undecidable: through the whole judgement", async () => {
      const { result } = await judge(exited(printed(noBuild())), exited(printed(noBuild({ enospc_lines: 1 }))));
      expect(result).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["box_resources_new_only"] });
    });

    it("new-only-resource-counted: through the whole judgement, not new only when a run of old that passed showed a shortage", async () => {
      const short = exited(printed(run(old().pages, { enospc_lines: 1 })));
      const d = docker(), b = boxes(short, exited(printed(old())), exited(printed(noBuild({ heap_out_lines: 1 }))), exited(printed(noBuild())));
      const result = await judgeGate3({ dir, old: sides, new: sides }, deps(d, b));
      expect(result.undecidable_reasons).toEqual(["box_resources"]);
      const alone = (await judge(exited(printed(noBuild({ heap_out_lines: 1 }))), exited(printed(noBuild())))).result;
      expect(undecidableCounts([result, alone])).toMatchObject({ box_resources: 1, box_resources_new_only: 1 });
    });

    it.each<[string, ContainerOutcome]>([
      ["times out", exited(printed(old()), { timedOut: true })],
      ["prints nothing that can be read", exited("killed", { exitCode: 137 })],
    ])("undecidable, not broken, when it %s", async (_name, outcome) => {
      const { result, labels } = await judge(exited(printed(noBuild())), outcome);
      expect(labels).toEqual(["old-1", "old-2", "new", "new-2"]);
      expect(result).toMatchObject({ verdict: "undecidable", broken: [], undecidable_reasons: ["new_no_result"] });
    });

    it("a first run of new with no result gets no second run", async () => {
      const { result, labels } = await judge(exited("killed", { exitCode: 137 }));
      expect(labels).toEqual(["old-1", "old-2", "new"]);
      expect(result).toMatchObject({ verdict: "undecidable", undecidable_reasons: ["new_no_result"] });
    });
  });

  it("every way out says its reason's name, so that C4 can count it", async () => {
    const reasonOf = async (answers: ContainerOutcome[], failOn?: RegExp, manifestText = manifest) => (await judgeGate3({ dir, old: { manifest: manifestText, lock: "{}" }, new: sides }, deps(docker(failOn), boxes(...answers)))).undecidable_reasons;
    const good = exited(printed(old()));
    const noBuild = (over: Partial<Gate3Run> = {}) => exited(printed(run([], { build: failed, ...over })));
    expect(await reasonOf([], undefined, JSON.stringify({ dependencies: {} }))).toEqual(["not_covered"]);
    expect(await reasonOf([], undefined, "{")).toEqual(["not_covered"]);
    expect(await reasonOf([], /^pull /)).toEqual(["could_not_run"]);
    expect(await reasonOf([], /--network=none/)).toEqual(["prepare_failed"]);
    expect(await reasonOf([{ kind: "spawn_error", message: "no docker" }])).toEqual(["could_not_run"]);
    expect(await reasonOf([exited("", { timedOut: true })])).toEqual(["old_no_result"]);
    expect(await reasonOf([good, exited("", { timedOut: true })])).toEqual(["old_no_result"]);
    expect(await reasonOf([noBuild()])).toEqual(["old_failed"]);
    expect(await reasonOf([good, exited(printed(run([], { crawl: failed })))])).toEqual(["old_failed"]);
    expect(await reasonOf([exited(printed(run([], { too_many_pages: true })))])).toEqual(["too_many_pages"]);
    const none = exited(printed(run([page("/", { status: 500 })])));
    expect(await reasonOf([none, none])).toEqual(["no_denominator"]);
    // Old's own lack of room is told apart from old failing: it is how many projects fit the box.
    expect(await reasonOf([noBuild({ memory_oom_kills: 1 })])).toEqual(["old_box_resources"]);
    expect(await reasonOf([good, noBuild({ tmp_min_free_bytes: 0 })])).toEqual(["old_box_resources"]);
    expect(await reasonOf([noBuild({ heap_out_lines: 1 })])).toEqual(["old_box_resources"]);
    expect(await reasonOf([noBuild({ enospc_lines: 1 })])).toEqual(["old_box_resources"]);
    expect(await reasonOf([exited(printed(run([], { start: failed, memory_oom_kills: 1 })))])).toEqual(["old_box_resources"]);
    expect(await reasonOf([exited(printed(run([], { crawl: failed, memory_oom_kills: 1 })))])).toEqual(["old_box_resources"]);
    expect(await reasonOf([good, good, exited("", { timedOut: true })])).toEqual(["new_no_result"]);
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
