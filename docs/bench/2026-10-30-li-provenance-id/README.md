# LI — provenance compared by the repository's immutable id (2026-10-30)

Decision: docs/decisions/2026-10-30-provenance-immutable-id.md (the first commit of this lane). Mistake record: docs/mistakes/2026-10-30-provenance-compared-by-name-only.md. Started from main 576e601.

## What changed

- `provenanceFrom` (npm-facts.ts) also reads GitHub's repository id and event: SLSA v1's `predicate.buildDefinition.internalParameters.github` (`repository_id`, `event_name`), and the v0.2 statements of npm 9's `predicate.invocation.environment` (`GITHUB_REPOSITORY_ID`, `GITHUB_EVENT_NAME`). Absent: null. Present but not digits (the id) or a lower-case name (the event), or GitHub parameters that are not an object: the read fails.
- time-cap.ts holds the two rules every place uses: `repositoryIds` (same, differ, one side only, none) and `eventProblem` (an event other than push, release or workflow_dispatch, or an id without an event).
- Gate 2 (judge.ts): ids that differ stop; an id on one side only stops; neither: an `info` finding says it was not compared by ID. The event of the version an update installs is checked, whether or not it has a predecessor.
- The same-release exception (time-cap.ts): the same id (or neither has one) and no event problem on either side; its entry has `by_id`, and its line says when it was not compared by ID.
- The next fix's publisher check (next-fix.ts): the same rules, the event on either side; the detail names each side's id and event and says when it was not compared by ID.
- Not changed: a name that differs with the same id still stops; the wait table and every gate's numbers.

## Checks (Docker, image ludion-l9-node24-git; nothing ran on the host)

`sh docs/bench/2026-10-30-li-provenance-id/scripts/run.sh test|full|mutate` from the worktree root. Logs in logs/.

The numbers are in docs/progress/2026-10-30-li-provenance-id.md, copied from the logs.
