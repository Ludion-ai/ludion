# Cycle 2 investigations: the one miss, the unknowns, and the stop-rate interval (2026-10-28)

Investigation only. No definition, gate, wait or counting rule is changed, and backtest v4's results stand as published (docs/bench/2026-10-28-backtest-v4). All lookups are public reads (OSV, the npm registry, deps.dev, ecosyste.ms, jsDelivr, Software Heritage, the GitHub advisory API), made in Docker (node:24-slim) on 2026-10-28. Nothing downloaded was run. The scripts are in `scripts/`, the raw answers in `ensdomains-buffer/` and `unknowns/`.

## 1. The miss: @ensdomains/buffer 0.1.1

**The record.**
- MAL-2025-190866: `published` 2025-11-24T16:31:47Z, `modified` 2025-11-26T00:08:10.790441Z. Alias GHSA-f9pq-63hg-w434.
- Its sources (`database_specific.malicious-packages-origins`):

  | Source | Versions | Modified |
  | --- | --- | --- |
  | amazon-inspector | 0.1.2 | 2025-11-24T16:31:47Z |
  | ghsa-malware | 0.1.2, 0.1.1 | 2025-11-24T17:09:19Z (imported 17:23:27Z) |
  | google-open-source-security | 0.1.2 | 2025-11-25T00:16:49Z |

  Only GitHub's malware advisory names 0.1.1. Google's says the package "was compromised by the Sha1-Hulud: The Second Coming NPM worm".
- GHSA-f9pq-63hg-w434 (GitHub's API): published 2025-11-24T17:02:05Z, updated 17:09:19Z, ranges `= 0.1.1` and `= 0.1.2`, no patched version.

**The versions** (registry `time`):

| Version | Published | On the registry today | Publisher (`_npmUser`) |
| --- | --- | --- | --- |
| 0.1.0 | 2022-03-30T02:19:38.944Z | yes | nickjohnson |
| 0.1.1 | 2023-02-28T09:46:00.601Z | no (tarball 404) | makoto_inoue (ecosyste.ms) |
| 0.1.2 | 2025-11-24T05:49:00.347Z | no | davidchu (ecosyste.ms) |
| 0.1.3 | 2025-11-25T08:06:41.545Z | yes | leeondamiky |

**Was 0.1.1 malicious when it was published? No evidence that it was.**
- **Its metadata,** as ecosyste.ms recorded it on 2023-02-28T11:58:26Z, two hours after publication:
  - integrity `sha512-92SfSiNS8XorgU7OUBHo/i1ZU7JV7iz/6bKuLPNVsMxV79/eI7fJR6jfJJc40zAHjs3ha+Xo965Idomlq3rqnw==`;
  - 2,096,683 bytes unpacked;
  - scripts `pub`, `lint`, `test`, `build` and `prepublishOnly`, with no preinstall, install or postinstall;
  - no runtime dependencies;
  - no attestations.
- **Its files, from two independent archives:**
  - jsDelivr still serves the version's files. Its copy of 0.1.0 equals the registry's 0.1.0 tarball in all 22 files.
  - Software Heritage archived 0.1.1 in a visit on 2023-03-23. Its 21 files have the same sha256 as jsDelivr's 21.
  - jsDelivr's byte totals equal the registry's `unpackedSize` for 0.1.0 (1,842,489), 0.1.1 (2,096,683) and 0.1.2 (12,259,267).
  - Neither archive can be checked against 0.1.1's tarball integrity, because the tarball itself is gone.
- **0.1.0 → 0.1.1.** Every `.js` and `.sol` file is unchanged. The changes:
  - added: `package-lock.json` (863,199 bytes, data that npm ignores in a dependency);
  - removed: `build/contracts/Buffer.json` and `build/contracts/Migrations.json`;
  - changed: `package.json` (version 0.1.0 → 0.1.1; `@nomiclabs/hardhat-truffle5` moved from dependencies to devDependencies) and `cache/solidity-files-cache.json`, the Solidity compiler cache (1,759 → 1,751 bytes).
- **0.1.1 → 0.1.2,** the worm:
  - added: `setup_bun.js` (4,960 bytes) and `bun_environment.js` (10,157,586 bytes);
  - `package.json` gains `"preinstall": "node setup_bun.js"`;
  - published by davidchu with npm 10.8.2.

**Which fix selected it, and how.**
- **The fix:** @ensdomains/ens-contracts 0.0.22, the fixed event of GHSA-rrxv-q8m4-wch3 (introduced 0, fixed 0.0.22; advisory published 2023-08-01T19:48:31Z), with T = 2023-07-10T00:06:21.278Z, 3,158.3 hours after 0.1.1.
- **The path:** a direct runtime dependency of ens-contracts. ens-contracts declares `"@ensdomains/buffer": "^0.1.1"` from 0.0.20 (2023-03-01T08:35:38Z, published by makoto_inoue, the publisher of buffer 0.1.1) through 0.0.22. Versions 0.0.15–0.0.19 declare `^0.0.13`.
- **Was it already in the lockfile before the fix?**
  - From 0.0.20 or 0.0.21, the versions just before the fix: yes. `^0.1.1` could only resolve to 0.1.1 until 0.1.2 appeared on 2025-11-24. So the update to 0.0.22 leaves buffer unchanged, and the judge does not judge an unchanged entry.
  - From 0.0.19 or earlier: no. buffer moves from 0.0.13 to 0.1.1, so the update brings it in.
  - The backtest's two scenarios are (a) P not in the lockfile and (b) P locked at prev (0.1.0, which `^0.1.1` does not satisfy). Neither is "already locked at V", so both count the update as bringing 0.1.1 in.

**Did the MAL- record exist when Ludion would have judged?**
- No. The judgement time is T + w. With w from 12h up to 336h (an extended low wait), that is 2023-07-10 to 2023-07-24 at the latest.
- The record was published on 2025-11-24, about 2.4 years later. So the re-query could not stop it, and this is not a bug.
- **Timing detail.** The backtest's conservative time for this version is the record's `published` (24,006.8 hours after V). ghsa-malware, the only source that names 0.1.1, shows a modified time 37 minutes 32 seconds later.
  - The rule for "may have been added later" (malicious-v2.ts) looks at publish times, not at which source names which version.
  - That does not change this outcome.

**Could a signal readable then have stopped it?** None of the stop signals could. These are the facts readable at the judgement time, reconstructed from ecosyste.ms's 2023 record and the registry:

| Signal | 0.1.0 (prev) | 0.1.1 | Effect |
| --- | --- | --- | --- |
| Provenance | none (deps.dev: no SLSA, no attestations) | none | no regression, no stop |
| Install scripts | none | none | no stop |
| New dependencies | `@nomiclabs/hardhat-truffle5` | none | no extension |
| Publisher | nickjohnson | makoto_inoue (a listed maintainer, publisher of 0.0.11–0.0.13) | extends the wait in (b); does not stop |
| Rule 1 | — | published before T | allowed |
| Rule 2 | package created 2018 | — | not young |
| Deprecation, gate 1 advisories | — | none then | no stop |

**Reading.** Public evidence indicates 0.1.1 was a legitimate release that one source added to a 2025 record about 0.1.2. By the registered definition it still counts as missed. Treating it otherwise, for example by requiring that a version be named by more than one source or be malicious by content, would be a new definition and a new run.

## 2. Sources for removed versions, and how many unknowns each could clear

**What makes a version unknown.** A diagnostic copy of `malicious-v4.ts` (`scripts/diag-block.ts`, not committed as a tool) ran offline on v4's cache and reproduced v4's counts exactly (990 / 1 / 157 at 24h, 1,071 / 1 / 76 at 168h). It lists the unreadable keys behind each unknown version: only 86 distinct keys.

| Kind | Keys | What it is |
| --- | --- | --- |
| Removed version (time kept) | 59 | chosen as the highest version before T; its dependencies cannot be read |
| Unparseable spec | 23 | dist-tags (`next`, `beta`, `insiders`, `development`) and invalid ranges (`=>0.20.0 <1`) |
| Same-release check unverified | 3 | @mistralai/mistralai 2.2.2–2.2.4, removed |
| Package not served | 1 | @notamitgamer/mojic |

- 13 of the 59 removed keys are named by MAL- records.
- Removed malicious versions top the list of keys behind the most unknowns:

  | Key | Unknown versions (of 157, 24h) |
  | --- | --- |
  | rc@1.3.9 (the 2021 hijack, live for hours) | 155 |
  | pinkie@2.0.5 | 146 |
  | device-detector-js@3.11.4 | 141 |
  | error-ex@1.3.3 (2025) | 130 |
  | colors@1.4.2 | 74 |

- Each unknown version has a median of 4 such keys, and up to 67.
- 44 of the 157 have an unparseable spec. No data source can say what a dist-tag pointed to at T, so those are a definition question, not missing data.

**Per source.** Each figure is an upper bound: a version that becomes readable can have unreadable dependencies of its own. Nothing was resolved or judged.

| Source | Removed keys it has (of 59) | Unknowns cleared through tree data (24h / 72h / 168h) | Notes |
| --- | --- | --- | --- |
| deps.dev API | 0 | 0 / 0 / 0 | also has none of the 1,140 removed malicious versions (v3, v4). BigQuery snapshots need a Google Cloud account; not checked |
| ecosyste.ms | 8 with dependencies, and the publisher and attestation facts for the 3 unverified checks | 2 / 0 / 1 | keeps registry metadata recorded while a version was listed (0.1.2 above was recorded 70 s after publication) |
| jsDelivr | 6 (`package.json`) | 0 / 0 / 0 alone | serves files of versions someone requested before removal |
| ecosyste.ms + jsDelivr | 16 | 2 / 0 / 1 | |
| Software Heritage | holds buffer 0.1.1 (visit 2023-03-23). None of the 7 keys behind the most unknowns: none has a visit within 60 days after its publication | not estimated beyond that | the anonymous rate limit is 120 requests an hour, so the other keys were not checked |
| OSV records | no dependency data | 0 | per-source version lists and times only |
| Security vendor reports | no dependency lists | 0 under the current definitions | they describe payloads in prose; using them would infer facts, a definition change |
| Wayback Machine, npmmirror, yarn's registry, unpkg | 0 for the case checked | 0 | registry documents are not archived; mirrors follow removals |
| Libraries.io open data (a 2020 dump) | not checked | not estimated | a bulk download, not an API read |

If every removed version were readable, a perfect archive, at most 113 / 54 / 37 unknowns would clear. The rest stay unknown because of unparseable specs or the one package not served.

**A second way to clear unknowns: gate 2 signals from ecosyste.ms.**
- In v4's outcome rule, another gate 2 stop (install scripts added, provenance regression) comes before "unknown".
- ecosyste.ms has metadata for 122 of the 157 unknown versions (24h).
- For 44 of them, it shows an install script that the previous version did not declare. The previous version's scripts come from the registry cache, else from ecosyste.ms.
- So up to 44 / 8 / 2 unknowns (24h / 72h / 168h) would become stopped, if ecosyste.ms were accepted as a source for that signal. Another 44 / 28 / 23 cannot be decided that way.
- Across the denominator, ecosyste.ms holds metadata for 32 of a fixed sample of 50 of the 1,140 removed versions, today unverified for every gate 2 signal.
- Accepting a third-party record of registry metadata is a new definition and a new run. Its integrity cannot be checked against a tarball that no longer exists.

## 3. Backtest v4 as a stop-rate interval

From docs/bench/2026-10-28-backtest-v4 (primary result, conservative timing, with the exception), out of 1,148:
- lower bound: every unknown counted as missed;
- upper bound: every unknown counted as stopped.

The one missed version stays missed in both.

| Wait | Stopped | Missed | Unknown | Lower bound | Upper bound |
| --- | --- | --- | --- | --- | --- |
| 12h and 24h | 990 | 1 | 157 | 990 / 1,148 = 86.24% | 1,147 / 1,148 = 99.91% |
| 72h | 1,052 | 1 | 95 | 1,052 / 1,148 = 91.64% | 1,147 / 1,148 = 99.91% |
| 168h | 1,071 | 1 | 76 | 1,071 / 1,148 = 93.29% | 1,147 / 1,148 = 99.91% |

Optimistic timing, shown, not used: 1,012 / 1 / 135 at 24h (88.15%–99.91%), 1,082 / 1 / 65 at 72h (94.25%–99.91%), 1,085 / 1 / 62 at 168h (94.51%–99.91%). Percentages are rounded to two decimals; the fractions are exact.

## How the scripts ran

Each script in `scripts/` ran as `docker run --rm --read-only --user 1000:1000 node:24-slim node <script>`, with the folders it names mounted. `/out`, `/e` and `/d` hold its inputs and outputs, `/cache` is a copy of backtest v4's registry cache, and `/osv` is the same OSV export. The paths inside the scripts are the container's. Scripts that compare files ran with `--network none`. `diag.sh` builds the diagnostic copy of `malicious-v4.ts` in a scratch copy of the worktree, never in the repository. It ran offline, and one attestation lookup that was not in the cache failed (next@13.5.0). The counts still equal v4's.
