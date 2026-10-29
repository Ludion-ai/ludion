## 2026-10-28 — The sandbox is its own package (`packages/sandbox`)

Cleanup PR-B in `docs/design.md`. What the security commands need from the legacy code now lives in one package, so the legacy code can be deleted without touching the sandbox:

- `src/docker.ts`: the Docker runner from #137 (`runDockerImageCommand`, `runArgs`, `runContainer`), moved unchanged except for two things. `runArgs` takes an optional tool (`npm`, `composer`, `maven`) that adds that tool's fixed container scratch tmpfs and `HOME=/tmp`, the same flags the npm/Composer/Maven updates used through `tools/verify`'s security branch. And the functions no longer take an injectable `spawn` (#137 review, N2): a caller could have used it to run a different argv. Tests replace `node:child_process` instead.
- `src/safe-fetch.ts`: the public-address-only fetch from `tools/verify`, with its own `FetchFn` type instead of `@ludion/core`'s.
- `test/guard.test.ts`: the repository guard on which files may start a container, moved out of `tools/verify/test/docker.test.ts`. It has to live on a protected path, and `tools/verify` is about to be deleted.

The whole `packages/sandbox/` directory is the protected path now, replacing the single file `packages/cli/src/security/docker.ts`: the guard and the fetch are part of the same boundary. The security commands (`patch.ts`, `dependency-patch.ts`) import nothing from `packages/capability` or `tools/verify` any more.

Still open from #137's review: the `docker build` flags (N1) are written in `patch.ts` and `dependency-patch.ts`, not in the protected package, and the line-based guard can be evaded (N3/N4).

