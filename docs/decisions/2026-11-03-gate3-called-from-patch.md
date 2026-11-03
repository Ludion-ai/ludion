# 2026-11-03 — `ludion patch` calls gate 3's comparison on each npm fix (LWIRE)

Committed before any of it was implemented or run. It writes down how npm's `ludion patch` uses `judgeGate3` (packages/cli/src/security/gate3.ts), which nothing has called until now: the third item of C12 in docs/decisions/2026-11-02-definition-of-complete-final.md. No wait and no numeric criterion of a gate changes. Composer, Maven and the official images are not touched.

## Where it is called

For each npm fix, after the project's own test has passed on the baseline and on that fix's candidate, and before the check that the project did not change during validation, so before any receipt says `validated` and before any branch is made. Old is the project's package.json and package-lock.json, and new is the candidate's. The project itself is the folder given, not the run's private copy of it, because that copy leaves out every `.env.*` and gate 3 reads the keys of `.env.example`. The project's own test still runs first and still decides what it decided: a project whose test does not pass on old stops as it does today, and never reaches gate 3.

## What each verdict does

| Verdict | What `patch` does |
|---|---|
| `not_broken` | The fix goes on |
| `broken` | The fix stops, with the reasons. Other fixes of the run go on |
| `undecidable`, with any reason but `not_covered` | The fix stops, with the reasons. Other fixes of the run go on |
| `undecidable`, with `not_covered` as its only reason | The fix goes on as it does today, on the project's own test alone, and its receipt says that the comparison did not run |

The whole result, its limits included, goes in the fix's receipt as `gate3`, whatever the verdict. A verdict is not a statement that a fix passed the four gates.

**Why `undecidable` stops, though gate 3's definition says it falls to a PR.** The definition (docs/decisions/2026-11-02-gate-3-type-definition.md, its first table) and the plan (「分母に入らないものは関門 3 が判定不能なので、pr に落とす」) send it to a PR. CLAUDE.md says "anything that cannot be judged stops", and the plan's copy says on its third line that CLAUDE.md wins where the two differ until a protected PR lands. This change does not touch CLAUDE.md and does not decide that difference. So a fix that gate 3 cannot judge gets no branch and no PR until a later change, after that protected PR, sends it to a PR.

**Why `not_covered` does not stop.** The first form covers only npm projects with `next` in their package.json. Read as any other `undecidable`, it would stop every fix of every other npm project, and those fixes reach a PR today. That is a scope change, and CLAUDE.md's Scope rule asks for the owner's OK on one sentence first: "Ludion no longer fixes an npm project that does not build with Next.js." No such OK has been given, so this change does not do it. Such a project is where it was before this change: docs/status.md already lists it as missing from gate 3's new type, and nothing may describe its fix as having passed the comparison. `not_covered` is the verdict only when every reason is that one.

## The PR job

The job that opens PRs runs no project code, so it cannot run gate 3 again, and reads the result from the receipt as it reads `candidate_passed`. It refuses an npm fix marked applied when the receipt has no gate 3 result, or one that should have stopped it. This is a check on the receipt's own consistency, not evidence: a forged receipt can say what it likes (the definition's Limits). The PR's text says, under "What was checked", either the verdict and its limit (GET pages only), or that the comparison did not run.

## What this does not show

The real path through Docker is for C4's VM or CI, since it needs Docker's socket (docs/mistakes/2026-11-03-gate3-ran-in-a-socket-container.md). This change is tested with Docker stood in for. Not run: `patch` through a real gate 3 run, on GitHub or anywhere else; the validation job's 120 minutes against gate 3's own limits (each box up to 20 minutes, with old twice and new once or twice, for each fix); a GitHub-hosted runner's disk against the browser image of several GB.
