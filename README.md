# Ludion — one workflow for security updates

Ludion detects known fixes, acquires dependencies, tests the original and updated application offline, rechecks advisories, and applies source changes under an explicit policy. The source preview supports four ecosystems through the same init / scan / patch / watch workflow.

| Ecosystem | Detection | Automatic source update scope |
| --- | --- | --- |
| PHP runtime | Official php.net security releases | Exact official image, single-stage Dockerfile, same major/minor and image flavor |
| JavaScript / TypeScript | npm package-lock + OSV | Public npm registry, package-lock v2/v3; no workspaces or URL/Git/file dependencies |
| PHP packages | Composer lockfile + OSV | Pinned public ZIP archives; standard vendor directory; no custom repositories or policy overrides |
| Java / Maven | Resolved direct/transitive dependency graph + OSV | Standalone POM, public Central; no parents, profiles, modules, extensions or custom repositories |

Yarn/pnpm discovery is partial and cannot enable automatic patching. Python, Go, Rust, Gradle, live server inventory, runtime upgrades beyond PHP, same-tag OS-image rebuilds, EOL certification and automatic production deployment remain unsupported. No matching finding is a security guarantee. Missing metadata and incomplete inventories remain visible.

## Run the source preview

The published npm ludion-ai 0.1.4 release is the earlier assistant-context product. These commands require building this repository, Node 24 and a local Docker daemon; no npm release is implied.

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
4. Preserve existing package majors (0.x preserves minor). npm/Composer direct requirements become bounded same-major ranges above the fixed floor, allowing the native resolver to select a newer safe fix. Maven uses explicit versions and dependencyManagement constraints when transitive fixes require them. Recheck the actual candidate inventory; remaining advisories, missing fixes, major upgrades, incomplete inventory or test failures block application.
5. Apply only the supported Dockerfile or dependency files after a final source check. Receipts in .ludion/security record inventories, advisories, source/config hashes, image IDs and tests. Multi-file updates use a recovery journal and backups; ordinary failures roll back our own changes. Unfinished transactions block a later run. Inspect the journal before recovering or removing a stale lock; never blindly delete its evidence. A process crash can require manual recovery.

The snapshot is not a general secret scanner. Use a local Docker daemon to keep source on your machine. Package names/versions are sent to OSV; manifest data goes to the public package registries and archives. No source is uploaded to Ludion and no security-command telemetry is sent. Receipts establish recorded behavior, not exploit coverage or certification. Runtime-image fixes beyond PHP, build-plugin advisories and operating-system packages are outside this increment.

Examples for all four ecosystems are under examples/*-security. Copy an example outside the repository before --apply. npm, Composer and Maven examples intentionally pin vulnerable versions for smoke-test demonstrations; the tests are not exploit regressions.

## Existing integrations

Legacy sync/teach, lesson attribution/data and MCP endpoints remain compatible. They are not vulnerability feeds. The existing Astro UI, typography, motion, responsive layout, Worker and deployment pipeline are reused. Previous product documentation is preserved under docs/legacy/.
