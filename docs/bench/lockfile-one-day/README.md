# LLOCK — which lockfile public npm projects keep at their root, one day

Experiment, read-only. Definition: docs/decisions/2026-11-02-lockfile-one-day-definition.md, committed and pushed (64e56be1c65538d0762a839ba43c9354de66dab2) before the first request about a repository's files. Result: docs/progress/2026-11-02-llock-lockfile-one-day.md and [counts.md](counts.md), printed by `scripts/analyze.mjs` and copied unchanged.

**The day is 2026-10-25, not the brief's 2026-11-01.** All 24 files of 2026-11-01 hold 0 PushEvents; the definition's section 1 gives the rule. [archive-scan.jsonl](archive-scan.jsonl) has the counts.

## Files

| File | What it is |
|---|---|
| [archive-scan.jsonl](archive-scan.jsonl) | 99 GH Archive hours: size and events per type, from `scripts/probe-types.mjs` |
| [boundary-evidence.json](boundary-evidence.json) | The ForkEvent ids of 2025-11-01 hour 00, from `scripts/boundary.mjs`, copied by hand from its output |
| [population-summary.json](population-summary.json) | The population's counts, what was left out, and each of the 24 hours |
| [screen.csv](screen.csv) | Every repository walked (4,408): its stratum, drawn position, id, name, package.json's HEAD status, and whether it is in the sample |
| [sample.csv](sample.csv) | The 1,000: each file's HEAD status, and yarn.lock's format |
| [counts.md](counts.md), [counts.json](counts.json) | The counts, intervals and weights |

The hour files were read as streams and not kept. The full drawn order (365,374 repositories) and the journal of answers stayed in the Docker volume, and the volume was removed at the end. The two CSV files keep each answer's status, and the commands below make the order again.

## What was run, and where

Everything ran in containers of `node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413` as uid 1000, with `--memory 1g`, no credentials, no socket and no host environment, with `scripts/` mounted read-only and writing only to the named volume. Results reached this folder through `cat` from the volume. Nothing on the host ran node, npm or python, and nothing was cloned.

1. **The population** (`scripts/population.mjs`): about one minute. Memory peak 523,628,544 bytes.
2. **The requests** (`scripts/measure.mjs`): 2026-11-02T09:29:13Z to 09:52:43Z. 9,408 HEADs (4,408 for package.json, 5,000 for the five files of the 1,000) and 50 ranged GETs. 0 retried, 0 with a 429, 0 with a 5xx, 0 failed, 0 unknown. Memory peak 167,702,528 bytes.
3. **The counts** (`scripts/analyze.mjs`), with `--network none`. Memory peak 205,971,456 bytes.

To run again (Git Bash, `MSYS_NO_PATHCONV=1`), with `B` this folder and `IMG` the image above:

```sh
docker volume create ludion-llock-w
docker run --rm -v ludion-llock-w:/v alpine@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a sh -c 'mkdir -p /v/pop /v/out /v/res && chown -R 1000:1000 /v'
docker run --rm --memory 1g --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges -v ludion-llock-w:/v -v "$B/scripts:/s:ro" "$IMG" node --max-old-space-size=700 /s/population.mjs 2026-10-25 1087451773 llock-2026-11-02 /v/pop /v/out/population-summary.json
docker run --rm --memory 1g --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges -v ludion-llock-w:/v -v "$B/scripts:/s:ro" "$IMG" node --max-old-space-size=700 /s/measure.mjs /v/pop /v/out/journal.jsonl
docker run --rm --memory 1g --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges -v ludion-llock-w:/v -v "$B/scripts:/s:ro" "$IMG" node --max-old-space-size=700 /s/analyze.mjs /v/pop /v/out/journal.jsonl /v/out/population-summary.json /v/res
```

The population and the draw come out the same as long as GH Archive's files do. The answers are as of the run.
