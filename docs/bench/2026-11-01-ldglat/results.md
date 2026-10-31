# LDGLAT results (printed by scripts/analyze.mjs)

Window start 2025-11-01T00:00:00Z, data end 2026-10-31T14:59:06Z. Hours. Percentiles nearest-rank.

Candidates 470; left out: {"not-in-debian-security":326,"other-release-upload":2,"no-binary-and-not-in-debian-security":8,"start-before-window":65,"start-at-or-after-data-end":0}; fixes in window: 69 ({"bin":68,"src":1}).

Per fix and base image, what the base listed at the start:

- debian:bookworm-slim: {"not-listed-at-start":58,"reached":9,"already-at-start":1,"not-reached":1}
- debian:bookworm: {"not-listed-at-start":58,"reached":9,"already-at-start":1,"not-reached":1}

## Stage 1: fix → base image (per unit)

| | reached | not reached | min | p10 | median | p90 | max | median, not reached as largest |
|---|---|---|---|---|---|---|---|---|
| debian:bookworm-slim (units 10, {"reached":9,"not-reached":1}) | 9 | 1 | 63.7 | 63.7 | 336.7 | 568.4 | 568.4 | 336.7 |
| debian:bookworm-slim lower bound (Created − start) | 9 | 0 | 9.1 | 9.1 | 299.8 | 507.3 | 507.3 | – |
| debian:bookworm (units 10, {"reached":9,"not-reached":1}) | 9 | 1 | 63.7 | 63.7 | 336.7 | 568.4 | 568.4 | 336.7 |
| debian:bookworm lower bound (Created − start) | 9 | 0 | 9.1 | 9.1 | 299.8 | 507.3 | 507.3 | – |

Fixes the base already had at the start: debian:bookworm-slim libcap2 1:2.66-4+deb12u2 (start 2026-03-19T18:34:03Z, base had 1:2.66-4+deb12u2); debian:bookworm libcap2 1:2.66-4+deb12u2 (start 2026-03-19T18:34:03Z, base had 1:2.66-4+deb12u2)

Independent events (distinct base-image commits that ended units):

- debian:bookworm-slim: 6 commits; 2026-02-27T13:15:36Z (created 2026-02-23T00:00:00Z): 1; 2026-06-12T13:03:16Z (created 2026-06-10T00:00:00Z): 2; 2026-09-22T12:56:24Z (created 2026-09-18T00:00:00Z): 2; 2026-10-06T12:56:04Z (created 2026-10-05T00:00:00Z): 2; 2026-10-23T12:56:26Z (created 2026-10-20T21:32:55Z): 1; 2026-10-30T12:55:26Z (created 2026-10-27T00:00:00Z): 1
- debian:bookworm: 6 commits; 2026-02-27T13:15:36Z (created 2026-02-23T00:00:00Z): 1; 2026-06-12T13:03:16Z (created 2026-06-10T00:00:00Z): 2; 2026-09-22T12:56:24Z (created 2026-09-18T00:00:00Z): 2; 2026-10-06T12:56:04Z (created 2026-10-05T00:00:00Z): 2; 2026-10-23T12:56:26Z (created 2026-10-20T21:32:55Z): 1; 2026-10-30T12:55:26Z (created 2026-10-27T00:00:00Z): 1

Units whose ending listing's Created is before the start: {"debian:bookworm-slim":0,"debian:bookworm":0}. Binary at the start different from the one queried: 0.

## Stage 2: base image → official tag (per tag × unit)

| | reached | not reached | min | p10 | median | p90 | max | median, not reached as largest |
|---|---|---|---|---|---|---|---|---|
| debian:bookworm-slim (all tags) | 72 | 0 | -351.2 | -78.8 | -14.9 | 56.9 | 56.9 | – |
| debian:bookworm (all tags) | 18 | 0 | -390.8 | -390.8 | 17.2 | 17.3 | 17.3 | – |
| node:22-bookworm-slim | 9 | 0 | -78.8 | -78.8 | -54.3 | 17.3 | 17.3 | – |
| node:24-bookworm-slim | 9 | 0 | -78.8 | -78.8 | -54.3 | 17.3 | 17.3 | – |
| php:8.2-cli-bookworm | 9 | 0 | -351.2 | -351.2 | -14.9 | 56.9 | 56.9 | – |
| php:8.3-cli-bookworm | 9 | 0 | -351.2 | -351.2 | -14.9 | 56.9 | 56.9 | – |
| php:8.4-cli-bookworm | 9 | 0 | -351.2 | -351.2 | -14.9 | 56.9 | 56.9 | – |
| php:8.4-fpm-bookworm | 9 | 0 | -351.2 | -351.2 | -14.9 | 56.9 | 56.9 | – |
| php:8.4-apache-bookworm | 9 | 0 | -351.2 | -351.2 | -15.1 | 56.9 | 56.9 | – |
| php:8.5-cli-bookworm | 9 | 0 | -351.2 | -351.2 | -14.9 | 56.9 | 56.9 | – |
| node:22-bookworm | 9 | 0 | -390.8 | -390.8 | 17.2 | 17.3 | 17.3 | – |
| node:24-bookworm | 9 | 0 | -390.8 | -390.8 | 17.2 | 17.3 | 17.3 | – |

Negative stage 2 values (tag's commit before the base's): {"debian:bookworm-slim":52,"debian:bookworm":8}.

## Total: fix → official tag (per tag × unit)

| | reached | not reached | min | p10 | median | p90 | max | median, not reached as largest |
|---|---|---|---|---|---|---|---|---|
| debian:bookworm-slim (all tags) | 72 | 8 | 39.2 | 84.7 | 202.4 | 553.2 | 585.7 | 353.9 |
| debian:bookworm (all tags) | 18 | 2 | 39.2 | 39.2 | 180.4 | 585.7 | 585.7 | 180.4 |
| node:22-bookworm-slim | 9 | 1 | 39.2 | 39.2 | 353.9 | 585.7 | 585.7 | 353.9 |
| node:24-bookworm-slim | 9 | 1 | 39.2 | 39.2 | 353.9 | 585.7 | 585.7 | 353.9 |
| php:8.2-cli-bookworm | 9 | 1 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | 202.4 |
| php:8.3-cli-bookworm | 9 | 1 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | 202.4 |
| php:8.4-cli-bookworm | 9 | 1 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | 202.4 |
| php:8.4-fpm-bookworm | 9 | 1 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | 202.4 |
| php:8.4-apache-bookworm | 9 | 1 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | 202.4 |
| php:8.5-cli-bookworm | 9 | 1 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | 202.4 |
| node:22-bookworm | 9 | 1 | 39.2 | 39.2 | 180.4 | 585.7 | 585.7 | 180.4 |
| node:24-bookworm | 9 | 1 | 39.2 | 39.2 | 180.4 | 585.7 | 585.7 | 180.4 |

Tag outcomes: node:22-bookworm-slim {"reached":9,"not-reached":1}; node:24-bookworm-slim {"reached":9,"not-reached":1}; php:8.2-cli-bookworm {"reached":9,"not-reached":1}; php:8.3-cli-bookworm {"reached":9,"not-reached":1}; php:8.4-cli-bookworm {"reached":9,"not-reached":1}; php:8.4-fpm-bookworm {"reached":9,"not-reached":1}; php:8.4-apache-bookworm {"reached":9,"not-reached":1}; php:8.5-cli-bookworm {"reached":9,"not-reached":1}; node:22-bookworm {"reached":9,"not-reached":1}; node:24-bookworm {"reached":9,"not-reached":1}

## Per unit, the median across its tags, then over units

| | reached | not reached | min | p10 | median | p90 | max | median, not reached as largest |
|---|---|---|---|---|---|---|---|---|
| debian:bookworm-slim stage 2 | 9 | 0 | -351.2 | -351.2 | -14.9 | 56.9 | 56.9 | – |
| debian:bookworm-slim total (units with a tag not reached: 1) | 9 | 0 | 84.7 | 84.7 | 202.4 | 553.2 | 553.2 | – |
| debian:bookworm stage 2 | 9 | 0 | -390.8 | -390.8 | 17.2 | 17.3 | 17.3 | – |
| debian:bookworm total (units with a tag not reached: 1) | 9 | 0 | 39.2 | 39.2 | 180.4 | 585.7 | 585.7 | – |

## Secondary units: package in the tag, not in its base (fix → tag)

| | reached | not reached | min | p10 | median | p90 | max | median, not reached as largest |
|---|---|---|---|---|---|---|---|---|
| php:8.2-cli-bookworm (units 24, {"reached":23,"not-reached":1}) | 23 | 1 | 48.1 | 56.1 | 179.9 | 421.7 | 600.5 | 179.9 |
| php:8.3-cli-bookworm (units 24, {"reached":23,"not-reached":1}) | 23 | 1 | 48.1 | 56.1 | 169.1 | 421.7 | 600.5 | 169.1 |
| php:8.4-cli-bookworm (units 24, {"reached":23,"not-reached":1}) | 23 | 1 | 48.1 | 56.1 | 179.3 | 408.3 | 600.5 | 179.3 |
| php:8.4-fpm-bookworm (units 24, {"reached":23,"not-reached":1}) | 23 | 1 | 48.1 | 56.1 | 179.3 | 408.3 | 600.5 | 179.3 |
| php:8.4-apache-bookworm (units 30, {"reached":29,"not-reached":1}) | 29 | 1 | 31 | 48.2 | 179.9 | 421.7 | 600.5 | 179.9 |
| php:8.5-cli-bookworm (units 23, {"reached":22,"not-reached":1}) | 22 | 1 | 48.1 | 56.1 | 179.3 | 408.3 | 600.5 | 179.9 |
| node:22-bookworm (units 55, {"reached":54,"not-reached":1}) | 54 | 1 | 8.6 | 80.6 | 213.7 | 401.6 | 512.8 | 228.3 |
| node:24-bookworm (units 55, {"reached":54,"not-reached":1}) | 54 | 1 | 8.6 | 80.6 | 213.7 | 401.6 | 512.8 | 228.3 |

## Rebuild intervals (hours between consecutive changes in the window)

| file | commits | no Image ID change | Image ID changes | min | p10 | median | p90 | max | <24h | <72h | listing changes | median | <24h | <72h |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| debian:bookworm-slim | 24 | 3 | 21 | 168 | 240 | 432 | 568 | 672 | 0/20 | 0/20 | 9 | 504 | 0/8 | 0/8 |
| debian:bookworm | 24 | 3 | 21 | 168 | 240 | 432 | 568 | 672 | 0/20 | 0/20 | 9 | 504 | 0/8 | 0/8 |
| buildpack-deps:bookworm | 32 | 11 | 21 | 167.9 | 239.8 | 432 | 567.8 | 599.9 | 0/20 | 0/20 | 19 | 432 | 0/18 | 0/18 |
| node:22-bookworm-slim | 35 | 5 | 30 | 72 | 96 | 264.1 | 504 | 575.9 | 0/29 | 0/29 | 9 | 575.9 | 0/8 | 0/8 |
| node:24-bookworm-slim | 40 | 4 | 36 | 71.9 | 72 | 240 | 503.9 | 504 | 0/35 | 1/35 | 9 | 575.9 | 0/8 | 0/8 |
| php:8.2-cli-bookworm | 33 | 6 | 27 | 70.6 | 95.9 | 335.9 | 567.4 | 672.1 | 0/26 | 2/26 | 18 | 433.3 | 0/17 | 1/17 |
| php:8.3-cli-bookworm | 35 | 6 | 29 | 70.6 | 95.9 | 264 | 567.4 | 672.1 | 0/28 | 2/28 | 19 | 336.2 | 0/18 | 1/18 |
| php:8.4-cli-bookworm | 37 | 6 | 31 | 70.6 | 71.9 | 264 | 433 | 672.1 | 0/30 | 3/30 | 20 | 407.7 | 0/19 | 1/19 |
| php:8.4-fpm-bookworm | 39 | 6 | 33 | 70.6 | 72 | 240.7 | 433 | 672.1 | 0/32 | 3/32 | 20 | 407.8 | 0/19 | 1/19 |
| php:8.4-apache-bookworm | 38 | 7 | 31 | 70.6 | 71.9 | 264 | 433 | 672.1 | 0/30 | 3/30 | 20 | 407.7 | 0/19 | 1/19 |
| php:8.5-cli-bookworm | 35 | 6 | 29 | 70.6 | 71.9 | 263.3 | 433.3 | 672.1 | 0/28 | 3/28 | 21 | 336 | 0/20 | 2/20 |
| node:22-bookworm | 43 | 12 | 31 | 72 | 72.1 | 264 | 504 | 575.9 | 0/30 | 0/30 | 19 | 432 | 0/18 | 0/18 |
| node:24-bookworm | 48 | 14 | 34 | 71.9 | 72 | 240 | 503.9 | 504 | 0/33 | 1/33 | 19 | 432 | 0/18 | 0/18 |

## Commit hours (UTC) of each file in the window

- debian:bookworm-slim: 12h 9, 13h 9, 21h 6
- debian:bookworm: 12h 9, 13h 9, 21h 6
- buildpack-deps:bookworm: 10h 19, 11h 6, 18h 1, 19h 6
- node:22-bookworm-slim: 06h 25, 07h 1, 13h 1, 14h 8
- node:24-bookworm-slim: 06h 28, 07h 1, 14h 11
- php:8.2-cli-bookworm: 05h 1, 06h 2, 07h 5, 17h 1, 21h 19, 22h 4, 23h 1
- php:8.3-cli-bookworm: 05h 1, 06h 4, 07h 5, 17h 1, 21h 18, 22h 4, 23h 2
- php:8.4-cli-bookworm: 05h 1, 06h 5, 07h 4, 17h 1, 21h 20, 22h 5, 23h 1
- php:8.4-fpm-bookworm: 05h 1, 06h 6, 07h 5, 17h 1, 21h 20, 22h 5, 23h 1
- php:8.4-apache-bookworm: 05h 1, 06h 5, 07h 4, 17h 1, 21h 21, 22h 5, 23h 1
- php:8.5-cli-bookworm: 05h 1, 06h 6, 07h 3, 17h 1, 21h 20, 22h 4, 23h 1
- node:22-bookworm: 06h 32, 07h 1, 13h 1, 14h 8, 21h 1
- node:24-bookworm: 06h 35, 07h 1, 14h 11, 21h 1
