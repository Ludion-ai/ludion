### 2026-10-13 (evening): lessons are CC BY 4.0; Analytics Engine counting opened; #93 merged

- **License** (#100, merged): the owner decided CC BY 4.0 for lessons; I applied it to lessons only and kept code Apache-2.0 (a Creative Commons license is not for software; the decision named "the license" of lessons, which is what #60 was waiting on). Every lesson on main was taught by one account, so no one else's agreement was needed. `teach --public` prints the teacher's sentence before the prompt and quotes it in the PR; that is in the CLI on main and ships with the next release.
- **Analytics Engine** (**#101**, protected, `needs-owner`, Opus review below it): counts requests for `/index/*.json`; written only once the owner sets `ANALYTICS_SALT`. Three deviations from the request, each explained in `docs/decisions.md`, "Counting index requests": an HMAC under a secret instead of a public daily salt, the path as its own field instead of inside the hash, and "weekly" meaning client-days because the key rotates daily. `/start` and the README say what the server counts. No numbers yet.
- **#93 merged** after 0.1.4 reached npm. Nothing is posted or sent; the maintainer letters 03 to 05 are still set aside for the owner's discussion. #96 (`/bench`) was merged by the owner.
- **Codex**: #67 and #68 closed unmerged; #69 is the one open PR.

