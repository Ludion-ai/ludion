# 2026-11-03 — The oldest version in range, and the asserts on it, in the product (LOLD2)

Committed before any of it was implemented or measured. After the first result, only these changed: section 5, the last sentence of section 3, the second line of section 4, and the sections added at the end, which say what. It writes down, for npm's `ludion patch`, the section 「待ちの規則（1 本）」 of docs/decisions/2026-11-02-definition-of-complete-final.md (lines 70 to 88 of that file), which is the first item of C12. LOLD (docs/bench/lold/, docs/progress/2026-11-02-lold-oldest-resolution.md) showed it can be done with npm 12.2.1's own resolver and writer, as a prototype.

The wait table and every gate's numeric criteria are not changed. Composer, Maven and the official images are not touched.

The sentence this writes down:

> Ludion が出す diff に入る全部の版は、T（勧告を最初に見た時刻）で解決され、push の時点で待ち以上の年齢を持ち、待ちの終わりの再照会で MAL-・廃止・取り下げが無い。V は最小の修正版。V 以外で動かざるをえない版は、範囲を満たす最古で、勧告・廃止・取り下げの無いもの。既存の lockfile の版は、範囲を満たす限り動かさない。

## 1. Terms

- **V.** A fix's planned version: `fixes[].changes[].to`, after main's next-fix rule (next-fix.ts) has run. A fix with two changes has two.
- **T.** The time the advisory was first seen. The product records no such time: `found_at` is this run's lookup, and a `found_at` from the first run that saw the fix is a separate item of C12. Until that item lands, T is the earliest time at which it can have been seen, read from public facts, the same on every run: the later of V's registry publish time (with two Vs, the latest) and the earliest OSV `published` among the advisories the fix closes (V's publish time alone when OSV gives none). It is a lower bound on the time of first sight, so it excludes more versions than the true time would, never fewer. When the first run's time is recorded, T becomes that.
- **Requirement.** A package name and the range some package asks for it. An `npm:` alias is its target's name and range.
- **Wait.** The judge's `wait_hours` for the fix's diff, as it is today: the wait table, with its extension and its exploited row.
- **Push.** Where the commit leaves for the project's repository. `ludion deliver open` runs the judge again at that moment, and the judge's wait counts from the newest publish in the diff. `ludion patch` runs the asserts below at its own judgement, which comes earlier.

## 2. Which version a requirement gets

The first of these that gives a version:

1. **V.** The fix's own package, at a requirement whose range includes V.
2. **A version already locked.** Among the versions the project's package-lock.json holds for the name, at any path: those in range, listed by the registry, not deprecated, and named by no OSV record (a record OSV marks withdrawn does not count). The earliest published. T does not apply, since a locked version brings in no new code.
3. **The oldest.** Among the versions published at or before T: those in range, listed, not deprecated, and named by no OSV record. The earliest published; on a tie, the lowest by semver. Publish time, not version number (CLAUDE.md, Product).
4. **The same release as V.** Only when 3 gives nothing: among versions published after T that are otherwise allowed, the earliest that time-cap.ts's `sameRelease` says is the same release as V. Rule 1 of the time cap already allows exactly these. This is the plan's case of V's own range forcing a version that has just been published: its age decides the wait (section 3).
5. **Nothing left.** The requirement has no answer. npm is told so, and if that makes npm's run fail, the fix stops with the requirement and the count of versions excluded for each reason. It is never answered with an excluded version or with a newer one. A requirement that is a tag (`latest`) has no answer, since a tag cannot be resolved at T.

A requirement npm asks about that the table does not hold has no answer either, with a reason of its own, and is counted apart from section 5's stops.

**A version already in the lockfile does not move while it satisfies the range.** npm does not ask about an edge a locked version satisfies, and a check after npm's run holds that (section 3, c).

**Why a fix may now move another version at all.** Today's `unplannedRemovals` stops an npm fix when any other installed version disappears, and the PR job refuses any other entry that moves. Together they stop every fix whose V needs a sibling at a higher version: the transitive fix in LOLD (braces 3.0.3 needs fill-range `^7.1.1`, and 7.0.1 is locked) is one. The sentence above says such a version moves. So, for npm only, the two checks become this: a path other than V's may change version only when its old version fails a requirement of a package that loads it in the result, and may be removed only when nothing in the result loads it. Everything else they refuse stays refused, and the entries that move go through what added entries go through today (the judge, the registry's comparison in the PR job, the walk from the planned paths). Composer keeps `unplannedRemovals`.

**How npm is made to take the answer.** LOLD's finding stands: npm has no way to choose the oldest. The host decides, reading package metadata only, and writes a table of requirement to version. In the resolver's Docker build, npm's own `install --package-lock-only` runs with one function replaced by a preloaded file that answers from that table (`pacote.manifest`). Placement, peer sets, flags, the writer, and the acquisition flags stay as they are. An update of the pinned npm needs this checked again. The tarball code of a candidate is not run by this step, as before.

## 3. The asserts

They run in the product, on the diff as npm wrote it, not on the table, and their result goes in the receipt (`fixes[].resolution`). Any failure stops that fix.

- **a. Age, per version.** For every version in the diff, V included: publish time + wait ≤ push. The youngest version sets the line (`wait_until`). A version that fails makes the fix wait until then; this covers the version landed on after deprecated or vulnerable ones were passed over, and a version V's own range forces.
- **b. Resolution time.** The resolution time is the earlier of T and push − wait, so it is at most push − wait. Every version in the diff other than V, a locked version, or the same release as V (section 2, step 4), must have been published at or before it. Published between push − wait and T: the fix waits (a). Published after T: the fix stops.
- **c. Landing.** Every version in the diff other than V must be the answer the table gave for that package. A version the table did not give stops the fix, whatever its age. A path that moved or went away without the need of section 2 stops the fix.

**What the literal sentence "T ≤ push − wait" would do, and what this does instead.** Read with T as first sight, it would make every fix wait a whole wait after its advisory appears, and the plan's own count says otherwise: in 73 of 200 fixes the wait is already over when the advisory appears (the same file, line 83), and the wait is measured per version from its publish time (line 80). So a fix stops or waits on b and a, as written above, and the literal comparison of T with push − wait is written in the receipt (`t_before_push_less_wait`) and stops nothing. This reading was decided on 2026-11-03 11:51 JST: the wait counts per version from its publish time, the youngest version in the diff sets the line (the same file, line 80), and the literal "T ≤ push − wait" is written in the receipt and stops nothing.

## 4. The two lines

- **The stop rate.** Of the fixes the resolver ran on (`built`, `stopped_no_allowed` and `failed` in LOLD's words, definitions section 8), the share that stop because nothing is left in range (section 2, step 5) in a way that makes npm's run fail. A fix stopped earlier (a MAL- record, the next-fix rule, a failed read) is not counted, and neither is a project with no base. A receipt says it in `fixes[].resolution.stopped_no_allowed`. **In LOLD: 10 of 23**, on examples chosen for having a new or changed range, with today's advisories and deprecations rather than T's, so it is not a population rate.
- **The line for moving to the other way. Withdrawn on 2026-11-03; the last section of this record replaces it.** The other way is the plan's: 「T の時点で解決し、V 以外に年齢 72h の下限」 (the same file, line 82). **If LSAMPLE's stop rate has a 95% lower bound above 20%, and only then, Ludion moves to it.** The bound is the one-sided exact one, the form of CLAUDE.md's "0/2: 77.6%". LSAMPLE does not exist yet: this is measured when it does, and no number is filled in here.
- **For reference, given with this lane's brief and not measured here.** Of 46 versions of the watched names in 2025, none took more than 72 hours from publication to a MAL- record (95% upper bound 6.3%).

## 5. What this does not do

- The oldest version is not shown to work. Gate 3 stays as it is, and this record adds no check to it.
- Beyond stopping, a range with nothing left follows the line in the last section of this record.
- The PR job works the table out again itself, and refuses a fix when a version it brings in, other than V or a version the base locks, is not the answer for what loads it (added below). It starts from the V the artifact names. It does not hold that V is the smallest fixed version, or that the package named as the fix has an advisory; that is as it was on main, and is a separate piece of work (LVCHECK).
- `ludion judge`, on an existing update such as a Dependabot PR, is unchanged: it does not say whether a version is the oldest.
- pnpm, yarn and bun locks.

## Added on 2026-11-03, after the first result

This section was added after the product's first result was seen. It changes no number and no line in section 4.

**What changed.** Section 5 said: "The PR job does not work the table out again. It holds what section 2 says about a moved path and, through the judge, the age of every version at push; that a moved version is the oldest is checked by `ludion patch` only, in the validation job." It now says what the PR job does.

**Why.** An audit of the first head found that section 2 loosens a check in the job Ludion trusts, while the check that makes up for it ran only in the job Ludion does not. The PR job reads the artifact as untrusted data, and `fixes[].resolution` is in the artifact. Before this, a forged artifact could put any version in range at a path V's requirement moves, including a malicious one that lies dormant past the wait and passes the judge.

**What the PR job does now.** For a fix that brings in a version other than V or one the base locks, moved or added, it calls the same `resolveOldest` as section 2, reading only the registry's metadata and OSV over the network. It takes the fix's advisories from OSV (those on the version moved from that do not name the version moved to), not from the receipt, and does not read `fixes[].resolution`. V comes from the artifact, and it starts the walk of requirements and can move T: a later V can move T past a version, and a receipt that names a sibling as the fix leaves nothing for this check to read (section 5). The lockfile and manifest it compares are the fix's commit's, after the PR job's other checks on them. It refuses the fix unless each such version is the table's answer for a requirement of a package that loads it, by Node's lookup, or for one of the project's `overrides`. A read that fails refuses the fix. No package's code runs, and only names and versions, and back to OSV the IDs it returned, are sent.

**One thing stricter than section 3, c.** That says the version must be an answer the table gave "for that package". The check above is per requirement, and `ludion patch` now holds it too: a version the table gives for another range of the name is not an answer for this one.

## Added on 2026-11-03: what was decided at 11:51 JST

Added after the first result, and before LSAMPLE has any result. It changes no code path: a fix still stops as section 2 says.

**The reading of T and the wait.** As section 3 now says.

**The npm change to `unplannedRemovals` is taken.** It implements CLAUDE.md's sentence that, besides the fix, a moved version is the oldest in range, and does not loosen beyond the plan. What holds in its place: a path moves only when a requirement is not met, goes away only when nothing loads it, and a moved entry goes through the judge, the comparison with the registry and the PR job's own working out of the oldest.

**The line for the other way, replacing section 4's 20%.** The other way (the plan's, the same file, line 82) is used only on a fix the rule stopped because nothing is left in range, never on a fix the rule can build. LSAMPLE applies the other way to those stopped fixes. A success is a fix where it can be built, the judge does not stop it, and OSV names none of the versions it chose. **With 5 or more successes, it goes in, and n and the count are written.** Until then a fix stops as it does today. The same measurement looks at whether the other way needs the same-release exception (the 6 failures of LOLD's alternative, all `ETARGET` at T). Item: `alternative-arm-compared-on-same-fixes`.

**V in the PR job.** That the PR job does not hold V as the smallest fixed version is left to a separate piece of work (LVCHECK), as section 5 says.
