# 2026-10-31 — The scheduled workflow runs on an hourly schedule and on push, and measures how often it is started

**Decided 2026-10-31 06:59 JST** by the owner's Claude chat (ludion-ops#1 comment 6534448385, 2), which accepted finding 1 of the fifth hourly first-principles audit (comment 6533867423). This replaces the chat's first form of the decision (comment 6528291928, 4, after finding 6 of the first audit, comment 6527803283), which assumed GitHub's schedule fires every time; the chat withdrew its "on average 30 minutes with an hourly schedule". Under comment 6525272283 ("毎時の監査"), audit findings that touch the goal, the scope, a gate, a wait or a rule are judged by the chat. Whether the owner has seen this decision is not on the board (不明).

## Why

The template's schedule is every 6 hours (action/patch-workflow.yml). The first form of this decision moved it to every hour, expecting the delay from a wait's end to the next run to fall with the interval. GitHub's schedule does not fire every time. Measured by the audit (comment 6533867423, 1) from the GitHub API's list of runs and their times, not by this record's author:

- **The shadow (public repository Ludion-ai/ludion-shadow), cron `17 * * * *`.** From the merge of its PR #1 (2026-10-29T10:20:26Z) to 2026-10-30T20:17Z there are 34 hourly slots. `actions/runs?event=schedule` gives total_count 5:
  - at 2026-10-29 18:29:37Z and 23:18:59Z, and 2026-10-30 05:52:12Z, 12:58:57Z and 18:38:43Z, 12, 2, 35, 42 and 22 minutes after their slots;
  - the intervals, from the first slot at 11:17Z, are 7.21, 4.82, 6.55, 7.11 and 5.66 hours;
  - the mean time from a moment to the next scheduled run is Σg²/(2Σg) = 200.8/62.7 = 3.20 hours, about what 6-hourly slots that all fire would give (3 hours). The last interval, from 18:38Z, had not ended and is not included; including it makes the mean longer.
  - Two of the five (12:58Z and 18:38Z) are cancelled runs; the audit reads the list as counting every scheduled run created, cancelled ones included.
  - Not checked: whether the shadow's chain of workflow_dispatch runs or its `concurrency: shadow` affected the five.
- **A private trial repository, two workflows.** In the hourly slots at 19:23Z and 20:23Z (four slots across the two), 0 scheduled runs; asked at 21:26Z, total_count was 0. The 6-hourly slot at 18:23Z had not fired either by 18:56:45Z, when the cron was changed. Why none fired is not known (不明).

On these measurements the first form's "30 minutes on average" does not hold, and an estimate that assumes every slot fires is not a measurement.

## Decided

1. **Two triggers: the hourly schedule, and `push` to the default branch.** On either, a run with nothing to do (no new advisory, no wait that has ended) ends early, before Docker. No new permission is needed.
2. **Each run writes the time since the start of the same workflow's previous run** in the job summary and in the receipt, reading only the record of runs, never an artifact. The PR body also shows "N hours since the previous run".
3. **Lateness is not written as an estimate.** q (the share of slots that fired), and the mean and quantiles of the time from a moment to the next run, are measured and written. The unit of independence is (repository, time).

**Cost** is also written from the measured q: a slot that does not fire uses no minutes, so an estimate that assumes every slot fires comes out too large. The minutes of a run that ends early and q for a private repository are not measured yet (不明); the cost of the hourly schedule for a private repository goes to the owner as a number once q is measured (comment 6534448385, 2).

**Caution:** `push` runs when a person merges. If a later form merges with GITHUB_TOKEN, `push` will not run.

The check from comment 6529705640, 4 (whether a run that ends early can decide so without reading an earlier run's artifact) stays.

## When it takes effect

When the template changes; that is not built yet. The PR that changes it is not a protected PR unless it deletes a file under action/ (comment 6528291928, 4). The board names no CLAUDE.md change for this.

## Undo

A later decision, with its own record.
