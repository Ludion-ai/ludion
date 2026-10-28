### 2026-10-12: Published as ludion-ai; the v2 stack is on main

- npm refused the name `ludion` ("too similar to luxon"), so the CLI is `ludion-ai` (two bins, `ludion` and `ludion-ai`). 0.1.0 was published by hand with the owner's passkey. 0.1.1 (sync keeps the lessons file when the index can't be fetched, 404 included) was staged by `publish.yml` through trusted publishing, with no npm token and with provenance, and the owner approved it on npmjs.com.
- The v2 PRs (#25 to #47) were merged into main one at a time, each deployed and checked by `check-production.ts`.

