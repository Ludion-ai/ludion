# LE2E: the water contrast check, measured

The definitions are in `docs/decisions/2026-11-02-le2e-water-sampling.md`, the result in `docs/progress/2026-11-02-le2e-water-sampling.md`. Everything here ran in Docker on the owner's PC on 2026-11-02, from d42e172's site, in `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`, `--network none --memory 4g --cpus 4`, `CI=1`, `--workers=2`, one run at a time.

| File | What it is |
| --- | --- |
| `minimums.csv` | One row per page, scheme and box (152): the threshold, the lowest value in A1, A2, A3, B and the final list, the water times that reach it in B and in the final list, the lowest over B, C and W. Values are full JavaScript numbers. |
| `runs/a1.json`, `a2.json`, `a3.json` | The check as it stood, clock running. 240 moments each. |
| `runs/b1.json`, `b2.json` | Clock paused, the same moments, one frame each. 240 moments each. |
| `runs/c.json` | Clock paused, the water times around A1's and A2's lowest values for the 7 boxes that were kinder in B (`times-c.json`). 1,269 moments. |
| `runs/w.json` | Clock paused, the sweep to 180.1 s and 90.1 s (`times-w.json`). 3,600 moments. |
| `runs/f1.json`, `f2.json` | The final list, as `e2e/water.spec.ts` now visits it. 246 moments each. |
| `added-moments.json` | The water times added to the check, chosen by `scripts/select.mjs`. |
| `timing.json` | Each run's Playwright report in numbers: wall seconds, test seconds per spec, passes and failures. |
| `logs/` | Each run's Playwright output. `t0-*` is the check before the change; `t1-*` the first after-run, which failed on the new "water moved" assertion as first written (see progress); `t1b-*` the after-run that counts; `m*` the mutations. |
| `scripts/` | How the numbers were made, in the order: `run.sh` (one run), `compare.mjs` (A against B), `times.mjs` (Arm C's times), `times-w.mjs` (Arm W's), `select.mjs` (the added moments), `final.mjs` (the final list against every arm, and `minimums.csv`), `mutate.sh` (M1 to M5), `report.mjs`, `export.mjs`. They expect a Docker volume at `/w` holding the repository, and run inside the container. |

In each run file, the key is `<path with / as _><scheme>`, and each moment holds: `k`, `ms` (the water time asked for; absent in A1, A2, B1 and B2, whose harness did not write it yet), `tBefore` and `tAfter` (the water time last sent to the shader before and after the screenshot), `drawsBefore` and `drawsAfter` (frames drawn so far), `stepMs` and `shotMs` (real milliseconds of the clock step and the screenshot) and `values` (each box's lowest contrast in that screenshot).

M3b, the stronger dark mutation, ran by hand after `mutate.sh`: in the built script, `caustic:.075,body:0,peak:.045` became `caustic:.6,body:0,peak:.6`, and the file was restored and compared afterwards (`logs/m3b-dark-strong.txt`).

To measure again, build the site in the image above, then in the same image:

```sh
WATER_FULL_OUT=out/running WATER_FULL_ARM=running npx playwright test e2e/water-full.spec.ts --workers=2
WATER_FULL_OUT=out/paused WATER_FULL_ARM=paused npx playwright test e2e/water-full.spec.ts --workers=2
```

`WATER_FULL_TIMES=<file>` makes the paused arm visit other water times, as the sweep did with `times-w.json`.
