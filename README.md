# Ludion — one workflow for security updates

Ludion detects known fixes, acquires dependencies, tests the original and updated application offline, rechecks advisories, and applies source changes under an explicit policy. The source preview supports four ecosystems through the same init / scan / patch / watch workflow.

| Ecosystem | Detection | Automatic source update scope |
| --- | --- | --- |
| PHP runtime | Official php.net security releases | Exact official image, single-stage Dockerfile, same major/minor and image flavor |
| JavaScript / TypeScript | npm package-lock + OSV | Public npm registry, package-lock v2/v3; no workspaces or URL/Git/file dependencies |
| PHP packages | Composer lockfile + OSV | Pinned public ZIP archives; standard vendor directory; no custom repositories or policy overrides |
| Java / Maven | Resolved direct/transitive dependency graph + OSV | Standalone POM, public Central; no parents, profiles, modules, extensions or custom repositories |

Yarn/pnpm discovery is partial and cannot enable automatic patching. Python, Go and Rust are scanned read-only, with no updates (see [Read-only scans](#read-only-scans-python-go-and-rust)). Gradle, live server inventory, runtime upgrades beyond PHP, same-tag OS-image rebuilds, EOL certification and automatic production deployment remain unsupported. An empty result is not a security guarantee. Missing metadata and incomplete inventories remain visible.

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

## Run the source preview

The published npm ludion-ai 0.1.4 release is the earlier lesson product, which ended on 2026-10-28. These commands require building this repository, Node 24 and a local Docker daemon; no npm release is implied.

```sh
npm ci
npm run build -w ludion-ai
node packages/cli/dist/cli.js scan --dir /path/to/app
node packages/cli/dist/cli.js init --dir /path/to/app --ecosystem npm
```

Scan discovers all supported manifests in a project. A saved update policy selects one ecosystem at a time; pass --ecosystem when initializing a mixed project. Set the real application test before applying:

```json
{
  "schema": 1,
  "ecosystem": "npm",
  "image": "node:24-slim",
  "test": ["npm", "test"],
  "timeout_seconds": 120
}
```

Composer and Maven use ecosystem composer / maven with default official tool images composer:2 / maven:3.9-eclipse-temurin-21. PHP retains the existing configuration with dockerfile: "Dockerfile" instead of ecosystem/image. The test must exist, run offline as UID 65534 and actually verify application behavior. Placeholder tests do not establish compatibility. The npm acquisition tool is pinned to npm 12.2.1, so custom Node images must satisfy that tool's engine requirements; the default Node 24 image does.

```sh
# Acquire/build/test and record; leave source unchanged.
node packages/cli/dist/cli.js patch --dir /path/to/app
# Repeat validation and apply supported source files if all checks pass.
node packages/cli/dist/cli.js patch --dir /path/to/app --apply
# Repeat the saved ecosystem policy in this foreground process.
node packages/cli/dist/cli.js watch --dir /path/to/app --apply --interval 900
```

Ctrl+C cancels pending application. An in-flight Docker step may finish before exit. Watch installs no service or scheduler. Scan exits 1 when it finds a known vulnerability or a PHP security release, 2 when it finds none but something still needs attention (a failed check, an incomplete result or an unsupported inventory), and 0 only when recorded supported inventories need no attention; it does not certify security. Patch exits 2 on failure.

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
4. Preserve existing package majors (0.x preserves minor). The candidate moves only the planned packages to the smallest fixed version: a direct requirement keeps its own style (exact, ^ or ~x.y.z) with the fixed version as its floor, and other styles need review; npm pins the fix (a transitive one as an override scoped to the vulnerable version) for one lockfile-only resolution and then restores the requirement, and Composer updates only the named packages with --minimal-changes. For npm and Composer, if any other installed version disappears, the update stops for review. New dependencies of a fixed package can still appear; the receipt lists every changed package. Composer requirements written as wildcards or ranges (5.4.*, >=…) stop for review. Maven uses explicit versions and dependencyManagement constraints when transitive fixes require them. Recheck the actual candidate inventory; remaining advisories, missing fixes, major upgrades, incomplete inventory or test failures block application.
5. Apply only the supported Dockerfile or dependency files after a final source check. Receipts in .ludion/security record inventories, advisories, source/config hashes, image IDs and tests. Multi-file updates use a recovery journal and backups; ordinary failures roll back our own changes. Unfinished transactions block a later run. Inspect the journal before recovering or removing a stale lock; never blindly delete its evidence. A process crash can require manual recovery.

The snapshot is not a general secret scanner. Use a local Docker daemon to keep source on your machine. Package names/versions are sent to OSV; manifest data goes to the public package registries and archives. No source is uploaded to Ludion and no security-command telemetry is sent. Receipts establish recorded behavior, not exploit coverage or certification. Runtime-image fixes beyond PHP, build-plugin advisories and operating-system packages are outside this increment.

Examples for all four ecosystems are under examples/*-security. Copy an example outside the repository before --apply. npm, Composer and Maven examples intentionally pin vulnerable versions for smoke-test demonstrations; the tests are not exploit regressions.

## The earlier lesson product

The lesson commands (`sync`, `teach`), the lesson data and the MCP server of ludion-ai 0.1.x ended on 2026-10-28; their code and data are kept in the git tag `archive/lessons-2026-10-27`. The existing Astro UI, typography, motion, responsive layout, Worker and deployment pipeline are reused.
