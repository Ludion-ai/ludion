# Ludion — security update preview

Ludion finds security releases relevant to a project's PHP Docker image, downloads the official replacement, tests the old and new application images, and can update the Dockerfile after validation. `watch --apply` repeats the process while running.

The first adapter supports **one-stage Dockerfiles using an exact official PHP image**. It preserves the major/minor branch and image flavor. This is a source preview: automatic production deployment, live server inventory, Java, floating tags, multi-stage builds and end-of-life certification are not implemented.

```sh
npm ci
npm run build -w ludion-ai
node packages/cli/dist/cli.js scan --dir /path/to/app
node packages/cli/dist/cli.js init --dir /path/to/app
```

Edit the generated `ludion.security.json` to use your actual application test:

```json
{
  "schema": 1,
  "dockerfile": "Dockerfile",
  "test": ["php", "tests/smoke.php"],
  "timeout_seconds": 120
}
```

The example path is a placeholder. The test must exist in the application image and run offline as a non-root user. Both Docker builds run offline too; dependencies must already be in the base image or copied source. `ADD`, external `COPY`, custom Dockerfile frontends and RUN network/mount overrides are refused.

```sh
# Download/build/test only; keep source unchanged.
node packages/cli/dist/cli.js patch --dir /path/to/app
# Repeat validation and update the Dockerfile only if it passes.
node packages/cli/dist/cli.js patch --dir /path/to/app --apply
# Keep checking every 15 minutes in this foreground process.
node packages/cli/dist/cli.js watch --dir /path/to/app --apply --interval 900
```

Stop watch with Ctrl+C. It installs no service or scheduler. Each cycle rechecks PHP's official metadata. A network or validation failure is an error, never a clean security result. `scan` exits 0 for no newer security release found, 1 when an update is found, and 2 on error. `patch` exits 2 on failure.

An example app is in `examples/php-security`. Copy it into a separate directory before trying `--apply`. It verifies response and JSON contracts; this is not an exploit regression test.

## What a patch actually does

1. Read the source-declared PHP image and fetch same-branch security-release metadata from php.net. A later non-security release can be selected when it includes an intervening security fix.
2. Take a bounded private copy of source, refusing symlinks and hard links and excluding `.env*`, Git history, `.ludion`, `node_modules`, `.ssh` and `.aws`.
3. Pull the old and candidate official images and resolve repository digests. Build both app images offline with the same source and tests.
4. Check the PHP runtime version and run the configured test on both images, with no network, a read-only root, a non-root user and resource limits. No host environment is forwarded. No host fallback.
5. Save evidence locally in `.ludion/security/`. With `--apply`, check that the source is unchanged and replace only the Dockerfile's FROM reference with the candidate tag and digest. Leave deployment to your normal process.

Use a local Docker daemon to keep source on your machine. The snapshot is not a general secret scanner. The security commands send no telemetry and upload no source to Ludion. Project-controlled test commands are executed only in Docker. Receipts record hashes, image digests and test outcomes; they are not security certifications. A missing update is not evidence that a project is secure. Same-tag image rebuilds and OS-package vulnerabilities are outside this adapter's scope.

## Existing integrations

The published npm `ludion-ai` 0.1.4 release contains the earlier assistant-context product. Its `sync` and `teach` commands, lesson data, attribution and MCP endpoints remain compatible in this source tree. They are not the security update service. The previous README is archived in `docs/legacy/README-before-security-pivot.md`.

The existing Astro UI, typography, motion, responsive layout and Cloudflare deployment path are reused. The old capability engine remains a reusable library; the new adapter reuses its Docker test runner rather than building a separate container timeout mechanism.
