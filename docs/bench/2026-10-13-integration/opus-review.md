# Protected review: PRs 67, 68 and 69

**Scope.** This review covers only the supplied diffs, the complete files at each head, and the dependency context. Nothing was executed. Each PR stacks on the previous one: 68's base is 67's head, and 69's base is 68's head.

## PR 67 — head `6438b6b71c0ec2009223e4578b91b62b504abbd2`

**Verdict: no actionable blocker. Approve for the owner's merge decision.**

### Public-input parsing
- **MCP request bound (`boundedMcpRequest`).**
  - It counts bytes actually read and does not trust Content-Length.
  - Oversized requests are cancelled and get a 413 with CORS headers.
  - Bodiless GET and OPTIONS requests pass through unchanged.
- **Index fetch in the CLI (`fetchLessons` / `indexJson`).**
  - Response size is bounded by bytes read, and decoding uses fatal UTF-8.
  - Manifest values are type-checked, and subjects are looked up with `Object.hasOwn`.
  - `inactive_ids` must match the ULID format.
  - Each shard must have the expected subject and the same `built_at` as the manifest.
- **Shard lessons (`checkedShardLesson`).**
  - Each lesson is rebuilt from validated fields only.
  - The claim is regenerated rather than copied from the shard.
  - `teacher` is constrained by the schema's author pattern.
  - `verified_by` must equal what `verifiedBy` derives, and model verdicts are limited to an enum.
  - A single bad lesson rejects the whole sync, leaving the existing file in place. That is fail-closed.

### Private ledger and Git behaviour
- **Ledger read and save (`parseLedgerEntry`).**
  - The status strings in `checks` come from an allowlist.
  - Lesson content goes through the same schema and problem checks as teaching.
  - PR URLs must be canonical https URLs, with no query, fragment, userinfo or control characters.
  - Saves are atomic (`wx` temp file, then rename) with mode 0600.
- **Retirement handling in sync.**
  - Retired ids are suppressed for public copies in the ledger.
  - Public ledger copies are downgraded to "status unknown" when retirement metadata is absent.
- **Git check in `writeAndWire` (`privateLessons` branch).**
  - It refuses to write if a generated file is tracked, matched case-insensitively.
  - It refuses if it cannot check, either because git failed inside a repository or for any error other than ENOENT.
  - It confirms with `git check-ignore` before writing.
  - `core.fsmonitor` is disabled for these git calls.

### Sandbox settings
- `dockerArgs` and `installArgs` now add `--cap-drop ALL`, `no-new-privileges` and the host UID for every run.
- `tools/sandbox-smoke.ts` checks this against real Docker using only its own probes:
  - effective capabilities are zero, NoNewPrivs is set, and the process is not root;
  - only the `lo` network interface exists, the root filesystem is read-only, and `/tmp` is writable.

### Credential scoping
- `runEnv` now passes `ANTHROPIC_API_KEY` only when running in GitHub Actions and the condition is `none` or `files`.
- The default case and the `project`, `web` and `ludion` conditions get no key.

### Scoped limitations (not findings)
- I could not see the site's GitInfo producer. If `verified_at` were ever emitted with a timezone offset instead of `Z`, every shard lesson would fail validation and every sync would refuse the index. This fails closed, and every fixture uses `Z`.
- If any CI pipeline runs bench agents under `web`, `ludion` or `project`, it will now lack the API key. That would be a functional break, not a leak. No such caller appears in this package.
- Running tests without a mounted work folder as a non-root user could change the outcome of an existing lesson's nightly reverify, if that lesson relied on root-only reads. I see no evidence of such a lesson.

## PR 68 — head `23c6c314ac5ea9964860119dbaa29eef0212ea1a`

**Verdict: no actionable blocker beyond the accepted known limits. Approve for the owner's merge decision.**

- **Host boundary.**
  - Candidate text is only read on the host. It runs only inside `runInDocker`: network off, read-only root, capabilities dropped.
  - Input reaches the probe as a `JSON.stringify` literal.
  - Paths are restricted to a character set, with no `..`, no absolute paths, and no excluded segments.
- **Checkout command (`checkoutArgs`).**
  - The script is tokenised as argv and never passed to a shell.
  - Shell operators, `$(…)`, backticks and control characters are rejected.
  - Only `vitest run`, exactly one name filter and at most the cart test path are allowed.
  - Lifecycle hooks and added vite/vitest config files are rejected.
- **Test participation and mutation checks.**
  - Task 16 requires exactly 3 passing tests: both original names plus the new one.
  - Each mutation must fail precisely its expected test.
  - The self-check fixtures cover skipped tests, unrelated assertions, a generic `toThrow()`, and filters that execute zero tests.
- **Error classification (`gradeRuntime`).**
  - Exit codes 2, 125, 126 and 127, a timeout, a null exit code, and output without a valid `LUDION_ACCEPTANCE` line are all classed as "error".
  - Unsupported tasks are never sent to Docker.
- **Accepted known limit.** The `/w` mount is writable, and candidate test code runs as the same UID as the harness. A malicious candidate could therefore tamper with `node_modules` or the reported results. This is the declared "not tamper-proof" limit.

## PR 69 — head `709d9a407221a609822c7f98637aca01df63d48e`

**Verdict: no actionable blocker. Approve for the owner's merge decision.**

### Unknown-cost and pending attempts
- A pending attempt is saved to disk inside `prepare`, before the model process starts.
- Missing or mismatched cost in the run's output marks the attempt `unknown` and stops the batch.
- On resume, `resumeState` refuses any attempt that is pending, unknown, or has a negative or non-finite cost.
- It also refuses if `spentUsd` disagrees with the recomputed total, or if a graded row has no matching charged attempt.
- `nextRunBudget` passes only the remaining cap, at most 2, to each run.
- Model-error runs keep their charge but get no grade.

### Concurrency lock (`withMeasurementLock`)
- The lock file is created exclusively (`wx`) before the ledger is read, and held across the whole batch.
- A stale lock blocks the next run.
- The process never removes a lock whose token is not its own.
- On an exception, the lock is released but the pending entry stays in the ledger, so resume is still blocked. Integrity does not depend on the lock surviving.

### Artifact privacy and integrity
- Artifacts are written atomically with mode 0600, into a directory that must be private (`ensureArtifactDir`).
- `readArtifact` checks the file's SHA-256 against the supplied hash, then re-checks the source digests and delivery hash.
- Files are read through `boundedText`: size-bounded, no symlinks (O_NOFOLLOW), changes detected, fatal UTF-8.
- `validateReplay` checks the task hash and baseline before Docker is touched.
- Score rows store only a reference to the artifact; delivery text stays inside the private artifact.

### Model-run opt-in and identity
- Model runs require `--run-model`.
- A dirty harness is refused.
- Resume requires the same identity: HEAD, CLI bytes, site, offline flag, and the prepared-inputs hash.

### Scoped limitations (not findings)
- The source snapshot now throws on any file outside the supported profile, for example a file with no extension such as `.node-version`.
- Any such file in a prepared cache stops `tasks-run` before the model starts. Any such file the agent creates stops the batch after the row is recorded with `artifact_error`.
- This fails closed and falls under the declared limited-profile limit.
- A `spawn` error after the pending entry is saved blocks resume even though nothing was charged. This is conservative, and only manual reconciliation clears it.
- PR 68 and PR 69 add 14 sandbox package installs to a job with a 15-minute timeout. That is an operational risk only; I could not check run times.

## Not established by this review

- No benchmark or model-accuracy result follows from the fixture checks.
- The hashes authenticate bytes against the supplied reference, not the identity of the model that produced them.
- No Docker run, CI result, npm publish or deploy was observed or approved.
- CLI 0.1.4 and its User-Agent are unchanged.