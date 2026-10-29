## 2026-10-28 (cycle 3) — Backtest v5: archives as install-script sources, and the disputed category

docs/bench/2026-10-28-backtest-v5. The definitions were committed at 23ab295 and the scripts at cadac0b, both pushed before the run. The execution ran 11:56:25Z–12:55:30Z, and its output was committed unchanged (f05e30f). v4 is reproduced with 0 differences.
- **Gate: not met.** At 12h and 24h, 1,039 / 1 / 108 (stopped / missed / unknown of 1,148); at 72h, 1,065 / 1 / 82; at 168h, 1,078 / 1 / 69. As an interval: 90.51%–99.91%, 92.77%–99.91% and 93.90%–99.91% (v4: 86.24%, 91.64%, 93.29% at the lower bound). The delay gates are v4's, carried over and met.
- **What moved.** ecosyste.ms's copies of removed versions show install scripts, which moves 49 / 13 / 7 versions (24h / 72h / 168h) from unknown to stopped.
  - 7 of these moves rest on whether the registry lists prev on the run date. That is all 7 at 168h and 7 of 13 at 72h.
  - Without those 7, the lower bounds are 89.90%, 92.16% and 93.29% (v4's 168h figure).
  - Software Heritage was read for 35 versions' install scripts and held 1, which changed nothing. It was also read for the 2 disputed candidates, and held both.
- **Disputed: at least 2, and 988 undecided.** The two are @ensdomains/buffer 0.1.1, still the one miss, and freo-design-system 1.0.4 (stopped). Both stay in the denominator.
  - "Legitimate" means only "named by no MAL- record", and the category does not say a version is benign.
  - freo 1.0.4 is in it because its record does not name 1.0.3, which added the same preinstall 59 minutes earlier.
  - A draft correction request for @ensdomains/buffer 0.1.1 to the GitHub Advisory Database is in the folder. It has not been sent.
- **A predictable limit.** jsDelivr's CDN answers 404 for the files of removed versions it still lists (cycle 2 had seen it serve only versions requested before removal). So 988 versions failed the disputed check closed (README, "Anomalies and limits").

