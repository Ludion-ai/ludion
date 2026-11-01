# LOLD: resolving to the oldest version in range

Measurement and prototype only; no product behavior changes. The definitions are in `definitions.md`, committed at 439cbf5 before any resolver ran, and not changed since. The result is `docs/progress/2026-11-02-lold-oldest-resolution.md`.

## Files

| Path | What it is |
|---|---|
| `definitions.md` | The question, the rule, the checks and how the answer is decided |
| `examples.json`, `examples.hand.json` | The 22 rows `scripts/select.mjs` chose, and the 2 written by hand |
| `scripts/oldest.mjs` | The prototype: npm 12.2.1's Arborist with `pacote.manifest` replaced |
| `scripts/verify.mjs` | The checks I1 to I4 on plain JSON, with its own registry reads |
| `scripts/run-example.mjs` | One example: base lockfile, prototype, real npm's comparison, I5 and I6; `--alternative` runs the plan's alternative |
| `scripts/summary.mjs`, `arms.mjs`, `tables.mjs` | Tabulation, with no network |
| `results/`, `summary.json` | The run that gives the answer (run 2), per example and tabulated |
| `results-alternative/` | The plan's alternative (definitions, section 8) |
| `results-no-advisory-filter/`, `results-no-advisory-no-deprecation-filter/` | The two diagnostic arms, added after the result |
| `arms.json` | All arms side by side |
| `run1-summary.json` | Run 1, kept because of the correction below |

## How to run it

In Docker only, with a volume `lold-w` (owned by uid 1000) that holds npm 12.2.1 at `/vol/npm12`:

```sh
docker run --rm --user node --cap-drop ALL --memory 2g -e HOME=/vol/home -v lold-w:/vol -v <worktree>:/w:ro node:24 node /w/docs/bench/lold/scripts/run-example.mjs /vol/run2
```

The registry changes every day, so a later run can differ: a newer version, a new advisory or a deprecation changes the normal resolution and may change a stop.

## What happened in order (2026-11-02, JST)

| Time | What |
|---|---|
| 01:22 | The definitions and examples committed and pushed (439cbf5). `select.mjs` had run; it reads metadata and runs no resolver |
| 01:25 | A smoke run of C1 and T1, then run 1 (01:25 to 01:29) |
| 01:30 | Run 2 (to 01:33), after the correction below |
| 01:33 | The alternative and the two diagnostic arms (to 01:42) |

The scripts other than `select.mjs` were committed after these runs, so their first commit holds the correction and the switch the diagnostic arms use (`LOLD_IGNORE`), which is unset in run 2 and in the alternative.

## The correction between run 1 and run 2

Run 1 gave 10 built, 13 stopped, 0 failed: the definitions' word would have been "cannot be built". Three of the stops were the prototype's mistake. Section 4 of the definitions says an edge a locked version satisfies is never asked about. That is wrong: Arborist also asks for a peer's version while it loads a new package's peer set, and then keeps the locked copy. In R04, R13 and R21 the replacement answered such a question with "nothing allowed" (the locked copy is deprecated or has an advisory today), recorded a stop, and npm's run went on to write a lockfile. R21's real npm moves nothing at all.

The correction counts a stop only when it makes npm's run fail, and keeps the others in `probe_stops`. A requirement left unmet any other way fails I5, and those three examples pass every check. The rule, the checks and the thresholds did not change. The sentence in section 4 stays as written, since the definitions are not edited after a result; this paragraph is its correction. A reader who rejects this correction should read the answer as run 1's.

## Why the diagnostic arms exist

They were added after the result, and they do not change the answer. Every stop in run 2 comes from the exclusion filters, and the filters use today's advisories and deprecations. The advisory endpoint gives no dates, so what was known at T cannot be separated. The arms bracket it: with no advisory filter, and with neither filter.
