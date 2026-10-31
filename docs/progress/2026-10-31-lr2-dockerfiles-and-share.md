# 2026-10-31 (LR2) — Public Dockerfiles on the official php and node images: how far behind, what else they show, and how many Ludion could keep patched with no person

A measurement that only reads; no product code, gate or wait changed. Definitions: `docs/decisions/2026-10-30-lr-dockerfile-lag-definitions.md` (LR, 975e6fa) and `docs/decisions/2026-10-31-lr2-definitions.md` (LR2, b884cbb), each committed and pushed before counting. Detail: `docs/bench/2026-10-30-lr-dockerfile-lag/README.md`. Nothing was cloned and no third-party code ran; file contents were read only inside a container with no network.

Sample: 100 repositories from GitHub's best-match code search (50 php, 50 node, one per owner, pushed within a year), measured on 2026-10-30. Nothing was "could not be counted". Only repositories whose Dockerfile has a `FROM` on the official image with a full-version tag (`X.Y.Z[-variant]`): 100 of the 748 pushed within a year (13%, 95% Wilson 11% to 16%); php 50/409, node 50/339. The 0 of 100 below is a count inside this stratum; with 748 as the denominator, the number today's Ludion can keep patched is still 0. (Added by L60 on 2026-10-31 from `raw/checked.tsv`; `docs/progress/2026-10-31-l60-schedule-60day.md`.)

- **Lag behind the series' latest security release: median 9 days, p90 1,807 days (n = 100).** php: median 0, p90 1,457 (n = 50); node: median 9, p90 2,075 (n = 50). 54 of 100 are behind; 39 pin a series past its end of life.
- **Dependabot docker or Renovate configured: 20 of 100**, median 0, p90 9 days; neither: 80, median 9, p90 2,075 days. Digest pinned: 16 of 100.
- **Tests:** a manifest test script 34 of 100; any test sign 51 of 100.
- **Buildable with no network (likely): 8 of 100** (php 7, node 1). Most fetch packages in a `RUN` (`apt-get` in 31 php files, `npm install`/`ci` in 30 node files).
- **Start can be checked:** EXPOSE 45, HEALTHCHECK 11, both 9, either 47 of 100.
- **Deployed automatically on merge: 21 of 100** (a push workflow saying `deploy` 19, a platform file 2).
- **Decision 4, kept patched by Ludion with no person: 0 of 100 (0.0%; 95% Wilson 0.0% to 3.7%).** Known before counting: automatic merge and a release are not built (H6). Apart from H6, what the files show also gives 0 of 100: 50 are node (no node image is patched), and Ludion's PHP Dockerfile parser accepts 4 of the 50 php files (45 are refused by its check for frontend directives or line continuations); of those 4, 3 pin an end-of-life series and the last has no test sign.
- **A mistake on the way:** the walk's first start put a third-party path into a `sed` program on the host; it was stopped before reading any repository, fixed (e0a4319) and started again. Recorded in the README and in `docs/mistakes/2026-10-31-third-party-path-in-host-sed.md`.
