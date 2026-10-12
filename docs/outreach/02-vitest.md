# To: Vitest maintainers (VoidZero)

Subject: Which Vitest 5 changes AI assistants get wrong, measured

Hi,

I run Ludion (https://ludion.ai), which tells AI coding assistants what changed in the versions a project installed: one lesson per change, each checked by a test across versions in Docker or by a quote from the docs, and signed by the GitHub account that taught it. Vitest is one of its first three subjects.

We measured how current models do on Vitest 5.0's changes, and I thought you'd want to see it.

- With no tools, Claude Haiku, Sonnet and Opus 5.5 got 3 to 5 of 45 recent changes right per trial (Vitest 5.0, wrangler and the Cloudflare Agents SDK).
- Claude Code with its default tools, web search included, in a project with Vitest 5.0.3 installed, got 24 of 45 right; with Ludion's lessons for the installed versions written into the project, 36 of 45. The whole gain was on changes a lesson covered.
- The attached table lists the Vitest 5 changes that make no noise, such as inline projects now inheriting the root config and `-t` matching the full name with ` > `. Claude Code in the project got 4 of those 6 wrong or didn't answer.

Every number comes from files in https://github.com/Ludion-ai/ludion/tree/main/docs/bench (questions, answer keys checked against the Vitest docs and source, raw logs, and grades).

Two questions:

1. Would a table like this, per release, be useful to you, for example to see which changes in a major assistants will get wrong before users hit them, or to shape the migration guide?
2. Would VoidZero pay for that measurement, run on each release and on the models your users use? I'm asking before building it.

Every lesson for Vitest was drafted by an agent and is labeled that way. If one of them says something about Vitest that you'd put differently, an issue or a pull request is the fastest way to correct it.

Thank you for reading,
<owner's name>

---

Attach: the vitest section of `docs/outreach/tables.md`.
