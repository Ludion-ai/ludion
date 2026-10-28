# Backtest v5: definitions, fixed before running it (2026-10-28, cycle 3)

Committed and pushed before any v5 script reads the backtest's data. A change after that is a new entry with a new run. The gates and the wait table (docs/design.md, "待機時間") are not changed. docs/decisions.md, "Backtest v5", points here.

## When it was decided, and what had been seen

- The task (the coordinator's, cycle 3) gives two definitions: use ecosyste.ms and Software Heritage as sources for signals (install scripts and file contents), and a "disputed" category.
- **The disputed category was decided after seeing v4's results.** v4 (docs/bench/2026-10-28-backtest-v4) missed one version, @ensdomains/buffer 0.1.1. The cycle-2 investigation (docs/bench/2026-10-28-cycle2-investigation) then showed that its code files equal 0.1.0's in two archives. This category exists because of that case. The meaning of "code" in section 3 was written by this session after reading that investigation's 0.1.0 → 0.1.1 file diff: every `.js` and `.sol` file unchanged; `package-lock.json` added; two `build/contracts/*.json` removed; `cache/solidity-files-cache.json` and `package.json` changed (version; one runtime dependency moved to devDependencies).
- Also seen before this entry: v4's per-version results, and the investigation's estimates:
  - ecosyste.ms holds metadata for 122 of v4's 157 unknown versions at 24h, and shows an install script the previous version did not declare for 44 / 8 / 2 of the unknowns at 24h / 72h / 168h;
  - ecosyste.ms holds metadata for 32 of a fixed sample of 50 removed malicious versions;
  - Software Heritage holds none of the 7 removed versions behind the most unknowns.
- Before this entry, this session read the API answers for @ensdomains/buffer only (jsDelivr's flat file list of 0.1.1 and 0.1.2, Software Heritage's directory of 0.1.1, ecosyste.ms's 0.1.2 record), to fix the field names below. Nothing else of the data was read.

## 1. What is unchanged from v4

Backtest v4's definitions (docs/decisions.md, "Backtest v3" and "Rule 1's same-release exception, and backtest v4's definitions") apply unchanged, except where sections 2 to 4 say otherwise. Unchanged:

- the data: the OSV npm export (`all.zip`, sha256 `8b3170a6…`), and v4's registry, identity, attestation and deps.dev cache (a copy of Docker volume `ludion-bt4-cache`; anything it lacks is read on the run date);
- the malicious denominator (the 1,148 versions of `docs/bench/2026-10-28-backtest-rerun/malicious-v2.json`), the fixes, and the trees, resolved with the exception (primary) and without it;
- scenarios (a) P not in the lockfile and (b) P locked at prev (`previous` in malicious-v2.json);
- the judgement time, the waits and their extensions, the re-query, record timings (conservative primary, optimistic shown);
- the outcomes (stopped, missed, unknown), the primary result (missed if either scenario misses, else unknown if either is unknown), and the gates;
- provenance regression, new dependencies and publisher change: read from the registry, else deps.dev, as in v4. ecosyste.ms is not used for them;
- archives are never used to resolve trees. A branch through a version the registry no longer lists stays unknown.

## 2. Install scripts: sources and rule

**The fact.** Which of `preinstall`, `install`, `postinstall` a version declares (the judge's `installScripts`, packages/cli/src/security/judge.ts). It is read from the first of these sources that has it:

1. **The registry**, when it lists the version: its version document's `scripts`. v4's cache keeps only whether a version has any install script, so the names, when needed, come from the registry's version document read on the run date.
2. **ecosyste.ms**, when the registry does not list it: the version record `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/<name>/versions/<version>`. It counts as having the fact when its `metadata` object has a `scripts` key: an object, or null for none. ecosyste.ms keeps this copy of the registry's version document from while the version was listed.
3. **Software Heritage**, when neither has it, and only under the reading rule below. Its npm origin is `https://www.npmjs.com/package/<name>`:
   - Visits are read until one is before the version's publish time.
   - Of the visits at or after the publish time that have a snapshot, the earliest is checked for the branch `releases/<version>`; if it does not hold it, the next one is. Two at most. A version the registry has removed does not come back, so a later snapshot cannot hold it.
   - The branch leads, through its release or revision, to the archived files of the registry's tarball. If the root holds one folder and no files, that folder is the package root.
   - The install scripts are the lifecycle keys in that `package.json`'s `scripts`. `install` is added when the root has `binding.gyp`, the package declares neither `install` nor `preinstall`, and `gypfile` is not false (what npm does for such a package).
4. Otherwise the fact is **unverified**. As in v4, unverified is not counted as a stop, and nothing fills it in.

When one source has the fact, the later ones are not read for the signal. Each version's source is reported.

**The rule** is the judge's, unchanged:
- (a) P is new to the project: V declaring any install script stops.
- (b) prev is listed by the registry: V declaring one that prev does not stops. prev's names come from the registry.
- (b) prev is not listed: the judge has no comparable predecessor, so V declaring any install script stops. v4 left this case unverified even when the registry listed V. It is applied here because it is the judge's rule (judge.ts, "No usable predecessor").

As in v4, this stop applies whether or not a fix selects V, because if a fix brought V in, the judge would stop on it. The genuine fixes' trees are not affected (section 5).

**Software Heritage's reading rule.** Its anonymous API allows 120 requests an hour, which does not cover the 1,140 removed versions. So it is read only where its answer can change a reported outcome or category:
- (i) V's install scripts are unverified after the registry and ecosyste.ms, and V is missed or unknown at some wait, in either timing, with or without the exception, when outcomes are computed without Software Heritage. The outcomes are then computed again with what it gave.
- (ii) V is a disputed-category candidate that has passed every check of section 3 that does not need Software Heritage.

So the install-script signal's "fires" count includes Software Heritage only for those versions, and the result says so. Its "alone" count, and every outcome, are exact under this rule: a version stopped without Software Heritage stays stopped.

**Failures.** Each request gets up to 4 attempts. A 404 is an answer: the archive does not hold it. Software Heritage's rate-limit headers are honoured by waiting for the reset. A source that still cannot be read leaves the fact unverified and is counted as unreadable.

## 3. The disputed category (係争中)

**Meaning.** A version named malicious for which it can be shown, with the registry's hash and two or more independent archives, that its code is identical to the immediately preceding legitimate version. Disputed versions **stay in the malicious denominator** with their outcomes, and are also counted and listed apart. The gates do not change.

**Checked for all 1,148 versions**, on the run date. V is disputed when all of these hold:

1. **The preceding legitimate version** prev_d is the latest version of P published before V (registry `time`) that no MAL- record in the OSV export names, in `versions` or within a SEMVER range. It differs from v2's `previous`, which must be at least 7 days older. The registry must list prev_d, and its tarball, downloaded from the registry, must match the registry's sha512 `dist.integrity`. Otherwise V is not disputed.
2. **The registry's hash of V** is its `dist.shasum` (sha1) and `dist.integrity` (sha512) from copies of the registry's version document. For a version the registry still lists, the registry itself gives it. Otherwise it comes from ecosyste.ms (`metadata.dist`) and from Software Heritage's `replicate-npm-package-json` metadata for V's archived files. At least one copy must give it, and every copy that gives a value must agree.
3. **Two independent archives hold V's files: Software Heritage and jsDelivr.**
   - Software Heritage: the archived files of section 2, with each file's sha256.
   - jsDelivr: `https://data.jsdelivr.com/v1/packages/npm/<name>@<version>?structure=flat`, with each file's sha256.
   - Both must list the same set of paths, with the same sha256 for every file.
   - ecosyste.ms keeps metadata, not files, so it is not one of the two. unpkg, npmmirror and the yarn registry serve only what the registry serves, so they hold no removed version.
4. **The archives are tied to the registry's hash.**
   - Software Heritage's `original-artifacts-json` for those files names the registry's tarball URL for V, with a sha1 equal to the registry's `shasum`, or a sha512 equal to its `integrity`.
   - Where copies of the version document give `dist.unpackedSize`, they must agree, and jsDelivr's file sizes must add up to it.
   - jsDelivr gives no tarball hash. It is tied to the hash through the identical files of item 3.
5. **The code is identical to prev_d's.** V's files (items 3 and 4) are compared with prev_d's files from its registry tarball (item 1). Paths are relative to the package root (the tarball's top folder removed).
   - **No code file is added or changed.** Every file of V is either inert or present in prev_d at the same path with the same sha256. Files of prev_d that V does not have are allowed: a removal adds no code.
   - **Inert files:**
     - `.json` files other than the root `package.json` and `npm-shrinkwrap.json`;
     - `.md`, `.markdown`, `.txt` and `.map` files;
     - files named LICENSE, LICENCE, COPYING, NOTICE, AUTHORS, README, CHANGELOG or HISTORY (any case, no extension or `.md`/`.txt`);
     - `yarn.lock`.
     Everything else is code, including `.d.ts`, `.sol`, `.c`, `.gyp`, `.html`, `.svg`, `.css` and files with no extension.
   - **The root `package.json`** may change, but these fields must be equal in V and prev_d (compared as JSON values, absent equal to absent):
     - `scripts.preinstall`, `scripts.install`, `scripts.postinstall`, `scripts.prepare`;
     - `bin`, `directories.bin`, `main`, `module`, `browser`, `exports`, `imports`, `type`, `gypfile`;
     - `bundleDependencies` and `bundledDependencies`.
   - **Runtime requirements.** Every entry of V's `dependencies`, `optionalDependencies` and `peerDependencies` appears in prev_d's under the same name with the same spec string. V may drop an entry or move it to devDependencies.
   - **What this does not claim.** A changed data file (`.json`) can still change what identical code does. The category says only that V's code equals prev_d's, not that V is benign. That is why V stays in the denominator.

**Order.** The checks run cheapest first, Software Heritage last:
- whether prev_d exists and the registry lists it;
- jsDelivr's list;
- prev_d's tarball and its integrity;
- item 5 against jsDelivr's files, with V's `package.json` from jsDelivr (its sha256 must match jsDelivr's list);
- ecosyste.ms's copy of the hash and `unpackedSize` (a missing record is not a failure; a disagreement is);
- Software Heritage (items 2 to 4).

The first failing check is recorded per version, so the result shows a funnel. Software Heritage is read only for versions that pass everything else (section 2, rule (ii)). Each request has the same retry rule. A source that cannot be read fails its check, and that is counted as unreadable, not as a pass.

## 4. Outputs

docs/bench/2026-10-28-backtest-v5/:
- `malicious-v5.json`: per version, the facts with their sources, both outcomes (with and without the exception), and the disputed check's funnel step and evidence.
- `README.md`.

Reported:
- **Per wait,** primary and conservative, with the exception: stopped / missed / unknown out of 1,148, and the stop rate as an interval. The lower bound counts every unknown as missed, (stopped) / 1,148. The upper bound counts every unknown as stopped, (stopped + unknown) / 1,148. The optimistic timing and the result without the exception are shown.
- **Per signal:** fires and alone, as in v4. The install-script signal is also split by source (registry, ecosyste.ms, Software Heritage). The change from v4: the versions that move from missed or unknown to stopped, by signal and source.
- **v4 reproduced.** The script also computes every outcome with v4's facts and v4's install-script rule. Each version's outcome must equal `malicious-v4.json`'s. Any difference is listed, not hidden.
- **The disputed category:** the funnel (how many fail at each check), every disputed version with its evidence and its outcome per wait, and the per-wait counts of disputed and other versions.
- **The sources:** per source, how many versions it was read for, how many it held, and how many were unreadable; the number of Software Heritage requests.

## 5. The genuine side is carried over from v4

The new sources only give facts for versions the registry no longer lists, and the judge's rules do not let such a fact change a genuine update's verdict:
- A changed version the registry does not list already stops ("no longer listed").
- A predecessor it does not list is not compared ("No usable predecessor"; the change's own install scripts come from the registry).
- Trees still do not read archives.

So v4's genuine results (`docs/bench/2026-10-28-backtest-v4/fixes-v4.json`: stops, delays, the three delay gates) are v5's, and that script is not rerun. A rerun would read today's registry again (deprecations, KEV, EPSS) and mix that drift into the comparison. The README lists the v4 genuine updates whose version or predecessor the registry does not list.

## 6. Gates

Unchanged (v3 section 7, v4):
- every malicious version stopped at each of the four waits (primary, conservative timing, with the exception), where missed or unknown counts as not stopped;
- the median added delay within 24h for exploited and for high, and within 72h for normal.

All must hold, and not measured counts as not met. Disputed versions stay in the denominator for the first gate.

## 7. How it runs

- The scripts are `tools/backtest/src/malicious-v5.ts` and `tools/backtest/src/archives-v5.ts`, committed and pushed before the run. They import from the judge's code (judge.ts, npm-facts.ts, time-cap.ts) and do not change it.
- They run in Docker (node:24-slim), as a non-root user, with a read-only root and no forwarded host environment.
- The network is used only for read-only lookups: the registry, deps.dev, ecosyste.ms, jsDelivr and Software Heritage. The registry is also where prev_d's tarballs come from. Tarballs are read in memory, hashed and never extracted to disk or run.
- **The first execution is the result.** It records its commit, the git blob hashes of the scripts and of the judge files they import, and its start and end times. The script refuses to overwrite an earlier output.
- **Smoke runs before it** are limited to @ensdomains/buffer 0.1.1 (`--only`), whose facts were already read in cycle 2, and use a separate copy of the cache. Their output is not a result.
