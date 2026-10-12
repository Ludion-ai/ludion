# Seed pipeline yield, against the hand-made seeds (2026-10-12)

Question (work list, next step 1): how many of a release's changelog entries become lessons that pass every check, compared with the 30 seeds made by hand? The pipeline is `tools/seed` (`docs/decisions.md`, "The seed pipeline"). Every number below comes from the `summary.json`, `check*.json`, `review*.json`, and `duplicates.json` in each subject's folder here, or from the files named in the hand-made row.

## What was run

| subject | range | drafting model | per-lesson reviewer | review rounds | local-check problems fed back to the drafter |
| - | - | - | - | - | - |
| agents | 0.19.0 to 0.27.0 | Opus | Opus | 2 revise rounds after the first review | from round 2 (round 1 used review findings only) |
| vitest | 5.0.0 | Opus | Opus | none (stopped by the spending rules) | no |
| wrangler | 4.111.0 to 4.148.0 | first 20 Opus, the other 36 Sonnet | Sonnet | none | no |

Triage (every entry, one call per batch of up to 25) was Sonnet in all three. Only silent changes that aren't additions (`default`, `behavior`, `deprecated`, `renamed`, `removed`) were drafted; loud ones and additions were triaged but not drafted. So the numbers say nothing about them.

## Yield

| | agents | vitest | wrangler | hand-made seeds |
| - | - | - | - | - |
| changelog entries | 131 | 140 | 288 | 45 changes chosen from the same projects (`docs/bench/2026-10-11-keys/`) |
| triaged as lesson candidates | 64 | 71 | 107 | |
| silent, not additions (what was drafted) | 32 | 39 | 56 | |
| drafted by the agent | 28 | 34 | 55 | 31 |
| agent skipped ("can't teach this truthfully") | 4 | 5 | 1 | |
| pass the local checks (schema, `lessonProblems`, quotes found), first draft | 24 | 24 | 33 | |
| of those, with a differential test pair | 15 | 22 | 23 | 29 of the 30 on main |
| review findings, first draft (lessons reviewed) | 52 (24) | 54 (24) | 92 (33) | 46 (30) from the pipeline's reviewer on the accepted lessons, Opus; 12 from the original review of 31 |
| reviewed with no finding, first draft | 4 | 6 | 3 | 10 of 30 |
| after revising: reviewed with no finding | 7 of 20 (round 2) | | | |
| **kept: no problem and no finding left** | **7** | **6** | **3** | 30 |
| of the kept, repeat a lesson on main | 1 | 1 | 0 | |
| **new lessons written for a PR** | **6** | **5** | **3** | |
| CI's Docker run on the PR | 6 of 6 passed (#62) | not yet a PR | not yet a PR | CI's `verify` passed in #36 |
| independent protected-PR review | approve, 6 of 6 (#62) | | | |
| draft cost (drafting step only, $) | 19.83 | 18.14 | 19.21 | not measured |

Reading it:

- **From the silent, non-addition changes drafted, 3 to 7 of 32 to 56 end as a lesson with nothing left to fix** (agents 7 of 32 after two revise rounds; vitest 6 of 39 and wrangler 3 of 56 after none). That is a low yield, and the revise rounds are the only thing that moved it: agents' reviewed-clean count went from 4 of 24 on the first draft to 7 of 20 after two rounds, and its local-check failures went from 4 of 28 to 0.
- **The reviewer isn't easy on accepted lessons either.** The same Opus reviewer found a finding in 20 of the 30 hand-made seeds (46 findings), so "no finding" is a strict bar. It is a model's opinion, not proof. The one independent check of kept lessons, the protected-PR review of #62, approved all 6 and called two of them low-value (they change only what the model sees).
- **Where drafts fail the local checks** (counts of problems, a draft can have several): `quote doesn't name the symbol` 3 / 9 / 15, `no evidence names the symbol` 2 / 9 / 10, `detail not grounded` 0 / 3 / 10, `schema` 1 / 0 / 0 (agents / vitest / wrangler). These are machine-checkable and the drafting agents can't run the checker (no shell, by design), so they find out only afterward.
- **Where the reviewer finds problems** (rule numbers are the seed checklist in `docs/decisions.md`; first drafts): rule 1 (claim says more than the evidence) 11 / 12 / 24, rule 8 (would mislead an assistant) 11 / 15 / 22, rule 7 (kind, symbol, versions, or replacement don't match the entry) 11 / 9 / 11, rule 5 (no differential pair) 9 / 4 / 12. The hand-made seeds' findings by the same reviewer: 17, 7, 6, 3.
- **Source-only lessons** (no test) among those that passed local checks: 9 of 24, 2 of 24, 10 of 33. Those get the weaker "source" label.
- **Overlap with the hand-made seeds** is a lower bound: a lesson counts as a repeat only when versions match and the symbols are equal or one holds the other (`isDuplicate`).

## Confounds

- The reviewer differs: Opus for agents and vitest, Sonnet for wrangler. A Sonnet reviewer found more per lesson (92 on 33) than Opus did on agents (52 on 24) and on the hand-made seeds (46 on 30), so wrangler's lower yield mixes drafting model, reviewer, and a larger share of hard changes. It can't be split from this run.
- Revise rounds were run only on agents.
- One run per subject. Hand-made seeds started from the 45 changes of the FreshBench set, chosen with a different filter (changes models got wrong), not from a whole range.

## What it says about the next step

The yield is poor enough that adding subjects first would multiply review work. The failures are mostly mechanical (the quote doesn't name the symbol, the detail uses words the quote doesn't contain, a missing test pair) and the pipeline already feeds local-check failures back to the drafter in `revise`; running `revise` once by default, before the reviewer, is the cheapest change and is the next thing to measure, on one subject. See `docs/progress.md`.

Files per subject: `run.json`, `entries.json`, `triage.json`, `drafts/`, `check.json`, `review.json` (agents also `drafts-r1/`, `drafts-r2/`, `check-r*.json`, `review-r*.json`), `kept.json`, `duplicates.json`, `summary.json`. `calibrate-hand-seeds.json`: the reviewer on the 30 accepted lessons.
