# 2026-10-29 — How the shadow's condition (b) is counted

Dated for the night-v2 work of 2026-10-29 (first committed 2026-10-28 23:47 JST). Fixed before the shadow records anything. It is not changed after its results are seen, and nothing here changes the wait table or a gate's numbers.

Condition (b) is in docs/decisions/2026-10-28-release-gates-by-stage.md: four consecutive weeks of shadow operation, zero misses on versions that received a MAL- record, and at least 100 decided judgements. This file fixes how that is counted. The design is docs/bench/2026-10-28-shadow-design/README.md.

**1. What is watched.**
- **The names.** Every package name in these lockfiles, as one frozen list:
  - this repository's root package-lock.json at the recorder PR's base;
  - Ludion-ai/ludion-sandbox's lockfiles, if it has any when the list is made (on 2026-10-28 it was empty);
  - the 100 root package-lock.json files of the noise measurement, at their recorded SHAs.
- **The list.** It is committed with the recorder, and its sha256 is written into the recorder's first status record. A different list is a different shadow.

**2. The four weeks.**
- **Start.** The four weeks start at the recorder's first successful poll after this file and the recorder are merged.
- **Breaks.** A UTC calendar day with no successful poll ends the run of consecutive weeks. The break is reported, and the four weeks start again at the next successful poll. So does a stop at the storage limit that lasts a calendar day.
- **Moving the recorder.** Moving to the production place the owner chooses does not end the run if no calendar day is lost.

**3. Which versions count.**
- **The window.** Versions of a watched package published within the four weeks, by publish time. The publish time comes from the registry's `time` as captured, else from the MAL- record or an archive. A version the feed never showed, because it was removed before a poll or lost in a gap, is still in the window. If it cannot be replayed, it is a capture gap.
- **MAL- records in the denominator.** A version is in the denominator if a MAL- record naming it is published by the end of the four weeks plus 336h, the longest wait in the table (low, 168h, extended to max(2 × 168h, 72h)). The result is reported only after that time.

**4. One judgement: how the judge is called.**
- **The judge.** The judge's own `judge()` (packages/cli/src/security/judge.ts), at the commit recorded at the start. A later change to the judge does not change this count. If the replay must be rerun, it runs at that commit.
- **The rows.** The judgement is made once per urgency row u (exploited, high, normal, low). `judge()` takes urgency from its fixes, so the replay gives it a **synthetic fix**: a `FixedAdvisory` for P from prev to V. This is a harness input, not an advisory. It makes `urgencyOf` return u, and it makes V the time cap's target, so T is V's publish time. Per row:
  - **exploited:** `kev: true`;
  - **high:** `severity: "CRITICAL"`, `kev: false`;
  - **normal:** `kev: false`, `severity: null`, `epss: null`;
  - **low:** as normal, with the change marked dev.
- **The other inputs.**
  - `files`: `["package.json", "package-lock.json"]`;
  - the change: `resolved` is `registryTarball(P, V)`, and `integrity` is V's captured `dist.integrity`, so gate 4 compares like with like;
  - `facts` and `created`: from the recorder's captures only;
  - `advisories`: empty. Non-MAL OSV ids are not captured, and leaving them out only removes stops;
  - `locked`: a scenario input, not a capture. In (b) it is {P@prev}; in (a) it is empty, so rule 2 checks P itself;
  - `projectWait`: none.
- **When.** The judgement is made at the judge's own `wait_until`, the newest publish in the change plus the row's wait. That wait is the judge's own `wait_hours`: WAIT_HOURS[u], or 24h for exploited when the versions cannot be compared, or max(2 × that wait, 72h) when an extend finding applies. `now` is one millisecond after `wait_until`. The replay's facts are those of the last capture before that moment, and include a MAL- record only if it was published by then.
  - Facts taken later can extend the wait: a predecessor that stops being listed, say.
  - So `wait_until` is first computed from V's first capture. It is then recomputed with the facts as of that moment until it no longer moves. Extensions only lengthen the wait, so this ends.
- **The scenarios.**
  - **(b), an update:** P is locked at prev and updated to V. prev is each distinct version of P in the watched lockfiles that is lower than V. If there is none, prev is the latest-published version of P lower than V by semver: the registry's predecessor. A later-published backport is never used, because it would make the judge stop on a downgrade.
  - **(a), a new package:** V is added as a new direct dependency, with `direct: [P]` so that T is V's publish time.
    - A fix needs a `from`, and a new package has none, so the synthetic fix cannot set urgency here.
    - (a) is therefore judged only in the rows the judge itself gives a new package: normal (production) and low (dev).
    - The exploited and high rows of (a) are reported as not applicable, not as stopped.
    - This makes the shadow **laxer than the backtests in one place**. The backtests judge (a) in all four rows, at 72h for exploited and high. A V that only (a) would miss there counts here as stopped, if (b) stops it.

**5. The outcome of one row.**
- **Stopped:** the verdict is `stop`, or `undecidable` with every input taken from captures.
- **Missed:** the verdict is `ready_except_build`.
- **Capture gap:** any input the replay needs is missing from the store, so the judge is not run. This covers a V removed before its first capture, a missing predecessor, a missing `created`, and missing attestations that the manifest says exist. A `wait` verdict at `wait_until`, which means the harness is wrong, is a capture gap too.
- **Combining.** A version's outcome in a row is missed if any scenario or prev misses it. Otherwise it is a capture gap if any is a capture gap. Otherwise it is stopped.

**6. Malicious versions: confirmed, and the two disputed categories.** A version named by a MAL- record is checked against v5's disputed standard (docs/bench/2026-10-28-backtest-v5/definitions.md, section 3), with one addition: where the recorder captured V's file hashes, they must agree with the archives. A version that meets the standard is disputed. Disputed versions go into one of two categories:
- **The run of identical code.** It is the versions before V back to O, the first version whose code equals V's under section 3's meaning. Each step compares a version with its predecessor. Here a predecessor is the latest-published version lower by semver, whether or not a record names it.
- **Record-omission candidate:** either
  - O was published after the earliest-published version of P that a MAL- record names, V excluded. If no other version is named, this condition is false; or
  - O declares an install script (preinstall, install or postinstall) that O's predecessor does not.

  Example: freo-design-system 1.0.4, whose identical predecessor 1.0.3 is named by no record.
- **False-report candidate:** a disputed version that is not a record-omission candidate. Example: @ensdomains/buffer 0.1.1.

How they count:
- **Confirmed** (not disputed) and **record-omission candidates** count as malicious. A miss or a capture gap on one is a miss for (b). This is the literal reading of (b), which counts every version that received a MAL- record.
- **False-report candidates** stay in the denominator, are shown apart, and are not counted as misses. (b)'s own text does not set them apart; the 2026-10-28 decision does that only for (a). The owner's addendum does it for the shadow (2026-10-28 23:11 JST: 見逃しの数え方（分母に残し別枠で示す）は F2 の決定どおり). So this count is looser than (b)'s literal text by exactly the false-report candidates. It is stricter than setting every disputed version apart. It is fixed here before any data.
- **Within the shadow.** Neither category is sent anywhere, and the shadow sends no correction request. That is the owner's.

**7. The gate.**
- **Misses:** zero, over every row and scenario, for every version counted in section 3 that is confirmed or a record-omission candidate.
- **Decided:** at least 100 versions in the window, judged in scenario (b) against one prev, with `stop` or `ready_except_build` in every one of the four rows. That prev is the highest version of P below V in the watched lockfiles, else the registry's predecessor (section 4). A row that is `undecidable` or a capture gap is not decided.
- **No cases.** If no MAL- record names a version in the window, the report says the miss half was met with no case.

**8. Shown next to the gate, not gated.**
- the number of MAL- records naming a watched version, by category;
- capture lag (`fetched_at` minus the publish time), as a median and at p90;
- every capture gap;
- every undecidable verdict;
- per-row and per-scenario outcomes;
- the judge's literal verdict, with its own urgency at its own `wait_until`. The counted outcome is a per-row counterfactual, like the backtests' (apart from (a)'s two rows, section 4), not the judge's literal verdict.

**9. What the recorder must capture for this.** Otherwise every replay would be a capture gap.
- **On the first change of a watched name:** the full `time` map, and the manifest and attestations of every version of that name the watched lockfiles hold (each possible prev). Also the version each dist-tag points to.
- **For each new version V:** its manifest, attestations and file list. Also its registry predecessor (section 4), if not yet stored.
- **For each dependency of V outside the watched set:** the package's first publish time (`created`, rule 2), unless already stored.
- **Afterwards:** later changes to `time`, `dist-tags`, removal and deprecation of every stored version.
