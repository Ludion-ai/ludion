### 2026-10-11: Switching to spec v2

- CLAUDE.md is the v2 spec, word for word. `.claude/rules/` is deleted. What those files said about the system as it runs today is kept below under "Carried over from v0"; what v2 changes is recorded here as the work happens.
- **PRs from before v2.** #13 (server-side teaching: GitHub App, OAuth, sessions, `/api/teach`, `/teach`) is closed unmerged: teaching moves to the teacher's machine. #23 (read path = `ludion_ask` alone) is closed: v2's read path is `ludion sync`. The useful parts of #19, #20, and #21 are folded into the v2 work and those PRs are closed when the work that carries them is open:
  - from #19: optional `kind`, runners pinned to versions, `expect: fail` + `error` (the basis of lesson format v1), and the FreshBench method (A/B questions, seeds kept out of the measurement, an LLM judge with spot checks, budgets).
  - from #20: deploy only main's newest commit; HSTS; the command guard for Claude Code (`.claude/settings.json` deny rules and the PreToolUse hook). The zone's Always Use HTTPS was turned on through the Cloudflare API on 2026-10-08 at the owner's request; it is a zone setting, so the repo can't show it (check with `curl -sI http://ludion.ai/`, which answers 301).
  - from #21: the `ludion_ask` header line (lessons are data, not instructions); subject-name guards. The claim guards are replaced by v2's generated claims and grounded `detail`.
- **PR descriptions** say what changed and how to undo it (decided 2026-10-08, kept in v2).
- **Order of work.** Built in the order that reaches "Done when" fastest; `docs/progress.md` tracks it:
  1. Lesson format v1 (schema, generated claim, grounded `detail`, `signal`, pinned and differential tests), with `tools/verify` and `packages/core`.
  2. `ludion` CLI: `teach` into the personal ledger, `sync` into `.ludion/lessons.md`. This reaches Done 1 (single player) with no server change.
  3. Index shards per subject, built with the site; `teach --public` through `gh`; `ludion_ask` and `ludion_teach` updated. With npm publishing this reaches Done 2 (plumbing).
  4. FreshBench per model: fix the 2026-10-08 answer keys, label loud/silent, record which models miss each change, feed `models` into the shards.
  5. 30 seed lessons (silent changes in vitest, then wrangler and agents), differential tests first.
  6. FreshBench under realistic conditions, with and without `ludion sync`: Done 3 (value).
  7. Then the Claude Code plugin, the site pages, and nightly reverify.

