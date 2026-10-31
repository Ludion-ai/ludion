# LDGLAT summary — Debian bookworm, 2025-11-01 to 2026-10-31T14:59:06Z

Experiment, read-only. Every number is copied from [results.md](results.md) (printed by `scripts/analyze.mjs`). Hours; percentiles nearest-rank. Definitions: docs/decisions/2026-11-01-ldglat-definitions.md (8c8800d2f1bf1585ccea81e32f43124f971a5ac0). The two places where the scripts were changed after their first run are under "Changes after the first run" below.

## Counts

- Candidate versions: 470. Left out: not in debian-security 326, no binary indexed and not in debian-security 8, other-release upload 2, start before the window 65, start after the data end 0. **Security fixes in the window: 69** (start from the binary 68, from the `.dsc` 1).
- What the base listed at each fix's start (the same for debian:bookworm-slim and debian:bookworm): not listed 58, **units 10** (reached 9, not reached 1), already had the version 1 (libcap2 1:2.66-4+deb12u2).
- **Independent events:** the 9 reached units per base image were ended by **6** distinct base-image commits (1, 2, 2, 2, 1, 1 units).
- Secondary units (package only in the tag): php 23–30 per tag, node:22/24-bookworm 55 each; node:*-bookworm-slim none.

## Stage 1: fix → base image (per unit, n = 9 reached + 1 not reached)

| | min | p10 | median | p90 | max |
|---|---|---|---|---|---|
| repo-info commit − start (upper) | 63.7 | 63.7 | 336.7 | 568.4 | 568.4 |
| `Created` − start (lower) | 9.1 | 9.1 | 299.8 | 507.3 | 507.3 |

The same for both base images (the two are rebuilt together). Not reached: tzdata 2026f-0+deb12u1 (start 2026-10-29T15:42:52Z).

## Stage 2: base image → official tag

Median over tags × units: debian:bookworm-slim **−14.9** (n 72, 52 negative), debian:bookworm 17.2 (n 18, 8 negative). Per tag the medians are −54.3 (node:22/24-bookworm-slim), −14.9 to −15.1 (php), 17.2 (node:22/24-bookworm).

**Stage 2 is mostly negative, so the split into two stages does not hold with these sources.** Two readings, from the rows in tag-units.tsv (readings, not measured):

1. The tags get some fixes themselves. php's and node's Dockerfiles run `apt-get install` on top of the base, and installing a package from the security archive upgrades the base packages it requires at the same version (php's Dockerfile installs autoconf, which requires perl; perl 5.36.0-7+deb12u4 was in php:8.4-cli-bookworm on 2026-10-08T21:47:19Z, before the base image's listing had it on 2026-10-23T12:56:26Z: −351.2).
2. repo-info's commit for the debian file lags the push of the debian image. node:22-bookworm-slim had tzdata 2026e-0+deb12u1 (its Dockerfile, read on 2026-11-01, does not name tzdata and runs no `apt-get upgrade`) on 2026-10-28T06:06:43Z, while the debian file's commit with it is 2026-10-30T12:55:26Z (`Created` 2026-10-27T00:00:00Z): −54.8. So stage 1's upper value is late by up to days, and the lower value (`Created`) is the closer one.

The total below does not use the base image's commit time, so neither reading changes it.

## Total: fix → official tag

| | n reached | not reached | min | p10 | median | p90 | max | median, not reached as largest |
|---|---|---|---|---|---|---|---|---|
| tags on debian:bookworm-slim (tags × units) | 72 | 8 | 39.2 | 84.7 | 202.4 | 553.2 | 585.7 | 353.9 |
| tags on debian:bookworm (tags × units) | 18 | 2 | 39.2 | 39.2 | 180.4 | 585.7 | 585.7 | 180.4 |
| per unit, median across its tags (bookworm-slim) | 9 | – | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | – |
| per unit, median across its tags (bookworm) | 9 | – | 39.2 | 39.2 | 180.4 | 585.7 | 585.7 | – |
| node:22/24-bookworm-slim (each) | 9 | 1 | 39.2 | 39.2 | 353.9 | 585.7 | 585.7 | 353.9 |
| php 8.2/8.3/8.4 cli, fpm, apache, 8.5 cli (each) | 9 | 1 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | 202.4 |

Secondary units (fix in a package the tag adds), median: php 169.1–179.9, node:22/24-bookworm 213.7.

So a Debian security fix in the base image's packages reached the official tags in a median of about 200 hours (8 days), at most 585.7 hours (24 days), over **9 fixes and 6 independent rebuilds**. The sample is small. Exposure in the project then adds Ludion's part (LDG), which is not built.

## Rebuild intervals (hours between consecutive new Image IDs, 2025-11-01 to the data end)

| image | new Image IDs | min | median | p90 | max | intervals < 72 h |
|---|---|---|---|---|---|---|
| debian:bookworm-slim | 21 | 168 | 432 | 568 | 672 | 0/20 |
| debian:bookworm | 21 | 168 | 432 | 568 | 672 | 0/20 |
| buildpack-deps:bookworm | 21 | 167.9 | 432 | 567.8 | 599.9 | 0/20 |
| node:22-bookworm-slim | 30 | 72 | 264.1 | 504 | 575.9 | 0/29 |
| node:24-bookworm-slim | 36 | 71.9 | 240 | 503.9 | 504 | 1/35 |
| php:8.2-cli-bookworm | 27 | 70.6 | 335.9 | 567.4 | 672.1 | 2/26 |
| php:8.3-cli-bookworm | 29 | 70.6 | 264 | 567.4 | 672.1 | 2/28 |
| php:8.4-cli-bookworm | 31 | 70.6 | 264 | 433 | 672.1 | 3/30 |
| php:8.4-fpm-bookworm | 33 | 70.6 | 240.7 | 433 | 672.1 | 3/32 |
| php:8.4-apache-bookworm | 31 | 70.6 | 264 | 433 | 672.1 | 3/30 |
| php:8.5-cli-bookworm | 29 | 70.6 | 263.3 | 433.3 | 672.1 | 3/28 |
| node:22-bookworm | 31 | 72 | 264 | 504 | 575.9 | 0/30 |
| node:24-bookworm | 34 | 71.9 | 240 | 503.9 | 504 | 1/33 |

No interval was under 24 h. The debian base images got a new Image ID 21 times, of which 9 changed the package listing (median 504 h between those). These are intervals between repo-info commits, so an interval of about 72 h can be two scans three days apart of images pushed less than 72 h apart, or more.

**For LDG's wait (not decided here):** with a 72 h wait counted from a tag's newest digest, 0 to 3 of each tag's 20–35 intervals were shorter than the wait, so a rebuild would rarely restart it. This is from repo-info commit times, whose resolution is about a day, and the forward record (decision section 8) would measure it to the hour.

## What is missing or 不明

- The scan interval of repo-info: 不明 (commits are made only on a change). Each file's commits come at a few fixed hours of the day (results.md, last section).
- The push time of any image: not in these sources.
- arm64 and other architectures, Alpine, trixie, point-release fixes: not measured (decision sections 2, 6, 8).
- How severe each fix was: not told apart (tzdata updates are in the security archive and count as fixes: 3 of the 10 units).

## Changes after the first run

1. `snapshot.mjs`: snapshot answers 404 to `allfiles` for 7 versions with no binary indexed (libpng1.6 1.6.39-2+deb12u2 and six systemd 252.x-1~deb12u1). The script then reads `srcfiles` (the definition's `.dsc` fallback). All 7 turned out not to be in debian-security. The first run's output is kept as raw/fixes-run1.tsv.
2. `analyze.mjs`: two versions end in `~deb11u1` (ca-certificates 20230311+deb12u1~deb11u1 and 20250419~deb12u1~deb11u1, bullseye's copies). They contain `deb12u` but are not uploads for bookworm (definition section 3), so they are left out as `other-release-upload`. In the first output they made 8 secondary units (one per php and node full tag). The base-image units did not change.
3. `analyze.mjs` prints stage 1's lower bound (`Created` − start), which section 4 records, and the fixes the base already had at the start.
