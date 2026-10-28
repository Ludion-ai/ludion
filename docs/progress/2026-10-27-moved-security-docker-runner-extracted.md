## 2026-10-27 — Security Docker runner extracted

Added `packages/cli/src/security/docker.ts` and switched `patch.ts` to it; the generated test argv is identical to the previous security phase of `buildDockerRunArgs`. New unit tests cover the exact argv, refusal of unsafe names, tags instead of image IDs and flag-like or empty test argv, the image-command allowlist, exit/output handling, name-only kill on timeout, spawn errors and the output cap. The `docker run` guard was tightened to explicit builder files and functions; a deliberate run argv outside `runArgs` was confirmed to fail it, then removed.

Results: typecheck passed; 680 passed / 8 skipped. The CLI bundle went from 2,455,228 to 1,675,049 bytes because it no longer pulls in the capability schema and guard. Real Docker, validation only, on a temporary copy of `examples/php-security`: PHP 8.4.26-cli-alpine → 8.4.27-cli-alpine, baseline and candidate passed, outcome `validated`, Dockerfile hash unchanged, temporary images removed. No deployment or npm publish.

### Security Docker runner — independent review, round 1

Verdict REQUEST CHANGES, with one blocking finding: the sandbox flags had moved out of the protected paths, and the protected guard trusted the new, unprotected file. Fixed by making `packages/cli/src/security/docker.ts` a protected path. Also fixed from the non-blocking findings:
- `runContainer` now builds its own hardened argv.
- A spawn that throws with an empty message now reports `Error` instead of an empty string.
- `runDockerImageCommand` has unit tests for success, failure, timeout and a missing Docker.
- The guard ends a builder function at its closing brace and flags `exec docker run` and non-kill/pull/version literal argv inside builder files.

Kept, with the reason: the now-unused security branch of `buildDockerRunArgs` in `tools/verify` (in-flight branches still call it; it goes when `tools/verify` is deleted), and this file's existing double-blank-line spacing.

