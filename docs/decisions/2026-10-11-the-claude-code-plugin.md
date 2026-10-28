### 2026-10-11: The Claude Code plugin

- **Where**: `plugin/` in this repo, listed by `.claude-plugin/marketplace.json` at the repo root. Install: `/plugin marketplace add Ludion-ai/ludion`, then `/plugin install ludion@ludion` (or `claude plugin install ludion@ludion`). `claude plugin validate` passes on both.
- **What it does**: a SessionStart hook (`startup|resume|clear`; not `compact`, which keeps the session) runs `npx -y ludion-ai@<version> sync --quiet --dir "${CLAUDE_PROJECT_DIR}"` with a 120-second timeout, and `plugin.json` adds the remote MCP server `ludion` (`https://ludion.ai/mcp`, http).
- **The hook's output is what reaches the session.** Measured on Claude Code 2.1.296: a SessionStart hook runs after CLAUDE.md has been read, so a file the hook writes (even a fast one) reaches only the next session, while the hook's stdout reaches this one. So `sync --quiet` prints nothing unless the lessons changed, or CLAUDE.md was just wired while there are lessons; then it prints the new lessons. The comparison skips the header lines that change on every sync (date, installed summary).
- **The CLI version is pinned** in the hook, and a test keeps it equal to `packages/cli/package.json`. A plugin install then runs exactly the version that was reviewed here, never whatever npm serves next; a new CLI version ships with a plugin version bump.
- **Held with the CLI**: the plugin runs `npx ludion-ai`, so it isn't announced or installable from `main` until the owner has published `ludion-ai` 0.1.0 on npm (same reason as the CLI).
- One command for both shells: no redirects or shell-only syntax, so it runs whether Claude Code picks Git Bash or PowerShell on Windows.

