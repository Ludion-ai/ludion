# 2026-10-31 — The scheduled workflow runs every hour

**Decided 2026-10-31 01:49 JST** by the owner's Claude chat (ludion-ops#1 comment 6528291928, 4), which accepted finding 6 of the first hourly first-principles audit (comment 6527803283). Under comment 6525272283 ("毎時の監査"), audit findings that touch the goal, the scope, a gate, a wait or a rule are judged by the chat. Whether the owner has seen this decision is not on the board (不明).

## Why

The template's schedule is every 6 hours (action/patch-workflow.yml). The delay from a wait's end to the next run is, if uniform, half the interval on average: 3 hours, added to exposure time, a quarter on top of the 12-hour wait for an exploited fix. GitHub's lateness happens at any interval, so it is no reason to pick 6 hours (the audit).

## Decided

1. **The template's cron runs every hour.**
2. **A run with nothing to do (no new advisory, no wait that has ended) ends early, before Docker.** The added delay goes from 3 hours to 30 minutes on average.
3. **Measured in the trial repository:** the minutes of a run that ends early. From that number, how many minutes a month it takes in a private repository is written down.
4. **Checked there too** (comment 6529705640, 4, after the second audit's finding 6, comment 6529106910): whether a run that ends early can decide so without reading an earlier run's artifact.

## When it takes effect

When the template changes; that is not built yet. The PR that changes it is not a protected PR unless it deletes a file under action/ (comment 6528291928, 4). The board names no CLAUDE.md change for this.

## Undo

A later decision, with its own record.
