# 2026-10-30 (LO) — Does a published tarball equal its public source release? Definitions fixed before any comparison

**Why.** The owner wants the gates decided by evidence Ludion makes itself, not by evidence it borrows (2026-10-30, to the Claude chat: 「今は関門をアルゴリズムでやるって話だったよね。時間指定の場合、例外が発生すれば終わる」, 「使命に対しては一切妥協するな」, 「一般論を信じ切るな」).
- Borrowed evidence breaks on its exceptions:
  - a wait relies on someone else in the world finding the problem first;
  - a publisher's provenance can be issued correctly from a hijacked CI.
- One piece of evidence Ludion could make itself is where a tarball came from: does the tarball equal the public repository's source for that release?
- The hypothesis to test: the malicious versions of chalk and debug (2025) and of Shai-Hulud were only in the registry, not in the source. Part of xz's backdoor (2024) was only in the release archive, not in git.
- This lane measures that hypothesis on lane LD's data.

**This is an experiment that only reads.** It changes no product code, no gate, and not the wait table. Nothing here changes a gate's criteria or the wait table.

This entry is committed and pushed before any version's tarball, any repository's references or any source archive is fetched for this lane. Data read before it:
- the row counts, field names, `name`, `version`, `status` and `sources` of the rows of `docs/bench/2026-10-30-delta-v1/delta-v1.json` (lane LD, commit 79f8816, not merged);
- LD's README at that commit.

A later change to this entry is a new entry, with the reason. The results say which definitions they used.

## 1. The data

The rows of LD's `delta-v1.json` at 79f8816 whose `status` is not `not obtained`:
- **Genuine fixes:** 192 rows (`set` = `genuine`), 192 distinct versions of 124 packages.
- **Malicious versions:** 11 rows (`set` = `malicious`).
- **The version compared** is each row's `version`: the fixed version of a genuine row, V of a malicious row. The previous version is not compared.
- None is left out after the fact.
- Counts are per row; the genuine rows are also distinct versions.

## 2. A version's files

They come from the same source LD's row used for that side (`sources.next`):
- **`registry`:** the registry tarball (`https://registry.npmjs.org/<name>/-/<base>-<version>.tgz`). It is accepted only when its sha512 equals the `dist.integrity` of the registry's version document (`https://registry.npmjs.org/<name>/<version>`).
- **`software-heritage`:** the directory as `swhLocate` in `tools/backtest/src/archives-v5.ts` finds it. Its publish time is the registry packument's `time`, as LD used. Files are listed by `swhFiles` (SHA-256 per path, no content), and the root `package.json` is read by `swhManifest`.
- A version whose files cannot be obtained this way is **not comparable: files not obtained**, with the reason.

**Paths.**
- A tarball entry loses its first path component, as npm strips the top folder.
- `.` segments are removed, and a path with a `..` segment is kept as written.
- When two entries give the same path, the later one is used, as extraction would overwrite.
- Regular files are hashed by their bytes. A link is hashed as the text `link:<target>`, both in the version and in the source.

## 3. The source release

**The repository** is read from the version's root `package.json` `repository`: a string, or an object's `url`, plus the object's `directory`.
- **GitHub only.** These forms name `owner/repo`: `owner/repo`, `github:owner/repo`, and `github.com/owner/repo` reached through `https://`, `http://`, `git+https://`, `git://`, `git+ssh://git@`, `ssh://git@` or `git@github.com:`. A trailing `.git`, a trailing `/` and a `#fragment` are dropped.
- Anything else is **not comparable**: `no repository` (no field), `not GitHub` (another host), or `repository not understood` (a GitHub URL with more path, or unparsable).

**References.** The repository's tags are read from `https://github.com/<owner>/<repo>.git/info/refs?service=git-upload-pack`, with no credentials. An answer other than 200 is **not comparable: repository not reachable**.

**The release tag.** The first of these tag names that exists, for version X, package name N and N without its scope U (the same when N has no scope):
1. `vX`
2. `X`
3. `N@X`
4. `U@X`
5. `U-vX`
6. `U-X`
7. `U/vX`
8. `U/X`

The commit is the tag's peeled commit.

**Without a tag: the provenance commit.** Used when no tag is found, and also when the repository was not usable above.
- **When.** The version's registry document has `dist.attestations`.
- **How it is read.** The attestations are read from `https://registry.npmjs.org/-/npm/v1/attestations/<name>@<version>`, by `provenanceFrom` in `packages/cli/src/security/npm-facts.ts`. That checks the statement names the version and its integrity.
- **Repository and commit.** The repository is the provenance's (GitHub, the same forms as above), and the commit is its commit.

Neither a tag nor a provenance commit: **not comparable: no release tag and no provenance**. Its sub-reason says whether the repository was usable.

**The source archive** is `https://codeload.github.com/<owner>/<repo>/tar.gz/<commit>`. That is what `git archive` makes, so it leaves out paths marked `export-ignore` and expands `export-subst`; this is not corrected. Every file is hashed, nothing is written to a disk. More than 2 GiB unpacked, or not read within 15 minutes after 3 attempts: **not comparable: source archive not read**.

**The package directory** in the source:
1. **`repository.directory`**, when given. Leading `./` and trailing `/` are dropped. If the source has no `package.json` there, the version is **not comparable: directory not in source**.
2. **The root**, when the root `package.json` `name` is N.
3. **The one directory, not under `node_modules`,** whose `package.json` `name` is N. None or more than one: **not comparable: package directory not found**.

## 4. Comparing

**Every file except the root `package.json`** at path P is compared with the source file at `<package directory>/P`:
- **Identical:** a file there with the same SHA-256.
- **Different:** a file there with another SHA-256.
- **Absent:** no file there.
- **A root-level fallback.** Some files at the version's root are absent from a package directory that is not the repository root: names starting, case-insensitively, with `README`, `LICENSE`, `LICENCE`, `CHANGELOG`, `HISTORY`, `NOTICE` or `AUTHORS`. They are compared with the repository root's file at P instead, because monorepos copy those at publish.

**The root `package.json`** is not compared by bytes: package managers rewrite it at publish. Both are parsed, and it **differs** when either of these differs:
- the install scripts `preinstall`, `install`, `postinstall`: present in one only, or with another value;
- the set of names in `dependencies` and `optionalDependencies`. Ranges are not compared, because `workspace:` and `catalog:` ranges are rewritten.

A version's `package.json` that is not a JSON object is **not comparable: package.json unreadable**.

**The outcome** of a comparable version:
- **Match** (一致): `package.json` does not differ, and every other file is identical.
- **Differs** (食い違い): `package.json` differs, or at least one file is different.
- **Absent files only** (ソースに無いファイルだけ): nothing differs, and at least one file is absent.
- **Not match** (一致しない) = differs + absent files only.

## 5. Built before publish (ビルドしてから出す)

**Built** when the source `package.json` in the package directory has one of these in `scripts`:
- a `build`, `prepack`, `prepublishOnly` or `prepublish`;
- a `prepare` whose value does not start with `husky`.

**Not built** otherwise. It is unknown when no package directory was found. Every count is shown for built, not built and unknown separately.

## 6. What is counted

- **Genuine (192 rows):**
  - match, differs, absent files only, and not comparable, each with its share of 192;
  - the share that match among the comparable;
  - the same for built and not built;
  - not comparable by reason.
- **Malicious (11 rows):**
  - match, differs, absent files only, and not comparable, each with its share of 11;
  - **not match** with its share of 11, and the share of the comparable;
  - not comparable by reason;
  - the two disputed versions (v5) are shown apart.
- **Shown, never part of the outcome:**
  - **Line endings.** Identical after CRLF → LF in both: for files from the registry and the source only. Software Heritage gives no content, so this is not computed for its versions.
  - **Absent files** under a top-level directory that the source package directory lacks entirely (such as a build output folder), against all other absent files.
  - **The release reference kind:** which tag form, or the provenance.

## 7. Safety

- **Where it runs.** Everything runs in Docker with no credentials (no host home, `.npmrc`, gh or git authentication), a read-only root, a non-root user and no forwarded environment. The repository is mounted read-only.
- **Package files and source archives** are held in memory and hashed. Nothing is extracted to a disk, installed, required or run.
- **The cache.** Fetched answers are cached in a named Docker volume, deleted at the end: version documents, references, source listings (paths and hashes), and the `package.json` texts of the source. No malicious version's file is cached.
- **What is committed:** names, versions, repositories, commits, outcomes and counts. Paths of files are committed for genuine versions only.
