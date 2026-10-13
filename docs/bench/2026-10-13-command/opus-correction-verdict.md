# Verdict: No blocker

## `tools/verify/src/command.ts`: invocation name retention

- **Symlinks into projects are still rejected.** `realpathSync(candidate)` resolves the whole chain, so the result is the final target. A link that leads into a project root, even through an intermediate global symlink, is still caught by `roots.some(inside(root, file))`. The `isFile` and `X_OK` checks still run on the resolved target, so the validation is unchanged.
- **The candidate path is built from trusted parts.** `dir` comes from `directories`, which holds only realpath'd, non-project, non-`node_modules/.bin` directories. So `candidate` is a fixed tool name inside a vetted global directory. Returning it keeps the basename (`docker`, `git`, and so on). That basename is what snap-style dispatchers read from argv[0]. This fixes the reported regression.
- **Check-to-spawn race.** A global symlink could be retargeted between the check and the spawn. This only matters under the stated trust model, where global install locations and their symlink ownership are trusted. It is not a new class of exposure.

## `tools/bench/src/agent.ts`: promise rejection

- A failure in `trustedCommand` now becomes `Promise.reject(error)` instead of a synchronous throw. This keeps the async rejection contract the first review asked for.
- `let command;` relies on TypeScript's inferred type for an unannotated `let`. The `catch` block always returns, so after the `try`/`catch` the type narrows to the resolver's return type. Your passing typecheck confirms this.
- The temp work directory created before the call is not cleaned up on rejection. This was already true before the change and is out of scope.

## `tools/verify/test/command.test.ts`: new test

- The test asserts the right behavior: the dispatch symlink path is returned, not the `dispatcher` target.
- **Possible fragility (not blocking):** the expected value is `join(f.global, "git")`, but the resolver returns `join(realpathSync(f.global), "git")`.
  - If the fixture's temp directory sits under a symlinked path, the two differ. A typical example is macOS, where `/var` points to `/private/var`.
  - Linux CI with a non-symlinked `/tmp` should pass. Unless the fixture already realpaths its directories, consider asserting `join(realpathSync(f.global), "git")`.
- The existing alias test still asserts `realpathSync(expected)`. It stays correct because `expected` is a regular file inside a directory the resolver already realpaths.

Nothing in the changed parts blocks merging.