# Dogfood: the judge on this repository's own dependency PRs

Started 2026-10-28. judge.yml judges each PR that changes package-lock.json; judge-comment.yml posts the judgement as one comment per PR (docs/decisions.md, "The judge on this repository"). Comments only: nothing is merged. Ludion's agents do not merge dependency PRs.

## Definitions (fixed before the table was written)

There is no gate in this measurement: it records what the judge did, with no pass or fail.

- **Period.** From #156's merge (be86239, 2026-10-28T08:38:29Z) to the collection time written at the top of `results.md`.
- **A judged PR.** A PR with at least one judge-comment.yml run whose log says `Posted the judgement comment on PR #N` or `Updated the judgement comment on PR #N`. A judge.yml run with no such comment is listed separately, with what its log says, and is not counted as judged.
- **A judgement.** One judge.yml run attempt (a re-run is a new attempt with its own record). Each is listed with its run ID and attempt.
- **The breakdown.** Per PR: the verdict in the PR's judgement comment at collection time, copied from the comment's `判定:` line. Per attempt: the verdict from that attempt's log (the record `record.ts` prints).
- **The time.** Copied, not rounded or computed:
  - from the comment: `判定役 X 秒` (the judge's own run time, `judge_seconds`) and `ジョブ開始から Y 秒` (`job_seconds`, install and build included);
  - from the Actions API: each judge.yml and judge-comment.yml job's `started_at` and `completed_at`;
  - from the PR: its `created_at`, and the comment's `created_at` and `updated_at`.
- **Raw data.** Everything the table copies is saved under `raw/`: the run logs (`gh run view --log`), the comment bodies and timestamps, and the API answers. Logs match `*.log` in .gitignore and are added with `git add -f`.
- **Not measured here.** Whether a verdict is right, exposure time (nothing here applies a fix), and human minutes.

## Files

- `results.md`: the table, from `raw/`.
- `npm-pack.md`: what `npm pack` puts in ludion-ai.
- `prepublish-checklist.md`: what must be true before the npm package or the action is released, and the live check of the action (#169).
- `action-check/`: the local check of action.yml in Docker, with gh stubbed (`run.sh`, `prepare.sh`, `gh-stub.sh`, outputs in `out/`).
