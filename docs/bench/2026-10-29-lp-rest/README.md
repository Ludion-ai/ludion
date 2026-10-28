# LP-rest (2026-10-29): the rest of the protected-path PR "LP"

What this PR changes and why: docs/decisions/2026-10-29-records-one-file-each.md and docs/decisions/2026-10-29-lp-rest-followups.md. The result: docs/progress/2026-10-29-lp-rest-protected-followups.md.

## The move of decisions.md and progress.md

- `split.mjs` cuts the old file into entries and kept parts by the rule fixed in db3c6db (before it ran), writes one file per entry and the index, and checks that the kept parts and the files, in order, give the old file back byte for byte. `split.sh` runs it in Docker (node:24-slim, no network, read-only root, user 1000) on the two files as they are at a given commit, after removing what an earlier run moved.
- The run in this PR is on main e72301d (after #168 and #178): `out/split-run.txt`, `out/split-report.json` (every file with the old line range it holds).

| | old lines | old bytes | files | moved lines | kept in the index | lines add up | byte for byte |
| --- | --- | --- | --- | --- | --- | --- | --- |
| decisions.md | 1269 | 228737 | 65 | 1263 | 6 | true | true |
| progress.md | 562 | 88004 | 50 | 558 | 4 | true | true |

- Before this PR is merged, main is merged again and `split.sh <that main commit>` is run again, so that entries other PRs add to the two files before then move too, and no file name is taken twice.

## Checks

- `scripts/test.sh <commit> <log>`: the commit through `git archive` into a new Docker volume, `npm ci --ignore-scripts --no-audit --no-fund` with network, then typecheck, the CLI build and `npx vitest run --project node packages` with `--network none --read-only --tmpfs /tmp:exec`, user 1000, image ludion-c3-test (node:24-slim with jq 1.6, unzip and git 2.39.5). Log: `logs/tests-<commit>.txt`.
- `scripts/mutate.sh <volume> <log>`: breaks one thing at a time in a copy of that volume and runs action.test.ts and judge-workflow.test.ts. It runs the unmutated copy first, and counts a mutant as killed only when tests ran and some failed. Log: `logs/mutations-<commit>.txt`.
  - Its first runs mounted the volume read-only, so vitest could not start (it writes `node_modules/.vite-temp`), and every mutant was reported "killed". That output was discarded; the script now runs the baseline first and tells a startup error from a failure.
- actionlint 1.7.12 (rhysd/actionlint, `--network none`, the worktree read-only) on judge.yml, judge-comment.yml and protected-paths.yml: exit 0, no output.
- `npm install --package-lock-only --ignore-scripts` in node:24-slim on the commit's tree leaves package-lock.json unchanged (the hand-edited `engines` of packages/cli).
- The action check (docs/bench/dogfood/action-check, `out-2026-10-29/`).
