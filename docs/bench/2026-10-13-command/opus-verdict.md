# Verdict: no actionable security blocker in the supplied delta

The core fix is sound. Every migrated callsite now runs an absolute file. That file is resolved only from absolute PATH directories. Nothing falls back to the current directory, so the Windows libuv cwd lookup can no longer be reached through these callsites.

Root exclusion is defense in depth on top of that:
- Each PATH directory and each candidate file is resolved with `realpathSync`.
- Both are checked against the caller's cwd, the target cwd and every ancestor `.git` marker. Nested markers are handled because the walk does not stop at the first marker.
- Paths that resolve through symlinks or junctions into those roots are rejected.

Other requirements also hold:
- **Child PATH:** relative, empty and `node_modules/.bin` entries are removed, and duplicate `Path` keys are collapsed into one `PATH`.
- **Absent tools:** `spawnTool` returns `status: null` with an `ENOENT` error, so callers that check status take the same branch as before. `execTool` and `publish.ts` still throw. `docker.ts run()` still returns `{kind: "error"}`.
- **Benchmark order:** in `tasks-run`, the harness SHA is read, then the dirty check runs, then model execution. That order is preserved.
- **Docker delta:** only the executable path and environment changed. The argument arrays and the timeout kill path are unchanged, and the kill now uses the same trusted file.

# Non-security items (recommended, not blocking)

**1. Returning the symlink target breaks tools that read their own name (argv[0]).**
- **Trigger:**
  - Ubuntu with Docker or gh installed as a snap: `/snap/bin/docker` links to `/usr/bin/snap`, which picks the app from its invocation name. The code would run `/usr/bin/snap pull …`, which fails.
  - Claude installed with Volta: `~/.volta/bin/claude` links to `volta-shim`, which fails the same way.
  - The result is that an installed tool reports as unavailable or fails.
- **Smallest fix:**
  - Keep the `realpathSync(candidate)` root check as it is.
  - Return `join(dir, tool + suffix)` instead. `dir` is already a resolved, non-project directory.
  - Re-resolving a symlink that lives in a global directory is within the stated trust scope ("installed globals trusted").

**2. `runAgent` can now throw synchronously.**
- **Trigger:**
  - Claude is not found, for example a Windows npm install that provides only `claude.cmd`.
  - `trustedCommand` then throws before the Promise is created. Before this change, the failure arrived as a rejected promise from the spawn `'error'` event.
  - Callers that only `await` inside try/catch behave the same either way. A caller using `.map(runAgent)` with `allSettled`/`.catch` would abort the whole batch instead of counting one run as an error.
- **Smallest fix:** keep the lookup before `prepare`, but write it as `let command; try { command = trustedCommand(...) } catch (e) { return Promise.reject(e); }`.

**3. Optional hardening.** `realpathSync` does not normalize case on macOS (APFS) or Windows 8.3 short names. An operator PATH entry that points into the project under an alias spelling would not be matched as a root. Using `realpathSync.native` would close that gap. The trigger needs operator-controlled PATH, so this is not actionable under the stated threat model.

# Please verify before merge

- **Other bare-name launches:** `tasks-run.ts` still imports `spawnSync` from `node:child_process`. Confirm it never runs a bare name such as `node` or `npm` with a candidate or work directory as cwd. The same Windows cwd lookup applies to any executable, not only the four `Tool` values.
- **Published CLI packaging:** `packages/cli` now imports `../../../tools/verify/src/command.ts` from outside its package. Confirm the packed `ludion` artifact bundles it, for example by running `npm pack` and then the CLI from outside the repo.
- **GitHub CI** has not been run for this snapshot.

# Limitations

- This is a static read only. Nothing was executed, and I did not run the Windows probe.
- I only saw the supplied delta and context, not the whole repo. Other bare-name `git`/`gh`/`docker`/`claude` launches, `runAgent` callers, `runEnv` and the CLI build configuration were not visible.
- Out of scope, and not assessed:
  - Windows DLL search order for trusted executables started with a project cwd.
  - Tools that Claude Code or git launch themselves inside a work copy.
  - Replacement of global installs and signature validation of executables.