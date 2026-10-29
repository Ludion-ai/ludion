# 2026-10-29 — Ludion is cut to the judge

**Owner decision, 2026-10-29 11:29 JST** (全て推奨で行く), given to the owner's Claude chat after a review of what Ludion had grown into. It changes the scope, the preview's release conditions and how work is recorded. The wait table and every gate's numeric criteria are unchanged.

## Why

- **Three products in one repository, one of them on the release path.** Of the CLI's 5,745 lines of source, the judge used about 1,600. The production/dev split was about 700 more. The other 3,400 or so (the fixer, Composer, Maven and PHP Docker, the read-only Python, Go and Rust scans, and the Docker sandbox) were never called by the judge. Dependabot and Renovate already write updates, and osv-scanner already lists advisories. What nothing else does is judge an update, which is the part the preview releases.
- **The split could not meet both of its gates.** Three samples of 100 repositories each:
  - The miss gate failed each time, with new causes each time.
  - The count stayed near half of npm audit's (52% on the third sample) against a gate of a third.
  - Each miss fix raised the count: 935 to 950 on the first sample, 998 to 1,062 on the second.

  In the preview the split only lowers a dev-only change's wait to seven days, which a comment on an existing PR barely needs.
- **Measuring third-party repositories on the owner's PC was the riskiest work.** On 2026-10-29 a markdown code span inside a double-quoted shell string ran `npx webpack serve` on that PC. The same sample held Joshuasco/coffeeShop, whose build runs an obfuscated payload.

## Decided

1. **No production/dev split in the preview.** Every changed version counts as production, and the lockfile's `dev` flag is not used. The preview's release condition L1 (the noise measurement's miss gate) is withdrawn with it. The count gate's definition is unchanged, and the release no longer depends on it.
2. **Protected paths are enforced by GitHub, not by parsing review comments.**
   - The agents get their own account, with write access but not admin. The owner stays Ludion-ai.
   - CODEOWNERS names the owner, and a ruleset on main requires the code owner's review and dismisses stale approvals.
   - This replaces the preview's release condition LP and PR #181.
   - Until the ruleset exists, the owner adds `review-approved` when merging a protected PR.
3. **Removed from main:**
   - the fixer (`init`, `scan`, `patch`, `watch`);
   - Composer, Maven and PHP Docker;
   - the read-only Python, Go and Rust scans;
   - packages/sandbox and examples/;
   - the split (production.ts) and the noise tool (tools/backtest/src/noise.ts).

   Main before the cut, 5553d671387676e9e09d4783b32d9e7d658b4ffc, keeps all of it.
4. **CLAUDE.md keeps rules only.** What is built moves to docs/status.md, which is not a protected path and is updated with the change it describes.
5. **Decision records only for a change to a gate, a rule, the scope, or something that cannot be undone.** Other details go in the PR description.
6. **At most one open PR changes a protected path at a time.** Main is not merged into a branch only to bring it up to date.
7. **The shadow moves to its own public repository,** Ludion-ai/ludion-shadow, with its workflow and its data together, so this repository's clones, its Actions standing and its protected-path process stay out of it. PR #197 is ported there; the PC recorder runs until the move.
8. **Text reaches commands through a file or a quoted heredoc, never inside double quotes.** The Bash guard hook (.claude/hooks/guard.mjs) refuses a backtick that bash would run. Third-party repositories are read only inside a container with no credentials.

## Release conditions after this decision

- **The preview (comments only)** is released when:
  - the judge has no production/dev split (this PR);
  - the workspace false stop is fixed (L9, done);
  - protected paths are enforced by GitHub as in 2 above.
- **Automatic merge** keeps its two conditions from docs/decisions/2026-10-28-release-gates-by-stage.md:
  - (a) zero misses of confirmed malicious versions in the backtests;
  - (b) four consecutive weeks of shadow operation with zero misses on versions that received a MAL- record, and at least 100 decided judgements.

## Undo

Each removal can be restored from 5553d67 by a PR. Bringing the split back brings L1 back with it. If it returns, the suggestion from this review is to observe what ships (the production image's node_modules, a bundle's source map) rather than infer it from configuration files.
