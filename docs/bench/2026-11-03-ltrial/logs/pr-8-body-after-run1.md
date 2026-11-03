<!-- ludion-fix -->
**プレビュー：マージは行わない。** Preview: Ludion does not merge this PR. Review it as you would any dependency update.

Ludion's validation job found a published security fix and, by its receipt, validated it on its own against the base commit `3faf98650ccb`. This PR holds that one fix (one commit).

| | |
|---|---|
| Package | `lodash` (npm) |
| Change | `4.17.20` → `4.18.1` |
| Advisories | `GHSA-29mw-wpgm-hmr9`, `GHSA-35jh-r3h4-6jhm`, `GHSA-f23m-r3pf-42rh`, `GHSA-r5fr-rjxr-66jc`, `GHSA-xxjr-mmjv-4gpg` |
| Fix published | `2026-04-01T21:01:20.458Z` (registry.npmjs.org's publish time: the latest among the fix's planned versions) |
| Found | `2026-11-03T09:49:24.388Z` (this run's lookup; an earlier run may have seen it first) |
| Branch made | `2026-11-03T09:49:47.603Z` |
| Receipt | `14b5d144-e027-4052-893c-b63d0128fdee` (in this run's ludion-fixes artifact) |

The times and advisory IDs above are as the validation job recorded them in its receipt; the job that opened this PR checked their form, not their values.

**What was checked**

- By the validation job's receipt: the project's own test command passed on the base commit and on this change alone, built and run offline in Docker.
- This commit changes only `package.json`, `package-lock.json`, Git reads its only parent as the base commit, and `git fsck` finds no error in it. The job that opened this PR, which runs no project code, checked again that package.json is what Ludion writes for this change, that package-lock.json's `packages` section, which npm 7 and later read, moves this package (under its own name or an npm alias), at each install path where the base locks the version the fix replaces, to the fix's version, adds only packages that those paths (or packages so added) require by what the registry lists for them (an optional peer adds nothing, and where the lock has one it must be the package its spec names, in range), changes no other entry beyond its flags and nothing another package loads, and leaves no requirement unmet that the base meets, that each moved or added entry declares the requirements, os, cpu and libc the registry lists, and that a v2 lock's npm 6 `dependencies` section says the same as `packages`.
- Ludion's judge on the lockfile change, in both jobs: `ready_except_build`. It covers parts of gates 1, 2 and 4 and the wait table, not all four gates (docs/status.md in Ludion lists what it does not check).

**Not checked**

- Gate 1's OS, SAPI and configuration matching; gate 2's inspection for obfuscated code or new network or process calls; gate 3's check that a changed package loads; the re-query when a wait ends.
- In package-lock.json, a moved or added entry's `hasShrinkwrap`, `bin`, `hasInstallScript` and `engines` are not compared with the base or the registry, though npm reads them (npm 7 and later install a package's own shrinkwrap). Nor are its flags (`dev`, `optional`, `devOptional`, `peer`), which decide what a production install leaves out. Another entry's flags may differ from the base's, and are not checked against what npm computes from the lock's graph, so a forged lock could have a production install take a package the base locks for development only, or leave a production one out; the judge gives each entry whose flags alone changed gate 2's checks (OSV's malicious-package records, deprecation, withdrawal), not the rest of the gates.
- Your CI: GitHub starts no workflow for a PR opened with the workflow's own token. Start it (for example, close and reopen this PR) before merging.
- Production: nothing is deployed.

