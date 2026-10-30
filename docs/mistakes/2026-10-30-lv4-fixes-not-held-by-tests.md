# 2026-10-30 — Two LV4 fixes were right, but no test held them

- **What happened.** LV4 (#214) made `osvIds` (packages/cli/src/security/npm-facts.ts) keep a repeated OSV id once, and made `ludion patch` (packages/cli/src/security/cli.ts) print a stopped fix's note once. The code was right, but the cloud review of #214 (https://github.com/Ludion-ai/ludion/pull/214#issuecomment-6517309422, Mutations and findings 1–3) changed it in ways that should fail and five changes passed every test:
  - `osvIds` de-duplicating on the id's prefix, so `[GHSA-a, GHSA-b]` reads as `[GHSA-a]`. That would hide a newly named advisory from gate 1's "introduced" stop (judge.ts:451-452) and turn a stop into a pass.
  - cli.ts dropping a version choice's note whenever the fix has any reason, whenever no version was chosen, whenever the reason starts with "Gate 2", or for every choice after a fix's first. Each would leave a note out of the terminal.

  LV4b added the missing cases and narrowed cli.ts: a note is left out only when the reason is exactly the text dependency-patch.ts writes for that choice (`"Gate 2 stops this fix: " + note`); any drift prints it twice instead of zero times.
- **Why.** The tests were written to show that each fix works on the case it was made for. The agreement list had no two distinct ids with one prefix, and the text tests had only a stopped fix's first choice and a fix with no reason. No test fed the cases where the change must not apply.
- **Check:** `packages/cli/test/judge.test.ts` — "OSV's batch answers for the judge": "keeps a repeated id once, in OSV's order" and the agreement list now have `[GHSA-aaaa-bbbb-cccc, GHSA-dddd-eeee-ffff, GHSA-aaaa-bbbb-cccc]` and `[MAL-2026-0001, MAL-2026-0002]`.
- **Check:** `packages/cli/test/patch-cli.test.ts` — a fix that took the next version and then failed validation prints its note; a fix's second version choice prints its note, once each.
