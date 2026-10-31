# 2026-10-31 — The guard refuses JavaScript and Python runtimes on the host, and reading third-party repositories' files there

**Decided 2026-10-31** by the owner's Claude chat (ludion-ops#1 comment 6542129458, 1: "決まりではなく、ガードで止める"), after the fifth run of node, npm, npx or python on the host. Earlier decisions it follows: comment 6525367644, 3 (the names, and that MCP servers Claude Code starts with npx are not the guard's business), comment 6533365853, 3 (refuse `gh api repos/<not Ludion-ai>/…` contents, compare, commits/<sha> and tarball on the host), comment 6528291928, 5 (the hook's own node is the owner's tool and is not counted). The coordinator added finding 5 of audit comment 6542250801 to this PR's brief: more names, `cmd /c`, `Start-Process`, absolute paths, the forms that must stay allowed, and the message. Written by lane LGUARD before the code, from main 355a91c. The owner merges the PR (`.claude/` is a protected path).

## Why

A brief that says "do not run node on the host" was broken five times (docs/mistakes/2026-10-31-host-runtimes-five-times.md). CLAUDE.md, How we work: "Prefer a check that runs (a test, a CI job, a hook) to a rule someone has to remember."

## What is refused

`.claude/hooks/guard.mjs` already runs before every Bash and PowerShell call (`.claude/settings.json`, matcher `Bash|PowerShell`, unchanged). It now also refuses, with exit 2:

1. **A JavaScript or Python runtime or package manager started on the host:** node, npm, npx, pnpm, yarn, bun, deno, tsx, vitest, python, python3, py, pip, uv, corepack. The lane adds the same programs' other names: nodejs, pnpx, yarnpkg, bunx, uvx, pythonw, pyw, `python3.13` and the like, pip3 and `pip3.13`.
   - The name is the file name without its folder, a Windows extension (`.exe`, `.cmd`, `.bat`, `.ps1`, `.com`) or case, so `C:\Program Files\nodejs\node.exe`, `/usr/bin/node`, `.\node.exe`, `npm.cmd` and `NODE.EXE` are refused too.
   - Also refused: any program run from a `node_modules` folder (`node_modules/.bin/tsc`), which is an installed package's code.
2. **Reading a third-party repository's files on the host**, where third-party means a GitHub owner other than Ludion-ai (any case). `{owner}` and `:owner` in a `gh api` path name the current repository and count as Ludion-ai.
   - `gh api` with an endpoint `repos/<owner>/<repo>/…` (with or without a leading `/` or `https://api.github.com/`) that returns files or patches: `contents`, `readme`, `compare/…`, `commits/<ref>` (one commit, with its patch), `git/blobs/…`, `tarball`, `zipball`, `pulls/<n>/files`. The last five are the same content by other endpoints; without them the brain's four would be bypassed by a rename. Any other `repos/<owner>/<repo>/…` endpoint is refused only when a header asks for a diff, a patch, raw content or `octet-stream`.
   - The same URLs, and GitHub's file hosts, in a download command (curl, wget, iwr, irm, Invoke-WebRequest, Invoke-RestMethod): `raw.githubusercontent.com/<owner>/…`, `codeload.github.com/<owner>/…`, `github.com/<owner>/<repo>/` followed by `raw/`, `blob/`, `archive/`, `commit/` or `compare/`, and `github.com/<owner>/<repo>/pull/<n>` with `.diff`, `.patch` or `/files`.
   - Cloning: `gh repo clone <owner>/<repo>`, and `git clone` of anything but a Ludion-ai repository on github.com or a local path (another host counts as third-party).
   - `gh pr diff`, `gh pr checkout` and `gh release download` with `-R`/`--repo` (or a github.com URL) naming another owner.

   The lane added cloning, the download commands and the three gh commands: they put the same files on the host as the endpoints the brain named, and CLAUDE.md already says "Read third-party repositories only inside a container with no credentials".
3. **A PowerShell `-EncodedCommand`** (`-e`, `-ec`, `-enc`…): the guard cannot read it.
4. **A command nested more than four levels deep** (a shell string inside a shell string, `eval`, `iex`…): it cannot be judged, so it stops, as CLAUDE.md's Product says of anything that cannot be judged. Before, a string three levels deep was let through unread.

The message for 1 says what to do instead: run it inside Docker (for example `docker run --rm --network none -v <worktree>:/w -w /w node:24 node <script>`; for Python, `python:3.14-slim`), use `command -v` (Get-Command in PowerShell) to see whether a program is installed, and the editor's tools to change files. The message for 2 says to read it inside a container with no credentials (for example `docker run --rm --read-only --cap-drop ALL curlimages/curl:8.11.1 -fsSL <url>`).

## Where a program is seen

The command line is read the way bash reads it (PowerShell for the PowerShell tool): quotes and escapes removed, and quoted parts of one word joined, so `n'o'de`, `no""de`, `no\de`, a backslash-newline inside a name, and PowerShell's `` n`ode `` are all node. A program counts when it is the first word of a command:

- after `;`, `&&`, `||`, `&`, `|`, `|&` and new lines (`2>&1`, `>&` and `&>` are redirections, not separators);
- inside `( )`, `{ }` and `$( )` — also `$( )` inside double quotes, inside an unquoted heredoc and inside a PowerShell `@"…"@` here-string, which the shell runs before the command; PowerShell script blocks (`{ node x }` in `ForEach-Object`, `Invoke-Command`, `Start-Job`) are `{ }`;
- after variable assignments (`FOO=1 node`, PowerShell's `$v = node -v`), redirections, and the words that start the command after them: `sudo`, `doas`, `env` (its `-S` string too), `time`, `exec`, `nice`, `nohup`, `stdbuf`, `timeout` (after its duration), `xargs`, `command` (not `command -v`/`-V`, which only look), `builtin`, `call`, `wsl` (not `wsl --list` and other options that run nothing), and bash's `if`, `then`, `else`, `elif`, `do`, `while`, `until`, `!`, `coproc`;
- after PowerShell's `&` call operator; as `Start-Process`'s (`saps`, `start`) program and arguments (`-FilePath`, `-ArgumentList`, or the first and second plain words), and cmd's `start`; after `find … -exec`;
- as a shell's command string: `sh`, `bash`, `zsh`, `dash`, `ksh`, `ash` with `-c` (or a flag group holding c, like `-lc`), `pwsh`/`powershell` with `-Command` (or its abbreviations, `-CommandWithArgs`), `cmd` with `/c`, `/k`, `//c` or `//k` (the form Git Bash needs); `eval`, `iex` and `Invoke-Expression` with a string;
- as the program a shell reads from stdin, when the guard can see it: a heredoc's body (`bash <<'EOF'`), a here-string (`bash <<< 'node x'`), and what `echo`, `printf`, `Write-Output`, a heredoc or a lone string feeds it through a pipe (`echo 'node x' | sh`, `'node x' | iex`).

## What is not refused (each fixed by a test)

- Anything inside a container: `docker run … node …`, `docker exec … npm …`, `docker compose …`, `docker build …`. The words after `docker` are its arguments, not commands.
- `git`, `gh` (Ludion-ai's repositories, and other repositories' metadata: `repos/<owner>/<repo>`, releases, tags, issues, the list of commits), `claude`, `curl -sI https://ludion.ai/`.
- A name that is only mentioned: arguments (`grep node`, `ls node_modules`, `echo npm`), quoted text (`git commit -m "…node…"`, a PR title), comments (`# node x`), a heredoc or here-string given to a program that is not a shell (`git commit -F - <<'EOF'`, `cat <<'EOF' > notes.md`, `gh pr create --body "$(cat <<'EOF' … EOF)"`, PowerShell's `git commit -m @'…'@`).
- Looking a program up: `command -v node`, `which`, `where`, `type`, `Get-Command`.
- What is not an agent's command: the hook's own `node` in `.claude/settings.json` (comment 6528291928, 5), and the MCP servers Claude Code starts with npx (comment 6525367644, 3). The hook does not see them.

## What changes for commands the guard allowed before

`npx wrangler deploy --dry-run`, `npx wrangler dev`, `npm test` and `curl … | node -e …` were tests of commands the guard let through. They start npx, npm or node on the host, so they are refused now and their tests move to the refused list. A deploy still gets the deploy message (deploy.yml), checked before the runtime rule.

## Remaining holes (the brain decides whether to close them)

- **A script file's contents are not seen.** For `sh x.sh`, `bash x.sh`, `pwsh -File x.ps1`, `. ./x.ps1`, `source x.sh`, `cmd /c x.bat` or `cat x.sh | sh`, the hook sees the shell and the file's name, not the `node` written inside it (audit comment 6542250801, 5).
- **A program named through a variable, a lookup or .NET** (`$n = "node"; & $n`, `& (Get-Command node)`, `[Diagnostics.Process]::Start("node")`), or through an alias or function defined in an earlier call.
- **Programs that are node or Python scripts installed on the PATH under their own names** (`tsc`, `wrangler`, `playwright`, `astro`, any global npm CLI) are not refused by name, unless run from a `node_modules` folder. `claude` is one of them and must stay allowed.
- **Other ways to read third-party files:** a GraphQL query (`object(expression:)`), `git fetch` or `git pull` from a URL, `git clone --upload-pack`, gists, and download commands to hosts other than GitHub's.
- **The hook only sees agents' Bash and PowerShell calls.** It counts nothing: whether a short-lived node ran is shown only by a record of process creation (Windows event 4688 with command lines, or Sysmon event 1), which is the PC's setting and the owner's decision (audit comment 6542250801, 5).
- It is a backstop, not bash or PowerShell: `$'…'` strings, brace expansion and other syntax it does not model can hide a name.

## Added after the automated security review of 27fa8b8 (2026-10-31, before any human review)

The review found three places where the guard read a command line differently from the shell, so a runtime could hide. Each is fixed, with tests that fail on 27fa8b8; nothing refused before is let through now.

- **A heredoc's delimiter is read as bash reads the whole word:** quotes and backslashes removed, literal when any part was quoted (`cat <<E"OF"` ends at `EOF`, not `E`). This adds a refusal: **a heredoc whose delimiter cannot be read** (no word, an unclosed single quote, `$'…'`, a new line inside it) **or that has no terminator line** is refused, since where its text ends cannot be judged. The backtick check reads the delimiter the same way.
- **A `#` starts a comment only after a space, tab, new line or `;&|()<>`,** so a CR (or another space character) before it hides nothing. A CR still ends a word, which only judges more.
- **PowerShell:** curly quotes are read as quotes and en and em dashes as `-`, as the review says PowerShell's tokenizer reads them. A lone CR and the Unicode line separators are taken as new lines, and any white space ends a word; how PowerShell itself treats each was not checked, and cutting there only judges more.

## The tests

The tests stay where the guard's tests are, `.claude/hooks/guard.test.ts`, which the root `vitest.config.ts` (project `node`, `.claude/hooks/*.test.ts`) and CI already run. They run in Docker only (`--network none`, `--memory 2g`, `--cap-drop ALL`, a non-root user), never on the host. Every refusal rule above gets at least one mutation that turns it off, applied in Docker; each must make the tests fail. The mutations and their results are in docs/bench/2026-10-31-lguard/.
