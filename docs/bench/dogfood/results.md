# Dogfood results

Collected at 2026-10-28T11:37:26Z (`raw/collected-at.txt`), under the definitions in README.md (fixed in 4c441d0 before this table). Every number is copied from the file named next to it; nothing is rounded.

## Judged PRs: 3

| PR | Update | PR created_at | Verdict in the comment | Comment id | Comment created_at | Comment updated_at |
| --- | --- | --- | --- | --- | --- | --- |
| #161 | hono 4.13.13 → 4.13.14 | 2026-10-28T10:45:53Z | 停止 (`stop`) | 6467253162 | 2026-10-28T11:00:37Z | 2026-10-28T11:34:59Z |
| #162 | astro 7.3.6 → 7.4.2 | 2026-10-28T10:46:10Z | 停止 (`stop`) | 6467337872 | 2026-10-28T11:04:50Z | 2026-10-28T11:04:50Z |
| #163 | vitest 4.1.12 → 5.0.5 | 2026-10-28T10:46:21Z | 可（関門3は未実施のため、適用してよいという判定ではない） (`ready_except_build`) | 6467735829 | 2026-10-28T11:24:59Z | 2026-10-28T11:24:59Z |

Sources: `raw/pr-N.json`, `raw/pr-N-comments.json`, `raw/pr-N-judge-comment.md`. Each PR has exactly one `github-actions[bot]` comment.

Breakdown per PR: `stop` 2, `ready_except_build` 1, `wait` 0, `undecidable` 0.

The stop reasons, from the comments:
- #161: `[stop] gate 4: The change also touches apps/worker/package.json; a dependency update must change only package.json and package-lock.json.`
- #162: the same gate 4 stop for `apps/site/package.json`, and two gate 2 stops: `unist-util-visit-parents@6.1.0` and `unist-util-visit@5.2.0` `was published at or after the fix (T = 2026-10-21T14:18:56.764Z)`. Also four `[extend] gate 2` lines (new dependencies `tinyps`, `fnv1a-64`, `std-env`).
- #163 has no stop; four `[extend] gate 2` lines (two publisher changes, two added dependencies) and `wait 144h from the newest publish (2026-10-15T14:29:01.396Z)`.

## Judgements (judge.yml attempts): 5

| PR | Run / attempt | Verdict (log) | judge_exit_code | judge_seconds | job_seconds | Job started_at | Job completed_at | Comment run | Comment job started_at → completed_at | Log line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #161 | 40676504450 / 1 | stop | 1 | 0.629 | 12.742 | 2026-10-28T11:00:06Z | 2026-10-28T11:00:25Z | 40676564795 | 11:00:32Z → 11:00:39Z | `Posted the judgement comment on PR #161` |
| #161 | 40676504450 / 2 | stop | 1 | 0.73 | 13.04 | 2026-10-28T11:01:12Z | 2026-10-28T11:01:30Z | 40676718146 | 11:01:37Z → 11:01:46Z | `Updated the judgement comment on PR #161` |
| #161 | 40676504450 / 3 | stop | 1 | 0.695 | 14.801 | 2026-10-28T11:34:26Z | 2026-10-28T11:34:47Z | 40681058051 | 11:34:53Z → 11:35:01Z | `Updated the judgement comment on PR #161` |
| #162 | 40677044201 / 1 | stop | 1 | 4.049 | 21.72 | 2026-10-28T11:04:08Z | 2026-10-28T11:04:37Z | 40677123193 | 11:04:44Z → 11:04:53Z | `Posted the judgement comment on PR #162` |
| #163 | 40679684709 / 1 | ready_except_build | 0 | 5.637 | 20.538 | 2026-10-28T11:24:20Z | 2026-10-28T11:24:47Z | 40679757983 | 11:24:54Z → 11:25:02Z | `Posted the judgement comment on PR #163` |

Sources: `raw/judge-RUN[-aN].log` (the record summary that record.ts prints), `raw/judge-RUN[-aN]-jobs.json`, `raw/judge-comment-RUN.log` and `raw/judge-comment-RUN-jobs.json`. Each comment run's log names the judge run it read (`RUN_ID:`). All 10 jobs concluded `success`.

The comment shows the newest attempt: #161's comment reads `判定役 0.695 秒、ジョブ開始から 14.801 秒`, attempt 3's numbers.

## The re-judgement updates the same comment (task step 1)

On #161 (the first dependency PR), attempt 1's comment run posted comment 6467253162. Attempt 2 (a re-run started before this session; who started it is not recorded here) and attempt 3 (re-run by this session at 2026-10-28T11:34:22Z, `gh run rerun 40676504450`) each logged `Updated the judgement comment on PR #161`. The comment's id and created_at stayed the same and its updated_at moved to 2026-10-28T11:01:43Z, then 2026-10-28T11:34:59Z. Nothing was merged.

## Not judged

- **#164** (@types/node 24.19.1 → 26.6.5) and **#165** (@axe-core/playwright 4.13.0 → 4.14.0): no judge.yml run. Both heads are still on base 70f7a07, from before #156 (`raw/pr-164.json`, `raw/pr-165.json`). At their creation (10:46Z) test and protected-paths ran and judge did not. A `@dependabot rebase` comment at 11:02:44Z and 11:02:45Z produced no new commit by collection time. Why judge.yml did not run at creation is not known; the same is true of #161–#163, which were judged only after their rebase onto be86239.
- **#159** (throwaway test of judge.yml, closed): two judge runs (40665174013, 40665447810), both `ready_except_build`, and no judge-comment run. It is not a dependency PR and is not counted.
