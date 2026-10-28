# Ludion — one workflow for security updates

Ludion detects known fixes, acquires dependencies, tests the original and updated application offline, rechecks advisories, and applies source changes under an explicit policy. The source preview supports four ecosystems through the same init / scan / patch / watch workflow.

| Ecosystem | Detection | Automatic source update scope |
| --- | --- | --- |
| PHP runtime | Official php.net security releases | Exact official image, single-stage Dockerfile, same major/minor and image flavor |
| JavaScript / TypeScript | npm package-lock + OSV | Public npm registry, package-lock v2/v3; no workspaces or URL/Git/file dependencies |
| PHP packages | Composer lockfile + OSV | Pinned public ZIP archives; standard vendor directory; no custom repositories or policy overrides |
| Java / Maven | Resolved direct/transitive dependency graph + OSV | Standalone POM, public Central; no parents, profiles, modules, extensions or custom repositories |

Yarn/pnpm discovery is partial and cannot enable automatic patching. Python, Go, Rust, Gradle, live server inventory, runtime upgrades beyond PHP, same-tag OS-image rebuilds, EOL certification and automatic production deployment remain unsupported. An empty result is not a security guarantee. Missing metadata and incomplete inventories remain visible.

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

Limits: GitHub-hosted Linux runners (the action needs gh, jq, unzip, GNU date and Node 22 or later); only the root package.json and package-lock.json, and each changed */package.json, are read (the judge does not use the changed workspace package.json files yet, so a PR that changes one still stops on gate 4); a PR that changes .github/ or 300 or more files is shown as undecidable; the comment job posts only for PRs into the default branch. Package names and versions are sent to OSV and the npm registry. No source is sent.

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

Ctrl+C cancels pending application. An in-flight Docker step may finish before exit. Watch installs no service or scheduler. Scan exits 1 for attention needed, 2 for an error, and 0 only when recorded supported inventories need no attention; it does not certify security. Patch exits 2 on failure.

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
