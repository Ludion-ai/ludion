# Show HN (draft)

Drafts only: the owner posts it, from their own account, and edits it as they see fit. Every number comes from `docs/bench/` (the folder is named next to each one). Before posting: check the numbers against the newest measurements, and post after `ludion-ai` 0.1.4 is on npm (the sentence about naming dependencies with no lessons is true of 0.1.3 and later).

## Title

Show HN: Ludion – tell your AI assistant what changed in your dependencies

(74 characters; Hacker News allows 80.)

## URL

https://github.com/Ludion-ai/ludion

## Text

Models learn once and software keeps changing. A change that makes noise (an error, a failing test) gets fixed by the assistant's own run loop. A change that makes none (a new default, a different return value, a deprecated call that still runs) ships. Ludion is for those.

`npx ludion-ai sync` reads your lockfile and writes `.ludion/lessons.md`, imported from CLAUDE.md (and named in AGENTS.md, and written into a Cursor rule, when you have them): only the changes for the versions your project installed, and, when it is told the model, minus the ones that model is measured to know. There is a Claude Code plugin that runs it at session start and adds an MCP server (`ludion_ask`).

Each lesson is one change. Its sentence is generated from structured fields, not written by hand; its evidence is either a test that passes on the new version and fails on the one before (run in Docker with the network off), or a quote that states the fact on its source page. It is signed by the GitHub account that taught it: `ludion teach --public` opens a pull request from your own `gh` after you have seen the whole lesson. The CLI has no telemetry.

What we measured (`docs/bench/2026-10-11-done3/`): 45 recent changes in vitest 5.0, wrangler 4.111 to 4.148 and the Cloudflare Agents SDK 0.19 to 0.27, one question per change, answer keys checked against primary sources. Claude Code (claude-opus-5-5) with its read-only tools (read, search, web search and fetch, and a few fixed commands such as `npm ls`), in projects with the new versions installed, answered 24 of 45 questions right on its own and 36 of 45 with `ludion sync` (the lessons as frozen on 2026-10-11 and served from a local build; the lessons on ludion.ai today are not the ones measured). The whole gain was on the 30 changes a lesson covers (16 to 28); on the 15 it doesn't cover, it didn't move (8 and 8). With no tools at all, Claude Haiku, Sonnet and Opus 5.5 answered 3 to 5 of the same 45 changes right per trial, asked in another wording (`docs/bench/2026-10-11-models/`).

Caveats: one trial per question and condition. The lessons were drafted from the same verified answer keys that grade the answers, so this measures whether a known change reaches the assistant, not whether Ludion finds changes. The lessons were written by an agent and are labeled that way wherever they appear. These are answers to questions, not code: a coding-task version of the check is only partly run and isn't reported. The lessons on ludion.ai have changed since; this is not a measurement of today's set. In our own check, one lesson's wording made an answer worse, so we withheld it (`docs/bench/2026-10-11-done3/`, "Harm check").

Ludion holds only some changes of some packages. A missing lesson is not evidence that nothing changed: check the changelog too. `sync` names the dependencies it has no lessons for and says where to ask for them.

An 89-second replay of recorded runs (one question without and with sync, then a lesson taught once and written in another project): https://github.com/Ludion-ai/ludion/blob/main/docs/demo/sync-vitest.cast (`asciinema play docs/demo/sync-vitest.cast`).

I'd most like to hear which package's changes you'd want covered, and which lesson says something you'd put differently: every lesson is a file in the repo, and a correction is a pull request.
