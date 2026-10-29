# 2026-10-29 (SA) — The shadow's recorder on a scheduled GitHub Actions workflow: built, not started

The owner chose scheduled GitHub Actions as the shadow's production place (2026-10-29 09:30 JST). The design is docs/decisions/2026-10-29-shadow-on-actions.md, and the estimate and dry run are docs/bench/2026-10-29-shadow-actions/.
- **Built.**
  - `.github/workflows/shadow.yml`: hourly. A read-only recording job runs the PC's pinned recorder in the PC's image for 50 minutes. A writing job that runs no Node checks the result and commits it to the branch `shadow-data`.
  - The driver `.github/shadow/record.ts`.
  - The seed script that moves the PC's data to that branch.
- **Not started.**
  - The workflow is a protected path: the owner merges it.
  - The branch does not exist; the owner seeds it after stopping the PC's container. Until then every run fails at its checkout.
  - The PC keeps recording.
- **Estimate.**
  - **Storage.** The branch's files at 42 days are about 2.00 GB central and 2.96 GB at the upper bound, uncompressed, against a limit of 3.8 GB. On disk that is about 1.2 to 1.5 GB at most, with git's history.
  - **Cost.** About 36,700 runner minutes a month, free for a public repository on standard runners. No secret is used.
  - **Not known.** Docker Hub's limit on hosted runners, npm's rate limits, the schedule's delays, and artifact storage billing for public repositories.
- **Review.** #197's first fresh-context review asked for changes; all eight findings were fixed:
  - the seed script now works with a remote name and without jq, and was run that way on this PC;
  - the size count lists `runs/` alone, so GitHub's listing limits are not reached;
  - an unchanged `state.json` no longer drops an hour's lines;
  - a branch without the PC's state is refused;
  - the workflow's scripts have behaviour tests;
  - the estimate no longer calls estimates bounds;
  - the measurement commands are committed;
  - an empty size argument is refused.
- **Checked.**
  - **Tests.** 27 tests on the workflow and driver, 13 of which run the workflow's own scripts against a local repository, plus tools/shadow's 35, pass in Docker; typecheck exit 0. Four mutations of the workflow's checks each make tests fail.
  - **Dry run before the fixes.** A seed, a second seed refused, two chained runs, and four refusals by the writer: a moved branch, another run's id, a `.github` path, a symbolic link.
  - **Dry run after the fixes.** Claude Code stopped it for low memory during run 2. Before that it did the seed, the new branch check and run 1.
  - **The seed script on this PC.** 783 files pushed byte for byte to a local repository, a second seed refused, and a 60 MB day file cut and rejoined.
- **Still to come.** The first real runs on GitHub, after the seed, are the first check of the checkout options, the artifact round trip and the schedule. Condition (b) has no result: the replay is not built.
