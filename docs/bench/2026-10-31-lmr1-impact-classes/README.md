# LMR1, LMR1b and LMR1c: how many OSV records Impact Classes classify (2026-10-31)

Started from main 0702370. The classes, the strength order, the severity rule and the CWE table's rule are in docs/decisions/2026-10-31-impact-classes.md (ludion-ops#1 comments 6538391108 and 6538576259); trap as a published record in docs/decisions/2026-10-31-impact-classes-trap-published-record.md (LMR1b, comments 6538877641 and 6538690397); each CWE's set of classes and the CVSS vectors that choose among them in docs/decisions/2026-10-31-impact-classes-cvss-vector.md (LMR1c, comment 6539200199, point 3). The code is `packages/cli/src/security/impact.ts`. Nothing here is wired into a PR body or a job summary (the next lane).

## Data

OSV's bulk exports, fetched inside a container with no credentials, no host environment and every capability dropped (`scripts/fetch.sh`; `logs/fetch.log`, and `fetch` in counts.json). The zips are not committed. LMR1, LMR1b and LMR1c all counted these same two zips.

| Export | Fetched (UTC) | Last-Modified | Bytes | sha256 |
|---|---|---|---|---|
| https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip | 2026-10-31T03:50:00.668Z | Sat, 31 Oct 2026 03:03:11 GMT | 219,692,908 | 49a43c99756a84092c1b53f514a1bbccabf0e106dc76ebed73b1660423f14575 |
| https://osv-vulnerabilities.storage.googleapis.com/Packagist/all.zip | 2026-10-31T03:50:17.051Z | Sat, 31 Oct 2026 03:03:06 GMT | 11,087,332 | 4effe961117ef2559d36a5f719b0397fcf048a5d30617fd36df6cd201e0d99f1 |

The CWE definitions in `logs/cwe-definitions.log` are MITRE's CWE 5.0 (2026-10-28), https://cwe.mitre.org/data/xml/cwec_latest.xml.zip, fetched 2026-10-31T04:04Z in the same kind of container (the sha256 is the log's first line).

These are every record of the two exports, not a sample, so the shares below are plain percentages with no interval.

## Results (LMR1e-2: every CWE with every class its mechanism can give)

docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md (committed in fdf2e10 before the code and the count). `scripts/count.sh` (`logs/count.log`, 2026-10-31T08:57:14Z, impact.ts d121e485…) classified every record with the impact.ts of f25d51b (`osv/impact-before-lmr1e2.ts`, sha256 ffefa53e…) and with the new one. `counts.json` and `stronger.tsv` are this run. LMR1d's are kept as `counts-before-lmr1e2.json`, `stronger-before-lmr1e2.tsv` and `logs/count-before-lmr1e2.log`. Among records that are not MAL-:

| | Before (LMR1d's sets) | After |
|---|---|---|
| npm + Packagist (15,469) | 11,288 (73.0%) | **11,340 (73.3%)** |
| npm (8,073) | 6,067 (75.2%) | **6,077 (75.3%)** |
| Packagist (7,396) | 5,221 (70.6%) | **5,263 (71.2%)** |

1,402 records changed. 1,250 went to a stronger class, most often steal → takeover (489). 152 went to unclassified, all records with no vector. The rest is in docs/progress/2026-10-31-lmr1e2-impact-classes-every-cwe-widened.md.

## Results (LMR1d: no stronger class's condition follows from a weaker one's, and wider sets)

Where this section names `counts.json`, `stronger.tsv` or `logs/count.log`, read `counts-before-lmr1e2.json`, `stronger-before-lmr1e2.tsv` and `logs/count-before-lmr1e2.log`. count.mjs no longer has its three ways; the count.mjs of f25d51b (git history) has them.

docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md (committed in 0566c3d before the code and the count). `scripts/count.sh` (`logs/count.log`, 2026-10-31T07:20:43Z, impact.ts e11540dd…) classified every record three ways:
- with the impact.ts before LMR1d (`git show 0129ba8:packages/cli/src/security/impact.ts`, written to the volume as `osv/impact-before-lmr1d.ts`, sha256 2326b824…);
- with the new `classify()` given the sets before widening (count.mjs's `NARROW`);
- with the shipped sets.

`counts.json` is this run, and `stronger.tsv` (`count.sh --stronger`) lists every record that moved to a stronger class. LMR1c's results are kept as `counts-before-lmr1d.json` and `logs/count-before-lmr1d.log`. The numbers and what changed are in docs/progress/2026-10-31-lmr1d-impact-classes-conditions-and-sets.md. In short, among records that are not MAL-:

| | Before LMR1d | Sets before widening | Shipped sets |
|---|---|---|---|
| npm + Packagist (15,469) | 11,625 (75.2%) | 10,846 (70.1%) | **11,288 (73.0%)** |
| npm (8,073) | 6,208 (76.9%) | 5,873 (72.7%) | **6,067 (75.2%)** |
| Packagist (7,396) | 5,417 (73.2%) | 4,973 (67.2%) | **5,221 (70.6%)** |

The sections below are LMR1c's, kept as they were. Where they name `counts.json`, `logs/count.log` or `count.sh --words`, read `counts-before-lmr1d.json`, `logs/count-before-lmr1d.log` and the count.mjs of 0129ba8 (git history); count.mjs no longer has `--words`.

## Results (LMR1c: each CWE allows a set of classes, and the CVSS vectors choose among them)

The decision record was committed and pushed (0345636) before impact.ts was changed and before this count. `scripts/explore-vectors.sh` (`logs/explore-vectors.log`) read the vectors' shapes first, classifying nothing: the exports have only CVSS 3.0, 3.1 and 4.0 vectors (no CVSS 2), and none repeats or lacks C, I or A (VC, VI, VA, SC, SI, SA for CVSS 4).

`scripts/count.sh` classified every record with the new impact.ts (sha256 d15c9be9…, tree 6bc011c) and with the one before LMR1c (`git show 218a83a:packages/cli/src/security/impact.ts`, written to the volume as `osv/impact-before-lmr1c.ts`, sha256 fc40d7d3…, the same as LMR1b's count), at 2026-10-31T05:28:29Z (`logs/count.log`). It checked both zips' sha256 against fetch.json before counting, and that trap is the same under both (it is: LMR1c does not change trap). `counts.json` is this run; LMR1b's is kept as `counts-before-lmr1c.json` and `logs/count-before-lmr1c.log`, LMR1's as `counts-before-lmr1b.json`.

### How many records the table gives a class

Records whose id is not MAL- (withdrawn records counted):

| | Records | Classified now | Before LMR1c | Change |
|---|---|---|---|---|
| npm + Packagist | 15,469 | **11,625 (75.2%)** | 12,006 (77.6%) | −381 |
| npm | 8,073 | **6,208 (76.9%)** | 6,465 (80.1%) | −257 |
| Packagist | 7,396 | **5,417 (73.2%)** | 5,541 (74.9%) | −124 |

The same with withdrawn records left out (565 of the 15,469; 410 npm, 155 Packagist):

| | Records | Classified now | Before LMR1c |
|---|---|---|---|
| npm + Packagist | 14,904 | **11,279 (75.7%)** | 11,651 (78.2%) |
| npm | 7,663 | **5,972 (77.9%)** | 6,224 (81.2%) |
| Packagist | 7,241 | **5,307 (73.3%)** | 5,427 (74.9%) |

How many records the CWE table gives a class, over records that are neither MAL- nor trap (`not_trap_classified_by_table`): 11,219 of 15,063 (74.5%); npm 5,803 of 7,668 (75.7%), Packagist 5,416 of 7,395 (73.2%). Over all 238,389 records (222,920 with a MAL- id): 234,545 (98.4%; before LMR1c 234,926, 98.5%).

By class, npm + Packagist, not MAL-:

| Class | Now | Before LMR1c |
|---|---|---|
| trap | 406 (2.6%) | 406 |
| takeover | 1,675 (10.8%) | 1,675 |
| impersonate | 5,477 (35.4%) | 5,604 |
| steal | 2,467 (15.9%) | 2,762 |
| alter | 684 (4.4%) | 639 |
| disrupt | 916 (5.9%) | 920 |
| unclassified | 3,844 (24.8%) | 3,463 |

Why the 3,844 are unclassified (`unclassified_by_reason`): only CWEs outside the table 2,087; no CWE 1,376; the vector rules out every class the CWEs allow 234; no vector to choose between a CWE's classes 147; a vector that could not be read 0.

### What changed

513 records that are not MAL- changed class (npm 348, Packagist 165), `changes_not_mal`:

| Before → now | npm + Packagist | npm | Packagist |
|---|---|---|---|
| steal → unclassified | 168 | 122 | 46 |
| impersonate → unclassified | 126 | 56 | 70 |
| steal → alter | 126 | 86 | 40 |
| alter → unclassified | 77 | 71 | 6 |
| disrupt → unclassified | 10 | 8 | 2 |
| alter → disrupt | 4 | 4 | 0 |
| impersonate → disrupt | 1 | 1 | 0 |
| steal → disrupt | 1 | 0 | 1 |

No record rose to a stronger class, and no record that was unclassified became classified: with a vector the record can only lose classes, and with none a CWE with several classes decides nothing.

By CWE (a changed record counts under each CWE it lists; all of them are in counts.json, `by_cwe`), the ones with 10 or more:

| CWE | Changed | How |
|---|---|---|
| CWE-22 | 189 | steal → alter 108, steal → unclassified 80, impersonate → unclassified 1 |
| CWE-1321 | 73 | alter → unclassified 69, alter → disrupt 4 |
| CWE-89 | 37 | steal → unclassified 26, steal → alter 11 |
| CWE-918 | 32 | steal → unclassified 31, impersonate → unclassified 1 |
| CWE-284 | 25 | impersonate → unclassified 25 |
| CWE-73 | 18 | steal → alter 16, steal → unclassified 2 |
| CWE-352 | 18 | impersonate → unclassified 17, impersonate → disrupt 1 |
| CWE-863 | 14 | impersonate → unclassified 14 |
| CWE-400 | 13 | disrupt → unclassified 7, alter → disrupt 4, impersonate → disrupt 1, steal → disrupt 1 |
| CWE-269 | 12 | impersonate → unclassified 12 |
| CWE-285 | 12 | impersonate → unclassified 12 |
| CWE-639 | 10 | impersonate → unclassified 10 |
| CWE-862 | 10 | impersonate → unclassified 10 |

CWE-73 is decided unclassified; its records changed through another CWE they list (CWE-22 among them).

Vectors among the 15,469 (`vectors_not_mal`): none 2,128, CVSS 3 only 9,600, CVSS 4 only 2,084, both 1,657. In 193 of the 1,657 the CVSS 3 and 4 vectors disagree on whether confidentiality (87), integrity (72) or availability (114) is affected; such a record keeps only the classes both allow. 12 records (npm 9, Packagist 3) have no vector and are classified by point 5 of the decision (the strongest is certain) although their CWEs together allow several classes; they would be unclassified if the record's whole set had to be one class.

Unclassified records that name the CWEs the decision record leaves for the chat (`unclassified_naming`): CWE-59 45, CWE-73 28, CWE-276 22, CWE-732 36 (a record naming two counts under each).

### The 20 CWEs most often left unclassified

Over the 2,468 unclassified records that list a CWE; a record with two counts once for each.

| CWE | Records | Why |
|---|---|---|
| CWE-20 Improper Input Validation | 327 | too broad |
| CWE-74 Injection | 165 | too broad |
| CWE-347 Improper Verification of Cryptographic Signature | 84 | doubtful |
| CWE-22 Path Traversal | 81 | {steal, alter}: no vector (or none consistent) |
| CWE-693 Protection Mechanism Failure | 74 | too broad |
| CWE-1321 Prototype Pollution | 69 | {alter}: the vector says integrity is not affected |
| CWE-248 Uncaught Exception | 66 | doubtful |
| CWE-345 Insufficient Verification of Data Authenticity | 63 | doubtful |
| CWE-367 TOCTOU Race Condition | 59 | doubtful |
| CWE-346 Origin Validation Error | 56 | doubtful |
| CWE-436 Interpretation Conflict | 52 | doubtful |
| CWE-184 Incomplete List of Disallowed Inputs | 48 | too broad |
| CWE-59 Improper Link Resolution Before File Access | 45 | doubtful |
| CWE-668 Exposure of Resource to Wrong Sphere | 44 | too broad |
| CWE-116 Improper Encoding or Escaping of Output | 40 | too broad |
| CWE-93 CRLF Injection | 39 | doubtful |
| CWE-732 Incorrect Permission Assignment for Critical Resource | 36 | doubtful |
| CWE-295 Improper Certificate Validation | 35 | doubtful |
| CWE-88 Argument Injection | 34 | doubtful |
| CWE-362 Race Condition | 34 | doubtful |

### "malware" or "malicious" in records that are not trap

A fixed-string search, case ignored, over each record's `summary` and `details` (`malware_or_malicious` in counts.json): 225,743 records match, 223,326 of them trap, **2,417 not trap**. Most of the 2,417 match only "malicious" (2,365), as in "a malicious user"; 20 match only "malware" and 32 both. By class: takeover 350, impersonate 901, steal 438, alter 109, disrupt 135, unclassified 484. Every one, with its id, ecosystem, class, the words it matched, its packages, CWEs and whether it is withdrawn, is in `malware-or-malicious.tsv` (`count.sh --words`).

The 52 that say "malware" are listed by id in counts.json (`not_trap_with_malware`): takeover 12, impersonate 29, steal 3, unclassified 8. Of the 8 records that list CWE-912 (hidden functionality) and are not trap (`all_not_trap_listing_cwe_912`), one matches the search: GHSA-236c-vhj4-gfxg.

ua-parser-js (`scripts/package.sh ua-parser-js`, `logs/package-ua-parser-js.log`): its 2021 malware advisory GHSA-pjwm-rvh2-c87w (CWE-506, CWE-912) is trap; GHSA-236c-vhj4-gfxg ("Duplicate Advisory: Embedded malware in ua-parser-js", CWE-829, CWE-912, withdrawn 2026-02-17) is takeover. Whether any of these records should be trap is for the chat; this lane decides nothing about them.

## Before LMR1c

LMR1b (trap is a MAL- id, a MAL- alias or CWE-506; one class per CWE), from `counts-before-lmr1c.json`: of the 15,469 records that are not MAL-, 12,006 classified (77.6%); npm 6,465 of 8,073 (80.1%), Packagist 5,541 of 7,396 (74.9%). 406 trap: 12 by a MAL- alias (all also CWE-506, all npm) and 394 by CWE-506 alone (393 npm, 1 Packagist); 403 of them were unclassified in LMR1 and 3 classified (takeover 2, steal 1). How many records the CWE table gave a class, over records neither MAL- nor trap: 11,600 of 15,063 (77.0%).

LMR1 (trap is a MAL- id only), from `counts-before-lmr1b.json`: 11,603 of the 15,469 (75.0%); npm 6,063 (75.1%), Packagist 5,540 (74.9%).

Severity (GHSA's, not MAL-) has not changed in any of the three: moderate 6,462, high 5,096, critical 2,125, low 983, unknown 803 (800 of them Packagist's). Every MAL- record's severity is unknown.

## How the table was checked

- `logs/explore.log`: every CWE in the two zips with its record count, read before the table was written.
- `logs/cwe-definitions.log`: each CWE in the table and in the decided-unclassified list, with its CWE 5.0 definition; the sets in the LMR1c decision record quote these definitions. Checking it moved CWE-476 from disrupt to unclassified before LMR1's count. The log was made before LMR1b and LMR1c, so it shows CWE-506 as "unclassified (decided)" and one class per CWE (the class each set's first class now is); cwe.mjs now lists TRAP_CWE first, as trap, and each CWE's set, but was not run again (it needs the network).
- `logs/explore-vectors.log` (LMR1c): the CVSS vector shapes, read before the vector rule was written.
- `logs/fixture-vectors.log` (LMR1c): each test fixture's CWEs and CVSS scores, from which the fixtures' expected classes were rewritten apart from `classify()`. Only GHSA-2444-8gj8-6fmx changed (CWE-91, alter; both its vectors say integrity is not affected, so unclassified).

## Checks (all in Docker; nothing ran on the host)

`scripts/run.sh <script>` mounts the worktree read-only at /src and copies it into the volume ludion-lmr1-w (image ludion-l9-node24-git, `--rm --memory=4g --cpus=2`), as LV5's scripts do. `setup`, `fetch` and `cwe` have the network; the others run with `--network none`. `fetch`, `cwe`, `count`, `package`, `pick`, `pick-trap`, `explore`, `explore-vectors` and `fixture-vectors`, which read third-party data, drop every capability.

LMR1c's runs (the logs hold only these; LMR1b's and LMR1's numbers are in git history at 218a83a and 0e62900):

- `scripts/test.sh` (`logs/test.log`, 2026-10-31T05:28:47Z, tree 6bc011c): tsc 0; `vitest run --project node packages/cli/test`: 23 files, 977 passed, 24 skipped; impact.test.ts 42 passed.
- `scripts/full.sh` (CI's checks except Playwright, against a stand-in repository; `logs/full.log`): typecheck 0, build 0, `npm test -- --maxWorkers=2` 39 files, 1264 passed, 24 skipped, at 05:29Z on tree 6bc011c (before these docs) and at 05:31:50Z on c5fdfff, with them (the log's run).
- `scripts/mutate.mjs` (`logs/mutate.log`, 05:27Z, the code of 6bc011c): **51 of 51** mutations of impact.ts caught by impact.test.ts, one at a time; it passes without them and after them. LMR1c's 22: the vectors not read; the weakest consistent class wins; one consistent vector is enough; steal needs no confidentiality; alter read from confidentiality; disrupt needs no availability; impersonate by confidentiality only; takeover needs all three; CVSS 4's subsequent systems not read; a vector of another version accepted; a score of another form skipped; a metric given twice accepted; any metric value accepted; N read as affected; an unreadable metric read as affected; with no vector, a CWE with several classes decides its strongest, never blocks, or blocks a stronger decided class; the reason names the first CWE; CWE-22's set loses alter; authorization's set loses steal and alter; XSS allows steal too. LMR1's "the weakest class wins", "the first CWE wins" and "CWE-78 leaves the table" were rewritten for the new code. LMR1b's 15 and LMR1's other 11 are unchanged. Another lane's mutation container (ludion-lb2a-mutate-g) was running on the same PC at the time, on its own volume.
- `scripts/pick.mjs` chose the 35 real records in packages/cli/test/fixtures/impact/records.json, and `scripts/pick-trap.mjs` (`logs/pick-trap.log`) the 5 in trap-records.json; neither was run again.
