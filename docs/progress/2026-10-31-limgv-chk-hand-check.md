# LIMGV-CHK: the hand check of #239 through both jobs (2026-10-31)

Lane LIMGV-CHK (brain 6542129458, item 2), on PR #239's branch lane/limgv-2. main d200350 (#240) was merged in first (991d209, no conflict); build, typecheck and every test then passed in Docker: `Test Files  40 passed (40)`, `Tests  1380 passed | 25 skipped (1405)` (docs/bench/2026-10-31-limgv/logs/full-3.log).

The procedure and its inputs were committed before the run (581b464, docs/bench/2026-10-31-limgv/README.md). The run, 2026-10-31 13:54:28Z to 13:55:59Z, in Docker (ludion-la-runner, `--memory 4g`, network on), ran both jobs of the scheduled workflow twice per case, against the real nodejs.org, php.net, Docker Hub and Docker. GitHub's API was a stand-in on 127.0.0.1; no PR was opened on GitHub.

- A move to the line's newest release with no newer security release (FROM node:24.22.1-alpine → 24.22.2, wait_until 2026-10-31T00:00:00.000Z) went through `patch`, `pack` and `open` to one PR; run 2 found it (`open_pr_exists #1`). **Passes.**
- That PR's title and body have no "security" (0 matches). **Passes.** The commit's paragraph says `no newer security release`, as decision 8 gives it.
- A tag Docker Hub does not have (FROM node:22.22.0-alpine3.22; node:22.23.4-alpine3.22 missing) stopped `patch` with exit 2 and the reason `Docker Hub has no node:22.23.4-alpine3.22, ...`; nothing was packed, pushed or opened. **Passes.**

The examples as they are (node 22.22.0 → 22.23.4, php 8.4.26 → 8.4.27) each opened one PR in run 1 and none in run 2.

Raw output: docs/bench/2026-10-31-limgv/logs/e2e.log and logs/e2e-<case>-github.json. Not done: a run on GitHub.
