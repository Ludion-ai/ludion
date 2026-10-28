# Shadow operation: design and estimate (2026-10-28, cycle 3, LS)

**Status: a design and an estimate.** Where the shadow runs in production needs the owner's approval, so section 6 gives the options without choosing one. The only thing that ran for this document is a one-off measurement of public data, which feeds the estimates (section 4).

**Later.** The recorder (sections 2.1 to 2.4) is built in a separate PR, and runs on the owner's PC until the owner chooses a place. The replay (2.5 to 2.7) is not built. How (b) is counted is fixed in docs/decisions/2026-10-29-shadow-counting.md, before any recording.

The release conditions this shadow serves were fixed first, in docs/decisions/2026-10-28-release-gates-by-stage.md (first committed to docs/decisions.md as cdea65e, 2026-10-28 22:49:56 JST). They were decided after seeing v5's results (オーナー決定 2026-10-28 22:46 JST). The wait table and the gates' numeric criteria are unchanged.

## 1. Where the conditions stand today

As of 2026-10-28, read from main's records (docs/progress.md and the bench READMEs). Nothing in this section is a new measurement.

| Condition | For | Where it stands |
| --- | --- | --- |
| Noise measurement's miss gate (L1) | preview comments | **not met**: 167 misses in 32 of 100 repositories (docs/bench/2026-10-28-noise) |
| Workspace false stop fixed (L9) | preview comments | not merged: #174 is a draft, its rule built but not wired |
| Protected-path PR "LP" merged | preview comments | not merged |
| (a) zero misses of confirmed malicious versions in the backtests | automatic merge | **not decided here.** v5 misses one version, @ensdomains/buffer 0.1.1, and that version is disputed. So (a) does not count it. But at 24h, 108 versions are unknown, and 988 versions were left undecided by the disputed check. The decision does not say how unknown versions count under (a). |
| (b) four weeks of shadow operation | automatic merge | not started; this document is its design |

## 2. What the shadow does

```text
[npm replication feed]                    [OSV: npm/modified_id.csv, daily]
  replicate.npmjs.com/registry/_changes      new or changed MAL- records
        │ ids of changed documents                  │
        ▼                                           ▼
[filter: watched names] ──► [capture, right away] ──► [store]     [replay when a MAL- record names a captured version]
                              packument time map,       append-only    the judge's rules on the captured facts,
                              version manifest,         records        per urgency row, at the judge's wait_until
                              attestation bundle,                            │
                              file hashes (no tarball)                       │
                                                                              ▼
                                                                [record: verdict per version, wait and scenario]
```

**2.1 Following the registry.** `GET https://replicate.npmjs.com/registry/_changes?since=<last seq>&limit=10000`. Since 2025-05-29 the feed only answers with ids and revisions. `include_docs` is not supported, the streaming modes are gone, and `limit` is at most 10,000 ([GitHub community discussion 152515](https://github.com/orgs/community/discussions/152515), [changelog 2025-02-27](https://github.blog/changelog/2025-02-27-changes-and-deprecation-notice-for-npm-replication-apis/)). So:
- every poll reads pages until `last_seq` stops moving, and stores `last_seq` only after the captures for that page are stored;
- the feed's sequence numbers are not contiguous (the sample in `out/changes-sample.json` has 212 entries over a range of 534). The feed shows only each document's latest change, so the stored position is the feed's `last_seq`, never a computed one;
- ids outside the watched set are dropped without any further request.

**2.2 Capture.** For each changed watched name, the shadow makes the same reads as the judge's `registryFacts` (packages/cli/src/security/npm-facts.ts), right after the change is seen:
- the full packument, `registry.npmjs.org/<name>`. The abbreviated document (`application/vnd.npm.install-v1+json`) has no `time`, checked on `semver`, and rule 1 and `package_created` need `time`;
- for each version new since the last capture, `/-/npm/v1/attestations/<name>@<version>` when `dist.attestations` is present.

What is stored, per capture:
- `fetched_at`, the URL, the HTTP status, and the response's sha256;
- the packument's `dist-tags`, and its `time`: in full at the first capture of a name, then only the entries that are new or changed;
- for each new or changed version, the manifest as served, minus e-mail addresses: `_npmUser.email` and `maintainers[].email` are dropped. `shared_publisher` is computed at capture with the judge's `sharedPublisher` and stored next to the name, with the commit of the code that computed it. This keeps the judge's input without republishing addresses;
- the attestation bundle as served;
- **the file list of V's tarball**: each path, size and sha256. The tarball is downloaded from the registry and checked against `dist.integrity`. It is never extracted to disk, run or stored. Only the list is kept. This is what the disputed check in 2.7 needs from the moment of publication: v5 found that jsDelivr's CDN answers 404 for the files of removed versions, so the archives may not hold them later. Tarballs above a size limit are not hashed, and that is recorded.

No tarball is stored: the judge compares the lockfile's integrity with `dist.integrity`, which the manifest carries. Later changes to a captured document are captured the same way, so the store also holds when a version was deprecated or disappeared. That is what the re-query at a wait's end needs.

**2.3 The watched set.** It is the names in these lockfiles, frozen when the shadow starts:
- this repository (dogfood);
- Ludion-ai/ludion-sandbox;
- the noise measurement's 100 repositories, at their recorded SHAs.

Measured today: 7,660 distinct names. **Ludion-ai/ludion-sandbox is an empty repository** (GitHub: "Git Repository is empty."), so today it adds nothing.

**2.4 Daily OSV.** Once a day, download `https://osv-vulnerabilities.storage.googleapis.com/npm/modified_id.csv`. Its lines are `<modified>,<id>`, newest first ([OSV data dumps](https://google.github.io/osv.dev/data/)), so it is read until the last processed time. Then fetch each new or modified `MAL-` record from `api.osv.dev/v1/vulns/<id>`, and store it whether or not it names a watched package (about 35 a day). Nothing about the watched set is sent; the judge's own OSV queries stay names and versions only.

**2.5 Replay.** A MAL- record that names a watched package's version V starts a replay. **How each judgement is made and counted is fixed in docs/decisions/2026-10-29-shadow-counting.md**: what follows only summarises it.
- **The rows.** One judgement per urgency row (exploited, high, normal, low), as the backtests do.
  - `judge()` takes urgency only from its fixes (`urgencyOf`), so the replay gives it a synthetic fix for P from prev to V. The fix's `kev` or `severity` makes `urgencyOf` return the row's urgency, and V becomes the time cap's target.
  - So rule 2's threshold is WAIT_HOURS of the row, and the wait is the judge's own: the row's wait, 24h for exploited without comparable provenance, or max(2 × that wait, 72h) when extended.
- **When.** At the judge's own `wait_until`: the newest publish in the change plus that wait, not V's publish time plus the wait. A same-release sibling published after V moves it. The re-query sees only MAL- records published by then, and captures taken before then.
- **The scenarios.**
  - (b): P locked at prev, updated to V.
  - (a): V added as a new direct dependency. A new package has no `from`, so a fix cannot set its urgency, and (a) is judged only in the normal and low rows.
- **The outcomes.**
  - `stop`, or `undecidable` with every input captured, is stopped.
  - `ready_except_build` is missed.
  - A missing input means the judge is not run; that is a **capture gap**, counted as a miss. This covers V removed before its first capture, or a missing predecessor or `created`.
- **Also shown, not counted.** The judge's literal verdict with its own urgency. The counted outcome is a per-row counterfactual, as in the backtests.

This framing is harsher than the backtests in one way. A malicious version reaches a project here through a direct update to it, as a Dependabot version update proposes. The backtests' most frequent stop, "no fix selects it" (1,033 of 1,039 stops at 24h in v5), does not apply.

**2.6 Judging every captured version, for the count.** Condition (b) needs at least 100 decided judgements. So every captured version is also judged in scenario (b) against one prev: the highest version below it in the watched lockfiles, else the registry's predecessor. "Decided" is `stop` or `ready_except_build` in all four rows. The estimate in section 5 is about 27,000 captured versions in four weeks, so the count itself is not the hard part.

**2.7 Disputed versions: false-report candidates and record omissions.** When a MAL- record names a captured version V, V is checked against v5's disputed standard: the registry's hash and two archives tied to it show that V's code equals its preceding legitimate version's (docs/bench/2026-10-28-backtest-v5/definitions.md, section 3). The recorder's own file list from 2.2 must agree with the archives, when it exists.

Being disputed catches two different things, so they are kept as two categories (owner's addendum, 2026-10-28 23:11 JST):
- **False-report candidate.** The record may name a version that was never malicious. Example: @ensdomains/buffer 0.1.1, a 2023 release whose code equals 0.1.0's, named by a 2025 record about 0.1.2's compromise. A correction request for it was sent by the owner: github/advisory-database issue 10743.
- **Record-omission candidate.** V is likely malicious, and the record misses its identical predecessor. Example: freo-design-system 1.0.4. Its predecessor 1.0.3 added the same `preinstall` 59 minutes earlier and is named by no record. The correction would add 1.0.3 to the record, not remove 1.0.4.

The rule that tells them apart is mechanical, so that it is decided before any data. Take O, the first version of the run of code identical to V. If O was published after another MAL-named version of P, or O adds an install script its predecessor lacks, V is a record-omission candidate. Otherwise it is a false-report candidate. Both examples fall where the rule puts them.

For condition (b):
- record-omission candidates count as malicious;
- false-report candidates stay in the denominator, are shown apart, and are not counted as misses.

The shadow sends no correction request: any request is the owner's.

## 3. How (b) is counted

Fixed in docs/decisions/2026-10-29-shadow-counting.md, committed before the recorder's first poll.
- The four weeks start at the first successful poll after that file and the recorder are merged. A UTC day without a successful poll restarts them.
- A miss is a missed row or a capture gap on a version that is confirmed malicious or a record-omission candidate. The MAL- record must be published by the end of the window plus 336h.
- Decided: at least 100 versions with `stop` or `ready_except_build` in all four rows.
- Shown, not gated: MAL- counts by category, capture lag, every capture gap and undecidable verdict, and the judge's literal verdicts. If no MAL- record names a version in the window, the report says the miss half was **met with no case**.

## 4. Measured inputs

`scripts/measure.mjs`, run once in Docker on 2026-10-28 from 13:52:36Z to 13:53:38Z. It used node:24-slim (Node v24.22.1) as user 1000 with a read-only root. Network access was for public reads only, and no project code ran. The output is `out/measure.json` and `out/measure.log`. Two later reads of the feed's root and `_changes` are in `out/` too.

Not recorded by the script. Each of these was read by hand in this session and is not saved with a timestamp:
- **Dogfood SHA.** 51a8f0b, main's head; the script reads `DOGFOOD_SHA` but does not write it.
- **The sandbox fact.** From `gh api`, HTTP 409; the script writes it as a fixed string.
- **OSV file sizes.** The `modified_id.csv` and `all.zip` sizes, from HTTP HEAD just before the run.
- **Feed read times.** 13:54:52Z and 13:56:15Z, from `date -u` printed next to each read.

**Image and labels.** The image was the local node:24-slim, image ID 55fb5f5a527e, run by tag rather than by digest. In measure.json, `top_publishers_in_window` counts versions per package name, not per publisher.

| Input | Value | From |
| --- | --- | --- |
| Lockfiles read | 101 of 101: dogfood at 51a8f0b and the 100 noise repositories. The 100 noise lockfiles are 37,669,376 bytes; the dogfood lockfile is not in that total | measure.json `watched_set` |
| Distinct names / name@versions | **7,660** / 17,673 (2,088 name@versions not resolved from registry.npmjs.org) | same |
| Sample | the 300 names with the lowest sha256(name), all 300 read | `sample` |
| New versions, 2026-09-30 to 2026-10-28 (28 days) | 1,062 across 86 of the 300 names: **0.1264 per name per day**. @clerk/backend alone has 329. Without it: 0.0873 | same |
| Version manifest size | median 3,231.5 bytes, p90 4,778, mean 3,532.3 | same |
| With attestations | 871 of 1,062. Bundle size from 200 read: median 14,723 bytes, p90 16,435, mean 14,963.9. The 200 are the first in completion order of concurrent reads, so the sample is not reproducible and a few packages may dominate it | same |
| With an install script | 6 of 1,062 | same |
| Full packument size | median 84,516 bytes, p90 1,409,833, max 29,121,477 | same |
| Feed rate | 309 changed documents from seq 140335691 (13:52:36Z) to 140336486 (13:56:15Z), 219 s: about 1.41 a second. One 3.6-minute sample, so low confidence | `out/changes-since-start.json`, `out/replicate-root-2.json` |
| Feed entry size | 104.6 bytes per entry | same |
| MAL- records ever naming a watched name | 53 (OSV querybatch, names only). **None published in the 28-day window**. 22 published in the last 12 months, on 8 days: 2025-11-24, 2025-11-25, 2026-03-31, 2026-04-18, 2026-05-11, 2026-05-12, 2026-05-19, 2026-08-04 | `osv` |
| 28-day windows with at least one such record | **134 of the 365 windows** ending on each of the last 365 days | computed from `osv.mal_records` |
| OSV npm `modified_id.csv` | 8,725,308 bytes; 230,857 lines, 222,860 of them MAL-. 976 MAL- lines modified in the 28-day window | `osv`, HTTP HEAD |
| OSV npm `all.zip` | 219,263,393 bytes (not downloaded) | HTTP HEAD, last modified 2026-10-28 11:33:00 GMT |

**What this means for (b).** With the past year's records against today's watched set, about 134 of 365 four-week windows (37%) would have held any MAL- case at all. So a four-week shadow will most likely pass the miss half of (b) with no case. The watched set is today's lockfiles, so this undercounts packages that were removed from projects after an incident.

## 5. The workload, estimated

Each line is arithmetic on section 4's measurements, not a measurement of the shadow.

| Item | Estimate | How |
| --- | --- | --- |
| New watched versions per day | about **968** (669 without @clerk/backend) | 7,660 × 0.1264 (× 0.0873) |
| Over four weeks | about 27,100 (18,700) | × 28 |
| Stored per version | about 15.8 KB | 3,532 + 0.820 × 14,964 bytes |
| Stored per day (versions) | about **15.3 MB** uncompressed | 968 × 15.8 KB; compression not measured |
| Four weeks / one year (versions only) | about 430 MB / 5.6 GB | × 28 / × 365 |
| `time` maps: the first capture of each watched name, and the new entries after it | not measured (the `time` maps were not sized). Not in the 15.3 MB above | — |
| Registry reads per day | about 968 packuments + 794 attestations at most | one packument per change event, attestations at 82.0% |
| Tarball downloads per day, for the file lists (2.2) | about 968, size not measured; only the lists are stored | one per new version |
| Packument download per day | about 82 MB at the median size, 1.36 GB at the p90 size. Neither is a bound: names that publish often may have large packuments (not measured), and the mean was not measured | 968 × 84.5 KB; 968 × 1.41 MB; not stored |
| Feed reads per day | about 122,000 entries, 12.7 MB | 1.41/s × 86,400 × 104.6 bytes; low confidence |
| OSV per day | 8.7 MB of `modified_id.csv`, about 35 record reads | 976 / 28 |
| Replays per day | about 0.06 (22 records a year) | 22 / 365 |

How long to keep captures: a MAL- record can come long after publication. @ensdomains/buffer 0.1.1 was named 24,006.8 hours later (backtest v4). So 90-day artifact retention is not enough. The proposal is to keep everything for the shadow plus at least 90 days, about 1.8 GB of version data at the rate above (118 days × 15.3 MB), plus the `time` maps, which were not sized, and to decide longer retention with the owner.

## 6. Where it could run: options for the owner

The npm registry's rate limits for these reads are **not known**: no public number was found.

| | A. GitHub Actions, scheduled, public repository | B. Cloudflare Worker, Cron Trigger, R2 | C. B for capture, A for OSV and replay |
| --- | --- | --- | --- |
| **Cost** | $0: "free … for public repositories that use standard GitHub-hosted runners" ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). A private repository has 2,000 minutes a month, and a poll every 5 minutes is 8,640 runs a month, so it does not fit | Workers Paid: "minimum charge of $5 USD per month for an account". It includes 10 million requests and 30 million CPU ms ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)). R2 at 15.3 MB/day (versions only) stays in the free 10 GB-month for about 650 days, and one object per run is 8,640 Class A operations a month against 1 million free ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)). Whether the account is already on Workers Paid is **not known** | B's cost plus A's |
| **Free plan?** | — | No. The free plan allows 10 ms CPU per Cron Trigger and 50 subrequests ([limits](https://developers.cloudflare.com/workers/platform/limits/)), and parsing one 1.4 MB packument likely needs more (not measured) | — |
| **Storage** | Commits to a data branch or a separate repository: 10 GB on-disk, 100 MB per file, 3,000 entries per directory ([repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)). Artifacts last at most 90 days in a public repository ([retention](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)), too short (section 5). The captures would be public. They are public registry data, minus e-mail addresses (2.2) | R2, private. 1 year ≈ 5.6 GB of version data | R2 |
| **Capture lag** | Schedules run "once every 5 minutes" at the shortest and "can be delayed during periods of high loads", for example at the start of every hour ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). The size of the delays is not known | Cron granularity is one minute. The CPU limit is 30 s per trigger under a 1-hour interval, wall time 15 min, 10,000 subrequests ([limits](https://developers.cloudflare.com/workers/platform/limits/)) | B's |
| **Permissions** | A capture-and-judge job with `contents: read` and no secrets uploads its output as an artifact. A writer job with `contents: write` commits it and runs no Node or dependency code, the same split as judge.yml and judge-comment.yml. Actions pinned by SHA. No token beyond `GITHUB_TOKEN` | A new Worker, an R2 bucket and a Cron Trigger. That is a Cloudflare change outside the ludion Worker, so it needs the owner's authorization (CLAUDE.md). Deploying needs a Cloudflare API token. Production deployment goes through deploy.yml only, so deploy.yml (a protected path) or a new protected workflow would have to change | A reads R2, so it needs an R2 credential as a secret, or the Worker serves the captures over HTTP, which starts to look like the relay CLAUDE.md rules out |
| **Failure handling** | The feed resumes from the stored `last_seq`, so a missed or failed run loses only the versions removed in the gap. Each one becomes a recorded capture gap. A `concurrency` group keeps one writer. Scheduled workflows in a public repository are disabled after 60 days without repository activity (events doc). Whether the bot's data commits count as activity is **not known**, so the daily job fails visibly when the last capture is older than a day | The same resume from `last_seq`, stored in R2. Whether a failed Cron Trigger is retried is **not known** (no source found). Alerting needs a status object that something checks, because no new account or alert service may be added | Two places to fail; the daily job checks the capture's freshness |
| **Owner actions** | Approve the repository: this one (a data branch) or a new repository in Ludion-ai. Merge the workflow PR, which is a protected path (.github/) | Approve the Worker, R2 bucket and Cron Trigger, the possible $5/month, the API token, and the deployment path | Both |

**The rules this design keeps** (CLAUDE.md, "Ludion must not become the attack path"):
- No npm token, and no new account.
- No tarball is stored, and nothing is served to users, so this is not a mirror. Option C's HTTP variant is the one that comes close.
- Nothing about a project goes to OSV: it is a daily public download, plus the judge's name-and-version queries.
- The writing job runs no dependency code.

## 7. What the shadow cannot show

- **A hijacked publisher with no provenance change** passes every stop condition. Only the wait and the re-query catch it (design.md, "関門2が見逃すもの"). The shadow measures exactly that, but only on records that appear.
- **Few cases.** Most four-week windows hold no MAL- record naming a watched package (section 4). Then (b)'s miss half is met with no case, and that says little.
- **Late records.** A record published after the window plus 168h is outside (b), as proposed. Records keep coming for years, and the store keeps the data to replay them.
- **Versions removed before the first capture.** Malicious versions are often removed within an hour (design.md, chalk and debug). Every one the shadow misses is a capture gap, and it counts as a miss under section 3.
- **Gate 3 and gate 1's OS, SAPI and configuration checks** are not built, so `ready_except_build` is the closest the judge comes to "would apply".

## 8. Choices for the owner

1. **Where it runs:** A, B or C (section 6). A has no new cost or service. B captures faster and keeps the data private.
2. **Retention:** the shadow plus 90 days (about 1.8 GB of version data, plus `time` maps), or longer.
3. **Wider watch, optional:** to get MAL- cases into (b), capture every npm version, not only the watched set. Feed volume would then be about 122,000 changes a day (low confidence), so storage and requests grow by two orders of magnitude. This was not estimated further. It would also change (b)'s population, so it would have to be fixed in docs/decisions/ first.

## Files

- `scripts/measure.mjs`: the measurement, with its Docker command in the header.
- `out/measure.json`, `out/measure.log`: its output.
- `out/changes-sample.json`, `out/changes-since-start.json`, `out/replicate-root-2.json`: the feed reads, 13:54:52Z and 13:56:15Z.

## Sources

- [GitHub community discussion 152515: npm replication API changes](https://github.com/orgs/community/discussions/152515)
- [GitHub Changelog: changes and deprecation notice for npm replication APIs (2025-02-27)](https://github.blog/changelog/2025-02-27-changes-and-deprecation-notice-for-npm-replication-apis/)
- [OSV: data dumps](https://google.github.io/osv.dev/data/)
- [GitHub Docs: GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Docs: Actions limits](https://docs.github.com/en/actions/reference/limits)
- [GitHub Docs: events that trigger workflows (schedule)](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [GitHub Docs: artifact and log retention](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)
- [GitHub Docs: repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
- [Cloudflare: Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare: Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare: R2 pricing](https://developers.cloudflare.com/r2/pricing/)
