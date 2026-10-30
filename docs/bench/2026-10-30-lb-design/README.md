# LB — Ludion runs by itself and opens one PR per fix (design, 2026-10-30)

docs/status.md, "Missing before complete", items 1 (runs without being asked) and 2 (delivers each fix as a PR). Stage 1: this design and the smallest form that works. Start: main fcbff49. Branch `lane/lb-scheduled-pr`.

Today Ludion does nothing unless someone types `ludion patch`. `patch --apply` already validates each fix on its own and commits it on its own branch (LA, #204), and nothing pushes the branch or opens a PR. This stage adds both, as a workflow in the user's repository.

## Shape: two more modes of the root action

The workflow lives in the user's repository and uses this repository's root action (`action.yml`), pinned by a release commit's full SHA, with two new modes:

- `mode: patch`, the validation job;
- `mode: pull-request`, the PR job.

Why modes of `action.yml` rather than a second action:

- **One pin, one bundle.** CLAUDE.md wants workflows written for users to pin actions by commit SHA and to ship the CLI inside the action. `action.yml` already checks that the pinned commit carries the bundled CLI (`packages/cli/dist/cli.js`) and stops otherwise. A second action would need its own copy of that check and a second pin that could drift from the first.
- **Same split as today.** `action.yml` already splits a read-only job (`judge`) from a job that writes (`comment`) and checks what crosses between them as untrusted data. The new pair follows the same pattern, and the same review of `action/` covers both.
- **Cost.** The action's name and description now cover more than the judge. `action.yml` and `action/` are protected only against deletion (docs/protected-paths.md), so adding modes is an ordinary PR.

The logic is TypeScript in the CLI (`packages/cli/src/security/deliver.ts`, `ludion deliver pack` and `ludion deliver open`), not shell, so that it is tested with vitest like the rest of the CLI and reuses branch.ts's Git rules. The action's shell only checks the event and passes paths.

The workflow file a user adds is `action/patch-workflow.yml` (a template; the action's own tests check its permissions).

## Two jobs (CLAUDE.md, "Ludion must not become the attack path")

"A job that runs candidate code has no write permission and no secrets; a job that writes runs no dependency code."

### Validation job (`mode: patch`)

- **Permissions:** `contents: read` only. No secret is passed, and the action gives this mode no token: none of its steps names `github.token`.
- **Checkout:** the action checks out the run's commit (`github.sha`) itself, with `persist-credentials: false`, so no credential is left in `.git/config`.
- **Run:** `ludion patch --apply --json` in the project folder (input `dir`). Candidate code runs only inside packages/sandbox's Docker (no network, read-only root, non-root user). On the runner itself only Ludion's bundled CLI and Git run. Each fix that passes becomes one commit on the checked-out commit, on its own branch (`ludion/<ecosystem>/<package>-<version>`, `ludion/php/<version>`), as `--apply` does today.
- **Result:** `ludion deliver pack` writes the artifact `ludion-fixes`:
  - `receipt.json`, the run's receipt;
  - `fixes.bundle`, a Git bundle holding the applied fixes' branches and nothing else, with the run's commit as its only prerequisite.
- **Failures:** a fix that fails is in the receipt with its reason, and the job fails after the artifact is uploaded, so a failed or partial run shows red. The PR job still runs for the fixes that passed. A run that finds nothing to fix uploads an artifact with the receipt `null` and no bundle.

### PR job (`mode: pull-request`)

- **Permissions:** `contents: write` and `pull-requests: write`. `needs:` the validation job, same workflow run, so `github.sha` is the same commit.
- **Runs no dependency code.** It checks out the same commit (`persist-credentials: false`, depth 1), downloads the artifact, and runs only Ludion's bundled CLI and Git plumbing. Nothing from the project or its dependencies is installed or run.
- **The artifact is untrusted data.** A candidate that escaped the sandbox could have written it. Before anything is pushed, `ludion deliver open` checks, and refuses the whole artifact on any failure:
  - the receipt's size (at most 8 MiB) and shape, field by field; every name, version, advisory ID, hash and time it uses must match a strict pattern, so nothing in it can become Markdown or a mention in the PR;
  - the bundle's size (at most 64 MiB) and its heads: exactly one branch per fix the receipt says was `applied`, no other ref;
  - each branch's name, recomputed from the receipt's package and versions, and its commit, equal to the receipt's;
  - the commit's only parent is the commit this run checked out (the validated base, taken from the run, not from the artifact);
  - the commit's subject, recomputed from the receipt, its author and committer (Ludion's fixed identity), and its message naming the receipt's ID;
  - the files it changes: exactly the receipt's files for that fix, each one a file the plan may change (for npm `package.json` and `package-lock.json`, for Composer `composer.json` and `composer.lock`, for Maven `pom.xml`, for PHP the Dockerfile named by `ludion.security.json` at the base commit), each already in the base commit with the same mode, nothing under `.github/`, and each file's new bytes hashing to the receipt's `after_hash`.
- **Then, one fix at a time:**
  1. Is there already a PR for this fix? The fix's branch name names it (package and fixed version). An open PR from that branch: not opened again. A closed one, merged or not: not opened again either, and said in the job summary (someone closed it on purpose, or merged it).
  2. Does the branch exist on GitHub? At the same commit: no push. At another commit: not changed (no force push, ever), and the fix is left out with that reason.
  3. Push the commit to the new branch, never forced: `git push` of `<commit>:refs/heads/<branch>` to the repository's own HTTPS URL, with the job's token passed to Git through its environment, not written to `.git/config`.
  4. Open one PR to the default branch. Title: the commit's subject. Body: built from the checked receipt fields only: the package and versions, the advisories, the base commit, that the project's own tests passed on the base and on this change alone in Docker, the npm judge's verdict when there is one, the exposure-time timestamps (`fix_published_at` with its source, `found_at`, `applied_at`), and what was not checked.
- A fix that cannot be delivered stops no other fix.

## Trigger

`schedule` and `workflow_dispatch`, on the default branch only (both modes refuse any other event and any other ref).

- **The schedule can be hours late or not come.** In Ludion-ai/ludion-shadow, GitHub's hourly schedule did not fire once between 12:17Z and 17:17Z on 2026-10-29 (commit ec61bf9 there), and runs had to be started by hand until each run started the next one. GitHub's documentation says scheduled runs "can be delayed during periods of high loads" and, in a public repository, are disabled after 60 days without repository activity.
- **What this does to exposure time.** A late run adds its delay to the time from a published fix to its PR. The wait table's shortest wait is 12 hours, so a delay of a few hours is not hidden by it. The template runs every 6 hours at minute 23 (away from the top of the hour), so one missed run costs 6 hours, not a day. Each receipt's `found_at` is the run's own lookup, so a late run shows as a later `found_at`, not as a hidden gap.
- **Not chained.** The shadow's fix (each run dispatches the next) is not copied: a validation run builds and tests in Docker and can take many minutes, and a chain that fails stops silently. Whether to add it is for later, with measurements.
- `concurrency: ludion-patch`, not cancelled in progress, so two runs never push the same branch at once.

## A fix that already has a PR (gate 4)

"One fix per commit or PR." A fix is identified by its branch name: the ecosystem, the package and the fixed version (and the project's folder in its repository). If a PR from that branch is open, Ludion opens no second one, and does not move the branch to a newer base (no force push). When the default branch moves on and the open PR's lockfile conflicts, the PR stays as it is; rebuilding it is not built. A later fix of the same package at a newer version has another branch name, so it gets its own PR while the older one is still open; the older PR is not closed or marked as replaced (not built).

Each scheduled run validates every fix again, including ones whose PR is open: the validation job has no branches but the checked-out commit, so `patch`'s "branch exists, skipped" does not apply. That costs runner minutes, not correctness, since the PR job does not open a second PR.

## What is not built (matches docs/status.md)

- **Automatic merge.** Nothing merges a PR. Automatic merge needs (a) and (b) (CLAUDE.md, Product), and neither is met.
- **The exposure-time end.** When a fix reaches the project's configuration is the merge, and nothing records it. The PR shows `fix_published_at`, `found_at` and `applied_at` only. `found_at` is still the run's own lookup, not the first run that saw the fix.
- **A project apply setting.** Adding the workflow is the only switch.
- **Gates beyond today's.** The PRs carry what `patch` checks today, no more. The npm judge's gates 1, 2 and 4 and its waits apply to npm fixes only; Composer, Maven and PHP fixes do not go through them; gate 1's OS/SAPI/configuration matching, gate 2's code inspection, gate 3's load check and the re-query when a wait ends are not built anywhere. The PR body says so and does not call the fix gated, waited or "passed the four gates".
- **CI on the PR.** GitHub starts no workflow for a PR or push made with the job's own token (`GITHUB_TOKEN`), so the project's CI does not run on Ludion's PRs by itself. Someone must start it (close and reopen the PR, or push), or the workflow must use a GitHub App's token, which needs an app and a secret. Not built.
- **Repository setting.** `GITHUB_TOKEN` can open PRs only when the repository allows it ("Allow GitHub Actions to create and approve pull requests"). Ludion does not change the setting; the PR job fails with GitHub's answer when it is off.
- **Superseded and stale PRs.** Closing a PR whose fix a newer one replaces, or rebuilding one whose base moved, is not built.
- **Not run on GitHub.** This stage runs both jobs' commands locally in Docker (below). Nothing has run on GitHub, and nothing is placed in any user repository or in ludion-sandbox. In particular, whether GitHub accepts the push and the PR exactly as the local stand-in did is not known until it runs there.
- **Release.** None (CLAUDE.md, Goal). The template pins a placeholder SHA, because no release commit exists.

## Checks of this stage

- vitest (`packages/cli/test/deliver.test.ts`, `packages/cli/test/action.test.ts`): the permissions in the template and in each mode's steps; the artifact checks (a parent other than the base, a file outside the plan, an extra branch, a commit other than the receipt's, a changed mode, a second commit, a receipt that does not parse); and that no fix gets a second PR.
- `scripts/e2e.sh` runs both jobs' commands on copies of examples/*-security in Docker: the validation job's `patch --apply` and `deliver pack` in the project's repository, then the PR job's `deliver open` in a fresh clone of the base, against a local bare repository as GitHub's Git and a stand-in for GitHub's API, twice (the second run must open nothing). Results are in docs/progress/2026-10-30-lb-scheduled-pr.md.
