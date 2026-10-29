## Current work: batch mode (from 2026-10-12)

The owner asked for the list below to be worked through in order without stopping for confirmation, with one report at the end. After a `/clear`, resume here: "docs/progress.md の続きから".

How the work runs:

- Every PR gets its tests and a fresh-context review (subagent). An unprotected PR is merged by us once CI is green.
- A protected PR (CLAUDE.md, `.github/`, `tools/verify/`, the schema, `lessons/`, `ludion.config.json`, `wrangler.jsonc`) is opened with its review posted as a comment and the `needs-owner` label, and the work moves on. Later work that depends on it is stacked on it.
- npm: one `publish.yml` stage at the end, once every CLI change is on main.
- Stop only for CLAUDE.md's "Stop and ask" items. Everything else is decided and written in `docs/decisions.md`.
- If the usage limit is hit, write here how far the work got, then stop.
- Every measured number goes in `docs/bench/`; no unmeasured number anywhere.

The list (status in brackets):

1. [done, #51] Replace the two seeds prepared in #50 (`DO_NOT_TRACK`, `--durable-objects-code-update-mode`), checked against primary sources.
2. [done, #53; issue form #54 waits for the owner] Say coverage is partial: `.ludion/lessons.md` and `ludion_ask` say Ludion holds some changes of some packages, that no lesson is no evidence of no change, and to check primary sources. Sync lists lockfile packages with no subject and one line on how to request one (issue URL with a template, label `subject-request`).
3. [built, branch `seed-pipeline`, no PR yet; yield numbers pending (next step 1)] `tools/seed`: package + version range → changelog, releases, source diff → drafted candidates → kind (with the "does code that doesn't use it behave differently" check) → differential tests → Docker → FreshBench `models` → harm check → one PR per subject labeled "drafted by an agent". Run it on the 30 existing seeds and compare (candidates, kept, review findings, in `docs/bench/`). Then a nightly workflow that watches covered subjects' new releases and opens PRs (protected).
4. [paused: 20 candidates scored and 3 chosen, zod/tailwindcss partly drafted, ai not started; next step 2 does one subject only] Two or more new subjects (target 6). Score 20 candidates on "AI writes it often" × release frequency × share of silent changes in the last 180 days; table in decisions. Each: FreshBench questions and keys from primary sources, seeds frozen, then B measurement and harm check. One seed PR per subject (protected).
5. [done, #55] Personal ledger: `ludion teach` accepts drafts without evidence, saved as `unverified`, shown in `lessons.md` as "unverified, yours only". `--public` still needs evidence.
6. [done, #63: no drop, no skill delivery] Experiment 3: 0, 50 and 500 correct but unrelated lessons, B accuracy. A drop of 10 points or more at 500 → build skill delivery (`.agents/skills/ludion-{subject}/SKILL.md`); otherwise don't, and say why.
7. [paused after 16 of 36 tasks (#61): daily batches stopped to save usage] C tasks: one batch a day (method in `docs/bench/2026-10-11-done3/README.md`). If C's gain is 10+ points below B's (+27), build the check hook (PostToolUse on Edit/Write matching imports and symbols against installed-version lessons) and measure it on part of C; otherwise don't, and say why.
8. [done, #93 merged 2026-10-13: README, 89-second demo, Show HN and X drafts, two letters; nothing posted or sent] Announcement tools: README (measured numbers only), an 89-second demo (`docs/demo/sync-vitest.cast`), one maintainer letter per subject, two so far (Cloudflare for wrangler and the Agents SDK together, and Vitest; each with a per-subject table of changes current models get wrong silently, asking whether they would pay for measurement), a Show HN post and one X post. The owner sends and posts them. More letters wait for the owner's discussion and for the subject to be measured.
9. [done, #57] Check that `llms.txt` and the per-lesson static pages are in a shape web search picks up.
10. [done, #100] License: the owner decided on 2026-10-13 that lessons are CC BY 4.0 (code stays Apache-2.0). `LICENSE-LESSONS`, the README, the CLI's README and the site footer say so; `teach --public` shows the teacher's sentence before its prompt and quotes it in the PR (in the next release of the CLI). #60 closed.

### Spending rules (2026-10-12, in force; details in `docs/decisions.md`, "Spending")

Heavy work one job at a time; Opus only for the review of protected PRs (one round); pipeline work on Sonnet; no per-lesson model FreshBench; no daily C batches; big files read through summaries; this file updated after each work item.

### What waits for the owner, in order (2026-10-13, latest)

1. ~~npmjs.com, `ludion-ai`: approve 0.1.4, reject 0.1.3.~~ **Done** (checked 2026-10-13): `latest` is 0.1.4, and 0.1.3 is deprecated ("Use 0.1.4 or later"). `npx ludion-ai@0.1.4 sync` in an empty folder against production exited 0 (`docs/bench/2026-10-13-done2/sync-production-0.1.4.txt`).
2. ~~Done 2, one line~~ **Done, passed** (2026-10-13): the owner ran `teach --public` from their own terminal (an agent's attempt stops at the confirmation, as designed), #97 merged; the three times and the three checks by hand are in `docs/bench/2026-10-13-done2/result.json`.
3. **Protected PRs, merge order** (2026-10-13): **#94** (retracts wrangler 4.113.0#10; users stop getting that lesson), then **#101** (Analytics Engine counting of `/index/*.json`; see 4), then Codex's **#69** (after its fixes; it will need a rebase over #100 and #101). #96 (`/bench`) was merged by the owner.
4. **After #101 is merged: the Worker secret.** `npx wrangler secret put ANALYTICS_SALT` with at least 32 random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Until it is set the Worker counts nothing. If the deploy after the merge says Analytics Engine must be enabled for the account, enable it where the message says. What is stored, what the numbers mean and don't, and the SQL: `docs/bench/2026-10-13-index-counts/`.
5. **Next npm release, 0.1.5** (CLI + `plugin.json` + the hook's pin): carries the consent sentence (#100) and, when it lands, #69. I stage it with `publish.yml`; the owner approves it on npmjs.com (passkey). Until then `teach --public` shows no sentence. Whether to stage it now or wait for #69 is the owner's call; the default is to wait, to ask for one approval instead of two.

### Open PRs and what waits for whom (2026-10-13, after the owner's merges)

- **Merged by the owner on 2026-10-12 (UTC):** #62, #75, #76, #80, #84 (25 lessons), #73 (nightly seed watch), #54 (issue form). Production serves them since deploy run 38311678194 on `6dedffa`: `/index/subjects.json` lists agents 15, vitest 17, wrangler 23 active lessons. The deploys for the commits in between failed on purpose at "Make sure this is main's newest commit".
- **#73 drafts nothing yet**: it needs the `ANTHROPIC_API_KEY` repository secret (a secret value, the owner's). Without it, the nightly run lists new releases in its artifact and stops.
- **Waiting for Codex, then the owner's merge:** #67 and #68 were closed unmerged by Codex; **#69** is now the one open PR ("Harden sync privacy and benchmark verification", `needs-owner`). It touches the CLI, the Worker and the site strings, so it needs a rebase over #100 and #101.
- **After #69 is on main (this side):** rebase open work, bump the CLI to 0.1.5 with the plugin pin (0.1.3 was skipped and 0.1.4 carries the User-Agent), run `publish.yml` (the owner approves the staged version on npmjs.com), and dispatch `reverify` (lessons on main haven't run under #67's Docker flags).

### Who works on what (owner, 2026-10-12)

Codex: security, audits, the benchmark (`tools/bench`). Claude Code: the seed pipeline (`tools/seed`), lessons, the site, publishing. A change that needs the other side's files is raised with the owner before it starts. Main conversation on Sonnet; Opus only for the pipeline's reviewer and content reviser and for protected-PR reviews.

### Next (in order)

1. [done] Pipeline yield against the hand-made seeds (`docs/bench/2026-10-12-seed/README.md`).
2. [decided by the owner] Who revises: machine-check problems back to the drafting model (Sonnet) first; then the Opus review; lessons with content findings (rules 1, 7, 8) to Opus, the rest to Sonnet, one round (`docs/decisions.md`, "Revising seed drafts"). Built in `tools/seed` (`revise --scope check|findings`, review reuse for unchanged drafts).
3. [reviews done, see above] After the owner merges them: rebase this side's open work on main, bump the CLI (0.1.3 and 0.1.4 carry #53, #55 and the User-Agent and are staged; #67 is not in them, so it goes out as 0.1.5) with the plugin pin, and stage it with `publish.yml`.
4. [done] vitest and wrangler: the remaining drafts through step 2. No finding after it: vitest 5 of 23 reviewed (3 new, #80), wrangler 11 of 43 (8 new, #84); the rest repeat lessons on main. Counts and costs: `docs/bench/2026-10-12-seed/README.md`. Search questions: #82, #83. CI: #80 3 of 3; #84 8 of 8 after one `fix` round. Opus review of both (one round): #80 approve; #84 one lesson fixed (4.113.0#10 now says provisioning is generally available). Both wait for the owner's merge.
5. Not started: the three outreach letters for subjects not yet measured.

### Where the running work lives (for resuming)

- Worktrees: `C:/dev/ludion-wt-seed` (branch `seed-pipeline`: `tools/seed`, `.github/workflows/seed-watch.yml`, results in `docs/bench/2026-10-12-seed/` and `docs/bench/2026-10-12-subjects/`), `C:/dev/ludion-wt-exp3` (branch `exp3-unrelated`: `tools/bench/src/unrelated.ts`, CLI built from main at `e7d82d7`).
- Large caches outside the repo: `C:/dev/ludion-seedwork/` (unpacked packages, agent folders, logs `draft-silent.log`, `subjects20.log`, `c-batch-<date>.log`, the bench projects in `bench-projects/`, the day's C batch script `c-batch.sh <ids>`).
- The pipeline's steps resume from their files: rerun the same `node tools/seed/src/cli.ts <step> <dir>` command.
- C tasks: `bash C:/dev/ludion-seedwork/c-batch.sh <ids>` runs one day's tasks under both conditions (frozen seeds served from `C:/dev/ludion-freeze`); results land in `docs/bench/2026-10-11-done3/` of `C:/dev/ludion` and are committed in a docs PR.

