# 2026-11-02 — The one lockfile v1 says it supports is package-lock.json

**The owner decided on 2026-11-02 at 19:53 JST:**

1. The only lockfile v1, the first release, says it supports is package-lock.json. pnpm-lock.yaml is left out. Since package-lock.json is the only one, yarn.lock, bun.lock and bun.lockb are not in v1 either.
2. The one-day measurement's change of day, from 2026-11-01 to 2026-10-25, is accepted, with its result of about ±3.7 points at package-lock.json's share.

This record gives what was decided, not the owner's words.

## What Ludion will not do

v1 will not say it supports pnpm-lock.yaml, yarn.lock, bun.lock or bun.lockb. Of npm's lockfiles, Ludion fixes only package-lock.json. Today its scan reads pnpm-lock.yaml and yarn.lock, and its judge reads pnpm-lock.yaml and never answers ready for it; it reads no bun lockfile. This record does not change that code, and whether those reads stay in v1 is not decided here. What it ends is the line in docs/status.md's scope table that they would be in if LV0 showed many.

## What it rests on

docs/decisions/2026-11-02-definition-of-complete-final.md (「範囲：npm だけ」) says 「lockfile は 1 日の測定で一番多いものに決める」. The measurement is docs/progress/2026-11-02-llock-lockfile-one-day.md, under the definition in docs/decisions/2026-11-02-lockfile-one-day-definition.md. Among public repositories with a root package.json and a default-branch push in GH Archive's files of 2026-10-25, package-lock.json is the most common: 64.0% (95% interval 60.2–67.6, n = 1,000, weighted, effective n 633; files as answered on 2026-11-02). Next is pnpm-lock.yaml: 15.5% (95% interval 12.9–18.5, same n).

That measurement's limits apply here. It leaves out 23.5% of the repositories pushed to that day, and it does not measure the projects of the people Ludion is to protect.

## What this record does not change

- The definition of the measurement, its raw data and its scripts.
- Any gate, the wait table, the code, or CLAUDE.md.
- Whether a release after v1 adds another lockfile. That is not decided here.
- The rest of the scope table in docs/status.md.

## Undo

A new decision record that adds a lockfile to v1, and the code and tests that fix it and judge it.
