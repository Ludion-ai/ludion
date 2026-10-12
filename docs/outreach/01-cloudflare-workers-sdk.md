# To: Cloudflare Workers SDK and Agents SDK maintainers

Subject: Which wrangler and Agents SDK changes AI assistants get wrong, measured

Hi,

I run Ludion (https://ludion.ai), which tells AI coding assistants what changed in the versions a project installed: one lesson per change, each checked by a test across versions in Docker or by a quote from your changelog, and signed by the GitHub account that taught it. wrangler and the Agents SDK are two of its first three subjects.

We measured how current models do on recent changes in both, and I thought you would want to see it.

- With no tools, Claude Haiku, Sonnet and Opus 5.5 got 3 to 5 of 45 recent changes right per trial (wrangler 4.111 to 4.148, Agents SDK 0.19 to 0.27, and vitest 5.0).
- Claude Code with its default tools, web search included, in a project with the new versions installed, got 24 of 45 right. With Ludion's lessons for the installed versions written into the project, it got 36 of 45. The whole gain was on changes a lesson covered.
- The attached table lists the changes that make no noise: code written for the older version still runs, and does something different. Claude Code in the project got 5 of 11 such wrangler changes and 3 of 6 such Agents SDK changes wrong or didn't answer.

Every number comes from files in https://github.com/Ludion-ai/ludion/tree/main/docs/bench (questions, answer keys checked against your changelogs and source, raw logs, and grades).

Two questions:

1. Would a table like this, per release, be useful to you? For example, to see which changes in a release assistants will get wrong, or to word changelog entries so they do.
2. Would Cloudflare pay for that measurement, run on each release and on the models your users use? I'm asking before building it, to know whether it's worth building.

Every lesson for wrangler and the Agents SDK was drafted by an agent and is labeled that way; if any of them says something about wrangler or the Agents SDK that you'd put differently, a pull request or an issue that says so is the fastest way to correct it.

Thank you for reading,
<owner's name>

---

Attach: the wrangler and agents sections of `docs/outreach/tables.md`.
