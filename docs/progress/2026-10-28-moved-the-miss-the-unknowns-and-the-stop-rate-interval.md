## 2026-10-28 (cycle 2) — The miss, the unknowns and the stop-rate interval (investigation only)

docs/bench/2026-10-28-cycle2-investigation. No definition or result changed.

- **@ensdomains/buffer 0.1.1, the one miss.**
  - MAL-2025-190866 was published 2025-11-24T16:31:47Z and modified 2025-11-26T00:08:10Z. Of its three sources, only GitHub's malware advisory names 0.1.1; all three name 0.1.2, the Shai-Hulud 2.0 version.
  - 0.1.1 was published 2023-02-28T09:46:00Z by a listed maintainer. jsDelivr and Software Heritage hold identical copies of its 21 files (same sha256), and Software Heritage's archived tarball has the sha1 the registry recorded for it (whether its loader checked that sha1 when downloading is not checked). Every code file equals 0.1.0's, and there are no install scripts. The worm's `setup_bun.js`, `bun_environment.js` and `preinstall` appear only in 0.1.2.
  - It was selected through @ensdomains/ens-contracts 0.0.22 (GHSA-rrxv-q8m4-wch3, T = 2023-07-10), which declares `^0.1.1`, as ens-contracts has since 0.0.20. So from 0.0.20 or 0.0.21 it was already in the lockfile.
  - The record came about 2.4 years after the judgement time, so the re-query could not stop it, and no bug was found. No stop signal readable then fires (the publisher change only extends the wait).
- **The unknowns.**
  - All 157 at 24h trace back to 86 unreadable keys: 59 removed versions, 23 dist-tag or invalid specs, 3 unverified same-release checks and 1 package not served. rc@1.3.9 alone is behind 155.
  - Clearable through tree data, at most: deps.dev 0; ecosyste.ms 2 / 0 / 1 (24h / 72h / 168h); jsDelivr 0; Software Heritage none of the top 7 blockers. A perfect archive would clear at most 113 / 54 / 37.
  - Separately, ecosyste.ms shows a new install script for 44 / 8 / 2 unknown versions, which would be stops if that source were accepted. That would be a new definition and a new run.
- **v4 as an interval** (unknown = missed … unknown = stopped): 86.24%–99.91% at 12h and 24h, 91.64%–99.91% at 72h, 93.29%–99.91% at 168h. The fractions are in the v4 README.

