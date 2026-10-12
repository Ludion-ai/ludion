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
| after revising: reviewed with no finding | 9 of 19 (round 1), 7 of 20 (round 2) | | 3 of 35 (Sonnet, round 1) | |
| **kept: no problem and no finding left** | **7** | **6** | **3** | 30 |
| of the kept, repeat a lesson on main | 1 | 1 | 0 | |
| **new lessons written for a PR** | **6** | **5** | **3** | |
| CI's Docker run on the PR | 6 of 6 passed (#62) | 5 of 5 (#75); after revising, 3 of 3 (#80) | 3 of 3 (#76); after revising, 7 of 8 (#84), 8 of 8 after one `fix` round | CI's `verify` passed in #36 |
| independent protected-PR review | approve, 6 of 6 (#62) | #75: 1 of 5 needed a fix (made); #80: approve, 3 of 3 | #76: approve, 3 of 3; #84: 1 of 8 needed a fix (made), 3 called low value | |
| draft cost (drafting step only, $) | 19.83 | 18.14 | 19.21 | not measured |

Reading it:

- **Under the same reviewer, the pipeline's drafts are close to the hand-made seeds, and revising closes the rest.** "Reviewed with no finding" depends on the reviewer: Opus found nothing in 10 of the 30 hand-made seeds (33%), Sonnet in 3 of 30 (10%; `calibrate-hand-seeds.json` and `calibrate-hand-seeds-sonnet.json`). Against each reviewer's own baseline:

  | reviewer | hand-made seeds | pipeline, first draft | pipeline, after revising |
  | - | - | - | - |
  | Opus | 10 of 30 clean, 46 findings | agents 4 of 24 clean, 52 findings; vitest 6 of 24, 54 | agents round 1: 9 of 19 clean, 21 findings; round 2: 7 of 20, 24 |
  | Sonnet | 3 of 30 clean, 67 findings | wrangler 3 of 33 clean, 92 findings | wrangler round 1 (Sonnet reviser): 3 of 35 clean, 110 findings |

  The hand-made seeds went through a person-and-agent fix cycle (12 problems) before they were measured here; the pipeline's first drafts didn't. With Opus revising, agents reached the hand-made seeds' clean rate (9 of 19 after round 1, 7 of 20 after round 2, against 10 of 30). With Sonnet revising, one round did nothing for wrangler (3 of 33 before, 3 of 35 after; its local-check passes went 33 of 55 to 35 of 49, with 6 drafts skipped by the reviser).
- **The kept counts are small because of the bar and because revising was cut.** 7, 6, and 3 of the 32, 39, and 56 drafted ended with nothing left to fix (agents after two Opus rounds; vitest and wrangler after none). The one independent check of kept lessons, the protected-PR review of #62, approved all 6 and called two of them low-value (they change only what the model sees).
- **Where drafts fail the local checks** (counts of problems, a draft can have several): `quote doesn't name the symbol` 3 / 9 / 15, `no evidence names the symbol` 2 / 9 / 10, `detail not grounded` 0 / 3 / 10, `schema` 1 / 0 / 0 (agents / vitest / wrangler). These are machine-checkable and the drafting agents can't run the checker (no shell, by design), so they find out only afterward.
- **Where the reviewer finds problems** (rule numbers are the seed checklist in `docs/decisions.md`; first drafts): rule 1 (claim says more than the evidence) 11 / 12 / 24, rule 8 (would mislead an assistant) 11 / 15 / 22, rule 7 (kind, symbol, versions, or replacement don't match the entry) 11 / 9 / 11, rule 5 (no differential pair) 9 / 4 / 12. The hand-made seeds' findings by the Opus reviewer: 17, 7, 6, 3.
- **Source-only lessons** (no test) among those that passed local checks: 9 of 24, 2 of 24, 10 of 33. Those get the weaker "source" label.
- **Overlap with the hand-made seeds** is a lower bound: a lesson counts as a repeat only when versions match and the symbols are equal or one holds the other (`isDuplicate`).

## Revising under the owner's rule (2026-10-12, later)

The owner's decision (`docs/decisions.md`, "Revising seed drafts"): machine-check problems back to the drafting model (Sonnet) first; the per-lesson reviewer is Opus; lessons with a content finding (rules 1, 7, 8) go to Opus once, the rest to Sonnet. Lessons already in #75 and #76 are left out. A draft unchanged since the last round keeps that round's Opus review. From each subject's `summary.json`, `drafts-r*/`, `check-r*.json`, `review-r*.json`, and `kept.json`:

| vitest round | what was revised, by whom ($) | drafts | pass local checks | reviewed (review kept) | findings | no finding | review $ |
| - | - | - | - | - | - | - | - |
| 0 (first draft, before) | | 34 | 24 | 24 | 54 | 6 (5 in #75, 1 repeats main) | 1.50 |
| 1: machine checks | 10, Sonnet (0.47) | 34 | 34 | 29 (19) | 82 | 1 | 0.67 |
| 2: findings, once | 26 with rule 1/7/8, Opus (5.41); 2 others, Sonnet (0.12); Opus skipped 6 | 28 | 23 | 18 (3) | 43 | 3 | 0.99 |
| 3: machine checks again | 5, Sonnet (0.22): 4 had more than 3 pieces of evidence, 1 an ungrounded word | 28 | 28 | 23 (18) | 53 | 5 | 0.33 |

- **vitest: 5 of the 23 lessons reviewed in the last round have no finding; 2 of them repeat a lesson on main, so 3 are new (#80).** With #75's 5, that is 8 of the 34 first drafts.
- Round 1 fixed every machine-check failure (10 of 10 pass), but Opus found something in all 10 (28 findings).
- Opus's revise round fixed content in some lessons and broke machine checks in 5, which round 3 repaired. The 6 skips all say the folder had no page to quote for the change (vitest has no CHANGELOG.md at the `v5.0.0` tag, at the package or the repo root, so its folders hold only docs files the PRs changed; 5 of the 6 had none). Quoting the GitHub release notes when there is no CHANGELOG.md would give those a page; not built yet.
- Findings left after round 3 (53 on 18 lessons), by rule: 8: 17, 1: 12, 2: 12, 7: 8, 5: 3, 3: 1. No further Opus round, per the rule.

wrangler started from round 1 (one Sonnet revise, Sonnet review). Its earlier reviews were all Sonnet, so the first Opus review kept none of them:

| wrangler round | what was revised, by whom ($) | drafts | pass local checks | reviewed (review kept) | findings | no finding | review $ |
| - | - | - | - | - | - | - | - |
| 0 (first draft, Sonnet review) | | 55 | 33 | 33 | 92 | 3 (in #76) | 1.01 |
| 1 (Sonnet revise, Sonnet review) | | 49 | 35 | 35 | 110 | 3 | 1.07 |
| 2: machine checks, then Opus review | 14, Sonnet (0.57) | 49 | 49 | 46 (0) | 127 | 5 | 2.81 |
| 3: findings, once | 39 with rule 1/7/8, Opus (12.09); 2 others, Sonnet (0.10); 3 skipped | 46 | 43 | 40 (6) | 70 | 11 | 2.34 |
| 4: machine checks again | 3, Sonnet (0.11): 2 ungrounded detail words, 1 detail too long | 46 | 46 | 43 (40) | 74 | 11 | 0.18 |

- **wrangler: 11 of the 43 lessons reviewed in the last round have no finding; 3 of them repeat a lesson on main, so 8 are new (#84), all with a differential pair.** With #76's 3, that is 11 of the 55 first drafts.
- The Opus round took wrangler from 5 to 11 with no finding (Sonnet's round had gone from 3 to 3). The 3 that round 4 repaired all drew findings again.
- Findings left after round 4 (74 on 32 lessons), by rule: 1: 23, 8: 20, 7: 10, 2: 9, 5: 6, 3: 3, 4: 2, 6: 1.
- One lesson's detail ("now go to stderr") made an off-topic search question ("How do I write a for loop in Go?") find it; `go` became a common word (#83).
- Cost of both subjects' revising under the rule: Opus revising $17.50, Opus reviews $7.32 (vitest 1.99, wrangler 5.33), Sonnet $1.59.

## After the merge: one lesson retracted (2026-10-13)

Of the 11 lessons in #80 and #84, one was rewritten after its Opus review and merged without a second one: wrangler 4.113.0#10. A fresh Opus review of it said DROP (a label removal only, with a claim that leads an assistant to think provisioning was experimental before 4.113.0). So of the 25 pipeline lessons on main (#62, #75, #76, #80, #84), one was retracted, and the reviews of the PRs did not catch it because no reviewer read its final text. See `docs/decisions.md`, "A fix made after a review is reviewed again".

## Confounds

- Drafting, reviser, and reviewer models differ across rows (table above); only the two baselines are like for like. Revise rounds: agents Opus twice; wrangler Sonnet once; vitest none.
- One run per subject. Hand-made seeds started from the 45 changes of the FreshBench set, chosen with a different filter (changes models got wrong), not from a whole range.
- "No finding" is one model's opinion with a checklist, not proof; it was not compared with a person's review.

## What it says about the next step

Not "the pipeline yields little" but "the model that revises matters, and the spending rules put Sonnet there". With Opus revising, two rounds brought agents to the hand-made seeds' level under the same reviewer; with Sonnet, one round on wrangler moved nothing. The cheap fixes left are mechanical failures the drafter can't see (quote doesn't name the symbol, detail not grounded: 27 and 13 problems) and a second Sonnet round, which this run doesn't show would help. Choosing between "Opus for revising only" and "accept the lower yield" is a spending decision (`docs/decisions.md`, "Spending"), so it is left to the owner; see `docs/progress.md`. The owner chose Opus for content findings, once, after a Sonnet pass on machine checks; the results are in "Revising under the owner's rule" above.

Files per subject: `run.json`, `entries.json`, `triage.json`, `drafts/`, `check.json`, `review.json` (agents and wrangler also `drafts-r*/`, `check-r*.json`, `review-r*.json`), `kept.json`, `duplicates.json`, `summary.json`. `calibrate-hand-seeds.json` (Opus) and `calibrate-hand-seeds-sonnet.json` (Sonnet): the reviewer on the 30 accepted lessons.
