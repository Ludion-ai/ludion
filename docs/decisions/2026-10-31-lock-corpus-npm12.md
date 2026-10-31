# 2026-10-31 (LB2a, #215) — The npm corpus adds npm 12.2.1, and the requirement check is judged against npm 12.2.1's report

Committed before npm 12.2.1's part of the corpus is generated. It extends docs/decisions/2026-10-31-lock-corpus-against-npm.md (the corpus, the variants and the gates G1 to G3 stay as written there) on the brain's direction for #215. It changes no gate's criteria elsewhere and no wait.

**Why.** Ludion writes a candidate's lock with npm 12.2.1 (dependency-patch.ts), so npm 12.2.1's reading is the one the requirement check must agree with. npm 7.10.0's `npm ls --package-lock-only` reports from `node_modules`, not from the lock, so its own report could not judge its locks.

## 1. What is added

- **npm 12.2.1 writes the six shapes**, at lockfileVersion 2 and 3, as the other versions did, with the same variants. Its image is the npm 11.19.1 image (`node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`, node 24.22.2) with npm 12.2.1 installed from its registry tarball, checked by SHA-512 (`sha512-bKCmFRVT/BB+YPEYbZwQ1XUI3N5t4xKSpU1MxOjo7z3iWzKBJ0ZXRC1xFdEN+TC7N5TdywaBzf2dMXGJq/e2PQ==`), with `--ignore-scripts`. Its Dockerfile is a fixture (`packages/cli/test/fixtures/npm-corpus/npm-12.2.1.Dockerfile`).
- **npm's report is made by npm 12.2.1 and by npm 11.19.1 on every lock and variant**, whichever npm wrote it: `npm ls --all --package-lock-only --json`, with `--network none`, `--cap-drop ALL` and `--user node`. Each is committed (`ls-12.2.1.json`, `ls-11.19.1.json`, with `.err` and `.exit`). The earlier reports by the writing npm are replaced.

## 2. The gates

- **G1 and G3:** as before, over every lock now in the corpus, npm 12.2.1's included.
- **G2:** judged against **npm 12.2.1's** report, for every variant of every npm version, npm 7.10.0's included. A variant is npm-unmet when npm 12.2.1's report has a counted problem (`missing:` or `invalid:`) that its report on the base does not have.
- **npm 11.19.1 against npm 12.2.1:** every variant where the two reports disagree on npm-unmet is listed by the test and in the bench README. npm 12.2.1 is taken as right.

## 3. The Docker test

A test runs npm 12.2.1's `npm ls` again in Docker, on every lock and variant of the corpus, and requires its counted problems to be exactly the committed `ls-12.2.1.json`'s. It has the form of packages/cli/test/action.test.ts's tests that need a tool: skipped only when Docker is missing outside CI; in CI (`CI` set) it runs, and fails without Docker, never skipped in silence.

**When a gate fails:** as in the first entry. A form Ludion refuses and npm 12.2.1 takes is not changed here: its count, direction, examples, npm versions and whether main's reader read the lock are reported, and the brain's rule (Ludion stricter than npm, on a lock main read: fix it, or measure its share and put one sentence with the number to the owner) is applied after that report.
