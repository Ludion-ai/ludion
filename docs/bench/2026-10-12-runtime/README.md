# C-task execution acceptance pilot — 2026-10-12

An evaluator check, not a new model measurement. Stacked on the security fixes in PR #67 (base `1ed141114cfa19c275a73cf5a3d7ddafca7cbc4f`). No model is invoked, and previous C grades/results are not modified. The existing spending pause stays in force.

## Why this check

The current C grader searches generated files for patterns. That checks recognizable syntax, not whether the requested tests run or detect faults. A matching command can exclude every test, and a matching test can be skipped or assert the wrong thing. The pilot uses task requirements as the acceptance criteria rather than adding more regexes.

The Vitest migration guide independently documents the [test-name separator and top-level mock requirement](https://vitest.dev/guide/migration/). The runner tests these requirements against pinned Vitest/Vite versions, rather than relying only on that prose.

## Implemented boundary

- Only `vitest-5-0-0-13-c` and `vitest-5-0-0-16-c` have runtime acceptance. Every other task returns **unsupported / not scored**, never implicitly correct/wrong. Existing historical grading remains separate.
- Host code reads a complete, bounded source snapshot as text. It excludes dependencies/repository/assistant metadata and npm lockfiles, rejects links and unsafe relative paths, and bounds tree size/depth and text size. It never evaluates candidate code or npm scripts on the host.
- The existing Docker runner installs trusted pinned `vitest@5.0.3` and `vite@7.3.1` with install scripts off, then executes in a separate network-off, read-only-root, resource/privilege-restricted container. Only a newly created temporary package folder is mounted, with candidate files in container `/tmp`. No project, home directory, credential or Docker socket is mounted.
- Task 13 parses a supported single `vitest run` command from the candidate's `test:checkout` script into argv. It rejects shell operators/substitution, lifecycle hooks, added config and report overrides, and invokes the pinned Vitest executable directly. It adds a future checkout case to the untouched test file inside the container and requires the real reporter to show exactly the intended cart checkout tests passed. Empty runs, leaf-name-only selection and wishlist selection fail.
- Task 16 requires both original tests and the new rejection test to run and pass. It then independently mutates swallowed fetch failures, the availability error message, currency conversion and unknown-currency errors. Each fault must fail its relevant assertion, not merely break startup. A skipped/wrong/unrelated assertion or generic rejection without the required error message is insufficient.
- Docker unavailable, install failure, Docker launch error, sandbox/subprocess timeout or missing acceptance protocol means **error / not scored**. Finished acceptance assertion failure means **failed**. This intentionally constrained pilot can reject legitimate alternate test names/layouts or command forms and is not ready to replace general model grading automatically.
- Candidate tests run in the same isolated container as the acceptance probe. This is not a tamper-resistant grader against an actively malicious submission that forges reports or attacks the probe; it is execution acceptance for ordinary generated solutions. Docker isolation protects the host boundary, not the honesty of code sharing that container.

## Reproduction

On Linux with Docker and repository Node/dependencies:

```sh
node tools/bench/src/runtime-tasks-cli.ts --self-check --out self-check.json
node tools/bench/src/runtime-tasks-cli.ts --task vitest-5-0-0-16-c --project /path/to/complete/generated/project --out candidate.json
```

The self-check uses the original correct/stale fixtures plus deliberately misleading candidates with matching regexes and an unsupported shell command. Correct fixtures must pass; stale and misleading fixtures must fail. The CLI persists each result, including the old static verdict and the observed runtime verdict. This is evaluator sensitivity, not Ludion accuracy or efficacy.

For actual candidate grading, `--project` must be a complete project. Historical `left` records save only files read by the regex rules, so they are insufficient to reconstruct arbitrary helper/config changes. Do not backfill a missing original artifact with guesses and publish a runtime score.

PR CI executes the fixture check and uploads `runtime-acceptance.json` as the `runtime-acceptance` artifact even on failure. Local Docker is unavailable on this PC: local typecheck and read-only boundary tests are not substituted for real execution. The actual result record will be added after inspecting that CI artifact.

## Review / release

The workflow changes require the repository's fresh Opus review and owner's merge. That review remains blocked by the previously observed existing-account usage limit; the independent Codex review is supplemental. Keep this stacked PR draft, without npm release or production deployment.
