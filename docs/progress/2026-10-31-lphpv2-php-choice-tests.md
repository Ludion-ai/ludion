# 2026-10-31 — LPHPV2: three tests close the gaps R237 found in scanPhp's choice

Lane LPHPV2, from main 9c4de68. Tests only: packages/cli/src/security/php.ts is unchanged. The review of #237 (Ludion-ai/ludion#237, comment 6540253837, findings 1–3) found three mutations of php.ts that every test let pass. Each now has one case in packages/cli/test/security.test.ts; all samples are made up, not fetched, and no test uses the network.

- R5, `parseReleases` no longer sorts: the #237 sample (fixtures/php-releases-8.4.json) with its entries oldest first must still give 8.4.28 from `php:8.4.25-cli-alpine`, and `security_releases` 8.4.28, 8.4.26. Without the sort the oldest newer security release, 8.4.26, would be taken.
- R7, any tag counts as security (`item.tags.length > 0`): the same sample with a newer 8.4.31 tagged `bugfix` (a made-up tag) must still give 8.4.28, and no candidate from 8.4.28.
- R10, string comparison in scanPhp's filter (`r.version > current.version`): from `php:8.4.9-cli`, with 8.4.10 tagged `security`, the candidate must be 8.4.10. As text "8.4.10" sorts before "8.4.9", which would give `no_newer_security_release`.

## Results

In Docker (`ludion-l9-node24-git`, node v24.22.1), `--network none`, `--memory 4g`, a copy of the worktree whose only change from 9c4de68 was security.test.ts, byte for byte the file in commit 629da46e0c6723147df76e225d624a2b105c91e0 (blob 231ef6b4923d88f3e620684c8a78f97825e3201d):

- `npm run build` exit 0 (5 pages), `npm run typecheck` exit 0.
- `npm test -- --maxWorkers=2` exit 0: `Test Files  39 passed (39)`, `Tests  1295 passed | 24 skipped (1319)`; security.test.ts 53 tests (50 on main).

Mutations, R237's three, each applied alone to php.ts, then the whole vitest run (`npx vitest run --maxWorkers=2`), php.ts restored after each:

| id | with this lane's tests | with main's security.test.ts |
|---|---|---|
| R5 | caught: `Tests  1 failed \| 1294 passed \| 24 skipped (1319)` (takes the same newest security release when php.net lists its releases oldest first) | survived: `Tests  1292 passed \| 24 skipped (1316)` |
| R7 | caught: `Tests  1 failed \| 1294 passed \| 24 skipped (1319)` (never takes a release tagged with anything other than security) | survived: `Tests  1292 passed \| 24 skipped (1316)` |
| R10 | caught: `Tests  1 failed \| 1294 passed \| 24 skipped (1319)` (compares versions by number in the scan, across a digit boundary) | survived: `Tests  1292 passed \| 24 skipped (1316)` |

Lane: caught 3, survived 0, not applied 0. Main: caught 0, survived 3, not applied 0. Each mutation fails exactly the one new case meant for it. After the runs, `git diff` on the host was empty for packages/cli/src (the worktree was mounted read-only).

Not done: R237's finding 4 (wording in docs/bench/2026-10-31-lphpv scripts) is outside this lane's files. The mutation scripts ran from the lane's temporary folder, not committed; the three replacements are exactly those in the table of comment 6540253837.
