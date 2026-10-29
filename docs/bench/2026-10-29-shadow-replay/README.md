# The shadow's replay (2026-10-29, LSR)

The replay from docs/bench/2026-10-28-shadow-design/README.md, sections 2.5 to 2.7. It counts condition (b) as docs/decisions/2026-10-29-shadow-counting.md fixes it. That decision is not changed here: where it could not be followed literally, the reading taken is listed below, and nothing in it was loosened.

**What exists now.** The replay is built, and has run on snapshots of the recorder's store. **There is no (b) result.** The four weeks run until 2026-11-25T15:51:48.401Z, and the result is final only after 2026-12-09T15:51:48.401Z (the window's end + 336h). The runs below are preliminary checks that the replay reads the real store, and they judge nothing yet.

## What it does

`tools/shadow/src/replay.ts` reads the recorder's data folder (`captures/`, `osv/`, `status/`) and nothing else about versions. Each fact the judge gets is a capture taken before the moment of the judgement.

- **The four weeks** (section 2).
  - They start at the first `poll` status line, the recorder's first successful poll.
  - A UTC calendar day with no `poll` line ends the run; the next run starts at the next successful poll.
  - Only days before the replay's own day are checked: today is not over.
  - The window is the first run that lasts 28 days.
- **The versions** (section 3). Every version of a watched name whose stored publish time (the packument's `time`, as captured) falls in the window.
- **One judgement** (section 4). It is the judge's own `judge()`, imported unchanged. `scripts/run.sh` runs a tree of its own: HEAD's committed files, with judge.ts, npm-facts.ts, time-cap.ts and archives-v5.ts taken from the recorder's start commit (8a78b55). So a later change to the judge does not change the count (main's #193 changed judge.ts after the start). It prints each file's blob next to the start commit's, and the output records the blobs it ran. It refuses a watched list other than the start line's.
  - **(b), per row.** A synthetic fix (`SHADOW-SYNTHETIC-FIX`) from prev to V sets the row. Exploited is `kev: true`; high is `severity: CRITICAL`; normal has neither; low is normal with the change marked dev.
    - `locked` is {P@prev}, and `files` is package.json and package-lock.json.
    - `resolved` is the registry tarball, and `integrity` is V's captured `dist.integrity`.
    - `advisories` is empty, and `projectWait`, `split` and `extraneous` are not given.
  - **(a).** V is added as a direct dependency, `locked` is empty, and there is no fix. Normal and low are judged; exploited and high are `not_applicable`.
  - **prev.** Each watched-lockfile version of P below V. Without one, the registry's predecessor.
  - **When.** At the judge's own `wait_until`, with `now` 1 ms after it. It is computed first from the facts at the end of the poll that captured V, then again from the facts as of `wait_until`, until it stops moving (at most 20 times; otherwise a capture gap).
  - **MAL- records.** A record counts at a judgement as its latest stored copy modified by then says. It must be published by then, and not withdrawn by then.
- **Outcomes** (section 5).
  - `stop`, or `undecidable` with every input captured, is stopped.
  - `ready_except_build` is missed.
  - A missing input is a capture gap, and the judge is not run. That covers:
    - V never captured;
    - attestations the manifest lists that were not captured;
    - a predecessor not captured;
    - a new dependency's `created` not captured;
    - no version of P below V at all (a missing predecessor).
  - A `wait` at `wait_until` is a capture gap.
  - Combined per row over every scenario and prev: missed if any missed, else a capture gap if any, else pending if any, else stopped.
- **Pending.** A judgement whose `wait_until` is past the store's coverage is pending, and the result is not final. The coverage is the last successful poll or the last OSV read, whichever is earlier.
- **Final.** All of these must hold:
  - the window is complete;
  - the window's end + 336h has passed;
  - an OSV read is at least 24h past that time, since a record published by then may be imported into OSV later;
  - nothing is pending;
  - no OSV record was given up.
- **Malicious versions** (sections 3 and 6). These are versions in the window named by a MAL- record published by the window's end + 336h. A record withdrawn later still counts here, because section 6 sets apart only false-report candidates. Each one goes through `tools/shadow/src/disputed.ts`:
  - **The disputed check.** It is v5's, in v5's order, read from the registry, jsDelivr, ecosyste.ms and Software Heritage. The recorder's captured manifest is one more copy of the registry's document. As the one addition, the recorder's own file list of V must equal jsDelivr's.
  - **Not disputed** is confirmed.
  - **Disputed.** The run of identical code is followed back to O.
    - It is a record-omission candidate if O was published after the earliest-published other version a MAL- record names, or if O declares an install script its predecessor does not.
    - Otherwise it is a false-report candidate.
  - **MAL- records for the package.** OSV's query API by package name, plus the recorder's stored copies.
  - **Without network** (`run.sh` without `NETWORK=1`), this check is not run. Every MAL-named version is then `not_checked`, and counts as malicious.
- **The gate** (section 7).
  - **Misses.** Confirmed, record-omission and not-checked versions with any missed or capture-gap row.
  - **Decided.** Versions in the window whose four (b) rows, against the decided prev, are each `stop` or `ready_except_build`.
  - **States.** Each half is `not_yet` until the result is final. The miss half is `met_with_no_case` only when no MAL- record names a version in the window; with cases and no miss, it is `met`.
- **Shown, not gated** (section 8):
  - MAL- records naming a watched version, by category;
  - capture lag, as a median and at p90;
  - every capture gap and undecidable verdict;
  - per-row and per-scenario outcomes;
  - the judge's literal verdict: no fix, V direct, production, so urgency normal;
  - recorder and OSV give-ups, and dropped repeats.

## Readings taken where the decision is not literal

None of these loosens a count. Each is the reading the code takes, and is tested. Two fresh-context reviews on PR #194 found readings that did loosen it.
- **The first, at 80b26f8.** Readings 5, 6 and 8 loosened the count, and MAL- records were read as they are today.
- **The second, at 2250791.** It found:
  - a later copy of a record could drop a version from the denominator;
  - withdrawn records were left out of the record-omission rule;
  - "final" did not wait for OSV reads still being retried;
  - versions named only by a range were missed.

All of these were changed as below.

1. **"V's first capture"** is the first capture of V with every input. The recorder retries a capture whose sub-reads failed, for up to 60 attempts, then gives up, and a give-up stays a capture gap. Taking the literal first capture would make every transient failure a gap.
2. **"The end of the poll."** The facts "of V's first capture" are those stored by the end of the poll that took it: the next `poll`, `error` or `stopped` status line. A capture's records are written over several seconds, so the predecessor's record comes after V's.
3. **The registry's predecessor** is taken among the versions the recorder had captured by that moment, as listed versions. The recorder captures the predecessor with V, so a version whose `time` is stored but which was never captured was not listed: unpublished before the recorder saw the package.
4. **Repeated records** are dropped only when equal, apart from `fetched_at`, to the record just before them with the same type, name and version. The recorder's README says "by type, name, version and content". Read over the whole stream, that would drop a deprecation that changes and changes back, or a 404 `created` record after a later success. In the third run's snapshot, 133 repeats were dropped: 79 `change` records with the same diff, and 54 `retry` version records (`logs/store-counts-3.log`).
5. **A MAL-named version with no stored publish time.** Section 3 allows a publish time from the record or an archive. OSV records carry no version publish time. So with `NETWORK=1` the replay reads the registry's `time`, which keeps removed versions' times:
   - outside the window: the version is outside;
   - otherwise, or if the time cannot be read (always without network): every row is a capture gap.
6. **Withdrawn records** stay in the denominator, and a version they name counts as named in the record-omission rule. At a judgement, one withdrawn by that moment does not stop the version, as the live re-query would not. Only prev_d leaves withdrawn records out, as v5 does.
7. **The disputed check's unreadable cases** are on the stricter side:
   - a source that cannot be read leaves V confirmed (v5);
   - a predecessor that cannot be read ends the run of identical code there, so O is later;
   - it also counts as O's added install script;
   - a first version (no predecessor) counts any install script it declares.
8. **(b) with no version below V** anywhere is a capture gap in every row: section 5's missing predecessor. Such a version is never decided.
9. **A MAL- record at a judgement** is read as its latest stored copy whose `modified` is at or before that moment. A record with no such copy is not known to have named V then, so it does not stop it: the stricter side.
10. **The denominator** is built from every stored copy of every MAL- record. A version any copy named stays named, even if a later copy no longer names it. Its publish date is the earliest of the copies naming it.
11. **Ranges.** A record that names a watched package by a range is applied to every version in the store and, with `NETWORK=1`, every version in the registry's `time`. Without the network, or if the registry cannot be read, the result is not final.
12. **OSV reads still retried.** An OSV `error` status line naming an id, with no copy of that id fetched later and no give-up, keeps the result from being final.

## Not done

- **OSV records modified before the recorder started.** The recorder stores only records modified since its start, so one modified before then that names a window version is not in the store. The disputed check's per-package OSV query sees all of them, but only for versions already named by a stored record.
- **The judge's dependencies.** The semver package's version is not part of the start-commit check (judge.ts imports it).
- **No schedule.** Moving the shadow to GitHub Actions is the SA lane's. `.github/workflows/` is not changed.
- **Older records.** docs/bench/2026-10-28-shadow-design/README.md and docs/bench/2026-10-29-shadow-recorder/README.md still say the replay is not built. So does CLAUDE.md, a protected path. They are left for their owners.

## Tests

`tools/shadow/test/replay.test.ts` has 43 tests. The recorder's 35 are unchanged, 78 in all. They run in Docker with no network, using node:24-slim pinned by digest. The run is `scripts/check.sh`, and its output is `logs/check.log`, at commit bebebbe:
- typecheck exit 0;
- 78 of 78 passed;
- 25 deliberate mutations, each making tests fail:
  - the re-query cut-off off;
  - exploited's synthetic fix off;
  - no recomputation of `wait_until`;
  - missing attestations not a gap;
  - a day without a poll not a break;
  - false-report candidates counted;
  - repeats kept;
  - late records joining the denominator;
  - nothing pending;
  - no seed from a later complete capture;
  - the recorder's file list not compared;
  - each half of the record-omission rule off;
  - MAL- records read as they are today;
  - withdrawn records leaving the denominator;
  - final without an OSV read past the deadline;
  - no predecessor taken as not applicable;
  - `met_with_no_case` when every case is a false-report candidate;
  - a version with no stored publish time skipped;
  - the file list taken only from the last capture;
  - the denominator from each record's latest copy only;
  - OSV records still being retried ignored;
  - ranges enumerated over stored versions only;
  - final although a range was not enumerated;
  - withdrawn records left out of the record-omission rule.

## The preliminary runs

**The current one** is `out/replay-preliminary-3.json` (log `logs/run-preliminary-3.log`, store counts `logs/store-counts-3.log`), at 9ed5466, after both reviews' fixes:
- **The snapshot.** Taken at 2026-10-29T01:40:34Z, 50,722,648 bytes, a copy. The recorder was not stopped or touched.
- **The setup.** No network. Watched list sha256 `02d3e6de…`.
- **The judge.** HEAD carries main's #193 version of judge.ts, so this run tests that run.sh puts back the start commit's judge files. The log prints them: judge.ts 5a598fd, npm-facts.ts 8289c4e, time-cap.ts 4fb4608 and archives-v5.ts 835452a, each equal to 8a78b55's.
- **The window.** In progress, 2026-10-28T15:51:48.401Z to 2026-11-25T15:51:48.401Z, one run, no break.
- **The versions.** 336 in the window, all pending. The coverage ends at the last OSV read, 2026-10-29T00:00:20.329Z. The first rows (exploited and high, 12h or 24h) become judgeable after the next daily OSV read.
- **The gate.** Decided 0 of 100, `not_yet`. Misses 0, `not_yet`.
- **MAL- records.** 15 OSV records stored, all MAL-, and none names a watched package.
- **Capture lag.** Median 0.012h, p90 0.017h.
- **Gaps and repeats.** Capture gaps 0, undecidable 0, give-ups 0. 133 repeats dropped.

**The second one**, at 0752459, between the two reviews: `logs/run-preliminary-2.log` and `out/replay-preliminary-2.json` (335 versions, all pending, 0 gaps).

**The first one**, at 22ad747 and before the review, is kept as it ran: `logs/run-preliminary.log` and `out/replay-preliminary.json`.
- **The snapshot.** Taken at 2026-10-29T01:06:35Z, 47,055,265 bytes, a copy. The recorder was not stopped or touched.
- **The setup.** No network. Start commit 8a78b55, and the judge's files unchanged. Watched list sha256 `02d3e6de…`.
- **The window.** In progress, 2026-10-28T15:51:48.401Z to 2026-11-25T15:51:48.401Z, one run, no break.
- **The versions.** 321 in the window, all pending. The store's coverage ends at the last OSV read, 2026-10-29T00:00:20.329Z, and every row's `wait_until` is later. The first rows (exploited and high, 12h or 24h) become judgeable after the next daily OSV read.
- **The gate.** Decided 0 of 100, `not_yet`. Misses 0, `not_yet`.
- **Capture lag.** Median 0.012h, p90 0.017h, over 321 versions.
- **Gaps and give-ups.** Capture gaps 0. Recorder give-ups 0, OSV give-ups 0.

## How to run it later

```text
bash docs/bench/2026-10-29-shadow-replay/scripts/run.sh <node_modules volume> C:/dev/ludion-shadow-data/data <new snapshot dir> <new out.json>
```

Add `NETWORK=1` when the report lists MAL- cases, so that the disputed check runs. Its cache is kept beside the output. The replay never overwrites an earlier output.
