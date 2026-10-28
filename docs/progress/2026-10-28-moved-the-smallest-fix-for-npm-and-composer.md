## 2026-10-28 — The smallest fix for npm and Composer

Candidates move only the planned packages (decisions, same date). Real Docker, built CLI, temporary copies of the examples:
- npm, `--apply`: lodash 4.17.20 → **4.18.0** (the old unscoped `npm update` chose 4.18.1); `changed_packages` is lodash only; requirement stays exact; applied in 17 s.
- Composer, `--apply`: **stopped**. The plan (5.4.0 → 5.4.50, the smallest version OSV lists as fixing both advisories) was refused by Composer because Packagist's advisory database still flags 5.4.50 (PKSA-xmwy-rmx5-m7h4). No file changed; exit 2.
- Maven, validation only: commons-text 1.9 → 1.10.0 and transitive commons-lang3 3.11 → 3.18.0, `validated` (128 s with image pulls).

Local: typecheck pass; CLI tests 83 passed / 1 skipped, sandbox 46 passed.

Round 1 review of #142 (REQUEST CHANGES): the npm transitive override was global, so another installed version of the same name drifted to its newest in-range release (reproduced by the reviewer with semver 6.1.1 → 6.3.1). Fixed with a version-scoped override plus a fail-closed check that no unplanned baseline version disappears; also duplicate plan names, the Composer `--`, `changed_packages` recorded before the compatibility check, and two raw NUL bytes that made git treat `dependency-patch.ts` as binary.
Real Docker after the fix, built CLI, `--apply`: the reviewer's scenario as a project (make-dir 3.0.0 + normalize-package-data 2.5.0, lockfile from before 2019-06-01, so semver 5.7.0 nested and 6.1.1 hoisted, both vulnerable): semver 5.7.0 → 5.7.2 and 6.1.1 → 6.3.1, each to its own smallest fix, plus the planned hosted-git-info 2.7.1 → 2.8.9 and path-parse 1.0.6 → 1.0.7; nothing else moved, no override left in package.json, 0 known findings after, smoke test passed. npm example again: lodash 4.17.20 → 4.18.0, applied. Local: typecheck and build pass; vitest 185 passed / 1 skipped.

Found by the judge (next PR): lodash 4.18.0, the smallest version OSV lists as fixing lodash's five advisories, is deprecated on npm ("Bad release. Please use lodash@4.17.21 instead."). The patch command does not read deprecation; the judge stops it.

