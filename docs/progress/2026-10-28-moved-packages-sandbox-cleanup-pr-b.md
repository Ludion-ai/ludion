## 2026-10-28 — `packages/sandbox` (cleanup PR-B)

Moved the security Docker runner, the public-address fetch and the container-start guard into `packages/sandbox`; `dependency-patch.ts` now runs its tests through `runContainer`, like `patch.ts`, passing its tool. New tests: the exact argv for each tool, refusal of an unknown tool before anything starts, and `runContainer` passing only the tool through.

Local, Windows, Node 24.19, Docker 29.9.2: typecheck and build pass; vitest 727 passed / 8 skipped. Real Docker, validation only (no `--apply`), on temporary copies of the examples with the built CLI: `php-security` 8.4.26 → 8.4.27, baseline and candidate passed, `validated` (10 s); `npm-security` lodash 4.17.20 → 4.18.0, known matches 5 → 0, baseline and candidate passed through the npm tool flags, `validated` (23 s). Application smoke tests, not exploit regressions.

