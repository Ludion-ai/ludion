# 2026-10-31 — Three claims written without reading what they described

The audits on the board (Ludion-ai/ludion-ops#1) found three such claims tonight. Each was corrected on the board. Times are UTC, 2026-10-30, which is 2026-10-31 in Japan.

- **What happened.** Three claims, each about something its writer had not read:
  1. **The coordinator's report 6532621677 (20:17:52Z).** It said that #230 at 32c7054 had changed decision 3's heading to 「提案中（範囲の一文はオーナーの OK 待ち）」.
     - At 32c7054, docs/decisions/2026-10-31-gate-3-official-image-same-series.md:5 was still `## Decided`; only the bold sentence at :3 had changed. Found by R230's review 6532712835 (B1) and by the audit 6532842961 (item 6).
     - The coordinator corrected it in 6533032375 (20:41:24Z, item 6).
  2. **The body of #234.** It was edited at 20:12Z to say of the first review's findings (6532347820, at 9d368bf): "They are fixed, and listed under "Review and fixes" in the progress file".
     - The head was still 9d368bf (its last commit 19:52:56Z), which has no such section.
     - The prototype's fix had been pushed to Ludion-ai/ludion-trial (6162b79, 20:04:50Z). The record's fixes existed only in the lane's local draft until 664dfe5 was pushed at 20:43:19Z.
     - Found by the audit 6532842961 (item 6), which read the head at 05:26 JST (20:26Z).
  3. **The brain's answer 6531046171, item 3 (18:55:12Z).** It said that an official image's digest listed in docker-library's repo-info and official-images is evidence Ludion can produce by itself.
     - repo-info's remote files are written from what Docker Hub answered for the tag at that moment (.remote.pl, as the audit read it in a container), so listing there is the same as asking the registry again.
     - official-images holds GitCommit and Directory, not digests.
     - Found by the audit 6532842961 (item 2). The brain withdrew the claim in 6533365853 (21:01:02Z, item 2).
- **Why.** The writer did not read the thing being described first:
  - Each claim described a file, a head or an outside record that its writer had not opened at that moment.
  - In 1, the coordinator's correction says it will open the file before writing from now on. Whether it had read an earlier version of the file is unknown.
  - In 2, the lane wrote the PR body from its local draft before pushing, while the reviewed head did not yet have the fixes.
  - In 3, the brain treated repo-info as an independent record without reading how it is written.
  - The mistakes rule asks for a record in the PR that fixes the mistake, and two of these three were board reports with no PR. That is why they are collected here, in a PR that touches docs/.
  - Since then (brain 6534448385, item 6): a report that states what a PR contains gives the head SHA it read. That is a practice on the board, not yet a rule in CLAUDE.md.
  - Widening CLAUDE.md:17 so that it also covers mistakes in board reports changes CLAUDE.md, so it goes to the owner. It is not changed here.
- No check catches this kind of mistake yet. The rule below is the one this record is kept under, not one that prevents the mistake.
- **Rule:** "Every mistake is traced to its cause and fed back into a rule or a check, so the same mistake cannot pass twice."
