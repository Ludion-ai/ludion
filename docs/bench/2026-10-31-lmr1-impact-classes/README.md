# LMR1 and LMR1b: how many OSV records Impact Classes can classify (2026-10-31)

Started from main 0702370. The classes, the strength order, the severity rule and the CWE table's rule are in docs/decisions/2026-10-31-impact-classes.md (ludion-ops#1 comments 6538391108 and 6538576259), and trap as a published record in docs/decisions/2026-10-31-impact-classes-trap-published-record.md (LMR1b, comments 6538877641 and 6538690397); the code is `packages/cli/src/security/impact.ts`. Nothing here is wired into a PR body or a job summary (the next lane).

## Data

OSV's bulk exports, fetched inside a container with no credentials, no host environment and every capability dropped (`scripts/fetch.sh`; `logs/fetch.log`, and `fetch` in counts.json). The zips are not committed.

| Export | Fetched (UTC) | Last-Modified | Bytes | sha256 |
|---|---|---|---|---|
| https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip | 2026-10-31T03:50:00.668Z | Sat, 31 Oct 2026 03:03:11 GMT | 219,692,908 | 49a43c99756a84092c1b53f514a1bbccabf0e106dc76ebed73b1660423f14575 |
| https://osv-vulnerabilities.storage.googleapis.com/Packagist/all.zip | 2026-10-31T03:50:17.051Z | Sat, 31 Oct 2026 03:03:06 GMT | 11,087,332 | 4effe961117ef2559d36a5f719b0397fcf048a5d30617fd36df6cd201e0d99f1 |

The CWE definitions in `logs/cwe-definitions.log` are MITRE's CWE 5.0 (2026-10-28), https://cwe.mitre.org/data/xml/cwec_latest.xml.zip, fetched 2026-10-31T04:04Z in the same kind of container (the sha256 is the log's first line).

## Results (LMR1b: trap is a MAL- id, a MAL- alias or CWE-506)

docs/decisions/2026-10-31-impact-classes-trap-published-record.md (committed in e900122 before this count) made trap a published record that says the version is malicious: a MAL- id, a MAL- alias, or CWE-506. `scripts/count.sh` was run again on **the same two zips** (sha256 above, checked in the volume before the run; fetched 2026-10-31T03:50:00.668Z and 03:50:17.051Z), so the change below is the definition's alone. `counts.json` is this run (`logs/count.log`, impact.ts sha256 fc40d7d3…); the LMR1 run is kept as `counts-before-lmr1b.json` and `logs/count-before-lmr1b.log`. count.mjs also reads each trap's basis from the record's own fields, apart from `classify()`, and fails if the two disagree on any record; it did not fail.

A record is a file in the zip; withdrawn records are counted (565 of the records that are not MAL-, 897 in all). Percentages with Wilson 95% intervals.

| | Records | MAL- id | With a CWE | Classified (not unclassified) | LMR1 (before) |
|---|---|---|---|---|---|
| npm + Packagist, all records | 238,389 | 222,920 | 14,093 (5.9%, 5.8–6.0) | 234,926 (98.5%, 98.5–98.6) | 234,523 (98.4%, 98.3–98.4) |
| npm + Packagist, not MAL- | 15,469 | 0 | 14,093 (91.1%, 90.6–91.5) | **12,006 (77.6%, 76.9–78.3)** | 11,603 (75.0%, 74.3–75.7) |
| npm, not MAL- | 8,073 | 0 | 7,839 (97.1%, 96.7–97.4) | **6,465 (80.1%, 79.2–80.9)** | 6,063 (75.1%, 74.1–76.0) |
| Packagist, not MAL- | 7,396 | 0 | 6,254 (84.6%, 83.7–85.4) | **5,541 (74.9%, 73.9–75.9)** | 5,540 (74.9%, 73.9–75.9) |

The share over all records (98.5%) is mostly records with a MAL- id (222,919 of npm's 230,992 records; 1 of Packagist's 7,397). The share asked for is the one over records whose id is not MAL-: **77.6%** (npm 80.1%, Packagist 74.9%).

Traps among the records that are not MAL- (`trap_by` in counts.json): 406, of which 12 by a MAL- alias (all 12 also list CWE-506; all npm) and 394 by CWE-506 alone (393 npm, 1 Packagist). Of the 406, 403 were unclassified before and 3 were classified by another CWE (takeover 2, steal 1); so the share rose by 403 records, the upper bound LMR1 gave.

The CWE table's own share, over records that are neither MAL- nor trap (`not_trap_classified_by_table`): 11,600 of 15,063 (77.0%, 76.3–77.7); npm 6,060 of 7,668 (79.0%, 78.1–79.9), Packagist 5,540 of 7,395 (74.9%, 73.9–75.9).

By class, npm + Packagist:

| Class | All records (238,389) | Not MAL- (15,469) | Not MAL-, LMR1 (before) |
|---|---|---|---|
| trap | 223,326 (93.7%, 93.6–93.8) | 406 (2.6%, 2.4–2.9) | 0 |
| takeover | 1,675 (0.7%, 0.7–0.7) | 1,675 (10.8%, 10.3–11.3) | 1,677 |
| impersonate | 5,604 (2.4%, 2.3–2.4) | 5,604 (36.2%, 35.5–37.0) | 5,604 |
| steal | 2,762 (1.2%, 1.1–1.2) | 2,762 (17.9%, 17.3–18.5) | 2,763 |
| alter | 639 (0.3%, 0.2–0.3) | 639 (4.1%, 3.8–4.5) | 639 |
| disrupt | 920 (0.4%, 0.4–0.4) | 920 (5.9%, 5.6–6.3) | 920 |
| unclassified | 3,463 (1.5%, 1.4–1.5) | 3,463 (22.4%, 21.7–23.1) | 3,866 |

Of the 3,463 unclassified records, 1,376 list no CWE and 2,087 list only CWEs that are not in the table. Severity (GHSA's, not MAL-) is unchanged: moderate 6,462, high 5,096, critical 2,125, low 983, unknown 803 (800 of them Packagist's). Every MAL- record's severity is unknown.

### The 20 CWEs most often left unclassified

Counted over the 2,087 unclassified records that list a CWE; a record with two such CWEs counts once for each. CWE-506 (403 in LMR1's count) is now trap and has left the list; CWE-754 (30) entered it.

| CWE | Records | Decision |
|---|---|---|
| CWE-20 Improper Input Validation | 322 | too broad |
| CWE-74 Injection | 164 | too broad |
| CWE-347 Improper Verification of Cryptographic Signature | 82 | doubtful |
| CWE-693 Protection Mechanism Failure | 70 | too broad |
| CWE-248 Uncaught Exception | 64 | doubtful |
| CWE-345 Insufficient Verification of Data Authenticity | 60 | doubtful |
| CWE-367 TOCTOU Race Condition | 58 | doubtful |
| CWE-346 Origin Validation Error | 56 | doubtful |
| CWE-436 Interpretation Conflict | 52 | doubtful |
| CWE-184 Incomplete List of Disallowed Inputs | 47 | too broad |
| CWE-59 Improper Link Resolution Before File Access | 45 | doubtful |
| CWE-668 Exposure of Resource to Wrong Sphere | 44 | too broad |
| CWE-116 Improper Encoding or Escaping of Output | 40 | too broad |
| CWE-93 CRLF Injection | 39 | doubtful |
| CWE-732 Incorrect Permission Assignment for Critical Resource | 36 | doubtful |
| CWE-88 Argument Injection | 34 | doubtful |
| CWE-295 Improper Certificate Validation | 33 | doubtful |
| CWE-327 Broken or Risky Cryptographic Algorithm | 33 | doubtful |
| CWE-362 Race Condition | 33 | doubtful |
| CWE-754 Improper Check for Unusual or Exceptional Conditions | 30 | too broad |

All 20 are in the decision record's list with their reasons. None was added to the table to raise the share: each one's definition does not say what the attacker gains. LMR1 wrote here that if CWE-506 became trap the share not MAL- would rise by at most 403 records (2.6 points); it rose by 403 (75.0% to 77.6%).

## How the table was checked

- `logs/explore.log`: every CWE in the two zips with its record count, read before the table was written.
- `logs/cwe-definitions.log`: each CWE in the table and in the decided-unclassified list, with its CWE 5.0 definition. Checking it moved CWE-476 from disrupt to unclassified (its definition does not say the application crashes) before the counts above; the count before that move gave 11,614 (75.1%) and is not the result. The log was made before LMR1b, so it lists CWE-506 as "unclassified (decided)"; its definition there ("The product contains code that appears to be malicious in nature") is the one trap now follows. cwe.mjs now lists TRAP_CWE first, as trap; it was not run again (it needs the network).

## Checks (all in Docker; nothing ran on the host)

`scripts/run.sh <script>` mounts the worktree read-only at /src and copies it into the volume ludion-lmr1-w (image ludion-l9-node24-git, `--rm --memory=4g --cpus=2`), as LV5's scripts do. `setup`, `fetch` and `cwe` have the network; the others run with `--network none`. `fetch`, `cwe`, `count`, `pick`, `pick-trap` and `explore`, which read third-party data, drop every capability (the first `explore` and `pick` runs, before that was added to run.sh, did not; both were run again after, and `pick` printed the same bytes).

LMR1b's runs (the logs hold only these; LMR1's numbers are in git history at 0e62900):

- `scripts/test.sh` (`logs/test.log`, 2026-10-31T04:29Z): tsc 0; `vitest run --project node packages/cli/test`: 23 files, 968 passed, 24 skipped; impact.test.ts 33 passed.
- `scripts/full.sh` (CI's checks except Playwright, against a stand-in repository): typecheck 0, build 0, `npm test -- --maxWorkers=2` 39 files, 1255 passed, 24 skipped, at 04:31Z (before the docs were finished) and at 04:35Z on the committed tree 0e05cf7 (`logs/full.log`). A run at 04:34Z on the same tree failed one test, branch.test.ts "refuses a symbolic link inside .git where Git would write, and a reflog the branch already has" (`logs/full-0434-failed.log`); full.sh keeps only the summary lines, so its error is not known. That file passed 3 times of 3 alone right after, and the whole suite passed at 04:35Z. impact.ts is not used by branch.ts or its test.
- `scripts/mutate.mjs` (`logs/mutate.log`, 04:30Z): 29 of 29 mutations of impact.ts caught by impact.test.ts, one at a time, which passes without them and after them. LMR1b's 15: a MAL- alias not trap; an alias containing MAL- anywhere trap; CWE-506 not trap; CWE-912 trap too; a trap stop accepted without its record classifying as trap; every stop counted as a trap; traps counted as unverified; a stopped row with no reason accepted; a stop reason on another action accepted; an unknown stop reason accepted; stop reasons counted in the order given; the reasons left out of the summary; the trap cell without the record's id; the record's id not escaped; the Japanese unverified label shortened. LMR1's 14 still apply (its "CWE-506 made trap" was dropped, since CWE-506 is now trap): MAL- not trap; any id containing MAL- trap; the weakest or the first CWE wins; CWE-78 dropped from the table; cwe_ids not read; any severity string kept; `|` not escaped; line breaks kept; the code-span fence not lengthened; minutes rounded instead of floored; an action before the fix accepted; Feb 30 accepted; the summary counting every action as fixed.
- `scripts/pick.mjs` chose the 35 real records in packages/cli/test/fixtures/impact/records.json; their expected classes in impact.test.ts were written from each record's CWEs and severity. GHSA-226w-6hhj-69hp (CWE-506) is now trap.
- `scripts/pick-trap.mjs` (`logs/pick-trap.log`) chose the 5 real records in packages/cli/test/fixtures/impact/trap-records.json from the records' own fields: npm's first 2 GHSA records with a MAL- alias (of 12) and first 2 with CWE-506 and no MAL- alias (of 393), and Packagist's only one with CWE-506 (no Packagist record has a MAL- alias).
