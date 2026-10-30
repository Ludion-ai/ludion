# LR and LR2 — public Dockerfiles that pin the official php or node image

A measurement that only reads; no product code, gate, wait table, CLAUDE.md, docs/design.md or docs/status.md changed. Nothing was cloned, no archive was downloaded, nothing third-party ran, and nothing was written to any other repository.

- Definitions: `docs/decisions/2026-10-30-lr-dockerfile-lag-definitions.md` (LR, 975e6fa) and `docs/decisions/2026-10-31-lr2-definitions.md` (LR2, b884cbb554b98bdfc68888a16b5aa6f35e9f2247), each committed and pushed before what it defines was counted.
- Scripts: `scripts/releases.sh` (official release lists), `scripts/search.sh` (code-search pool), `scripts/select.sh` (the walk; host `gh api` calls), `scripts/classify.mjs` (reads file contents, in Docker), `scripts/analyze.mjs` (the numbers, in Docker).
- Raw data: `raw/`. Results: `results.json`, `results.md`.

## Results

Measurement date 2026-10-30 (UTC). n = 100 (50 php, 50 node), 100 owners. Every number below is copied from `results.md` / `results.json`, which `analyze.mjs` made from `raw/`. No repository and no item was "could not be counted" (0 everywhere), and `raw/select.log` has no API error or wait line.

### LR: the lag

| group | n | lag median (days) | lag p90 | exposure median | exposure p90 | behind (lag > 0) | series past EOL |
|---|---|---|---|---|---|---|---|
| all | 100 | 9 | 1807 | 9 | 2075 | 54 | 39 |
| php | 50 | 0 | 1457 | 0 | 1891 | 24 | 17 |
| node | 50 | 9 | 2075 | 10 | 2075 | 30 | 22 |
| Dependabot docker or Renovate configured | 20 | 0 | 9 | 0 | 10 | 7 | 2 |
| neither configured | 80 | 9 | 2075 | 9.5 | 2174 | 47 | 37 |
| Dependabot docker | 12 | 0 | 9 | 0 | 94 | 5 | 2 |
| Renovate | 8 | 0 | 10 | 0 | 10 | 2 | 0 |

- Digest pinned: 16 of 100 (php 7, node 9).
- 2 repositories have an untagged PHP release (LR section 3) newer than the one they pin.
- Of the 54 behind, 27 pin a series past its end of life and 27 do not. 21 are more than 365 days behind.
- The walk checked 1,859 repositories to choose 100: 1,109 not pushed since 2025-10-30, 648 with no qualifying FROM line, 1 already chosen in php, 1 whose owner was already chosen (`raw/checked.tsv`).

### LR2: the five items (yes / no / could not be counted)

| item | all | php | node |
|---|---|---|---|
| test script (manifest `scripts.test`) | 34 / 66 / 0 | 12 / 38 / 0 | 22 / 28 / 0 |
| any test sign | 51 / 49 / 0 | 24 / 26 / 0 | 27 / 23 / 0 |
| buildable with no network (likely) | 8 / 92 / 0 | 7 / 43 / 0 | 1 / 49 / 0 |
| EXPOSE | 45 / 55 / 0 | 17 / 33 / 0 | 28 / 22 / 0 |
| HEALTHCHECK | 11 / 89 / 0 | 4 / 46 / 0 | 7 / 43 / 0 |
| EXPOSE and HEALTHCHECK | 9 / 91 / 0 | 4 / 46 / 0 | 5 / 45 / 0 |
| EXPOSE or HEALTHCHECK | 47 / 53 / 0 | 17 / 33 / 0 | 30 / 20 / 0 |
| deploy: push workflow saying `deploy` | 19 / 81 / 0 | 9 / 41 / 0 | 10 / 40 / 0 |
| deploy: platform file | 2 / 98 / 0 | 1 / 49 / 0 | 1 / 49 / 0 |
| deployed automatically on merge | 21 / 79 / 0 | 10 / 40 / 0 | 11 / 39 / 0 |
| series past end of life | 39 / 61 / 0 | 17 / 33 / 0 | 22 / 28 / 0 |

What made a build "not with no network" (the first pattern of LR2 section 3.2 found, `raw/lr2.tsv`): php: pattern 1 `apt-get install|update…` 31, pattern 3 `apk add…` 7, pattern 10 `composer install…` 3, pattern 8 `curl|wget` 1, a remote `ADD` 1; node: pattern 11 `npm install|ci…` 30, pattern 1 7, pattern 3 5, pattern 12 `npx` 2, and patterns 13 to 17 one each. 9 of the 21 that deploy on merge are behind.

### Decision 4: kept patched by Ludion with no person

**0 of 100 (0.0%; 95% Wilson interval 0.0% to 3.7%).** As LR2 section 4 says, H6 (the fix reaches the repository with no person) is not met by any repository today, because automatic merge, opening PRs on GitHub and a release are not built and PHP image updates do not go through the judge. That was known before counting.

What the files show, which is **not what Ludion can do** (it would still need everything H6 names): H1 to H5 are met by **0 of 100** (95% Wilson 0.0% to 3.7%), so even with H6 built this sample would have none.

| step (each counted among those that met the earlier ones) | of | yes | no | could not be counted |
|---|---|---|---|---|
| H1 the image is php (Ludion patches no node image) | 100 | 50 | 50 | 0 |
| H2 `phpImage` accepts the Dockerfile | 50 | 4 | 46 | 0 |
| H3 the series is not past end of life | 4 | 1 | 3 | 0 |
| H4 buildable with no network | 1 | 1 | 0 | 0 |
| H5 any test sign | 1 | 0 | 1 | 0 |
| H6 reaches the repository with no person | 0 | 0 | 0 | 0 |

`phpImage`'s answer for the 50 php Dockerfiles: 4 accepted; 45 refused with "Dockerfile frontend directives and continuations are not supported in this preview." (it checks that first, so a file refused for it may also break the later rules, such as one FROM stage); 1 refused with "ADD, external COPY and RUN network/mount overrides are not supported by the offline validator." Of the 4 accepted, 3 pin a series past its end of life (8.1.34, 7.1.3, 7.4.28) and 1 (8.5.12) has no test sign.

### What this says (and does not)

- Half of these Dockerfiles (54 of 100) are behind a security release of their own series on 2026-10-30; the median is 9 days and the p90 is about 5 years. Where Dependabot's docker updates or Renovate are configured (20), the median is 0 and the p90 9 days; where neither is (80), the p90 is 2075 days. This is an association in a best-match sample, not a cause.
- On this sample, the narrow PHP Docker path that is built today would reach almost nothing: the line-continuation rule alone stops 45 of 50 php Dockerfiles, and 92 of 100 Dockerfiles run a command that usually fetches from the network, which a `--network=none` build cannot do. These are the two largest gaps the counts show between the PHP Docker path and these repositories. Changing either is a design question for the owner, not a result of this lane.
- 51 of 100 show some test sign and 21 deploy on merge, both read from text only.

## How it ran

1. `releases.sh` (2026-10-30T11:49:11Z): php.net's release lists for PHP 5, 7 and 8 and its states, Node's `index.json` and release schedule, in `raw/releases/`.
2. `search.sh` (2026-10-30T11:49:06Z to 12:29:16Z): GitHub code search, 28 queries × 10 pages, 280 pages, no error lines (`raw/search-pages.tsv`), 28,000 hits (`raw/search-hits.tsv`). Its shell was stopped from outside on low memory while it ran, and a note said the search had stopped at 225 pages; the process in fact went on and finished every page. That note (`STOPPED.md`) is kept, marked superseded.
3. `select.sh` (2026-10-30T17:00:18Z to 19:14:03Z, second start): the walk of LR section 6 with LR2's one-repository-per-owner rule, then the files of LR section 5 and LR2 section 2 for each chosen repository. One row per repository checked in `raw/checked.tsv`, the FROM lines of every Dockerfile examined in `raw/froms.tsv`, LR2's items in `raw/lr2.tsv`, progress and API errors in `raw/select.log`.
4. `analyze.mjs`, in Docker with no network: `results.json` and `results.md`.

**Change of method (not of what is counted), LR2 section 2:** LR's `select.sh` as first committed (c0d1b6c) read Dockerfiles with `grep` on the host. It never ran on real data. The version that ran passes the contents API's base64 text, still encoded, to `classify.mjs` in a container (`node:24-slim` pinned by digest, `--network none`, read-only root, user 1000, `--cap-drop ALL`, no-new-privileges, 256 MB, 64 processes, no host environment), which applies the same patterns and prints only flags and matched lines. The FROM pattern, the Dependabot pattern and the `"renovate"` key pattern are LR's, written as JavaScript regular expressions. H2 runs `phpImage` from `packages/cli/src/security/php.ts`, mounted read-only, on the measured Dockerfile.

**A first start that was stopped (a mistake in the walk).** The walk was first started at 3a48513 and stopped about two minutes later, while it was still ordering the php pool: no repository had been read and no row written. An automated security review of the pushed commit found that the test-sign step put the measured Dockerfile's directory, which comes from a third-party path, into a `sed` program on the host, where a path holding `|` could have become sed commands (14 hit paths hold a shell or sed character such as `&` or `'`; none was reached). e0a4319 passes it to `awk` through the environment instead, and the path in `froms.tsv` too. The walk was then started again from the beginning; the run below is that one. No mistake record is added in this lane (its files are this folder and two records); it is reported to the coordinator.

**Small readings made while writing the scripts (before counting):**

- A hit Dockerfile that answers 404 when read (gone since the search) has no qualifying line, as in LR; one that fails otherwise is skipped and counted in the outcome as `rejected:no-qualifying-from(unread N)` when no other file qualifies.
- A Dockerfile line counts as continued when it ends in `\` followed only by spaces or tabs; comment lines are dropped before lines are joined, as Docker does.
- A root `package.json` whose `"renovate"` line is found counts for Renovate even when the file does not parse as JSON (LR's rule is by line).

## Limits

- The sample is GitHub's best-match code search, active repositories only (pushed within 365 days of 2026-10-30), one per owner: not a random sample of GitHub.
- Files were read between 17:19Z and 19:14Z on 2026-10-30, the same UTC date as the measurement date, which every day count uses.
- LR2's items are read from text: a test that exists is not run; "builds with no network" is a list of commands that usually fetch; a deploy is a push-triggered workflow that says `deploy`, or a platform file; none of these was checked by running anything.
- Decision 4's H6 is not met by any repository today, by what is built (LR2 section 4); the share is known to be 0 before counting. H1–H5 is what the files show, not what Ludion can do.
