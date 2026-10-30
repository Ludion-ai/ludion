# 2026-10-30 (LO) — Does a published tarball equal its public source release?

An experiment that only reads; no product code, gate or wait changed. Definitions: `docs/decisions/2026-10-30-lo-tarball-source-definitions.md`, committed and pushed before any fetch (07ee0dd). Detail: `docs/bench/2026-10-30-lo-tarball-source/README.md`. Data: lane LD's 192 genuine fixes and 11 obtained malicious versions (`delta-v1.json` at 79f8816).

- **Malicious versions: 0 of 11 could be compared** (11 / 11 not comparable). 9 name no repository, 1 names a repository that does not answer (HTTP 401), 1 names one with no tag of the 8 forms; none has provenance. The hypothesis that malicious files are not in the source was **not tested** on this data.
- **Genuine fixes: 25 of 192 match (13.02%)**; 25 of the 168 comparable (14.88%). Differs 44, absent files only 99, not comparable 24.
  - **Built before publish:** 3 of 120 match (2.50%).
  - **Not built:** 22 of 48 match (45.83%).
- **So the comparison alone would let 13.02% of these genuine fixes pass.** Built packages are not in git as published; showing where they came from would need the build reproduced (not measured).
- **Not measured:** whether the malicious versions' previous versions named a repository.
