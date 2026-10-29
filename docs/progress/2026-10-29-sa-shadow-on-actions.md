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
- **Checked.** 14 new tests and tools/shadow's 35 pass in Docker; typecheck exit 0. The dry run of the workflow's own shell steps against a local repository did:
  - a seed, and a second seed refused;
  - two chained runs;
  - four refusals by the writer: a moved branch, another run's id, a `.github` path, a symbolic link.
- **Still to come.** The first real runs on GitHub, after the seed, are the first check of the checkout options, the artifact round trip and the schedule. Condition (b) has no result: the replay is not built.
