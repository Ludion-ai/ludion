# Ludion — one workflow for security updates

Ludion detects known fixes, acquires dependencies, tests the original and updated application offline, rechecks advisories, and applies source changes under an explicit policy. The source preview supports five ecosystems through the same init / scan / patch / watch workflow.

| Ecosystem | Detection | Automatic source update scope |
| --- | --- | --- |
| PHP runtime | Official php.net security releases | Exact official image, single-stage Dockerfile, same major/minor and image flavor |
| Node.js runtime | nodejs.org's release index (`security` mark) | Exact official `node` image, single-stage Dockerfile, same major and image variant; the newest security release of the line |
| JavaScript / TypeScript | npm package-lock + OSV | Public npm registry, package-lock v2/v3; no workspaces or URL/Git/file dependencies |
| PHP packages | Composer lockfile + OSV | Pinned public ZIP archives; standard vendor directory; no custom repositories or policy overrides |
| Java / Maven | Resolved direct/transitive dependency graph + OSV | Standalone POM, public Central; no parents, profiles, modules, extensions or custom repositories |

Yarn/pnpm discovery is partial and cannot enable automatic patching. Python, Go and Rust are scanned read-only, with no updates (see [Read-only scans](#read-only-scans-python-go-and-rust)). Gradle, live server inventory, runtime upgrades beyond PHP and Node.js, same-tag OS-image rebuilds, EOL certification and automatic production deployment remain unsupported. An empty result is not a security guarantee. Missing metadata and incomplete inventories remain visible.

## Getting started: judge your npm dependency PRs

**プレビュー：コメントのみ。マージは行わない。** Preview: comments only; nothing is merged.

The judge reads a dependency PR's package.json and package-lock.json (from Dependabot, Renovate or a person) and comments on the PR with what it found. It checks parts of gates 1, 2 and 4 and the wait (docs/design.md). It does not build or test anything (gate 3), so it never says a PR can be applied, and its output lists what it did not check. It is not a required check unless you make it one.

**Not released yet.** No release commit exists yet. The action needs a release commit, because only that carries the bundled judge; at any other commit it stops with an error. When one is published, pin its full 40-character SHA (not a tag or branch) in both workflows.

Add two workflows. The first judges with read access only and runs nothing from the PR:

```yaml
# .github/workflows/ludion-judge.yml
name: ludion-judge
on:
  pull_request:
    paths: [package-lock.json]
permissions:
  contents: read
# A newer push cancels the judgement of an older head.
concurrency:
  group: ludion-judge-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  judge:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: Ludion-ai/ludion@<release commit SHA>
        with:
          mode: judge
```

The second posts the result. It runs from your default branch after each judge run, checks the result as untrusted data, and keeps one comment per PR up to date:

```yaml
# .github/workflows/ludion-judge-comment.yml
name: ludion-judge-comment
on:
  workflow_run:
    workflows: [ludion-judge]
    types: [completed]
permissions:
  actions: read
  contents: read
  pull-requests: write
# One comment run at a time per PR branch, so two runs cannot both post a comment.
concurrency:
  group: ludion-judge-comment-${{ github.event.workflow_run.head_repository.full_name }}-${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: false
jobs:
  comment:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: Ludion-ai/ludion@<the same release commit SHA>
        with:
          mode: comment
```

A change to that SHA (from Dependabot, for example) is an update to Ludion itself: review it like any dependency update, and do not auto-merge it.

Limits: GitHub-hosted Linux runners (the action needs gh, jq, unzip, GNU date and Node 22 or later); only the root package.json and package-lock.json, and each changed */package.json, are read (the judge leaves a workspace package.json out of gate 4's changed-files stop when it agrees with the lockfile; one that does not agree stops, and one that cannot be read on both sides, such as an added, removed or renamed workspace's, is undecidable); a PR that changes .github/ or 300 or more files is shown as undecidable; the comment job posts only for PRs into the default branch. It sends package names and versions to OSV and the npm registry, and the IDs of the advisories OSV returns back to OSV. It downloads CISA's catalog of exploited vulnerabilities and FIRST's daily list of EPSS scores whole and looks the CVE IDs up in them, so no CVE ID is sent; a list it cannot download or read makes the judgement undecidable. No source is sent.

## On a schedule: one PR per security fix

**プレビュー：マージは行わない。** Preview: Ludion opens PRs and merges nothing. Not released: the template pins a placeholder SHA, because no release commit exists yet.

Copy [action/patch-workflow.yml](action/patch-workflow.yml) to `.github/workflows/ludion.yml` in a repository that has a `ludion.security.json` (`ludion init`, below), and allow "GitHub Actions to create and approve pull requests" in the repository's settings. Every 6 hours, or when run by hand, it does two jobs:

- **patch** (`contents: read`, no secret): checks out the default branch's commit without keeping a credential and runs `ludion patch --apply`, so each fix that passes on its own is one commit on its own branch, built and tested in Docker. It uploads the receipt and a Git bundle of those branches. A failed fix makes the job fail; the fixes that passed go on.
- **pull-request** (`contents: write`, `pull-requests: write`): runs no dependency code. It checks the artifact as untrusted data: each branch is one commit by Ludion whose only parent is the run's commit, with the message Ludion writes, changing only the receipt's files among those the plan may change (package.json and package-lock.json, composer.json and composer.lock, pom.xml, or the policy's Dockerfile); the manifest is exactly what Ludion writes for the change; the Dockerfile changes only its FROM image, to the official PHP or Node.js image pinned by digest; composer.lock moves only the planned package and adds only packages it requires, each entry as Packagist lists it in everything Composer installs or runs from, none a Composer plugin or installer; the PHP or Node.js image's digest is the one Docker Hub gives for its tag; and for npm the judge runs again on the lockfile. Then it pushes each fix to its own branch and opens one PR per fix. It never force-pushes. A fix whose branch already has a PR, open or closed, gets no new one; a branch an earlier run pushed with the same change is reused; any other branch of that name is left alone and the fix fails.

Limits: GitHub's schedule can be hours late or skip runs. In a public repository, GitHub turns this schedule off after 60 days without repository activity; Ludion does not see or undo that today. GitHub's documentation gives that rule for public repositories only and states none for private ones (https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows). A branch someone creates between the PR job's check and its push could be fast-forwarded. In package-lock.json, fields of entries whose version stays (such as `dev`) are not compared. The PR body's times and advisory IDs, and its statement that the tests passed, come from the validation job's receipt. A fix that waits or is stopped makes the patch job fail on every run until that changes. The PR job does not see inside Composer archives or Maven's transitive graph. The template turns setup-node's npm cache off in both jobs, but a candidate that escaped the Docker sandbox in the patch job would be on a runner that can write the repository's Actions caches. GitHub starts no workflow for a PR opened with the workflow's token, so start your CI on Ludion's PRs before merging. Each run validates every fix again, including those with an open PR. A PR whose base moved on is not rebuilt, and an older PR that a newer fix replaces is not closed. The PR carries what `patch` checks today (below), and the receipt's fix_published_at, found_at and applied_at; it does not record when a fix is merged. On GitHub it has run twice, both by hand (workflow_dispatch) on 2026-10-30 in a private trial repository, with Ludion and the template from an unreleased commit (before the npm cache was turned off): one copy of the template for an old PHP image and one for a vulnerable npm version, each run succeeded and opened one PR for its one fix (docs/bench/2026-10-30-lb2b-trial). Not yet recorded there: a run on the schedule, a second run (which should open no second PR), CI on Ludion's PRs, and a fix that waits or fails. Before that, it had run only locally against a stand-in for GitHub (docs/bench/2026-10-30-lb-design).

## Run the source preview

The published npm ludion-ai 0.1.4 release is the earlier lesson product, which ended on 2026-10-28. These commands require building this repository, Node 24 and a local Docker daemon; no npm release is implied.

```sh
npm ci
npm run build -w ludion-ai
node packages/cli/dist/cli.js scan --dir /path/to/app
node packages/cli/dist/cli.js init --dir /path/to/app --ecosystem npm
```

Scan discovers all supported manifests in a project. A saved update policy selects one ecosystem at a time; pass --ecosystem when initializing a mixed project (an npm lockfile beside a Dockerfile whose FROM names node is one). A FROM line that names a node image in a form Ludion does not read (no exact version, as in node:22-alpine, node:lts or node; a flag such as --platform; a registry or namespace prefix other than library/ or docker.io/library/, as in docker.io/node or ghcr.io/acme/node; or a digest without a tag) is reported by scan as a check it could not make, and scan exits 2, or 1 when it also finds a known vulnerability or security release. Set the real application test before applying:

```json
{
  "schema": 1,
  "ecosystem": "npm",
  "image": "node:24-slim",
  "test": ["npm", "test"],
  "timeout_seconds": 120
}
```

Composer and Maven use ecosystem composer / maven with default official tool images composer:2 / maven:3.9-eclipse-temurin-21. PHP retains the existing configuration with dockerfile: "Dockerfile" instead of ecosystem/image; the PHP image moves to the newest release of its branch that php.net tags security, not to a later release without that tag (docs/decisions/2026-10-31-lphpv-php-security-release.md). The official Node.js image uses the same configuration with ecosystem: "node" (examples/node-security; init offers it when the Dockerfile's FROM names node, with the test node tests/smoke.js): its one FROM must name an exact version (node:22.23.4 or node:22.23.4-alpine, not node:22 or node:lts), and it moves to the newest release of the same major that nodejs.org's index marks as a security release (docs/decisions/2026-10-31-lnode-node-image.md). Like the PHP image, it is not judged and does not wait, and Ludion does not check whether the release's fixes reach your application. The test must exist, run offline as UID 65534 and actually verify application behavior. Placeholder tests do not establish compatibility. The npm acquisition tool is pinned to npm 12.2.1, so custom Node images must satisfy that tool's engine requirements; the default Node 24 image does.

```sh
# Acquire/build/test and record; leave source unchanged.
node packages/cli/dist/cli.js patch --dir /path/to/app
# Repeat validation, then commit each fix that passes on its own branch (the project must be a Git repository).
node packages/cli/dist/cli.js patch --dir /path/to/app --apply
# Repeat the saved ecosystem policy in this foreground process.
node packages/cli/dist/cli.js watch --dir /path/to/app --apply --interval 900
```

Each fix (every planned change of one package, or the PHP or Node.js image update) is validated on its own against one baseline, and one that fails stops no other. An OSV malicious-package record (MAL-) on any installed package stops every fix of the run before anything is installed or tested (for Maven, after its dependency graph is resolved). With --apply, each fix that passes becomes one commit on HEAD, on its own branch (ludion/<ecosystem>/<package>-<version>, ludion/php/<version>, ludion/node/<version>); the working tree and HEAD are not changed, and nothing is pushed. --apply first checks that the project's files are byte for byte HEAD's, and refuses otherwise: an untracked or ignored file (a build output counts, outside the names never compared: .git, .ludion, node_modules, .ssh, .aws and .env* at any depth, and for npm, Composer and Maven the top-level vendor, target, .npmrc, auth.json and .mvn), an executable bit other than the commit's (not on Windows), a file Git stores through a filter (Git LFS, git-crypt), a sparse checkout that leaves out project files, refs kept in reftable storage, or a symbolic link inside .git where Git would write refuses. --apply runs git by absolute path, found in PATH's absolute folders other than the working directory, the repository, node_modules folders and Yarn's shim folder (so not a git that npx, npm scripts, Composer's vendor/bin or a .venv put first on PATH), and refuses when there is none. Fixes that pass only together are not applied. A fix whose branch already exists is skipped. Ctrl+C cancels pending application. An in-flight Docker step may finish before exit, and so may the judge's lookups for an npm candidate (each request can take up to 30 seconds, and the download of FIRST's EPSS list up to 120 seconds); nothing is applied after either. Watch installs no service or scheduler. Scan exits 1 when it finds a known vulnerability or a PHP or Node.js security release, 2 when it finds none but something still needs attention (a failed check, an incomplete result or an unsupported inventory), and 0 only when recorded supported inventories need no attention; it does not certify security. Patch exits 2 when the run fails or only partly succeeds (some fixes failed, or some findings have no supported fix).

## Read-only scans: Python, Go and Rust

`ludion scan` also reads these files at the project root and looks up their packages in OSV. Ludion reports known advisories for these ecosystems but does not plan or apply updates. There is no update policy for them: `init`, `patch` and `watch` refuse `--ecosystem python|go|rust`. `scan --ecosystem python` (or `go`, `rust`) scans only that ecosystem.

| Ecosystem | A scan runs when the root has | Inventory | OSV ecosystem |
| --- | --- | --- | --- |
| Python | requirements.txt, pyproject.toml, poetry.lock, uv.lock, Pipfile.lock, Pipfile, setup.py or setup.cfg | Registry packages locked in uv.lock (format 1), poetry.lock (1.x and 2.x) and Pipfile.lock (spec 6), and exact `==` pins in requirements.txt. | PyPI |
| Go | go.mod | go.mod's require list (the build list since Go 1.17), plus `stdlib` and `toolchain` at the version on the toolchain line. That line is only a minimum, so a Go result always has a limitation and exits 2 when nothing matches. | Go |
| Rust | Cargo.lock or Cargo.toml | crates.io packages in Cargo.lock (formats 1 to 4), for every target and feature. | crates.io |

What gives a limitation (`Incomplete:`, never a clean result), besides anything a file cannot state exactly:

- **Python, without a lock Ludion reads** (uv.lock, poetry.lock or Pipfile.lock): pyproject.toml always gives a limitation, whatever it holds. Pipfile without Pipfile.lock gives one when it declares packages. Versions are never guessed.
- **Python, with a lock:**
  - a uv.lock without the project's package;
  - a lock missing a requirement its manifest declares (for uv.lock, `[tool.uv] dev-dependencies` too);
  - a literal `[tool.uv.workspace]` member that is not one of uv.lock's project packages, or members given by pattern or exclude;
  - a manifest that cannot be read;
  - any `[tool.*]` setting whose key names dependencies, requires, deps or members, outside uv's beside uv.lock and Poetry's beside poetry.lock. This over-reports by design: ruff's `required-version` counts too.
- **Python, setuptools:** setup.py is never read and always gives a limitation. setup.cfg is read for its section headers only: any section naming `options` gives a limitation.
- **Rust:** Cargo.toml is read beside Cargo.lock. These give a limitation:
  - a lock without Cargo.toml's package among its workspace members;
  - a crate that `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]` or `[target.*]` declare but the lock does not list;
  - a literal `[workspace]` member (named in its own Cargo.toml) that is not one of the lock's members, or members given by pattern or exclude;
  - a Cargo.toml that names another workspace root (`package.workspace`), or one that cannot be read;
  - Cargo.toml without Cargo.lock.

Checked:

- The packages whose exact name and version the files state. Only each name and version is sent to OSV, and the match is OSV's. Withdrawn advisories are left out.
- For each match: the advisory id, its summary and the fixed versions OSV lists for that package, copied as they are.
- Names must be valid for their ecosystem (PEP 508 names without extras, Go module paths or stdlib and toolchain, crates.io names); anything else stops the check with an error. A PyPI package listed under several spellings is looked up once (PEP 503).
- RustSec advisories marked unmaintained or notice are listed as informational, and do not count as vulnerabilities for the status or the exit code. One with a CVE or GHSA alias, or whose OSV entries for the crate are not all marked, counts as a vulnerability. Unsound ones always count.

Not checked:

- Versions are not compared. Ludion does not say which listed fixed version applies to the installed one, or whether one is newer: PEP 440 and Go versions are not semver.
- Anything that cannot be read as an exact name and version (an unpinned or ranged requirement, a Git, path or URL source, a Go replace directive, an unknown file format version) is listed as `Incomplete:` and the result is `incomplete`, never clean.
- Whether a lock is up to date beyond those checks: the lock is the inventory, and a manifest's version ranges are not compared with it.
- Files in subdirectories and go.sum are not read, and give no limitation. The exception is a literal workspace member's Cargo.toml or pyproject.toml, read for its package name only. go.work is not read, and gives a limitation.
- pyproject.toml's `[build-system] requires` (build-time requirements) and `[tool.poetry.requires-plugins]` (Poetry's own plugins, which poetry.lock does not lock) are not read. Neither are tool configuration files outside pyproject.toml (tox.ini, hatch.toml, noxfile.py, pixi.toml); they give no limitation. Requirements files other than requirements.txt give a limitation, but a project whose only Python file is one of them is not scanned.
- Nothing is installed, resolved, built or run, and whether vulnerable code is reached is not checked.

Exit codes are scan's own: 1 when a vulnerability matches, 2 when a result is incomplete or a check fails, 0 otherwise. An informational-only match exits 0. `--json` also gives each match's `kind` and `fixed_versions`.

## Validation and acquisition boundaries

1. Capture bounded source and policy hashes before lookup. Refuse symlinks/hardlinks, exclude Git history, .env*, .ludion, node_modules, .ssh and .aws; reject changes during validation.
2. Pin official tool images by digest. Online acquisition receives manifests only, with no application source or forwarded host environment. npm scripts are disabled and npm12 forbids Git/URL/file/directory dependencies. Composer resolution disables scripts/plugins; a host downloader validates pinned public archive URLs and every redirect before offline installation, removes source fallback, records archive hashes and sends no credentials. Maven uses a dependency-only acquisition POM and fixed Central mirror, excluding the project's build plugins from the online phase.
3. Build and test baseline and candidate offline. Tests use a read-only root/source, non-root user, no network, fixed writable scratch paths, CPU/memory/process limits and the existing Docker timeout runner. There is no host execution fallback. Custom Maven build plugins may require a separately trusted offline cache; a cache miss fails rather than accessing the network.
4. Preserve existing package majors (0.x preserves minor). The candidate moves only the planned packages to the smallest fixed version: a direct requirement keeps its own style (exact, ^ or ~x.y.z) with the fixed version as its floor, and other styles need review; npm pins the fix (a transitive one as an override scoped to the vulnerable version) for one lockfile-only resolution and then restores the requirement, and Composer updates only the named packages with --minimal-changes. For npm and Composer, if any other installed version disappears, the update stops for review. For npm, when the smallest fixed version is deprecated, no longer listed by the registry, or named by an OSV record that is not a MAL- record (a record OSV marks withdrawn does not count), the next smallest stable version (not a prerelease) of the same major (0.x: the same minor) that the registry lists, that is not deprecated and that no OSV record names, MAL- or other, is taken instead, looking at up to 50 later versions; OSV is asked about the later versions only when the smallest cannot be used. The version taken must come from the same publisher as the smallest it passes over, compared as the judge's same-release exception compares (but not the commit, since two releases have two): when both have provenance, the same repository, workflow and GitHub repository id (when neither statement records an id, without it), and neither recorded as published from a GitHub event other than push, release or workflow_dispatch (docs/decisions/2026-10-30-provenance-immutable-id.md); when neither has, the same publisher account (trusted publishing's shared user never matches). Anything else stops that fix at gate 2, before any build or test: another account, repository, workflow or repository id, provenance or a repository id on one side only, a smallest the registry no longer lists (it keeps nothing to compare), and a read of the two releases' publisher or provenance that fails (docs/decisions/2026-10-30-next-fix-same-publisher.md). This is unlike a failed read of the version list or OSV, which keeps the smallest (below). A takeover that publishes from the same account, or through the same repository and workflow (by push, release or workflow_dispatch), passes this check and is caught only by the wait and the re-query. A smallest fixed version that OSV names in a MAL- record (not withdrawn) stops that fix at gate 2 in the same way, whatever else names it or is true of it, and no later version is looked at (docs/decisions/2026-10-30-mal-smallest-stops-the-fix.md); OSV is asked about the smallest even when it is deprecated or no longer listed. The fix's receipt entry lists each version passed over and why, and what the publisher check compared and found (fixes[].version_choice); a stopped fix's reason says the same. The fix's fix_published_at and the T of the time cap's rules 1 and 2 are the latest publish time among the fix's planned versions, the version taken included; with two changes of one package in a fix, that can be the change that was not replaced. Without such a version the smallest stays and its fix stops; when the lookup fails (a registry or OSV answer that cannot be read included), the smallest also stays, and the judge checks it as before. Composer and Maven have no per-version deprecation to read, so they do not do this. New dependencies of a fixed package can still appear; the receipt lists every changed package. Composer requirements written as wildcards or ranges (5.4.*, >=…) stop for review. Maven uses explicit versions and dependencyManagement constraints when transitive fixes require them. Recheck the actual candidate inventory; remaining advisories, missing fixes, major upgrades, incomplete inventory or test failures block application. Each npm fix's candidate is also judged with `ludion judge`'s checks (parts of gates 1, 2 and 4 and the wait table, every changed version counting as production) over every package in the change from the project's package-lock.json to that fix's candidate, after the baseline's tests and before that candidate's re-scan, build and tests. Unlike `ludion judge`, it reads only package.json and package-lock.json (workspaces and links are refused earlier), so gate 4's check that nothing else changes holds by construction. A fix whose candidate the judge stops or cannot decide on gets no branch, and one that must still wait (12 to 72 hours, at most 144 when a publisher change, a new dependency or a replaced version the registry no longer lists extends it) gets none before its wait ends (run the patch again then); the run's other fixes go on. Each fix's judgement is in its receipt entry (fixes[].judgement). Its exposure.fix_published_at is the latest publish time among the versions in that fix's lockfile diff that fix an advisory, read by the judge; the fix's own fix_published_at is read separately for its planned versions, so the two can differ. A run downloads CISA's catalog and FIRST's EPSS list once per npm fix it judges. Composer and Maven candidates are not judged this way.
5. Apply only the supported Dockerfile or dependency files after a final source check, each fix as one commit on its own branch, through Git plumbing started outside the project's folder, with core.hooksPath, fsmonitor, signing, replace refs and every transport turned off; a repository whose Git configuration names hooks (hook.*), or a partial clone, is refused. Receipts in .ludion/security record inventories, advisories, source/config hashes, image IDs, tests, each fix's branch and commit, and its timestamps: fix_published_at (the official publication: php.net's release day, nodejs.org's release day, the npm registry's publish time or Packagist's release date; null, with the reason, when it cannot be read, and always for Maven), found_at (this run's advisory lookup) and applied_at (when the branch was made). A journal left by an earlier version's in-place apply still blocks a later run until it is recovered. Inspect it before recovering or removing a stale lock; never blindly delete its evidence.

The snapshot is not a general secret scanner. Use a local Docker daemon to keep source on your machine. Package names/versions are sent to OSV; manifest data goes to the public package registries and archives. Judging an npm candidate sends what `ludion judge` sends (see its limits above). No source is uploaded to Ludion and no security-command telemetry is sent. Receipts establish recorded behavior, not exploit coverage or certification. Runtime-image fixes beyond PHP and Node.js, build-plugin advisories and operating-system packages are outside this increment.

Examples for all five ecosystems are under examples/*-security. Copy an example outside the repository and commit it in a repository of its own before --apply. npm, Composer and Maven examples intentionally pin vulnerable versions, and the PHP and Node.js examples old images, for smoke-test demonstrations; the tests are not exploit regressions.

## The earlier lesson product

The lesson commands (`sync`, `teach`), the lesson data and the MCP server of ludion-ai 0.1.x ended on 2026-10-28; their code and data are kept in the git tag `archive/lessons-2026-10-27`. The existing Astro UI, typography, motion, responsive layout, Worker and deployment pipeline are reused.
