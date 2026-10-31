# LMR1: how many OSV records Impact Classes can classify (2026-10-31)

Started from main 0702370. The classes, the strength order, the severity rule and the CWE table's rule are in docs/decisions/2026-10-31-impact-classes.md (ludion-ops#1 comments 6538391108 and 6538576259); the code is `packages/cli/src/security/impact.ts`. Nothing here is wired into a PR body or a job summary (the next lane).

## Data

OSV's bulk exports, fetched inside a container with no credentials, no host environment and every capability dropped (`scripts/fetch.sh`; `logs/fetch.log`, and `fetch` in counts.json). The zips are not committed.

| Export | Fetched (UTC) | Last-Modified | Bytes | sha256 |
|---|---|---|---|---|
| https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip | 2026-10-31T03:50:00.668Z | Sat, 31 Oct 2026 03:03:11 GMT | 219,692,908 | 49a43c99756a84092c1b53f514a1bbccabf0e106dc76ebed73b1660423f14575 |
| https://osv-vulnerabilities.storage.googleapis.com/Packagist/all.zip | 2026-10-31T03:50:17.051Z | Sat, 31 Oct 2026 03:03:06 GMT | 11,087,332 | 4effe961117ef2559d36a5f719b0397fcf048a5d30617fd36df6cd201e0d99f1 |

The CWE definitions in `logs/cwe-definitions.log` are MITRE's CWE 5.0 (2026-10-28), https://cwe.mitre.org/data/xml/cwec_latest.xml.zip, fetched 2026-10-31T04:04Z in the same kind of container (the sha256 is the log's first line).

## Results

`scripts/count.sh` classifies every record of both zips with impact.ts's `classify()` (network none; `counts.json`, which also holds the per-ecosystem numbers). A record is a file in the zip; withdrawn records are counted (565 of the records that are not MAL-, 897 in all). Percentages with Wilson 95% intervals.

| | Records | MAL- | With a CWE | Classified (not unclassified) |
|---|---|---|---|---|
| npm + Packagist, all records | 238,389 | 222,920 | 14,093 (5.9%, 5.8–6.0) | 234,523 (98.4%, 98.3–98.4) |
| npm + Packagist, not MAL- | 15,469 | 0 | 14,093 (91.1%, 90.6–91.5) | **11,603 (75.0%, 74.3–75.7)** |
| npm, not MAL- | 8,073 | 0 | 7,839 (97.1%, 96.7–97.4) | 6,063 (75.1%, 74.1–76.0) |
| Packagist, not MAL- | 7,396 | 0 | 6,254 (84.6%, 83.7–85.4) | 5,540 (74.9%, 73.9–75.9) |

The share over all records (98.4%) is mostly MAL- records, which are trap by definition (222,919 of npm's 230,992 records; 1 of Packagist's 7,397). The share that says how well the CWE table works is the one over records that are not MAL-: **75.0%**.

By class, npm + Packagist:

| Class | All records (238,389) | Not MAL- (15,469) |
|---|---|---|
| trap | 222,920 (93.5%, 93.4–93.6) | 0 |
| takeover | 1,677 (0.7%, 0.7–0.7) | 1,677 (10.8%, 10.4–11.3) |
| impersonate | 5,604 (2.4%, 2.3–2.4) | 5,604 (36.2%, 35.5–37.0) |
| steal | 2,763 (1.2%, 1.1–1.2) | 2,763 (17.9%, 17.3–18.5) |
| alter | 639 (0.3%, 0.2–0.3) | 639 (4.1%, 3.8–4.5) |
| disrupt | 920 (0.4%, 0.4–0.4) | 920 (5.9%, 5.6–6.3) |
| unclassified | 3,866 (1.6%, 1.6–1.7) | 3,866 (25.0%, 24.3–25.7) |

Of the 3,866 unclassified records, 1,376 list no CWE and 2,490 list only CWEs that are not in the table. Severity (GHSA's, not MAL-): moderate 6,462, high 5,096, critical 2,125, low 983, unknown 803 (800 of them Packagist's). Every MAL- record's severity is unknown.

### The 20 CWEs most often left unclassified

Counted over the 2,490 unclassified records that list a CWE; a record with two such CWEs counts once for each.

| CWE | Records | Decision |
|---|---|---|
| CWE-506 Embedded Malicious Code | 403 | doubtful: trap is the MAL- record (GHSA malware advisories) |
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

All 20 are in the decision record's list with their reasons. None was added to the table to raise the share: each one's definition does not say what the attacker gains. If the chat decides CWE-506 is trap, the share not MAL- would rise by at most 403 records (2.6 points); that is a decision about trap's meaning, not about the table.

## How the table was checked

- `logs/explore.log`: every CWE in the two zips with its record count, read before the table was written.
- `logs/cwe-definitions.log`: each CWE in the table and in the decided-unclassified list, with its CWE 5.0 definition. Checking it moved CWE-476 from disrupt to unclassified (its definition does not say the application crashes) before the counts above; the count before that move gave 11,614 (75.1%) and is not the result.

## Checks (all in Docker; nothing ran on the host)

`scripts/run.sh <script>` mounts the worktree read-only at /src and copies it into the volume ludion-lmr1-w (image ludion-l9-node24-git, `--rm --memory=4g --cpus=2`), as LV5's scripts do. `setup`, `fetch` and `cwe` have the network; the others run with `--network none`. `fetch`, `cwe`, `count`, `pick` and `explore`, which read third-party data, drop every capability (the first `explore` and `pick` runs, before that was added to run.sh, did not; both were run again after, and `pick` printed the same bytes).

- `scripts/test.sh` (`logs/test.log`): tsc 0; `vitest run --project node packages/cli/test`: 23 files, 960 passed, 24 skipped; impact.test.ts 25 passed.
- `scripts/full.sh` (`logs/full.log`; CI's checks except Playwright, against a stand-in repository): typecheck 0, build 0, `npm test` 39 files, 1247 passed, 24 skipped.
- `scripts/mutate.mjs` (`logs/mutate.log`): 15 of 15 mutations of impact.ts caught by impact.test.ts, which passes without them: MAL- not trap; any id containing MAL- trap; the weakest or the first CWE wins; CWE-78 dropped from the table; CWE-506 made trap; cwe_ids not read; any severity string kept; `|` not escaped; line breaks kept; the code-span fence not lengthened; minutes rounded instead of floored; an action before the fix accepted; Feb 30 accepted; the summary counting every action as fixed.
- `scripts/pick.mjs` chose the 35 real records in packages/cli/test/fixtures/impact/records.json; their expected classes in impact.test.ts were written from each record's CWEs and severity.
