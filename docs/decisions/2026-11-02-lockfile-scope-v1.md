# 2026-11-02 — The one lockfile v1 says it supports is package-lock.json

**The owner decided on 2026-11-02 at 19:53 JST:**

1. The only lockfile v1, the first release, says it supports is package-lock.json. pnpm-lock.yaml is left out. Since package-lock.json is the only one, yarn.lock, bun.lock and bun.lockb are not in v1 either.
2. The one-day measurement's change of day, from 2026-11-01 to 2026-10-25, is accepted, with its result of about ±3.7 points at package-lock.json's share.

**The owner decided on 2026-11-02 at 23:06 JST:**

3. Ludion applies no fix to a project that has a lockfile other than package-lock.json at its root, or whose packageManager is not npm, and stops, writing the reason. The owner accepted that the share of projects it covers goes from 64.0% to 61.0% (below, "What it rests on").

This record gives what was decided, not the owner's words.

## What Ludion will not do

v1 will not say it supports pnpm-lock.yaml, yarn.lock, bun.lock or bun.lockb. Of npm's lockfiles, Ludion fixes only package-lock.json. Today its scan reads pnpm-lock.yaml and yarn.lock, and its judge reads pnpm-lock.yaml and never answers ready for it; it reads no bun lockfile. This record does not change that code, and whether those reads stay in v1 is not decided here. What it ends is the line in docs/status.md's scope table that they would be in if LV0 showed many.

v1 will not fix a project that has a lockfile other than package-lock.json at its root, or whose packageManager is not npm. It stops there and writes the reason.

## What the code does today, against decision 3

Decision 3 is not yet what the code does. This is from reading the lines below at 890ec68f53c469a8c2d31c9b51ad6d57603b6513, not from running them. This record changes no code and no test.

| Project | What the code does | Lines read (packages/cli/src/security/) |
|---|---|---|
| package-lock.json and another lockfile at the root | Does not stop for the other lockfile: it takes package-lock.json and does not look at the other | `inventory.ts:81`–`:82` take the first reader that finds its file, package-lock.json first; `inventory.ts:13` and `dependency-patch.ts:389` copy only package.json and package-lock.json; `deliver.ts:553`–`:554` name npm-shrinkwrap.json and package-lock.json only |
| pnpm-lock.yaml or yarn.lock, and no package-lock.json | Stops with a reason when the scan has a finding; with none, it ends with no fix | `inventory.ts:87`, `dependency-patch.ts:330`; `dependency-patch.ts:308` |
| bun.lock or bun.lockb, and none of package-lock.json, pnpm-lock.yaml and yarn.lock | Stops with a reason that does not name bun | `inventory.ts:83`, called from `dependency-patch.ts:305` |
| packageManager is not npm, and package-lock.json at the root | Does not stop: nothing reads packageManager | The word has no match in `packages`, `action`, `action.yml`, `apps/site/src`, `tools` or `examples` |

## What it rests on

docs/decisions/2026-11-02-definition-of-complete-final.md (「範囲：npm だけ」) says 「lockfile は 1 日の測定で一番多いものに決める」. The measurement is docs/progress/2026-11-02-llock-lockfile-one-day.md, under the definition in docs/decisions/2026-11-02-lockfile-one-day-definition.md. Among public repositories with a root package.json and a default-branch push in GH Archive's files of 2026-10-25, package-lock.json is the most common: 64.0% (95% interval 60.2–67.6, n = 1,000, weighted, effective n 633; files as answered on 2026-11-02). Next is pnpm-lock.yaml: 15.5% (95% interval 12.9–18.5, same n).

The 61.0% of decision 3 is, among the same repositories, package-lock.json at the root with none of pnpm-lock.yaml, yarn.lock, bun.lock and bun.lockb: 61.0% (95% interval 57.1–64.7, same n; docs/bench/lockfile-one-day/counts.md, row "only package-lock.json": 306/500 and 297/500, weighted). It measures the lockfile half of the decision only. The measurement did not read packageManager, so the share under the whole decision is at most 61.0%, and how far below is not known. npm-shrinkwrap.json was not counted, and Ludion's other stops, such as workspaces (`dependency-patch.ts:165`), are not taken off.

That measurement's limits apply here. It leaves out 23.5% of the repositories pushed to that day, and it does not measure the projects of the people Ludion is to protect.

## What this record does not change

- The definition of the measurement, its raw data and its scripts.
- Any gate, the wait table, the code, or CLAUDE.md.
- Whether a release after v1 adds another lockfile. That is not decided here.
- The rest of the scope table in docs/status.md.

## Undo

A new decision record that adds a lockfile to v1, and the code and tests that fix it and judge it. For decision 3, a new decision record.
