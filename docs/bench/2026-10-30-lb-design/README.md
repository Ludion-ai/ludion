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

- **Permissions:** `contents: read` only. No secret is passed, and none of this mode's steps names `github.token`. The job refuses to start when it can request an OIDC token (`id-token: write`).
- **Checkout:** the action checks out the run's commit (`github.sha`) itself. actions/checkout fetches with the job's read-only token and, with `persist-credentials: false`, leaves no credential in `.git/config`, before any candidate is built.
- **Run:** `ludion patch --apply --json` in the project folder (input `dir`). Candidate code runs only inside packages/sandbox's Docker (no network, read-only root, non-root user). On the runner itself only Ludion's bundled CLI and Git run. Each fix that passes becomes one commit on the checked-out commit, on its own branch (`ludion/<ecosystem>/<package>-<version>`, `ludion/php/<version>`), as `--apply` does today.
- **Result:** `ludion deliver pack` writes the artifact `ludion-fixes`:
  - `receipt.json`, the run's receipt;
  - `fixes.bundle`, a Git bundle holding the applied fixes' branches and nothing else, with the run's commit as its only prerequisite.
- **Failures:** a fix that fails is in the receipt with its reason, and the job fails after the artifact is uploaded, so a failed or partial run shows red. The receipt is uploaded on every run that wrote one, also when no fix was applied, so the reasons stay with the run. The PR job runs only when at least one fix was applied. A run that finds nothing to fix uploads the receipt `null` and no bundle.
- **A waiting or stopped fix keeps the job red.** `patch` exits 2 for a fix that waits (the judge's wait table) as for one that fails, so the job fails every 6 hours, with GitHub's failure notice, until the wait ends or the fix is applied or dropped. examples/npm-security's lodash fix (4.18.0, deprecated, stopped by the judge) would keep it red indefinitely. Telling a wait from a failure in the job's result is not built.

### PR job (`mode: pull-request`)

- **Permissions:** `contents: write` and `pull-requests: write`. `needs:` the validation job, same workflow run, so `github.sha` is the same commit.
- **Runs no dependency code.** It checks out the same commit (`persist-credentials: false`, depth 1), downloads the artifact, and runs only Ludion's bundled CLI and Git plumbing. Nothing from the project or its dependencies is installed or run.
- **The artifact is untrusted data.** A candidate that escaped the sandbox could have written it. Before anything is pushed, `ludion deliver open` checks, and refuses the whole artifact on any failure:
  - the receipt's size (at most 8 MiB) and shape, field by field; every name, version, advisory ID, hash and time it uses must match a strict pattern, so nothing in it can become Markdown or a mention in the PR;
  - the bundle's size (at most 64 MiB) and its heads: exactly one branch per fix the receipt says was `applied`, no other ref;
  - each branch's name, recomputed from the receipt's package and versions, and its commit, equal to the receipt's;
  - the commit's only parent is the commit this run checked out (the validated base, taken from the run, not from the artifact);
  - its author and committer (Ludion's fixed identity), and its whole message, rebuilt from the receipt as `patch` writes it (so no `Closes #1` or trailer rides along);
  - the files it changes: exactly the receipt's files for that fix, each one a file the plan may change (for npm `package.json` and `package-lock.json`, for Composer `composer.json` and `composer.lock`, for Maven `pom.xml`, for PHP the Dockerfile named by `ludion.security.json` at the base commit), each already in the base commit with the same mode, nothing under `.github/`, and each file's new bytes hashing to the receipt's `after_hash`;
  - **what the files say** (the receipt's hashes come from the same artifact, so they prove nothing alone), from the base commit and the fix's commit, by Git:
    - the manifest (`package.json`, `composer.json`, `pom.xml`) is exactly what `changedManifest` (inventory.ts, as `patch` calls it) makes from the base's files for the receipt's changes, so a new install script, dependency, Maven plugin or looser range is refused;
    - the Dockerfile changes only its FROM image, to the official PHP image of a newer release of the same branch and flavor, pinned by digest;
    - composer.lock changes no top-level key but its content hash and package lists, moves only the planned package and to the fix's version, keeps every other package as at the base apart from descriptive metadata (`time`, `published-time`, `support`, `funding` and the like), removes none, and takes the planned and each new package from a pinned public archive (acquisition.ts's `publicArchiveUrl`), none of them a Composer plugin or installer;
    - package-lock.json: the judge runs again in the PR job (below).
- **Then, one fix at a time:**
  1. Is there already a PR for this fix? The fix's branch name names it (package and fixed version). An open PR from that branch: not opened again. A closed one, merged or not: not opened again either, and said in the job summary (someone closed it on purpose, or merged it).
  2. Does the branch exist on GitHub? At the same commit: no push. At another commit whose tree is this commit's and whose only parent is the same base (an earlier run pushed it and could not open the PR, for example while the repository did not let Actions open PRs): no push, and the PR is opened from it. At any other commit: not changed (no force push, ever), and the fix fails, saying to delete the branch.
  3. npm: the judge again (candidate-judge.ts) on package.json and package-lock.json at the base and at the fix's commit. Anything but `ready_except_build` (a stop, a wait, undecidable, a lookup that fails) fails that fix, and nothing is pushed. It sends and downloads what `patch` does (package names and versions to OSV and the npm registry; CISA's catalog and FIRST's EPSS list whole). This checks the lockfile's entries against the registry (gate 4's tarball and integrity, gate 2's provenance and install scripts) independently of the artifact.
  4. Push the commit to the new branch, never forced: `git push` of `<commit>:refs/heads/<branch>` (no `+`, no `--force`) to the repository's own HTTPS URL, with the job's token passed to Git through its environment (`GIT_CONFIG_*`), not in its arguments or `.git/config`.
  5. Open one PR to the default branch. Title: the commit's subject. Body: built from the checked receipt fields only: the package and versions, the advisories, the base commit, that the project's own tests passed on the base and on this change alone in Docker, what the PR job checked again, the npm judge's verdict, the exposure-time timestamps (`fix_published_at` with its source, `found_at`, `applied_at`), and what was not checked. If GitHub refuses the PR after the push, the fix fails, and the next run opens the PR from the pushed branch (step 2) while the default branch has not moved.
- A fix that cannot be delivered stops no other fix. A failed fix or a branch Ludion will not move fails the job.

### What these checks do not cover

- **Composer archives' contents and Maven's transitive graph.** The PR job checks where composer.lock takes each package from, not what the archive holds, and Maven has no lockfile: what the build resolves is what the validation job tested, not something the PR job can see again.
- **A sandbox escape in the validation job.** The candidate runs in Docker with no network and no forwarded environment, but if it escaped to the runner, it would be on a runner that holds the job's read-only token and the runner's own `ACTIONS_RUNTIME_TOKEN`, which can write Actions caches for the default branch that other workflows of the repository restore (cache poisoning). The template uses no cache, but the repository's other workflows may. The PR job's checks bound what such an escape can get into a PR; they do not bound the cache.
- **The bundle's objects are not fsck-ed when unpacked.** Every object the PR job acts on is read back and checked (the commit's headers and message, the tree's changed paths and modes against the base, each changed file's bytes), and GitHub checks objects it receives on push.

## Trigger

`schedule` and `workflow_dispatch`, on the default branch only (both modes refuse any other event and any other ref).

- **The schedule can be hours late or not come.** In Ludion-ai/ludion-shadow, GitHub's hourly schedule did not fire once between 12:17Z and 17:17Z on 2026-10-29 (commit ec61bf9 there), and runs had to be started by hand until each run started the next one. GitHub's documentation says scheduled runs "can be delayed during periods of high loads" and, in a public repository, are disabled after 60 days without repository activity.
- **What this does to exposure time.** A late run adds its delay to the time from a published fix to its PR. The wait table's shortest wait is 12 hours, so a delay of a few hours is not hidden by it. The template runs every 6 hours at minute 23 (away from the top of the hour), so one missed run costs 6 hours, not a day. Each receipt's `found_at` is the run's own lookup, so a late run shows as a later `found_at`, not as a hidden gap.
- **Not chained.** The shadow's fix (each run dispatches the next) is not copied: a validation run builds and tests in Docker and can take many minutes, and a chain that fails stops silently. Whether to add it is for later, with measurements.
- `concurrency: ludion-${{ github.workflow }}`, not cancelled in progress, so two runs of the workflow never push the same branch at once, and another workflow that copies the template does not share its queue.

## A fix that already has a PR (gate 4)

"One fix per commit or PR." A fix is identified by its branch name: the ecosystem, the package and the fixed version (and the project's folder in its repository). If a PR from that branch is open, Ludion opens no second one, and does not move the branch to a newer base (no force push). When the default branch moves on and the open PR's lockfile conflicts, the PR stays as it is; rebuilding it is not built. A later fix of the same package at a newer version has another branch name, so it gets its own PR while the older one is still open; the older PR is not closed or marked as replaced (not built).

Each scheduled run validates every fix again, including ones whose PR is open: the validation job has no branches but the checked-out commit, so `patch`'s "branch exists, skipped" does not apply. That costs runner minutes, not correctness, since the PR job does not open a second PR.

## What is not built (matches docs/status.md)

- **Automatic merge.** Nothing merges a PR. Automatic merge needs (a) and (b) (CLAUDE.md, Product), and neither is met.
- **The exposure-time end.** When a fix reaches the project's configuration is the merge, and nothing records it. The PR shows `fix_published_at`, `found_at` and `applied_at` only. `found_at` is still the run's own lookup, not the first run that saw the fix.
- **A project apply setting.** Adding the workflow is the only switch.
- **Gates beyond today's.** The PRs carry what `patch` checks today, no more. The npm judge's gates 1, 2 and 4 and its waits apply to npm fixes only; Composer, Maven and PHP fixes do not go through them; gate 1's OS/SAPI/configuration matching, gate 2's code inspection, gate 3's load check and the re-query when a wait ends are not built anywhere. The PR body says so and does not call the fix gated, waited or "passed the four gates".
- **CI on the PR.** GitHub starts no workflow for a PR or push made with the job's own token (`GITHUB_TOKEN`), so the project's CI does not run on Ludion's PRs by itself. Someone must start it (close and reopen the PR, or push), or the workflow must use a GitHub App's token, which needs an app and a secret. Not built.
- **Repository setting.** `GITHUB_TOKEN` can open PRs only when the repository allows it ("Allow GitHub Actions to create and approve pull requests", off by default). Ludion does not change the setting; the PR job pushes the branch, fails with GitHub's answer, and opens the PR from that branch on a later run once the setting is on, if the default branch has not moved; once it has moved, the fix fails until someone deletes the branch.
- **Superseded and stale PRs.** Closing a PR whose fix a newer one replaces, or rebuilding one whose base moved, is not built.
- **Not run on GitHub.** This stage runs both jobs' commands locally in Docker (below). Nothing has run on GitHub, and nothing is placed in any user repository or in ludion-sandbox. In particular, whether GitHub accepts the push and the PR exactly as the local stand-in did is not known until it runs there.
- **Release.** None (CLAUDE.md, Goal). The template pins a placeholder SHA, because no release commit exists.

## Checks of this stage

All ran in Docker (`scripts/run.sh test|mutate|e2e`); nothing of the project ran on the host. Volumes: ludion-lb-w (tests, e2e build), ludion-lb-m (mutations), ludion-lb-e (e2e repositories).

- **Tests** (`scripts/test.sh`, image ludion-l9-node24-git, git 2.39.5): `tsc -p tsconfig.json` exits 0; `vitest run --project node packages/cli/test`: 20 files, 781 passed, 19 skipped (`logs/test.log`), then 36 of 36 in the two new files after the last test was added. New: `packages/cli/test/deliver.test.ts` (packing; one PR per fix and none on the next run; a closed PR; a branch at another commit, on another base and on the same base; a PR GitHub refused, then opened from the pushed branch on the next run; a branch already at the fix's commit; a failed push; the judge run again, refusing or failing; an executable file's mode kept; a run off the default branch; the push's arguments and environment; and the refusals: a parent other than the base, two commits, a file outside the plan, a file the plan may not change, a new file, a changed mode, an extra branch, another commit, a missing or unexpected bundle, other bytes, another subject, author or message, a package.json with more in it, another branch name, an npm fix without `ready_except_build`, failed tests, another base, Markdown in a field, a receipt that is not JSON, an oversized bundle, a checkout at another commit; PHP's policy and Dockerfile, Maven's pom.xml and Composer's composer.json and composer.lock content) and `packages/cli/test/action-patch.test.ts` (6 tests: the template's triggers, permissions and pins; each mode's steps and where the token is; start.sh's refusals). Checkouts in the tests are depth 1 with HEAD detached, as actions/checkout makes them.
- **Mutations** (`scripts/mutate.mjs`, 41 mutations): at the head reviewed first (d714435), 26 of 26 caught. After the review's changes, the run was stopped by Claude Code after 27 mutations because the machine was low on memory, and was not started again (`logs/mutate.log`): 26 caught, and one not caught ("a branch with another change reused": no test had a branch on the same base with another tree). A test for it was added (the third case of "does not open a fix again whose PR was closed, nor move a branch that holds another change"); the remaining 14 mutations and that one were not run again.
- **Both jobs on the examples** (`scripts/e2e.sh npm-two php composer maven npm`, image ludion-la-runner; `logs/e2e.log`): for each case, two runs of the workflow, each a validation job (a depth-1 clone of the bare origin with HEAD detached, `patch --apply --json`, `deliver pack`) and a PR job (another such clone, `deliver open` against `scripts/github.mjs`, a stand-in for GitHub's API that reads branches and commits from the origin; for npm the judge runs again against the real registry, OSV, KEV and EPSS). Results in docs/progress/2026-10-30-lb-scheduled-pr.md.
- **Found by the e2e runs.**
  - First run (`logs/e2e-first.log`): the PR job refused every real fix ("adds, removes or changes the mode of Dockerfile"): the mode check accepted only `1006xx`, and the examples' files are committed as 100755, as copied from a Windows folder. It failed closed (nothing pushed), but no fix could be delivered. The check now accepts 100644 and 100755 when the base has the same mode; a test with an executable lockfile and a mutation (100755 refused) keep it.
  - After the content checks (`logs/e2e-composer-refused.log`): the Composer fix was refused because composer.lock's `plugin-api-version` went from 2.9.0 to 2.11.0 (the tool image's newer Composer wrote it). That key is now allowed to change, with a test.
  - `logs/e2e-d714435.log` is the run at the head the first review read.
- **Every node-project test** at d714435 (`vitest run --project node`, with a throwaway Git repository in /w because apps/site/test/knowledge.test.ts asks Git for the top folder): 32 files, 1,014 passed, 19 skipped. Not run again after the review's changes, which touch only the CLI's deliver code, its tests, the action and docs.

## The first review (comment 6512945643, REQUEST CHANGES at d714435)

- **Blocking 1, content not checked.** Now checked as above (manifest recomputed, Dockerfile FROM only, composer.lock entry by entry, npm judge again). What stays unchecked is written above.
- **Blocking 2, a refused PR left the fix stuck.** A branch on GitHub with the same tree on the same base is reused; any other fails the job with what to do.
- **3** whole message rebuilt and compared. **4** the receipt is uploaded on every run that wrote one; the design's sentence now matches. **5** `pushInvocation` is tested (arguments, token only in the environment, no force, only ludion/ branches). **6** tests and e2e use depth-1 detached checkouts. **7** cache poisoning written above and in README and docs/status.md. **8** no fsck, with the reason above. **9** logs added with `git add -f`. **10** `concurrency: ludion-${{ github.workflow }}`. **11** red runs written in the design, README, the template and docs/status.md. The nit in docs/status.md fixed ("in the base commit").
