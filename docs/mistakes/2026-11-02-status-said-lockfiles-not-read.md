# 2026-11-02 — docs/status.md said Ludion does not read pnpm and yarn lockfiles, and the code read them

- **What happened.** On main, the scope table in docs/status.md said `Not read` of `npm (pnpm, yarn and bun locks)`. For pnpm-lock.yaml and yarn.lock that was false when it was written. 4aefb22 (#251) added the line, and at that same commit packages/cli/src/security/inventory.ts:81 has readers for both, and packages/cli/src/security/judge-cli.ts:28 reads pnpm-lock.yaml. The same premise is in docs/decisions/2026-11-02-definition-of-complete-final.md:66 (`今読めるのは package-lock.json だけ`). That is a decision record on main, and it is not changed here.
- **Why.** The line is the English of a row in the definition the owner adopted (docs/decisions/2026-11-01-definition-of-complete.md:61, `読まない`), and 4aefb22's message says its "Today" values are the record's, not measured again. Why that row said so is not known. It stayed because no test or workflow compares that table with the code.
- **What changed.** The table now says what the scan and the judge read (docs/status.md, the scope table's row for these lockfiles), and docs/decisions/2026-11-02-lockfile-scope-v1.md gives the lines read.
- No check catches this kind of mistake yet. The rule below is the one this record is kept under, not one that prevents the mistake.
- **Rule:** "Make supported scope and failures explicit."
