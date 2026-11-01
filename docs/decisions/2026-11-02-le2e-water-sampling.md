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

## What stays in any case

The measurement of every moment stays as a test that is skipped unless asked for, with how to run it. It is not deleted out of view, even if it leaves CI's required path.

Workers are not changed in this lane. `.github/`, `apps/site/`, `playwright.config.ts` and the thresholds are not touched.
