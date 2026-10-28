### 2026-10-11: Deploy safety (from #20)

- **Only main's newest commit deploys.** Right before `wrangler deploy`, `deploy.yml` fetches `origin/main` and fails if `HEAD` is older: "This run is for an old commit (…); main is now at …. Deploy main's newest commit with: gh workflow run deploy.yml --ref main". A rerun of an old run can't put old code over newer code, and a queued run whose commit was overtaken fails while the newer run deploys.
- **HSTS**: `Strict-Transport-Security: max-age=31536000` on every Worker response and every static asset (`_headers`). No `includeSubDomains` or `preload`, because both are hard to undo. Together with Always Use HTTPS on the zone, plain HTTP isn't served.
- **The command guard for Claude Code in this repo**:
  - `.claude/settings.json` denies, in Bash and PowerShell forms: `wrangler deploy`, `wrangler versions deploy`, `wrangler secret`, `gh secret`, force pushes, `gh repo delete`, bare shells, and `Invoke-Expression`.
  - A deny rule can't make an exception for `--dry-run`, and rules see each side of a pipe separately. So a PreToolUse hook (`.claude/hooks/guard.mjs`) sees the whole command line.
    - It splits the line into commands and pipeline stages, respecting quotes, and judges each command by the program it runs: through `npx`, `node …/wrangler.js`, `sudo`, and env assignments, and into `bash -c "…"` payloads.
    - Blocked: `wrangler deploy`, `versions deploy`, `versions upload`, `rollback`, and `delete` unless that command has `--dry-run`; `wrangler secret` and `versions secret`; `gh secret`; force pushes (`--force`, `--force-with-lease`, any short flag containing `f` such as `-uf`, and `+refspec`); `gh repo delete`; a download piped into a shell or interpreter that reads its program from stdin; and `iex` on a download.
    - Words that merely appear (a commit message, a grep pattern, a PR body) don't count.
    - Tests list what it blocks and what it lets through.
  - If `node` can't be found, the hook fails without blocking, and the deny rules still apply.
  - It backs up the rule that production changes only through `deploy.yml`.

