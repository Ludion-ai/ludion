# 2026-11-02 — How the water contrast check is measured, and when it may change

Fixed before any contrast value was measured in this lane. Nothing here is loosened after seeing a result; a result that does not meet it is written down as it is. The thresholds (4.5 and 3), the boxes the check compares, the pixel step and the accessibility checks do not change whatever the result.

**Why now.** A first-principles audit measured `e2e/water.spec.ts:88` (8 tests) at 1,056 of the 1,222 test seconds of the e2e step, in a job with a 15-minute limit. This lane measures that, then shortens it without weakening the check.

**What reading the code showed, before measuring.**

- `page.clock.install` leaves Playwright's clock running on real time (playwright-core 1.63.0, `_replayLogOnce` ends in `_innerResume` unless the clock was paused). So in the check as it stands, the water time of "moment k" is not `0.3 × k` seconds: it also holds the real time every earlier step took, and depends on the machine. The same moment number may be a different frame on another run.
- `clock.runFor(300)` fires each animation frame due in those 300 ms, so water.js may draw several frames per moment (its 33 ms cap), each one rendered in software on CI.
- No page under `apps/site/src` marks `[data-water-hit]`, so the "ring" the spec's comments name may no longer be drawn. To be recorded, not assumed.

So the measurement has to record which water time each screenshot showed, and has to test whether two runs agree.

## The values

For a page `p`, colour scheme `s`, box `b` and moment `k`:

- `v(p,s,b,k)`: the lowest contrast under box `b` in the screenshot of moment `k`, computed as the spec at d42e172 computes it (same `targets`, same clip, every second pixel, same formula), kept as the full JavaScript number, not rounded.
- `m(p,s,b)`: the lowest `v` over the moments of that page.
- `K(p,s,b)`: every moment whose `v` equals `m` exactly (a tie keeps all of them).

**"The same value" means exact equality of those numbers.** No tolerance. The moments are the spec's: 40 for `/` and `/ja/`, 20 for `/start/` and `/ja/start/`, each page light and dark: 8 tests, 240 moments.

For each moment the raw data also keeps: the water time last sent to the shader before and after the screenshot, the number of frames drawn before and after it, and the real milliseconds of the clock step and of the screenshot. For each box: name, position and size, colour, large or not. Observing these wraps `getUniformLocation`, `uniform1f` and `drawArrays` in the page, and sends the same calls on.

A test skipped for lack of WebGL2 is a failed measurement, not a result.

## The environment

Docker, `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`, `--network none`, `--memory 4g`, `--cpus 4`, `CI=1`, `--workers=2` on the command line (what the CI runner's default gives; `playwright.config.ts` does not change). The site is built once from d42e172 in that image, dependencies by `npm ci --ignore-scripts`, and the same build serves every run. No two runs at once, and no other container of this lane during a run.

## The runs

- **Time before (T0).** The unchanged spec: whole `npm run test:e2e` once, and `e2e/water.spec.ts` alone once. Seconds as Playwright's JSON report gives them.
- **Arm A, as it is, twice (A1, A2).** The spec's own steps with the clock running, plus the observation above. The second run is only there to see whether the numbers repeat.
- **Arm B, clock paused, twice (B1, B2).** The same pages, boxes and number of moments, with the clock paused before the page loads, so the frame depends on the moment alone: after the same first 100 ms, moment `k` is exactly `100 + 300 × (k + 1)` ms of water time, reached by `clock.fastForward(300)`, which draws one frame.
- **Arm C, only if a rule below calls for it.** Arm B's clock, at water times taken from A1 and A2.
- **Arm R, only if a reduced list is taken.** One run of that list on the final clock.
- **Time after (T1).** The changed spec, the same two commands as T0.

## What may change, and when

Arm A is **repeatable** if every `v` of A1 equals the same `v` of A2. Arm A's values are reported whichever way that goes.

The clock in `e2e/water.spec.ts` may be paused only if all of these hold:

1. **B repeats.** Every `v` of B1 equals the same `v` of B2, and every moment of B shows the water time above and drew one frame.
2. **Same boxes.** A1, A2 and B1 give the same list of boxes for each page and scheme: names, positions, sizes, colours, large or not.
3. **Not kinder.** For every `(p,s,b)`, B's `m` is at or below A's `m` in both A1 and A2. If a box fails this, the failing water times from A1 and A2 go into Arm C. The moments of Arm C are then added to the check, and this rule is read against B and C together. If a box still fails, the clock is not changed and the numbers are reported.
4. **Every box passes the unchanged threshold.** If the paused clock finds a box below its threshold, that is a finding about the site, not a reason to change the check. This lane does not touch `apps/site/`: it stops and reports.

Moments are dropped only if all of these also hold:

5. **Worth it.** Under the paused clock with all moments, the 8 tests still sum to more than 240 test seconds in Docker. At or below that, every moment stays: a shorter list would save under two minutes of wall time at two workers and would rest on today's site alone.
6. **Everything is contained.** The list contains, for every `(p,s,b)`, at least one moment of `K(p,s,b)`, chosen by this rule: repeatedly take the moment covering the most boxes not yet covered, the lowest `k` on a tie. Arm R must then give, at each kept moment, the `v` of B1 exactly, and so the same `m` for every box.
7. **It holds for a changed site.** A list is proved for one site only. So the check must notice when the boxes or the water shader differ from those measured, and then run every moment.

## Added after T0, A1, A2, B1 and B2, before any further run

Written after seeing those five runs. **This section changes a rule after a result, so this file's opening sentence, that nothing is loosened after seeing one, does not hold for it.** Rule 3 says the moments of Arm C are added to the check; "What is added to the check" below puts a chosen list in their place. This paragraph first said that the section adds measurement and keeps every rule as written, and the message of commit ec88fd3 says "It only adds measurement". Both were wrong. The commit message cannot be rewritten, so the correction is here.

- **Stronger than rule 3 as written.** The lowest value the list must reach also includes Arm W's sweep, Arm A3 tests the list against a run that did not choose it, and Arm F runs the list itself. On the site measured, the list is lower than rule 3's B and C on 4 of 152 boxes and higher on none. B and C as written would have been kinder than A3 on 1 box (`/start/` dark, `p.where`, 7.5188 against 7.4753); the list is not.
- **Weaker than rule 3 as written.** Rule 3 would fix 1,509 moments in the check (B's 240 and C's 1,269); the list fixes 246, so on a changed site the check looks at fewer moments. As written, that check's runs sum to 348.562 s (B1 70.135 s and C 278.427 s, two separate runs added, not one run), over rule 5's 240 s, so a shorter list had to meet rules 6 and 7. The list uses rule 6's method, and rule 7 is not met: the check does not notice a changed site and run every moment. This section made that exception after seeing the results.

What those five runs showed:

- Rule 1 holds: B1 and B2 agree on all 4,480 values, and all 240 moments show the stated water time; each moment after the first drew one frame, and the first moment's count also holds the first 100 ms.
- Rule 2 holds. Rule 3 does not yet: 7 of 152 boxes are kinder in B than in A1 or A2, all of them in dark, so Arm C is due.
- Arm A does not repeat: 398 of 4,480 values and 2 of 152 minimums differ between A1 and A2. It reached 76.906 s of water time in Docker. At the audited CI run's pace, about 4.4 s a moment, it would reach about 176 s on the home pages and 88 s on the start pages.

**What Arm C visits.** A moment of A shows a frame drawn somewhere between the two water times recorded around its screenshot, and that gap is often over a second. So for each kept case (a box of rule 3 that failed, in a run of A where its value is lower than B's, at each moment of that run's `K`), Arm C visits those two times and every 33 ms between them (water.js draws at most every 33 ms), rounded up to a whole millisecond: 1,269 visits over 4 of the 8 tests.

**Arm W, added.** Arm B's clock, one run, the same 300 ms step carried on to 180.1 s of water time on the home pages (600 moments) and 90.1 s on the start pages (300), so past where A can reach on CI. Its first 40 or 20 moments are B's, and must equal B1 exactly. This goes beyond rule 3, because A1 and A2 are two samples of a check that does not repeat: a third run could reach other times.

**What is added to the check.** Rule 3's text says the moments of Arm C are added. Adding all 1,269 would take the check back to minutes for moments that mostly cannot lower anything, so the moments added are the ones that hold the same result: the check's list is B's moments plus a list chosen by rule 6's method, so that for every `(p,s,b)` the list reaches, exactly, the lowest value seen over B, C and W together. No box's minimum may rise by this choice, and rule 3 is read against that list.

**Arm F, added: the final list, two runs.** Every value must equal the same water time's value in B, C or W exactly, and each moment must draw one frame.

**Arm A3, added: a third run of A, after the list is fixed.** It did not choose the list. For every `(p,s,b)`, the list's minimum must be at or below A3's. A box that fails adds its water times the way Arm C does, once, and A3 is not repeated: what remains is reported.

**What this does not show.** A check whose moments depend on the machine's speed has no fixed set of values. These runs show the final list against A1, A2, A3 and a sweep, in Docker, not against every run A could make. Values on CI are compared with Docker's only to the two decimals the CI log prints.

## What stays in any case

The measurement of every moment stays as a test that is skipped unless asked for, with how to run it. It is not deleted out of view, even if it leaves CI's required path.

Workers are not changed in this lane. `.github/`, `apps/site/`, `playwright.config.ts` and the thresholds are not touched.
