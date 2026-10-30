# 2026-10-30 (LO2, LD2) — Is a version tied to a source release, and do the source changes explain its new capabilities? Definitions fixed before counting

**Why.** Lane LO found that a byte match with the source is not a usable pass condition: only 25 of 192 genuine fixes matched (13.02%), 3 of the 120 built ones. It also found that none of the 11 obtained malicious versions could be tied to a source release, against 20 of 192 genuine fixes (10.4%). A gate shape to test from that:
- the version is tied to a release (a tag or a provenance commit);
- every new capability in the tarball diff is explained by the source diff between the two releases.

The idea is that someone who hijacks a publisher can publish to npm, but would find it harder to also place a tag and matching source changes in the repository. These two lanes measure how often genuine fixes fail each part. The 11 malicious versions LO obtained are biased (9 name no repository at all, while a hijacked popular package keeps its `repository` and changes only the files), so they do not decide a gate.

**This is an experiment that only reads.** It changes no product code, no gate and not the wait table. Nothing here changes a gate's criteria or the wait table.

This entry is committed and pushed before any tarball, reference list, tag, commit or source archive is fetched for these lanes. Data read before it:
- LO's `lo.json` (`docs/bench/2026-10-30-lo-tarball-source/`, merged in c84d73c): its summary, including the count of release kinds, and the row fields;
- LD's `delta-v1.json` (`docs/bench/2026-10-30-delta-v1/`, merged): field names, and one genuine row in full;
- both READMEs, and the two lanes' definitions.

A later change to this entry is a new entry, with the reason. The results say which definitions they used.

## 1. The data

- **Genuine fixes:** the 192 rows of LD's `delta-v1.json` with `set` = `genuine` whose `status` is not `not obtained`. The fixed version is the row's `version`, the previous one its `prev`. LO's row for the same `name` and `version` in `lo.json` gives the fixed version's release.
- **Malicious versions:** the 11 rows with `set` = `malicious` and `status` not `not obtained`. The previous version is the row's `prev`.
- None is left out after the fact. Counts are per row and always given with their denominator.

## 2. LO2 — is the fixed version tied to a release?

**Tied** (結び付く): LO found a release for it, that is, its `lo.json` row has a `release`: a tag of LO's 8 forms (LO definitions §3), or, where no tag was found, a provenance commit. This is a re-count of LO's run; the references are not fetched again for it.

**Shown, not part of "tied":** whether the registry's version document has `dist.attestations`, and, if it does, whether `provenanceFrom` (`packages/cli/src/security/npm-facts.ts`) reads a provenance with a GitHub repository and a commit from `https://registry.npmjs.org/-/npm/v1/attestations/<name>@<version>`. This is read now for all 192, so tag and provenance can be shown together: tag only, provenance only, both, neither. An error from `provenanceFrom` is recorded as "provenance unreadable" with its message.

Counted: tied, by kind (tag form or provenance), and not tied by LO's reason, each out of 192.

## 3. LO2 — when was the tagged commit made, against the publish time?

For every genuine row tied by a tag:
- **The tag is fetched** in a credential-free container: `git fetch --depth=1 --filter=tree:0 --no-tags https://github.com/<owner>/<repo>.git +refs/tags/<tag>:refs/tags/<tag>` into an empty repository on a tmpfs. No tree or file is fetched.
- **The commit** is the tag's peeled commit. When it is not the commit LO recorded (`source` in `lo.json`), the row is **not comparable: tag moved**, and has no time.
- **The commit time** is the peeled commit's committer time (`%ct`). The author time (`%at`) is shown.
- **The tagger time** is shown only, for an annotated tag (`%(taggerdate:unix)`). A lightweight tag has none.
- **The publish time** is the registry packument's `time[<version>]` (`https://registry.npmjs.org/<name>`).
- **The difference** is the commit time minus the publish time, in hours. A negative value means the commit was made before the publish.
- A fetch that fails 3 times, or a missing publish time: **not comparable**, with the reason.

Counted, out of the tag-tied rows: the median, the quartiles, the minimum and the maximum of the difference, and how many fall in each of: ≤ −168 h, (−168, −24], (−24, −1], (−1, 0], (0, 1], (1, 24], (24, 168], > 168 h. The same is shown for the tagger time where there is one. For rows tied by provenance, the provenance commit's committer time is fetched the same way by its hash and shown apart.

**What this does not measure:** when the tag was pushed. Commit and tagger times are written by whoever makes them and can be set to any value; GitHub does not give an anonymous reader the push time of a tag.

## 4. LO2 — did the malicious versions' previous versions name a repository?

For each of the 11 malicious rows, the previous version's root `package.json`:
- read from its registry tarball (`https://registry.npmjs.org/<name>/-/<base>-<prev>.tgz`), accepted only when its sha512 equals the registry version document's `dist.integrity`, held in memory, never extracted or run;
- if the tarball cannot be obtained so, the `repository` of the registry version document (the registry copies it from `package.json` at publish), recorded as such;
- else **not obtained**.

Its `repository` is read as LO §3 reads it (`repositoryOf` in LO's `scripts/lo.ts`): no repository, GitHub `owner/repo`, not GitHub, or not understood. The malicious version's own reading is LO's (`repository` and `repository_status` in `lo.json`).

Counted, out of 11: the previous version names a repository (any form); names a GitHub repository; the field is **removed** (the previous version names one and the malicious version names none); the two name the same `owner/repo`. The two disputed versions (v5) are shown apart.

## 5. LD2 — the tarball diff, files matched by content

The tarball diff is LD's v1 (`tools/backtest/src/delta.ts`, LD definitions §3–§4) on the same two registry tarballs, except for one thing: **which previous file a changed code file is compared with.**

- **Files.** Both tarballs from the registry, accepted only when their sha512 equals the version document's `dist.integrity`, held in memory. A pair that cannot be obtained so, or that v1 calls undecidable, is **not comparable** with the reason.
- **A changed code file** is v1's: a code file of the new version whose bytes equal no file of the previous version.
- **Lines of a file:** its UTF-8 text split at `\n`, each line trimmed of white space at both ends, empty lines dropped; the set of distinct lines.
- **Similarity** of a changed file F to a previous code file P: the number of F's distinct lines that are also lines of P, divided by the number of F's distinct lines (0 when F has none).
- **Its predecessor:** among the previous version's code files (v1's code-file rule, with the previous `package.json`'s `bin`), the one with the highest similarity, if that is at least **0.5**. Ties go to the file at the same path, then to the path first in code-unit order. When no file reaches 0.5, the previous file at the same path, as in v1; when there is none, no file (all counts 0).
- **New:** a capability of LD's rules 1–3 and 7 is new in F when its count in F is greater than in F's predecessor.
- **Rules 4–6** (install scripts, new dependencies, binaries) are v1's, unchanged.

The **tarball's new capabilities** are those, by name. A pair with none is **no new capability** (新しい能力なし).

**Shown:** v1's result for the same pair (it should reproduce LD's: 51 of 192 flagged; a difference is recorded, not corrected), and the pairs and capabilities that content matching removes or adds. For the malicious versions, the same reading is shown for the 8 rows whose both sides are registry tarballs (LD's sources); the 3 read from Software Heritage are not computed.

## 6. LD2 — the source diff, and what it explains

Only for genuine pairs with at least one new capability under §5.

**The two releases.** The repository is the one LO used for the fixed version (`source` in `lo.json`).
- **The fixed version's commit:** LO's (`source`).
- **The previous version's commit:** the first tag of LO's 8 forms for `prev` in that repository's references, read now from `https://github.com/<owner>/<repo>.git/info/refs?service=git-upload-pack` with no credentials; else the previous version's provenance commit, when `provenanceFrom` gives one in the same `owner/repo`.
- Either missing: **not comparable: no release for the fixed version** or **no release for the previous version**.

**The source files.** Both commits' archives from `https://codeload.github.com/<owner>/<repo>/tar.gz/<commit>`, read in memory as LO reads them (the same limits: 2 GiB unpacked, 3 attempts, 15 minutes each). Not read: **not comparable: source archive not read**.

**The package directory** at each commit, by LO §3's rules with that version's own `repository.directory` (from its tarball's `package.json`). Not found: **not comparable** with LO's reason. The source diff is the files under it, paths relative to it.

**Source capabilities:** §5's reading (v1 with content matching) of the previous commit's package directory to the fixed commit's. Code files are v1's (extensions, `.d.ts` left out, a `#!` line naming `node`, the source `package.json`'s `bin`); test files are not left out. Rules 4–6 read the source `package.json` in the package directory. The source `package.json` not being a JSON object is **not comparable: source package.json unreadable**.

**Explained** (ソースで説明できる): a tarball capability is explained when the source diff has the same capability new. For new dependencies and install scripts, every name in the tarball's `where` for it must be in the source's `where` for it; for every other capability, the name is enough.

**Unexplained capability** (説明できない能力): a new capability of the tarball diff that is not explained.

## 7. What is counted (LD2)

For the 192 genuine pairs, each exactly one of:
- **no new capability** (§5);
- **all explained**;
- **unexplained**: at least one unexplained capability;
- **not comparable**, by reason.

Counted: each out of 192; unexplained out of the comparable; per capability, the pairs where it is new and where it is unexplained. **Shown:** the pairs that would pass both prongs of the gate shape above, that is, tied (§2) and either no new capability or all explained, out of 192.

The malicious side is not measured here: the 11 obtained versions have no release (LO), and hijacked versions of the kind this gate is meant for were not obtained. Whether the gate shape is good enough is the owner's decision; this lane only measures.

## 8. Safety

- **Where it runs.** Everything runs in Docker with no credentials (no host home, `.npmrc`, gh or git authentication), a read-only root, a non-root user, a tmpfs `/tmp`, and no forwarded environment. The repository is mounted read-only, as a `git archive` of the run commit with its dependencies installed with scripts off.
- **Package files and source archives** are held in memory and read as bytes. Nothing is extracted to a disk, installed, required or run. Git fetches only commit and tag objects (`--filter=tree:0`), into a tmpfs, and runs no hook.
- **The cache.** Fetched JSON answers and reference lists are cached in a named Docker volume, deleted at the end. No package file and no source file is cached.
- **What is committed:** names, versions, repositories, commits, times, capability names, outcomes and counts. Paths are committed for genuine versions only. No file content of any version.
