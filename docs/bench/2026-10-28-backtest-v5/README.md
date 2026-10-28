# Judge backtest v5: archives as install-script sources, and the disputed category (2026-10-28, cycle 3)

Backtest v4 with two additions, from the coordinator's task:
- **New sources.** ecosyste.ms and Software Heritage become sources for install scripts when the registry no longer lists a version.
- **The disputed category (係争中).** A version named malicious whose code, shown with the registry's hash and two archives, equals the preceding legitimate version's.

The definitions are in `definitions.md`, with a short entry at the end of docs/decisions.md. Both were committed and pushed before any script read the data. **The disputed category was decided after seeing v4's results** (the definitions say how). The gates, the wait table and the judge's code are unchanged.

## When things were fixed, and what ran

| What | Commit | Time |
| --- | --- | --- |
| Definitions (`definitions.md`, decisions.md entry) | 23ab295 | 20:42:52 JST (CI started 11:43:10Z) |
| Scripts (`malicious-v5.ts`, `archives-v5.ts`, tests) | cadac0b | 20:53:31 JST (CI started 11:53:38Z) |
| Smoke run, `--only=@ensdomains/buffer@0.1.1`, separate cache copy (`smoke/`) | at cadac0b | 11:54:24Z–11:55:39Z |
| **The execution** (the result) | at cadac0b | 11:56:25Z–12:55:30Z, exit 0 (`run-times.txt`) |
| Output committed unchanged | f05e30f | 22:02:04 JST |

- Before the definitions were committed, only @ensdomains/buffer's API answers had been read: to fix field names (`definitions.md`, first section).
- The smoke run read only that version's facts, in its own cache copy. Its output (`smoke/smoke-buffer.json`) is not a result.
- The execution used a fresh copy of v4's cache (Docker volume `ludion-bt4-cache`).
- It ran in Docker (node:24-slim, Node v24.22.1, semver 7.8.5) as user 1000, with a read-only root and no forwarded environment.
- The output records the git blob hashes of `malicious-v5.ts`, `archives-v5.ts` and the judge files it imports (judge.ts, npm-facts.ts, time-cap.ts). The judge files are main's: this PR does not change them.
- Software Heritage's rate limit made the run wait twice, 37 and 15 minutes (`malicious-v5.log`).

## Result: the gate is not met

**v4 reproduced: 0 differences.** With v4's facts and v4's install-script rule, every one of the 1,148 versions gets v4's outcome, in every mode, timing and scenario. So every change below comes from the new sources and the install-script rule.

Malicious versions (1,148), primary result, with the exception. Each cell is stopped / missed / unknown:

| Wait | v5, conservative | v5, optimistic (shown) | v5 without the exception | v4, conservative |
| --- | --- | --- | --- | --- |
| Exploited (12h) | 1,039 / 1 / 108 | 1,051 / 1 / 96 | 1,040 / 1 / 107 | 990 / 1 / 157 |
| High (24h) | 1,039 / 1 / 108 | 1,051 / 1 / 96 | 1,040 / 1 / 107 | 990 / 1 / 157 |
| Normal (72h) | 1,065 / 1 / 82 | 1,085 / 1 / 62 | 1,067 / 1 / 80 | 1,052 / 1 / 95 |
| Low (168h) | 1,078 / 1 / 69 | 1,088 / 1 / 59 | 1,078 / 1 / 69 | 1,071 / 1 / 76 |

**Stop rate as an interval** (conservative, with the exception):
- lower bound: every unknown counted as missed;
- upper bound: every unknown counted as stopped.

| Wait | Lower bound | Upper bound | Optimistic timing (shown) |
| --- | --- | --- | --- |
| 12h and 24h | 1,039 / 1,148 = 90.51% | 1,147 / 1,148 = 99.91% | 91.55%–99.91% |
| 72h | 1,065 / 1,148 = 92.77% | 1,147 / 1,148 = 99.91% | 94.51%–99.91% |
| 168h | 1,078 / 1,148 = 93.90% | 1,147 / 1,148 = 99.91% | 94.77%–99.91% |

v4 was 86.24% / 91.64% / 93.29% at the lower bound, with the same upper bound. The percentages are rounded to two decimals; the fractions are exact.

**The gates:**
- **Every malicious version stopped at each wait: not met.** @ensdomains/buffer 0.1.1 is missed at every wait, and 108 / 82 / 69 versions are unknown.
- **The delay gates: met, carried over from v4** (section "Genuine fixes"): exploited 16.4h (n = 6), high 0h (n = 21), normal 41.5h (n = 138).

All must hold, so v5 does **not meet** the gate.

Per scenario (conservative, with the exception), stopped / missed / unknown:
- (a), P not in the lockfile: 1,065 / 1 / 82 at 12h and 24h, 1,075 / 1 / 72 at 72h, 1,078 / 1 / 69 at 168h;
- (b), P locked at prev: the same as the primary result.

## What each signal contributed

**The contribution is the change from v4.** That is 49 versions at 12h and 24h, 13 at 72h and 7 at 168h, all moving from unknown to stopped. Every one moves because of an install script that ecosyste.ms's copy of the version document shows:
- Each fires in scenario (a): a new package that runs install scripts.
- 42 of the 49 (24h) also fire in (b) as "added".
- 7 fire in (b) under the rule for a prev the registry no longer lists:
  - @optimystic99/dev-utils 1.0.22;
  - google-profanity-words 1.0.1 and 1.0.2;
  - rxnt-healthchecks-nestjs 1.0.3 and 1.0.4;
  - rxnt-kue 1.0.5 and 1.0.6.

`malicious-v5.json`, `changes_from_v4_with_exception`, lists each version per wait. No version moved in the other direction, and none moved through Software Heritage or the registry.

Stops per signal, conservative, with the exception. Each cell is fires / alone, with "alone" as v4 defines it:

| Signal | 12h | 24h | 72h | 168h |
| --- | --- | --- | --- | --- |
| Stopped | 1,039 | 1,039 | 1,065 | 1,078 |
| Install scripts (any source) | 574 / 0 | 574 / 0 | 575 / 0 | 575 / 0 |
| … from the registry | 1 / 0 | 1 / 0 | 1 / 0 | 1 / 0 |
| … from ecosyste.ms | 573 / 0 | 573 / 0 | 574 / 0 | 574 / 0 |
| … from Software Heritage | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Provenance regression | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Re-query | 6 / 5 | 6 / 5 | 6 / 5 | 6 / 5 |
| No fix (that rule 1 lets through) selects it | 1,033 / 460 | 1,033 / 460 | 1,059 / 485 | 1,072 / 498 |
| … of which selected only in trees rule 1 stops | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

v4, reproduced on the same rows: install scripts 1 / 0, re-query 6 / 6, and "no fix selects it" 984 / 983 (12h, 24h), 1,046 / 1,045 (72h), 1,065 / 1,064 (168h).

**Why the install-script signal's "alone" is 0.** v4's "alone" counts "no fix selects it" as another reason. That holds even for a version that would be unknown without the signal, because a fix in its window has an unreadable branch. The 49 versions above are of that kind. So "alone" understates the signal. The change from v4 is the measure of what it adds.

**The facts behind the signal:**
- **V's install scripts, by source:**
  - the registry: 8 (the versions it still lists);
  - ecosyste.ms: 693;
  - Software Heritage: 1;
  - unverified: 446.
- **ecosyste.ms, for the 1,140 removed versions:**
  - held, with a `scripts` key: 693;
  - held without one: 0;
  - not held: 447;
  - unreadable: 0.
- **575 versions declare an install script.** The rule fires on 575 in (a) and 572 in (b). The 3 that fire only in (a) declare the same scripts as their prev: duckdb 1.3.3, airchief 0.3.1 and @hapheus/n8n-nodes-pgp 1.5.1.
- **Software Heritage (rule (i)): read for 35 versions, held 1.**
  - The one it holds is hyperterm-hipster 1.0.3 (visit of 2019-06-24). It shows no install script, so the version stays unknown.
  - The other 34:
    - 24 are not in the first snapshots after publication;
    - 7 have no visit with a snapshot after publication;
    - 3 have no archived origin.
- **Requests:** ecosyste.ms 1,141, registry packuments 728, registry tarballs 733, jsDelivr 2,036, Software Heritage 104. None unreadable.

What the unknowns are now. At 24h, 108 versions are unknown. By V's install-script fact:
- ecosyste.ms shows none: 68;
- unverified: 34;
- the registry shows none: 4;
- Software Heritage shows none: 1;
- ecosyste.ms shows one, and prev has the same: 1.

At 168h, 69 are unknown: ecosyste.ms none 50, unverified 14, registry none 4, Software Heritage none 1. So reading install scripts for the remaining unverified versions would clear at most 34 at 24h and 14 at 168h. The rest are unknown because a fix in their window resolves through a branch that cannot be read, as in v4.

Unchanged from v4:
- the trees: 5,399 resolved; rule 1 stops 43 with the exception and 494 without; 610 and 603 with an unreadable branch;
- the two versions stopped only without the exception: loliloli 1.0.108 at 12h, 24h and 72h, and @alexcolls/nuxt-ux 0.6.2 at 72h.

## The disputed category

**2 of the 1,148 versions are disputed.** They stay in the denominator.

| Version | Record | Published | prev_d | Evidence | Outcome (all four waits) |
| --- | --- | --- | --- | --- | --- |
| @ensdomains/buffer 0.1.1 | MAL-2025-190866 | 2023-02-28T09:46:00Z, removed | 0.1.0 | See below | **missed** |
| freo-design-system 1.0.4 | MAL-2025-3399 | 2025-04-25T21:51:55Z, still listed | 1.0.3 | See below | stopped |

- **@ensdomains/buffer 0.1.1.**
  - The registry's hash comes from ecosyste.ms and Software Heritage, which agree: shasum `6c275ba7…`, integrity `sha512-92SfSiNS…`, unpackedSize 2,096,683.
  - Software Heritage's artifact is the registry's tarball URL, with that sha1. Its visit was 2023-03-23.
  - Software Heritage and jsDelivr hold the same 21 files.
  - Compared with 0.1.0, the only differences are inert or removals: `cache/solidity-files-cache.json` and `package-lock.json` changed or added; `build/contracts/Buffer.json` and `build/contracts/Migrations.json` removed.
- **freo-design-system 1.0.4.**
  - The registry, ecosyste.ms and Software Heritage agree on the hash (shasum `c2c00593…`, unpackedSize 1,053).
  - Software Heritage's artifact has that sha1. Its visit was 2025-12-05.
  - Both archives hold the same 2 files. Its other file equals 1.0.3's, and its `package.json` matches 1.0.3's in every field the check compares.

Outcomes, conservative, with the exception, stopped / missed / unknown:

| Wait | Disputed (2) | Others (1,146) |
| --- | --- | --- |
| 12h and 24h | 1 / 1 / 0 | 1,038 / 0 / 108 |
| 72h | 1 / 1 / 0 | 1,064 / 0 / 82 |
| 168h | 1 / 1 / 0 | 1,077 / 0 / 69 |

So the one miss is a disputed version. Even counted apart, which the gate does not do, the gate would still fail on the unknowns.

**Funnel.** The first check each version failed, in the definitions' order:

| Check | Failed there |
| --- | --- |
| A preceding legitimate version exists | 0 |
| The registry lists prev_d | 124 |
| jsDelivr holds V | 12 |
| prev_d's tarball matches its integrity | 0 |
| V's `package.json` from jsDelivr matches its list | 988 (see "Anomalies": the CDN answered 404) |
| Code identical to prev_d (jsDelivr's files) | 22 |
| The copies of the hash and `unpackedSize` agree | 0 |
| Software Heritage holds V, the two archives agree, the artifact is tied to the hash | 0 |
| **Disputed** | **2** |

That totals 1,148. Software Heritage was read for the 2 versions that reached it (rule (ii)).

## Genuine fixes: carried over from v4

As the definitions (section 5) set out, v4's genuine results stand: `docs/bench/2026-10-28-backtest-v4/fixes-v4.json`.
- Stops: 35 of 200 with the exception.
- Delays: exploited 16.4h (n = 6), high 0h (n = 21), normal 41.5h (n = 138), all within their gates.

8 of the 200 updates involve a version the registry no longer lists (`diagnostics/genuine-unlisted.json`, from v4's cache):
- **taylored 7.0.7 → 7.0.8:** both are unlisted. Already stopped: "no longer listed".
- **duckdb 1.3.3 → 1.3.4:** the predecessor is unlisted. Stopped: install scripts with no comparable predecessor, read from the registry.
- **Six updates from an unlisted predecessor, all ready except build:**
  - debug 4.4.2 → 4.4.3;
  - color-name 2.0.1 → 2.0.2;
  - flowise 3.0.9 → 3.0.10;
  - error-ex 1.3.3 → 1.3.4;
  - simple-swizzle 0.2.3 → 0.2.4;
  - eslint-config-prettier 8.10.1 → 8.10.2.

The judge does not compare against a predecessor it cannot list. So no archive fact about those predecessors can change these verdicts.

## Anomalies and limits

- **The run's attached shell was stopped; the run was not.**
  - Shortly before 12:02:43Z, Claude Code stopped the background shell that held `docker run`, because the host was low on memory.
  - The container kept running (`docker ps`: "Up 6 minutes" at 12:02:43Z, 2.37 GiB at 12:33Z). It finished on its own at 12:55:30Z with exit 0.
  - It is the same, first execution: nothing was restarted.
- **jsDelivr lists removed versions but does not serve their files.**
  - The run fetched V's `package.json` from cdn.jsdelivr.net but did not record the HTTP status, so 988 versions failed under a label that says "does not match its list".
  - Checked after the run (13:00:35Z, `diagnostics/jsdelivr-cdn.json`): the CDN answers 404 "Couldn't find the requested release version" for all 988, while jsDelivr's data API still lists their files with hashes.
  - Under the definitions these versions fail the check. That is what happened (fail closed), so no result changes. But the check was blocked, not decided.
  - In jsDelivr's lists, 23 of the 988 have no non-inert file that differs from prev_d. Their differences are only in `package.json`, which could not be read. Among them: color 5.0.1, eslint-config-prettier 10.1.6, @toptal/picasso 54.1.3.
  - Whether jsDelivr's lists for removed versions are complete was not checked.
- **Software Heritage holds few malicious versions.** It held 1 of the 35 versions read for install scripts, which confirms the cycle-2 finding. ecosyste.ms is the source that moved the numbers.
- **Not covered:**
  - archives were not used for trees, nor for provenance, publisher or new dependencies (by definition);
  - the new sources say nothing about the 446 versions neither holds.
- **ecosyste.ms is a third-party copy of the registry's metadata.** Its integrity cannot be checked against a tarball the registry no longer serves. For the disputed category, Software Heritage's artifact checksum ties the copies to a tarball.

## Files

- `definitions.md`: the definitions, fixed before the run.
- `malicious-v5.json`: the output: per version, the facts with sources, outcomes with and without the exception, and the disputed funnel step with its evidence. `malicious-v5.log` is the run's log, and `run-times.txt` its start and end.
- `smoke/smoke-buffer.json`: the smoke run (not a result).
- `diagnostics/`: post-run checks that change no result:
  - `jsdelivr-cdn.json`: the CDN's answers for the 988;
  - `genuine-unlisted.json`;
  - `summary.txt`: the tables above, printed from `malicious-v5.json` by `scripts/summarize.mjs`.
- `scripts/`: the Docker wrappers (`setup.sh`, `sync.sh`, `copycache.sh`, `smoke.sh`, `run.sh`), the summary script and the diagnostics' scripts.
- `ghsa-correction-request.md`: a draft correction request to the GitHub Advisory Database for @ensdomains/buffer 0.1.1. **Not sent.**
