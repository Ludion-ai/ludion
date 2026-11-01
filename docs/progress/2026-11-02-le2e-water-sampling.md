# 2026-11-02 — LE2E: the water contrast check, from minutes to seconds

Definitions, fixed before the runs: `docs/decisions/2026-11-02-le2e-water-sampling.md`. Raw data: `docs/bench/le2e/`.

**Result.** No moment was dropped and 6 were added. The check got faster because it no longer draws frames it never looks at. In Docker, e2e went from 356.1 s to 85.2 s, and `e2e/water.spec.ts` alone from 313.2 s to 39.6 s. Thresholds, boxes, the pixel step and the accessibility checks are as they were.

## What was measured about the check as it stood

- **The time went to frames nobody looks at.** In A1, each moment drew 9 to 24 frames (A2: 9 to 25, A3: 9 to 22), and the clock steps took 297.0 s and the screenshots 276.0 s of the test time. With a paused clock and one frame a moment, the same two parts took 1.8 s and 54.6 s (F1).
- **Its moments were not fixed.** `clock.install` leaves the clock running, so a moment's water time holds the real time spent so far: moment 39 was at 76.9 s of water time in A1's slowest test, not 12 s. On a slower machine it goes further. Between any two of A1, A2 and A3, 398 to 458 of 4,480 values differ, and 2 of 152 boxes' minimums differ. So the check had no single "same minimum" to keep. On `/start/` dark, for example, the lowest value of `p.where` was 7.5188 in A1 and A2, and 7.4753 in A3.
- **The "ring" in the spec's comments is not drawn.** `[data-water-hit]` appears in the built site only inside water.js, and no page marks it. The comment is gone from the spec; water.js is not touched here.
- **On light pages most boxes do not move at all.** 67 of 76 light boxes keep one lowest value through all 3,600 moments of the sweep: caustics in light only brighten, so the steady tint under a box stays.

## The moments

Under the paused clock a frame depends on its water time alone: B1 and B2 agree on all 4,480 values, the sweep's first moments equal B1 on all 4,480, and the 54 values where C and the sweep met are equal.

| Rule (decision) | Result |
| --- | --- |
| 1. B repeats, one frame, the stated time | Holds: 0 of 4,480 values differ. 240 moments, 0 off. |
| 2. Same boxes | Holds on all 8 tests. |
| 3. Not kinder than A | **Failed for B alone:** 7 of 152 boxes were kinder in B than in A1 or A2, all in dark. Holds with the 6 added moments: 0 of 152 kinder. |
| 4. Every box passes | Holds: 0 below threshold. The closest is `span.focus-bracket 2` on `/` and `/ja/` dark, 5.0903 against 4.5. |
| 5. Worth dropping moments | Not met: the 8 tests sum to 70.1 s in B against the 240 s the rule sets, so **every moment stays**. Rules 6 and 7 do not apply. |

The sweep (Arm W) found 4 more boxes where B stood above the lowest seen, 11 in all. A chosen list reaches all 11:

| Page, dark | Water times added (ms) |
| --- | --- |
| `/` | 97300, 121000 |
| `/start/` | 41200 |
| `/ja/` | 32878, 64812 |
| `/ja/start/` | 54400 |

No light page needed one. Adding Arm C's 1,269 visits whole, as rule 3's first text read, would have taken the check back to minutes; the decision's addition records this choice and why, before the runs that used it.

## Before and after, the minimum

Exact equality of full numbers, 152 boxes (`minimums.csv`):

| Final list against | Same value | Final lower | Final higher |
| --- | --- | --- | --- |
| A1 | 146 | 6 | **0** |
| A2 | 148 | 4 | **0** |
| A3, which did not choose the list | 148 | 4 | **0** |
| B, C and W together (the lowest seen) | 152 | 0 | **0** |

F1 and F2 agree on all 4,592 values, and each equals the same water time's value in B, C or W. All 492 moments show the asked-for time and draw one frame.

The lowest box of each test, final and as it stood:

| Page, scheme | Boxes | Lowest box | Final | A1 | A2 | A3 | Needs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/`, light | 18 | `span.focus-bracket 2` | 5.5134 | 5.5134 | 5.5134 | 5.5134 | 4.5 |
| `/`, dark | 18 | `span.focus-bracket 2` | 5.0903 | 5.0903 | 5.0903 | 5.0903 | 4.5 |
| `/start/`, light | 20 | `p.wiring` | 6.1875 | 6.1875 | 6.1875 | 6.1875 | 4.5 |
| `/start/`, dark | 20 | `p.where` | 7.4753 | 7.5188 | 7.5188 | 7.4753 | 4.5 |
| `/ja/`, light | 18 | `span.focus-bracket 2` | 5.5134 | 5.5134 | 5.5134 | 5.5134 | 4.5 |
| `/ja/`, dark | 18 | `span.focus-bracket 2` | 5.0903 | 5.0903 | 5.0903 | 5.0903 | 4.5 |
| `/ja/start/`, light | 20 | `p.wiring` | 6.1875 | 6.1875 | 6.1875 | 6.1875 | 4.5 |
| `/ja/start/`, dark | 20 | `p.where` | 7.4753 | 7.4753 | 7.4753 | 7.4753 | 4.5 |

## Time

In Docker, `--workers=2`, `--cpus 4`, `--memory 4g` (`timing.json`). Each command was run once for each side.

| | Before (d42e172) | After |
| --- | --- | --- |
| Whole `npm run test:e2e`, wall | 356.1 s | 85.2 s |
| Whole e2e, sum of test seconds | 702.8 s | 162.1 s |
| `water.spec.ts` within it, test seconds | 614.2 s | 75.7 s |
| `water.spec.ts` alone, wall | 313.2 s | 39.6 s |
| `water.spec.ts` alone, sum of test seconds | 621.5 s | 74.9 s |

The other specs are unchanged.

On CI, read from GitHub's records of the two runs (one run each, on different commits):

| | Before: #257, run 41343379058 | After: this PR at 5961fda, run 41359470122 |
| --- | --- | --- |
| `test` job | 837 s | 290 s |
| `npm run test:e2e` step | 617 s | 105 s |
| The 8 water tests, sum of what the log prints | 1,056 s (printed to a tenth of a minute) | 92.8 s |

All 64 lines of "Worst contrast" that CI printed at 5961fda, to two decimals, equal the ones Docker printed in `logs/t1b-all.txt`.

## Does the check still catch things

Mutations of a copy in the Docker volume, not of the repository (`logs/m*.txt`):

| Mutation | Result |
| --- | --- |
| M1: small-text threshold 5.1 | `/` and `/ja/` dark fail on `span.focus-bracket 2`, 5.09. |
| M2: M1, without `/ja/`'s added moments | `/ja/` dark now passes (5.1212 at the steady moments), so the added moments are what catch it. |
| M3: dark `peak` 0.045 to 0.6 in the built site | All 8 pass. The mutation is too weak to cross a threshold: `/ja/start/` dark's lowest moved from 7.48 to 7.43. By water.js's formula the light under the cap tops out near 0.1 (1.35 × 0.075), so raising the cap alone adds little. |
| M3b: dark `caustic` and `peak` both 0.6 | `/start/` and `/ja/start/` dark fail (down to 3.87). `/` and `/ja/` dark move but still pass: `span.focus-bracket 2` falls from 5.09 to 4.94 and 5.03. |
| M4: light tint `#eeeeee` to `#555555` | All 4 light pages fail (down to 2.78). |
| M5: the clock no longer moves the water | All 8 fail on the new "the water moved between moments". |

M5 is the one new assertion. A paused clock adds a way to fail silently, showing one frame 40 times, so the spec now requires the screenshots' pixels to differ between moments. Its first version compared box values and failed 3 light pages, whose values really are constant (the fact above), so it was changed to pixels and T1 was run again; `logs/t1-*` keeps that failure, `logs/t1b-*` is the after-run reported above.

## What this does not show

- **The 6 added moments hold for the site that was measured.** If text moves or the shader changes, they may stop being the lowest, and nothing here notices it. The steady moments still run, and `e2e/water-full.spec.ts` measures again by hand. The old check would have sampled differently, and only by luck of the machine's speed.
- **The steady moments now span 12 s (6 s on the start pages), where the old ones wandered over about 70 s in Docker, with no fixed span.** Against today's site the added moments cover the difference. Against a changed site this check samples a narrower span than the old one did. From the sweep's data, the same 40 or 20 moments 4.5 s apart would reach the lowest value on 149 of 152 boxes, against B's 141. That was not in the fixed definition and is not done here.
- **The sweep is a 300 ms grid to 180.1 s (90.1 s on the start pages), plus C's visits.** A lower value could exist between its points or after its end.
- **Exact equality of full numbers was shown in this one Docker image.** CI was compared to the two decimals its log prints.
- A1, A2 and A3 leave out the spec's coverage assertions (one `page.evaluate` and three comparisons), and water-full.spec.ts gained `WATER_FULL_TIMES` and `drawsAtStart` between B2 and C. Neither changes a value's definition.
