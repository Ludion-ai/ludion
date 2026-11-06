# 2026-10-31 (LT) — Hijacked versions and condition 1: did the repository have a tag for the malicious version? Definitions fixed before counting

**Why.** LO2 measured condition 1 of a gate shape on the genuine side: a fixed version is **tied** to a release when its repository has a tag of LO's 8 forms for it, or a provenance commit (172 of 192 genuine fixes). Condition 2 (LD2) asks that every new capability in the tarball diff be explained by the source diff between the two releases. The idea is that someone who hijacks a publisher can publish to npm, but would find it harder to also place a tag and matching source changes in the repository. LO2 could not test that on the malicious side: the 11 malicious versions it obtained name no repository or have no release.

Condition 1 does not need the malicious tarball. It needs two things:
- the `repository` of the version before the malicious one, which the registry often still lists;
- whether that repository has, or had, a tag for the malicious version's number.

So it can be measured on all 1,148 malicious versions of v5. This lane does that, and measures, on both sides, a stronger condition 1: the tag's commit can be reached from the repository's default branch.

**This is an experiment that only reads.** It changes no product code, no gate and not the wait table. Nothing here changes a gate's criteria or the wait table.

This entry is committed and pushed before any registry document, reference list, GitHub API answer, GH Archive file or source archive is fetched for this lane. Data read before it:
- `docs/bench/2026-10-28-backtest-v5/malicious-v5.json`: the row count, the field names, and the counts of `present` (1,140 false, 8 true), `previous_present` (1,024 true, 124 false) and the year of `published` (2017: 1, 2023: 14, 2024: 18, 2025: 1,111, 2026: 4);
- `docs/bench/2026-10-30-lold2/lold2.json`: the field names of its genuine rows, the count of `lo_release.kind` (tag 168, provenance 4, none 20) and one tag row's `release_time`;
- the definitions, READMEs and scripts of LO, LO2/LD2 and LD.

A later change to this entry is a new entry, with the reason. The results say which definitions they used.

## 1. The data

- **Malicious versions:** the 1,148 `rows` of `malicious-v5.json`. V is the row's `version`, its previous version P the row's `previous`, its publish time the row's `published`. The two disputed versions (v5) are shown apart.
- **Genuine fixes:** the 192 genuine rows of `lold2.json`. Their tie (tag form, or provenance), the repository and the tag's commit are LO2's (`lo_release`, `lo_source`); they are not fetched again.
- None is left out after the fact. Every count is given with its denominator.

## 2. The previous version's repository

- **From the registry:** P's version document, `https://registry.npmjs.org/<name>/<P>` (the registry copies `repository` from `package.json` at publish).
- **Else from ecosyste.ms:** when the registry does not answer 200, the `metadata` of ecosyste.ms's copy of P's version document (as v5 read it). Counted apart as "from ecosyste.ms".
- **Else not obtained**, with the registry's answer.

`repository` is read by LO's `repositoryOf` (LO definitions §3): **GitHub `owner/repo`**, or **no repository**, **not GitHub**, **repository not understood**. Counted, out of 1,148: each of these, and not obtained.

**Shown only:** V's own `repository`, read the same way (registry, else ecosyste.ms), and whether it names another `owner/repo` than P's. A gate that reads the repository from V itself could be pointed by an attacker at a repository the attacker controls.

## 3. The tag now (今のタグ)

For every row whose P names a GitHub repository:
- **References:** `https://github.com/<owner>/<repo>.git/info/refs?service=git-upload-pack`, with no credentials (LO §3). An answer other than 200 is **repository not reachable now**, with the status.
- **V's tag:** the first of LO's 8 forms for V that exists (`releaseTag` in LO's `lo.ts`), and its peeled commit. None: **no tag now**.
- **P's tag:** the same for P (used in §6).
- **The repository's metadata,** read with the GitHub REST API on the host (`gh api repos/<owner>/<repo>`, read only): its numeric id, its current `full_name` (a renamed repository redirects) and its `default_branch`. A 404 is recorded as **repository not found by the API**.

**Shown only, for a tag found:** its commit's committer time minus V's publish time, in hours, in LO2's buckets (≤ −168 h, (−168, −24], (−24, −1], (−1, 0], (0, 1], (1, 24], (24, 168], > 168 h). Forms 1 and 2 (`vX`, `X`) do not name the package: a repository named by many packages, or by a package that copied another's `package.json`, can have such a tag for an unrelated release. The commit time shows tags made long before V.

## 4. The tag at the time (当時のタグ), from GH Archive

The tags read in §3 are today's. A tag deleted after the incident is not in them. GH Archive (`https://data.gharchive.org/<YYYY-MM-DD-H>.json.gz`) holds GitHub's public events by hour.

**Which rows.** Every row whose P names a GitHub repository and that has **no tag now** (including repository not reachable now). Rows with a tag now are not looked up for themselves; any event of theirs in the hours read anyway is shown.

**The window.** From V's publish time minus 24 hours to plus 24 hours. The files read are every hour from the hour holding the window's start to the hour holding its end (49 files). An event counts when its `created_at` is inside the window.

**Reading.** Each file is streamed and gunzipped in memory; only the matching events are kept. No file is written to a disk. Each hour is read once, for all the rows whose window holds it. A file that answers 404, or cannot be read after 3 attempts, is a **missing hour**.

**A matching event.** Its `repo.id` equals the repository's id from §3, or, when the API gave no id, its `repo.name` equals P's `owner/repo` without regard to case. The current `full_name` from §3 also matches by name.

**What is recorded** for a row:
- **Tag created at the time:** a `CreateEvent` with `payload.ref_type` = `tag` and `payload.ref` one of the 8 forms for V.
- **Shown only:** a `DeleteEvent` of such a tag; the number of other tags created (`CreateEvent`, `ref_type` `tag`, another name); the number of `PushEvent`s. All in the window, in that repository.

**The outcome at the time:**
- **tag created at the time**;
- **no tag event**, when every hour of the window was read;
- **not fully checked**, when an hour is missing and no tag event was found.

**What GH Archive does not show.** GitHub creates no `CreateEvent` for tags when more than three tags are pushed at once, and events of a private repository are not public. So "no tag event" is evidence, not proof, that no tag was pushed in the window.

## 5. Is the tag's commit reachable from the default branch?

For every tag found now (§3), and for the genuine rows' tag and provenance commits (LO2's `lo_source`): `gh api repos/<owner>/<repo>/compare/<default_branch>...<commit>` on the host, read only.
- **Reachable:** `status` is `identical` or `behind` (the commit is an ancestor of the default branch, or is its head).
- **Not reachable:** `ahead` or `diverged`.
- **Unknown:** any other answer, with the status. The default branch is the one read in §3 for the malicious rows, and read the same way for the genuine rows' repositories.

This is today's default branch. A commit reachable now may not have been reachable when the version was published.

## 6. The source diff of a tagged malicious version

For every malicious row with a tag now for V:
- **P's release:** P's tag now (§3), else P's provenance commit when P's version document has `dist.attestations` and `provenanceFrom` (`packages/cli/src/security/npm-facts.ts`) gives a commit in the same `owner/repo` (LD2 §6). Neither: **not comparable: no release for the previous version**.
- **The two archives:** `https://codeload.github.com/<owner>/<repo>/tar.gz/<commit>`, held in memory. LD2's reading (`readSourceTar`, `packageDir`), with one change for the memory limit of this lane: more than **1 GiB** unpacked is **not comparable: source archive over the limit**. Both sides use the package directory found with P's `repository.directory`.
- **Source capabilities:** LD2 §5's reading (`contentDelta` in LO2's `lold2.ts`) of P's package directory to V's. **New capability in the source** or **none**.
- **Shown, when V is still in the registry** and both tarballs pass their `dist.integrity` (sha512): the tarball diff by the same reading, and LD2 §6's explanation of its new capabilities by the source diff (all explained, or the unexplained ones).

A tag found only at the time (§4) has no commit in its event: **not comparable: tag no longer exists**.

## 7. V's provenance

Condition 1 also ties a version by a provenance commit (LO §3). For every malicious row: V's registry version document; when it has `dist.attestations`, `provenanceFrom` reads the GitHub repository and commit, as LO2 §2. Recorded as **provenance read** (with whether its repository is P's), **no attestations**, **V not listed** (no version document), or **provenance unreadable** with the message.

## 8. What is counted

**Malicious (1,148).** Each row is exactly one of:
- **tied: tag now** (§3);
- **tied: tag at the time only** (no tag now, a tag `CreateEvent` in the window, §4);
- **tied: provenance only** (no tag now or at the time, provenance read, §7);
- **not tied** (stopped by condition 1), by reason:
  - P not obtained; P names no repository; P's repository not GitHub; P's repository not understood;
  - no tag now and no tag event at the time (split by whether the repository is reachable now);
- **unknown:** no tag now, no tag event found, and the window not fully checked; and no provenance.

Shown with them: the counts with and without the two disputed versions; per tied row, the tag form, the commit time against the publish time (§3), whether the commit is reachable from the default branch (§5), and its source diff (§6).

**Condition 1 strengthened** (既定のブランチのタグ): tied by a tag now whose commit is reachable from the default branch, or by a provenance commit reachable from it. A tag only at the time cannot be checked and is counted apart.

**Genuine (192).** Out of 192 and of the 172 tied:
- tag commit reachable, not reachable, unknown; provenance commit the same;
- **condition 1 strengthened** passes;
- **both prongs** with the strengthened condition 1: strengthened condition 1, and LD2's outcome (`ld2.outcome` in `lold2.json`) is no new capability or all explained. LO2's figure with the plain condition 1 was 163 of 192.

There is no pass mark. Whether the gate shape stops hijacked versions well enough, and whether it lets enough genuine fixes through, is the owner's decision; this lane measures, and lists every kind of malicious version the shape does not stop.

## 9. Safety

- **Where it runs.** Every fetch of the registry, ecosyste.ms, reference lists, GH Archive and codeload, and all counting, runs in Docker with no credentials (no host home, `.npmrc`, gh or git authentication), a read-only root, a non-root user, a tmpfs `/tmp`, no forwarded environment, and `--memory 3g`. The repository is mounted read-only, as a `git archive` of the run commit with its dependencies installed with scripts off.
- **The GitHub API** is read on the host with `gh api` (GET only): repository metadata and compare. Its answers are reduced to the fields named above.
- **Nothing is cloned.** No file of a malicious version is fetched except the tarballs of §6's shown part, held in memory and read as bytes. Source archives are held in memory, never extracted to a disk. GH Archive files are streamed, not saved.
- **The cache.** Fetched JSON answers and reference lists are cached in a named Docker volume, deleted at the end. No package file, source file or GH Archive file is cached.
- **What is committed:** names, versions, repositories, tag names of the 8 forms, commits, times, event counts, capability names, outcomes and counts. No file content, and no other text from repositories or events.
