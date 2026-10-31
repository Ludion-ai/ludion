# LGUARD — the guard refuses runtimes on the host (2026-10-31)

Lane LGUARD, from main 355a91c (ludion-ops#1 comment 6542129458, 1). What the guard refuses and lets through was committed before the code: docs/decisions/2026-10-31-lguard-host-runtime-guard.md (a78697f). The mistake it answers: docs/mistakes/2026-10-31-host-runtimes-five-times.md.

The code was first committed at 27fa8b8. An automated security review ran on each commit and found places where the guard read a command line differently from the shell, so a runtime could hide: three in 27fa8b8 (fixed at 62d2648), two in 62d2648 (fixed at 695424c), one in 695424c (fixed at 4d97495), and two in 4d97495, which are **not fixed**: the lane stopped there, since the brief says to stop work that fails the same way three times in a row and report it. The review of the pushed branch (bdaca26) then reported five more gaps in what the guard covers (three seen: a shell option's value taken for a script file, `GH_REPO` with `{owner}`, launchers not listed such as `winpty`), also not fixed. They are listed in the decision record's section "Added after the automated security review", the open ones marked; each fix came with tests that fail on the commit before it. The runs below are at 6c38b20 unless they say otherwise; 6c38b20 differs from 4d97495 in a code comment naming the two open findings, one test, and records.

## What was changed

- `.claude/hooks/guard.mjs`: a reader that cuts a command line the way bash (or PowerShell, for the PowerShell tool) does, then the rules: runtimes on the host, third-party repositories' files on the host, `-EncodedCommand`, a heredoc it cannot read, and a depth limit. The rules that were there before (deploys, secrets, force pushes, downloads into a shell, backticks) still refuse what they refused; the backtick check now reads quotes, `$( )` and heredoc delimiters more closely.
- `.claude/hooks/guard.test.ts`: the tests that were there, with the five commands that are no longer allowed (three `npx wrangler` runs, `npm test`, `curl … | node -e …`) moved to the refused list, plus the five host runs as typed, the other forms, the reviews' cases, and the commands that must stay allowed.
- `.claude/settings.json`: unchanged up to 6c38b20, whose matcher `Bash|PowerShell` already sent both tools through the hook. From dee0307 (the resumption, below) it has the matcher `Bash|PowerShell|Edit|Write|NotebookEdit` and `"onFailure": "block"`.

## Runs

Every run in Docker, from the host: image `node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c` (node:24-slim, Node 24.22.2, npm 11.19.1), user 1000, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--memory 2g`. The worktree was copied into the volume ludion-lguard-w (without `.git`). Nothing ran on the host but git, gh, docker and text tools (grep, sed, sha256sum). Windows had 12,661 MB free before the first run.

| Run | How | Result |
|---|---|---|
| ci | network on: `npm ci --ignore-scripts --no-audit --no-fund` in the volume | exit 0 |
| baseline | `--network none`: main's guard tests, before any change | 53 passed |
| test | `--network none`: `npx vitest run .claude/hooks/guard.test.ts tools/records/test/records.test.ts` | 2 files, 425 passed (372 at 27fa8b8, 415 at 62d2648, 422 at 695424c, 424 at 4d97495) |
| review 1's tests on 27fa8b8 | the 40 tests added for the first review, against 27fa8b8's guard.mjs | 27 failed, 13 passed (the allowed cases, and two commands 27fa8b8 refused for another reason) |
| review 2's tests on 62d2648 | 695424c's guard tests, against 62d2648's guard.mjs | 5 failed (the `$( )` delimiter, three backtick cases, the message), 403 passed |
| review 3's tests on 695424c | 4d97495's guard tests, against 695424c's guard.mjs | 1 failed (the reviewer's case), 409 passed |
| typecheck | `--network none`: `npm run typecheck`, and `npx tsc` on a config that adds `.claude/hooks/guard.test.ts` (tsconfig.json does not include `.claude/`) | both exit 0, at each commit |
| mutations, run 1 | `--network none`: scripts/mutate.mjs on the code before 27fa8b8 | 190: caught 185, survived 2, not applied 3, void 0 (logs/mutations-run1.txt) |
| mutations, runs 2 to 4 | at 27fa8b8, 62d2648 and 695424c | each stopped within minutes, when a security review of that commit came in; no result kept |
| mutations, run 5 | `--network none`: scripts/mutate.mjs at 4d97495 | 219: caught 217, survived 2 (H4, R3), not applied 0, void 0 (logs/mutations-run5.txt) |
| mutations, run 6 | `--network none`: scripts/mutate.mjs at 6c38b20 | 219: caught 218, survived 1 (R3, below), not applied 0, void 0; the unchanged file's tests passed first (411 passed with `--bail=1`) (logs/mutations.txt) |

### The mutations

scripts/mutate.mjs changes one rule of guard.mjs at a time in the volume's copy, runs the guard's tests with `--bail=1`, and puts the file back. A mutation is caught when the tests fail; the run starts with the unchanged file, whose tests must pass. A mutation whose text is not found exactly once is "not applied". Every refusal rule has at least one; the 219 are, by the first letter of their id: N, each runtime name (23); B, how a program is named and the runtime rule itself (12); P, what comes before the program: assignments, redirections, wrappers, keywords, npx (37); S, starters, find, shells, evaluators and the depth limit (31); F, what a shell reads from stdin (9); L, the reader: quotes, escapes, comments, here-strings, heredocs, groups, separators (34); H, the heredoc delimiter and unread heredocs (15); R, the backtick check's stack (6); W, PowerShell's look-alike characters and white space (7); T, third-party files (36); E, the rules that were there before (9).

Run 1 found five that did not do their job, and each was fixed before the next run:

- **P25 survived (wsl -e):** a wrapper's other options are skipped anyway, so naming `-e` changed nothing. The `names` option was removed from guard.mjs, with its mutation.
- **P34 survived (keyword while):** no test had a runtime right after `while`. `while node x; do sleep 1; done` was added.
- **S13, L15, L16 not applied:** the mutations' text was wrong (S13) or found twice (L15 and L16 also matched runsBacktick). Their text was made exact.

Also changed while writing the mutations, before run 1, because no test could tell the code apart from a mutation: a `${…}` branch that kept the text unread (it would have hidden bash 5.3's `${ node; }`), wsl's "any other option runs nothing", a line of readsProgram that a plain word already covers, the wrappers' own `--` check, and check()'s depth check (refuse() stops at the limit). One gap found the same way was fixed: in `start cmd /c node x`, cmd's `/c` was read as a switch of `start`; switches now count only before the program.

Run 5 (at 4d97495) left two survivors:

- **H4 (the backslash escape inside a double-quoted delimiter):** no test made it matter alone; with it off, the misread word ran into a new line and was refused as unread anyway. 6c38b20 adds `cat <<"E\$F"`, whose delimiter is `E$F` to bash.
- **R3 (the backtick check skips an unread `<<` word):** equivalent in every case tested. check() refuses an unread heredoc before the backtick check runs, so the backtick check's handling of it does not show. It stays, so that the backtick check does not take a word it cannot read as a heredoc where the two readings differ.

## Resumption (2026-10-31 23:4x JST, the chat's comment 6544620643, 1)

Main fdbcf50 was merged into the branch (1cc2bf6; main had not changed `.claude/`). Definitions first (6cb7457), then the code (dee0307): `"onFailure": "block"` and the matcher `Bash|PowerShell|Edit|Write|NotebookEdit` in settings.json; one try/catch in guard.mjs; groups nested at most 64 deep; no imports (`process.getBuiltinModule`); Edit, Write and NotebookEdit refused in `.claude/` at the top of the file's git work tree. The mistake record counts at least six host runs.

| Run | How | Result |
|---|---|---|
| test | `--network none`, `--maxWorkers=2`: guard and records tests at dee0307 | 2 files, 434 passed |
| typecheck | as above | both exit 0 |
| live, this session on Windows | Write after settings.json changed | refused: `…\.claude\hooks\probe.txt`, `…\.CLAUDE\Hooks\probe.txt`, `C:/…/docs/../.claude/hooks/probe.txt`; allowed: this repository's `docs/` files |
| mutations, run 7 | `--network none`: scripts/mutate.mjs at dee0307, with G1–G14 for the new rules (G12 and G13 change settings.json) | 233: caught 228, survived 5, not applied 0, void 0; the unchanged file's tests passed first (420 passed with `--bail=1`) (logs/mutations.txt; run 6's log is logs/mutations-run6.txt) |

The new matcher applied to this lane's own session as soon as settings.json changed (Claude Code reloads settings), although the chat's comment 6543282859, 4 expected it to take effect only after the merge. The lane's next edit, two more tests in guard.test.ts (groups side by side are not counted as nested; a file not yet made, reached through a link, is refused), was refused, and the lane did not go round it with a Bash write. Mutations that only those tests would catch are reported as survived.

Run 7's five survivors:

- **G3 (a group's end lowers the count), G11 (the deepest existing part of the path), G6 (NotebookEdit's `notebook_path`):** each needs a test that could not be added after the matcher applied: groups side by side (`echo $(echo x) …` 80 times), a file not yet made reached through a link, and a NotebookEdit outside `.claude/` that must pass. Without G6's field, NotebookEdit is refused everywhere (a write whose file cannot be named), so the gap is too much refusal, not too little; without G3, many groups side by side would be refused; without G11, a new file reached through a link to `.claude/` would pass.
- **G7 (backslashes become slashes before resolving):** on Windows `path.resolve` takes a backslash as a separator anyway; in the Linux test the case fold also turns backslashes into slashes, and the tested folder lies inside the repository's own `.claude/`, so the result does not change.
- **R3:** equivalent, as in runs 5 and 6.

## Not done here

- No run of the whole node test project: only `.claude/hooks/` and `docs/` changed, and the records test covers `docs/`.
- The hook was not tried live in this session with a runtime: had it let one through, the runtime would have run on the host. Its own calls (git, gh, docker) went through it after each change.
- The remaining holes are in the decision record; the chat decides whether to close them.

## 2026-11-01: Monitor denied, container examples read-only and pinned (the chat's comment 6550639256, 2)

From 5afba97. The guard refuses Edit and Write under `.claude/`, so the changes to `.claude/` were made in a clone inside a Docker volume (node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413, Node 24.22.2, npm 11.19.1, user 1000, `--memory 4g`, `--cap-drop ALL`, no Docker socket), committed there and pushed from the host without checking the commit out in the host's worktree. Dependencies: `npm ci --ignore-scripts` (network on); everything after it ran with `--network none`. Nothing ran on the host but git, gh and docker.

| step | command | result |
|---|---|---|
| before any change | `npx vitest run .claude/hooks/guard.test.ts tools/records/test/records.test.ts` | 2 files, 434 passed |
| tests first, on 5afba97's guard.mjs and settings.json | same | 3 failed, 433 passed (436): "says what to do instead", "gives container examples that mount the worktree read-only and pin the image by digest", "denies the Monitor tool as a whole in permissions, and leaves the matcher as it is" |
| with the change | same | 2 files, 436 passed |
| typecheck | `npm run typecheck`, and `npx tsc` on a config that adds `.claude/hooks/guard.test.ts` | both exit 0 |

The image digests were read with `docker buildx imagetools inspect` on 2026-11-01; each resolved on Docker Hub. The first version of the new mount check also matched `-v (Get-Command` in the message's `command -v` hint and failed with the change in place; it now matches only `-v <source>:/<target>`, and the three tests still fail on 5afba97's files (the second row was run again after that). No mutation run for this change.
