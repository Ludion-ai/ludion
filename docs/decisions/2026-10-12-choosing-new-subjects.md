### 2026-10-12: Choosing new subjects

- **Rule** (from the owner's list): "AI writes it often" × release frequency × share of silent changes, over the last 180 days (since 2026-04-15). Measured per package by the seed pipeline's `collect` and `triage` on its GitHub release notes, and scored by `tools/seed/src/score.ts`:
  - "AI writes it often" has no direct measure; npm's weekly downloads (the week before 2026-10-12) stand in for it.
  - release frequency: stable releases published in the window.
  - silent share: triaged entries that are silent changes and not additions, over all entries.
  - Downloads and releases are heavy-tailed, so each is taken as log10(1 + x); each factor is divided by the largest among the candidates, and the three are multiplied.
- **The 20 candidates and their scores** are in `docs/bench/2026-10-12-subjects/scores.json` (table below, generated from it). Four couldn't be scored: their GitHub release notes hold too few entries to read (drizzle-orm, prisma, react-router, @tanstack/react-query keep their changelogs elsewhere or in another format).

| package | weekly downloads | stable releases | entries | silent changes | silent share | score |
| - | - | - | - | - | - | - |
| ai | 30,798,367 | 359 | 656 | 127 | 0.194 | 0.635 |
| tailwindcss | 136,230,978 | 6 | 97 | 26 | 0.268 | 0.315 |
| @supabase/supabase-js | 30,723,462 | 42 | 218 | 32 | 0.147 | 0.308 |
| zod | 341,697,718 | 16 | 488 | 76 | 0.156 | 0.28 |
| @sveltejs/kit | 3,248,293 | 27 | 458 | 77 | 0.168 | 0.271 |
| hono | 74,173,194 | 36 | 223 | 24 | 0.108 | 0.228 |
| @anthropic-ai/sdk | 46,456,539 | 59 | 301 | 29 | 0.096 | 0.224 |
| stripe | 23,860,701 | 16 | 44 | 6 | 0.136 | 0.211 |
| astro | 7,219,474 | 63 | 429 | 34 | 0.079 | 0.167 |
| openai | 43,233,974 | 48 | 688 | 48 | 0.07 | 0.155 |
| @playwright/test | 75,674,770 | 7 | 107 | 13 | 0.121 | 0.147 |
| next | 67,261,197 | 30 | 2679 | 155 | 0.058 | 0.116 |
| eslint | 161,560,021 | 15 | 344 | 20 | 0.058 | 0.098 |
| nuxt | 2,352,805 | 18 | 1373 | 91 | 0.066 | 0.092 |
| express | 143,994,672 | 3 | 125 | 12 | 0.096 | 0.081 |
| vite | 195,883,741 | 30 | 64 | 2 | 0.031 | 0.066 |
| drizzle-orm | 27,765,699 | 2 | 1 | 0 | 0 | not scored |
| prisma | 19,186,626 | 4 | 0 | 0 | 0 | not scored |
| react-router | 57,103,384 | 20 | 0 | 0 | 0 | not scored |
| @tanstack/react-query | 65,874,058 | 38 | 16 | 4 | 0.25 | not scored |

- **Chosen: `ai` (Vercel AI SDK), `tailwindcss`, `zod`.** `ai` and `tailwindcss` are first and second. `@supabase/supabase-js` (third) is passed over for now: its changes are about a hosted service's client, so a test can't show them offline in Docker, and its lessons would be source-only; CLAUDE.md prefers differential tests. `zod` (fourth) is pure code and tests well. That makes six subjects with vitest, wrangler and agents.
- Each new subject: lessons drafted by the pipeline for its current major (ai >=7.0.0, zod >=4.0.0, tailwindcss >=4.0.0), at most 25 silent, non-addition candidates first; FreshBench B questions written from the changelog entries alone (`tools/seed/src/questions.ts`) for every drafted change, kept or not, so the measurement has covered and uncovered changes; seeds frozen before measuring; then B with and without sync and the harm check, as for Done 3. One seed PR per subject (protected).

