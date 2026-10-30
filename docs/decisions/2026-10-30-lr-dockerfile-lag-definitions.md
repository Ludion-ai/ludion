# 2026-10-30 (LR) — How far behind are public Dockerfiles that pin the official php or node image? Definitions and sample fixed before counting

The first completion (decision A) handles the official runtime images (PHP, Node). No repository of the owner's organisation uses them, so it cannot be tried there. And Dependabot's docker version updates do raise the tag in a Dockerfile's `FROM` (a version update with a default wait, not a security update), so the difference Ludion would make for a base image is narrower than docs/design.md says: only security releases, only inside the same release series, no wait, the official source and digest checked, tested before it goes in. Whether that difference matters to users has not been measured. Lane LR measures it on public repositories, read only.

**This is a measurement. It changes no product code**, gate, wait table, CLAUDE.md or docs/design.md. Reconsidering decision A is not this lane's job.

This entry is committed and pushed before any repository is selected or counted. Read before it: the format of the release sources below, and only the `total_count` of four code-search queries (to check that the search answers). A later change is a new entry with its reason; the results say which definitions they used.

## 1. Official php and node images

A `FROM` image reference names the official Docker Hub image when its name, after removing one optional prefix `docker.io/library/`, `index.docker.io/library/`, `docker.io/` or `library/`, is exactly `php` or `node` (lower case). Any other registry or namespace (for example `bitnami/php`, `circleci/node`, `public.ecr.aws/docker/library/node`) is not the official image here.

## 2. Pinned to the patch version

The tag (between `:` and an optional `@`) matches `^(\d+)\.(\d+)\.(\d+)(-[A-Za-z0-9._-]+)?$`: a full `X.Y.Z`, optionally followed by a variant such as `-fpm-alpine3.20` or `-bookworm-slim`. A tag with a variable (`$`), a release candidate (`8.3.0RC1`), or only `X` or `X.Y` does not qualify. ARG defaults are not resolved.

A line qualifies when, with leading whitespace removed, it matches (case-insensitive) `FROM` `[--platform=<value>]` `<reference>` `[AS <name>]` and the reference meets 1 and 2. The **measured line** is the last qualifying line of the file (the latest stage built on the image).

**Digest pinned:** the measured reference contains `@sha256:` followed by 64 hex digits.

## 3. The same series and a security release

- **Series:** PHP: the same `X.Y` (PHP maintains each minor branch). Node: the same major `X` (Node maintains each major line).
- **Releases and their dates (official only):** PHP: `https://www.php.net/releases/index.php?json&version=<major>&max=1000` for majors 5, 7 and 8; a release is a **security release** when its `tags` contain `security`. A release without a `tags` field (41 PHP 7.0–7.3 releases, all before 2019) is treated as not a security release; the number of measured repositories for which such a release is newer than the pinned one is shown. Node: `https://nodejs.org/dist/index.json`; a security release has `"security": true`.
- **End of life (shown, not part of the lag):** PHP: `https://www.php.net/releases/states.php`, `state` `eol`. Node: `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`, `end` before the measurement date.
- **Not countable:** the pinned version is not in the official list (for PHP and Node alike). Such a repository stays in the denominator and is counted as "could not be counted".

## 4. The lag in days

The **measurement date** is the UTC date when collection starts, written in the log. Days are whole UTC calendar days.

- **Lag (primary, as asked):** among the series' security releases newer than the pinned version, the latest one; lag = measurement date − its release date. 0 when no newer security release exists in the series.
- **Exposure (secondary):** the earliest security release newer than the pinned version; days = measurement date − its release date. 0 when none.
- Also shown: how many are behind (lag > 0), and how many pin a series past its end of life.

**Median:** the middle value, or the mean of the two middle values. **p90:** nearest rank, the value at rank ⌈0.9·n⌉ in ascending order. Each is given with its denominator.

The date a Docker image of a release appeared on Docker Hub is not measured; the upstream release date is used.

## 5. Dependabot docker and Renovate

Read from the repository's default branch at measurement time, through the GitHub contents API.

- **Dependabot docker:** `.github/dependabot.yml` or `.github/dependabot.yaml` exists and has a line matching (case-insensitive) `package-ecosystem:\s*["']?docker["']?\s*(#.*)?$`. `docker-compose` is a different ecosystem and does not count. Whether the entry's `directory` covers the measured Dockerfile is not checked.
- **Renovate:** any of `renovate.json`, `renovate.json5`, `.github/renovate.json`, `.github/renovate.json5`, `.gitlab/renovate.json`, `.gitlab/renovate.json5`, `.renovaterc`, `.renovaterc.json`, `.renovaterc.json5` exists, or the root `package.json` has a line matching `^\s*"renovate"\s*:`. Renovate's Dockerfile manager is on by default; `enabledManagers` and organisation-level presets are not resolved.
- **Configured** = Dependabot docker or Renovate. Lag (median, p90, n) is shown for configured and not configured, and for Dependabot docker and Renovate separately. A repository whose files could not be read is "could not be counted" for this item.

## 6. Choosing 100 repositories

Two strata of 50: php, then node.

1. **Pool.** GitHub's REST code search (`GET /search/code`, best match, `per_page=100`, pages 1–10, authenticated):
   - php: `"FROM php:<X.Y>" filename:Dockerfile` for X.Y in 7.0, 7.1, 7.2, 7.3, 7.4, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5;
   - node: `"FROM node:<X>" filename:Dockerfile` for X in 10 to 26.
   Every hit's repository full name and file path is logged. Nothing else is searched after the results are seen.
2. **Order.** Each stratum's unique repositories in ascending SHA-256 of the lower-case full name.
3. **Check in that order**, until 50 qualify or the pool ends:
   - the repository (`GET /repos/{owner}/{repo}`) is public, not a fork, not archived, and `pushed_at` is within 365 days before the measurement date;
   - the owner is not `docker-library`, `nodejs`, `php` or `Ludion-ai`;
   - not already chosen in the php stratum (each repository counts once);
   - among its hit files whose base name is `Dockerfile`, starts with `Dockerfile.`, or ends with `.Dockerfile` (case-insensitive), in ascending path order, the first whose current default-branch content has a qualifying line (1 and 2) for the stratum's image. That file and its measured line are the repository's.
4. If a stratum ends with fewer than 50, its n is smaller and the report says so. No query is added.

The sample is GitHub's best-match search, not a random sample of GitHub, and active repositories only. That is a stated limit.

## 7. Reading only

Public repositories are read only through the GitHub API (search, repository metadata, contents). Nothing is cloned. File contents are streamed through `grep`; the full text of no file is saved. The logs keep repository names, paths, the matched `FROM` lines and the matched configuration lines, nothing else. Nothing is written to any other repository (no issue, PR, comment or star). When the API's rate limit is reached, the collection waits.
