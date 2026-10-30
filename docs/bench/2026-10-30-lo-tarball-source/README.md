# LO: does a published tarball equal its public source release? (2026-10-30, lane LO)

The gates should rest on evidence Ludion makes itself. One such piece of evidence is whether a version's tarball equals the public repository's source for that release. The hypothesis was that malicious versions exist only in the registry, not in the source. This lane measured that on lane LD's data: 192 genuine fixes and the 11 malicious versions LD could obtain.

**It is an experiment that only reads.** No product code, gate or wait changed.

The definitions are in `docs/decisions/2026-10-30-lo-tarball-source-definitions.md`. They were committed (07ee0dd) and pushed before any tarball, reference list or source archive was fetched for this lane, and are unchanged.

## When things were fixed, and what ran

| What | Commit | Time (UTC) |
| --- | --- | --- |
| Definitions | 07ee0dd | committed 10:48:15Z, pushed before 10:49:04Z |
| Runner, helpers, self-test | 669b949, then b426c3f | committed 10:53:21Z and 10:55:16Z |
| A smoke run of the first 3 genuine rows (output discarded, not the result) | the working tree between the two | 10:54:38Z–10:54:43Z |
| **The execution** (the result), at b426c3f | — | 10:55:30Z–11:04:28Z, exit 0 (`run.log`) |

- **The smoke run** compared react-server-dom-turbopack 19.2.2, axios 1.8.2 and @react-native-community/cli-server-api 19.1.2. Its runner differed from b426c3f only by one shown count in the summary, which b426c3f added. It changed no definition.
- **Setup.** The execution ran in Docker (node:24-slim, Node v24.22.2) as user 1000, with a read-only root, a tmpfs /tmp, no credentials and no forwarded environment.
  - The repository at b426c3f (`git archive`, dependencies installed with scripts off) and LD's `delta-v1.json` (sha256 `257f8430…61bf`, recorded in `lo.json`) were mounted read-only.
  - The self-test (`scripts/selftest.ts`) passed first.
- **Nothing reached the host.** No package file and no source file reached the host. Tarballs and source archives were hashed in memory.
- **The cache.** A named volume held the fetched answers: version documents, reference lists, Software Heritage listings, source listings (paths and hashes) and the source `package.json` texts. It was deleted at the end.
- **Blob hashes.** `lo.json` records the git blob hashes of `run-lo.ts`, `lo.ts`, `archives-v5.ts`, `npm-facts.ts` and `judge.ts`; they equal b426c3f's.

## Result

### Malicious versions (11): none could be compared

| Outcome | Count |
| --- | --- |
| Match | 0 |
| Differs | 0 |
| Absent files only | 0 |
| **Not comparable** | **11** (11 / 11) |

**Every one stopped at the first step: no release tag and no provenance.**
- **No `repository` field** in the version's `package.json`: 9.
  - @igh/server-updater-ssh 1.2.16;
  - @igh/server-updater-ssh-l1 1.2.17;
  - @asyncapi/studio 0.20.1 and 0.20.2;
  - freo-design-system 1.0.1 and 1.0.4 (1.0.4 is disputed, v5);
  - @dm3-org/dm3-lib-shared 1.7.2;
  - @ensdomains/buffer 0.1.1 (disputed, v5);
  - eslint-config-kinvey-flex-service 0.1.1.
- **The named repository did not answer** (HTTP 401, the answer GitHub gives for a repository that does not exist or is private): @react-native-aria/switch 0.2.5.
- **No tag of the 8 forms** in the named repository: @voiceflow/natural-language-commander 0.5.3.
- **No provenance:** none of the 11 has attestations.

**So the hypothesis was not tested.** Whether a malicious version's files differ from its release's source could not be measured on any of the 11. What was measured is that none of them had a source release that the definitions could find.

**Not measured:** whether these versions' previous versions name a repository. If they did, the field was removed in the malicious version. That would be a new definitions entry and a new run.

### Genuine fixes (192): 25 match

| Outcome | Count | Share of 192 |
| --- | --- | --- |
| **Match** | **25** | 13.02% |
| Differs | 44 | 22.92% |
| Absent files only | 99 | 51.56% |
| Not comparable | 24 | 12.50% |

- **Among the 168 comparable:** 25 match (14.88%), and 143 do not match (85.12%).
- **The 192 rows are 192 distinct versions** of 124 packages.

**Built before publish** (definitions §5: the source package's own `scripts`):

| | Rows | Match | Differs | Absent files only | Match / rows |
| --- | --- | --- | --- | --- | --- |
| Built | 120 | 3 | 28 | 89 | 3 / 120 (2.50%) |
| Not built | 48 | 22 | 16 | 10 | 22 / 48 (45.83%) |
| Unknown (not comparable) | 24 | — | — | — | — |

**The 3 built versions that match**: axios 1.8.2, jspdf 3.0.1 and zx 8.8.5. Every published file of theirs is in the repository at the tag, built files included.

**Not comparable (24):**

| Reason | Count |
| --- | --- |
| No release tag and no provenance: no `repository` field | 9 |
| No release tag and no provenance: no tag of the 8 forms | 7 |
| No release tag and no provenance: not GitHub | 2 |
| No release tag and no provenance: repository not understood | 2 |
| Package directory not found | 2 |
| Directory not in source | 1 |
| Source archive not read (HTTP 404) | 1 |

All 20 rows without a release tag have no attestations, so none of them had a provenance commit to fall back on.

**The release reference** of the 168 comparable:
- tag `vX`: 118;
- tag `X`: 31;
- tag `N@X`: 14;
- tag `U@X`: 1;
- the provenance commit: 4 (@directus/api 24.0.1 and 28.0.2, x402 0.5.2, @openai/codex 0.39.0).

**Why the 44 genuine versions that differ, differ** (counts from `lo.json`):

| What differs | Built | Not built |
| --- | --- | --- |
| Dependency names only (`package.json`) | 19 | 0 |
| Files only | 8 | 15 |
| Files, install scripts and dependency names | 1 (snyk 1.1297.3) | 1 (mongosh 2.3.9) |

- **Not built by the definition, but built from the repository root.** 8 of the 15 "not built, files only" rows are react-server-dom-turbopack (5), -webpack (2) and -parcel (1). Each differs in 13 or 19 files, entry files such as `client.js` among them, and has 12 or 18 absent files under folders the source package lacks. Their package has no build script of its own; react's build runs from the repository root. §5 reads only the package's own `scripts`, so it counts these as not built.
- **A file at the same path, rewritten at publish.** Others differ in one file at the same path, such as the `README.md` that @angular/compiler, @angular/platform-server, typeorm, @openai/codex and mongosh replace at publish.
- **Line endings.** 3 of the 44 differ only by line endings: every different file is identical after CRLF → LF, and `package.json` does not differ. Over all comparable genuine rows, 15 of the 177 different files are identical after CRLF → LF.

**Absent files** (shown, not part of the outcome):
- the comparable genuine rows have 168,105 absent files;
- 162,469 of them lie under a top-level directory that the source package directory lacks entirely, such as a build output folder;
- that is so in 37 of the 44 rows that differ and 94 of the 99 with absent files only;
- all 15 vite fixes are "absent files only".

## What this shows, and what it does not

- **On these 11 malicious versions, the comparison could not be made at all.**
  - 9 name no repository, 1 names one that does not answer, 1 names one with no matching tag.
  - So the hypothesis that a malicious version's files are not in its source was not tested. Testing it needs malicious versions that name a repository with a release, and these 11 do not.
- **"The tarball equals the source" is rare for genuine fixes.** Under the definitions, 25 of 192 (13.02%) match.
  - **Built packages:** 3 of 120. Their published files are made by a build and are not in git, so a byte comparison cannot show where they came from. Showing that would need the build to be reproduced: an idea for a later entry, not measured.
  - **Not built:** 22 of 48.
- **If Ludion let a version pass only when it matches,** 167 of these 192 genuine fixes (86.98%) would not pass on this evidence alone. That is the share the owner's new measure (fixes handed to a person) would count, for this one piece of evidence.
- **The genuine sample** is v4's 2025 GHSA fix events (LD), not all npm packages. It holds many monorepo and bundled packages.

## What the runner and the definitions leave open (recorded, not changed)

- **The order of path normalisation.** §2 says a tarball entry loses its first component and `.` segments are removed. The runner removes `.` and empty segments first, then drops the first component. No npm tarball or GitHub archive in this run is known to have a leading `./`; this was not checked.
- **The main reason of a not-comparable row.** §3 names `no repository`, `not GitHub`, `repository not understood` and `repository not reachable` as reasons, and also says that without a tag the provenance is tried, and that "no release tag and no provenance" carries a sub-reason saying whether the repository was usable. The runner records "no release tag and no provenance" as the reason, with the repository's state and the provenance's state as the sub-reason. The tables above give both.
- **A source `package.json` that is not a JSON object** is recorded as "source package.json unreadable", which the definitions do not name. No row has it.
- **Built, by the package's own scripts only** (§5). As shown above, packages built from the repository root count as not built.

## Files

- `lo.json`: the summary, and one row per version with:
  - its repository, release reference, commit, package directory and outcome;
  - file counts and which `package.json` checks differ;
  - for genuine versions only, up to 20 paths that differ and 20 that are absent.
- `lo.log`, `run.log`: the execution's log and times.
- `scripts/lo.ts`: the helpers.
- `scripts/run-lo.ts`: the runner.
- `scripts/selftest.ts`: the helpers' checks on made-up inputs.
- `scripts/run.sh`: what ran in the container.
