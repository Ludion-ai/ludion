# Delta v1: does the diff from the previous version tell malicious from genuine? (2026-10-30, lane LD)

The owner asked for an algorithm instead of a fixed wait (2026-10-30 08:41–08:43 JST). Malicious code has to be in the diff from the previous version, and a security fix's diff is usually small. So lane LD measured on real data whether checking the diff itself works. This is a measurement toward gate 2's inspection for obfuscated code and new network or process calls, which docs/status.md lists as not built. It builds no part of that inspection. **It is an experiment: no product code, gate, or wait changed.**

The definitions are in `docs/decisions/2026-10-30-ld-delta-v1-definitions.md`. They were committed and pushed before any tarball, file list or file was fetched, and are unchanged.

## When things were fixed, and what ran

| What | Commit | Time (UTC) |
| --- | --- | --- |
| Definitions | f90450d | pushed 2026-10-30T00:12:53Z |
| Analyzer, runner, tests (`delta.ts`, `delta-v1.ts`, `delta.test.ts`) | 8d576eb | committed 00:18:41Z |
| First execution, at 8d576eb | — | 00:19:00Z–00:49:29Z, **exit 1, no result** (`attempt1.log`) |
| Fix: long runs scanned by hand, an analyzer error is undecidable (`docs/mistakes/2026-10-30-delta-regex-stack.md`) | 9443192 | committed 00:51:43Z |
| **The execution** (the result), at 9443192 | — | 00:51:53Z–07:26:30Z, exit 0 (`run-times.txt`) |

- **The first execution stopped** after about 1,200 of the 1,348 pairs. `/[A-Za-z0-9+/]{200,}/` overflowed V8's regex stack on a multi-megabyte run in one fetched file. The fix counts the same maximal runs by hand, so the definitions are unchanged. The fix also records an analyzer error on one pair as undecidable; none occurred in the result. The first execution wrote no result, so nothing from it is reported beyond its log.
- **Setup.** Both executions ran in Docker (node:24-slim, Node v24.22.2) as user 1000, with a read-only root, a tmpfs /tmp, no credentials, no forwarded environment, and the repository mounted read-only.
- **No package file reached the host.** Tarballs and files were held in memory. A named volume cached the fetchers' answers: v5's ecosyste.ms, jsDelivr list and Software Heritage answers were copied in, and new ones were added.
- **One exception in the cache** (found in review). v5's Software Heritage answers include the raw `package.json` text of the versions Software Heritage held for v5 (`swhManifest`). So the copied cache did hold that one file of those versions, as inert text, inside the volume. This execution's own fetches cached no package file. See `docs/mistakes/2026-10-30-delta-v1-records.md`.
- **Removed afterwards.** The container and the volumes were deleted at the end (lane report).
- **What is committed.** `delta-v1.json` holds names, versions, sources, outcomes, capability names and numbers. It holds file paths only for genuine fixes, and no file content.
- **Blob hashes.** The output records the git blob hashes of `delta-v1.ts`, `delta.ts`, `archives-v5.ts` and `judge.ts` (main's, unchanged); they equal the commit's.

## Result

### Malicious versions (1,148): 11 obtained, 1,137 not obtained

| Outcome | Count |
| --- | --- |
| Flagged (new capability) | **9**, of which disputed (v5): 1 |
| Clean, **a miss** | **2**, of which disputed (v5): 1 |
| Undecidable | 0 |
| Not obtained | **1,137** (V only 1,021; both 111; previous only 5) |

**Of the 11 obtained, 9 are flagged and 2 are missed.** The 11 are not a random sample of the 1,148:
- 8 are the versions the registry still lists;
- 3 are versions Software Heritage held among the 228 it was asked about in its 6 hours.

So 2 of 11 is not an estimate of the miss rate over the 1,148.

**Why 1,137 were not obtained:**
- **The registry** answered 404 for the tarball of every removed malicious version.
- **jsDelivr's CDN** served 3 V's (loliloli 1.0.103 and 1.0.107, yoo-styles 6.0.326) and 3 previous versions (config-cordova 0.8.4, selenium-session-client 1.0.3, uplandui 0.5.3). It answered 404 for the rest, or did not list them.
- **Software Heritage.** Its anonymous limit is 120 requests an hour. In 6 hours (01:18:44Z–07:20:10Z) it was asked about 228 of the 1,176 versions still missing, in the order of SHA-256(name@version), and it held 7 of them.
- **By side**, for the 1,132 missing V's:
  - not looked up in time: 913;
  - not in the first snapshots after publication: 208;
  - no visit with a snapshot after publication: 6;
  - origin not archived: 5.
- For the 116 missing previous versions:
  - not looked up in time: 111;
  - no visit with a snapshot after publication: 4;
  - origin not archived: 1.

`malicious.not_obtained_reasons` in `delta-v1.json` has the full breakdown.

**The 11 obtained malicious versions:**

| Version (record) | Previous | Source (prev / V) | Outcome | New capabilities |
| --- | --- | --- | --- | --- |
| @igh/server-updater-ssh 1.2.16 (MAL-2025-48351) | 1.2.4 | registry / registry | flagged | long base64 |
| @igh/server-updater-ssh-l1 1.2.17 (MAL-2025-47896) | 1.2.8 | registry / registry | flagged | long base64 |
| @asyncapi/studio 0.20.1 (MAL-2025-190863) | 0.20.0 | registry / registry | flagged | fetch, XMLHttpRequest, WebSocket, eval, new Function, long hex, very long line |
| @asyncapi/studio 0.20.2 (MAL-2025-190863) | 0.20.0 | registry / registry | flagged | as 0.20.1 |
| freo-design-system 1.0.1 (MAL-2025-3399) | 1.0.0 | registry / registry | flagged | child_process, dns |
| freo-design-system 1.0.4 (MAL-2025-3399) | 1.0.0 | registry / registry | flagged | child_process, install script |
| @dm3-org/dm3-lib-shared 1.7.2 (MAL-2025-3713) | 1.7.1 | registry / registry | flagged | new Function, long base64 |
| @voiceflow/natural-language-commander 0.5.3 (MAL-2025-191356) | 0.5.1 | registry / Software Heritage | flagged | child_process, http(s), fetch, XMLHttpRequest, eval, long hex, long base64, very long line, `_0x` names, install script |
| eslint-config-kinvey-flex-service 0.1.1 (MAL-2025-191395) | 0.1.0 | registry / Software Heritage | flagged | as the row above |
| **@react-native-aria/switch 0.2.5** (MAL-2025-4789) | 0.2.4 | registry / registry | **missed** | none |
| **@ensdomains/buffer 0.1.1** (MAL-2025-190866) | 0.1.0 | registry / Software Heritage | **missed** | none |

**The other disputed version is among the flagged: freo-design-system 1.0.4** (v5 README, "The disputed category").
- **Why it is flagged.** Section 1 compares it with its row's `previous`, 1.0.0, so its flags (child_process, install script) come from changes across 1.0.1–1.0.3. v5 found that 1.0.3, which no MAL record names, added the `preinstall`. It also found that 1.0.4's code and `package.json` equal 1.0.3's in every field v5 compares.
- **Compared with 1.0.3,** 1.0.4 would very likely show nothing new. That is an inference from v5's check, not measured here.
- **So of the 9 flagged,** 8 are not disputed.

**Why each miss passed.** No code was read on the host or is quoted here.

- **@react-native-aria/switch 0.2.5.** This is a real miss: the MAL record says the version connects to a command-and-control server and allows arbitrary command execution.
  - **The analyzer's facts:**
    - one code file changed, the CommonJS entry file;
    - every capability count is zero in both versions of it;
    - 2 lines added, 35 removed;
    - 3 build-configuration files removed.
  - **Further counts.** They go beyond the analyzer's facts, as recorded in `docs/decisions/2026-10-30-ld-delta-v1-miss-inspection.md`. They were measured after the result, inside a credential-free container, by `scripts/inspect-miss.ts`. The script prints the integrity flag, each version's file list (not committed), counts and the module names given to `require` (strings of at most 80 characters). It prints no line of code:
    - the file went from 283 to 4,545 bytes;
    - its longest line went from 46 to 4,302 characters;
    - that line is its only line of 1,000 or more;
    - the highest entropy of any line of 200 characters or more is 5.20 bits per character;
    - the longest run of spaces or tabs in the file is 836 characters;
    - the file `require`s only the package's own module;
    - it has 2 occurrences of `global[`.

    That the added code is that line, behind that whitespace, reaching what it uses through computed lookups on `global`, is inferred from these counts (the entry says which are printed and which are inferred).
  - **So no v1 rule could fire:**
    - 4,302 characters is under the very-long-line threshold of 5,000;
    - 5.20 is under the entropy threshold of 5.5;
    - no listed module, API or code-from-string name appears literally.
- **@ensdomains/buffer 0.1.1.** **No code file changed.** In the analyzer's facts:
  - 1 file added, 2 removed and 2 changed (`package.json` among them), none of them code;
  - that is all 21,955 lines added and 14,572 removed. This is one of v5's two disputed versions: its code equals 0.1.0's, and the compromise named by the record's other sources is in 0.1.2 (v5 README, "The disputed category"). A diff check cannot catch it, because there is nothing new in it.

### Genuine fixes (200): 192 obtained, 51 false alarms

| Outcome | Count |
| --- | --- |
| Clean | 141 |
| Flagged, **a false alarm** | **51** (51 / 192 = 26.56%) |
| Undecidable | 0 |
| Not obtained | 8 |

**The 8 not obtained.** Each `from` is a version the registry no longer lists, and Software Heritage was not reached for them in time:
- debug 4.4.2;
- color-name 2.0.1;
- error-ex 1.3.3;
- simple-swizzle 0.2.3;
- flowise 3.0.9;
- duckdb 1.3.3;
- eslint-config-prettier 8.10.1;
- taylored 7.0.7 → 7.0.8, where both versions are unlisted.

Several of these `from` versions were themselves compromised releases.

Per capability, over the 192 genuine and the 11 malicious pairs. Each cell is fires / alone:

| Capability | Genuine | Malicious |
| --- | --- | --- |
| module: child_process | 18 / 1 | 4 / 0 |
| module: net | 19 / 0 | 0 / 0 |
| module: http(s) | 17 / 2 | 2 / 0 |
| module: dns | 16 / 0 | 1 / 0 |
| module: tls | 13 / 0 | 0 / 0 |
| module: dgram | 0 / 0 | 0 / 0 |
| module: worker_threads | 15 / 0 | 0 / 0 |
| module: vm | 0 / 0 | 0 / 0 |
| fetch | 31 / 5 | 4 / 0 |
| XMLHttpRequest | 2 / 0 | 4 / 0 |
| WebSocket | 17 / 0 | 2 / 0 |
| eval | 12 / 0 | 4 / 0 |
| new Function | 19 / 0 | 3 / 0 |
| long hex | 1 / 0 | 4 / 0 |
| long base64 | 21 / 0 | 5 / 2 |
| high-entropy line | 25 / 2 | 0 / 0 |
| very long line | 30 / 2 | 4 / 0 |
| `_0x` names | 0 / 0 | 2 / 0 |
| install script | 0 / 0 | 3 / 0 |
| new dependency | 7 / 5 | 0 / 0 |
| binary | 2 / 1 | 0 / 0 |

**What the false alarms are** (from `where` in `delta-v1.json`):
- **vite: 15 of the 51.** vite's build puts code in chunks with content-hashed names (`dist/node/chunks/dep-<hash>.js`). Each release's chunks are new files, so every capability in them counts as new.
- **Other bundles.** The same happens in other projects that ship bundles: next, mermaid, better-auth, @anthropic-ai/claude-code, x402. The obfuscation markers (long base64, high-entropy line, very long line) fire mostly on minified bundles.
- **New dependencies, 7**:
  - ioredis, file-type, to-buffer, has-own, @paralleldrive/cuid2, winston-transport;
  - three in flowise-components 2.2.4.
- **Binaries, 2:** azle 0.30.0 added two `.wasm` templates, and @openai/codex 0.39.0 changed its platform executables.

**Shown, not part of the result** (defined in section 4 of the definitions before the run):
- **The package-wide reading.** Rules 1–3 and 7 count as new only when their total over all code files rises. Under it, 25 of the 192 genuine fixes are flagged (13.02%), instead of 51. All 9 flagged malicious versions stay flagged, and both misses stay missed. vite's 15 false alarms all disappear under it, because the hashed chunks only move code around.
- **False alarms by the number of changed code files:**

  | Changed code files | Flagged / pairs |
  | --- | --- |
  | 0–1 | 5 / 51 |
  | 2–5 | 23 / 52 |
  | 6–20 | 9 / 49 |
  | more than 20 | 14 / 40 |

### The size of a diff

Median / maximum over the judged pairs:

| | Malicious (11) | Genuine (192) |
| --- | --- | --- |
| Files changed | 2 / 3 | 7 / 1,153 |
| Files added | 0 / 5 | 0 / 316 |
| Files removed | 0 / 5 | 0 / 316 |
| Code files changed | 1 / 2 | 5 / 1,128 |
| Lines added | 35 / 21,955 | 159.5 / 325,243 |
| Lines removed | 7 / 14,572 | 97 / 325,197 |

## What this shows, and what it does not

- **v1's rules on the 11 obtained malicious versions.** 9 are caught, 8 of them not disputed (freo-design-system 1.0.4 is disputed, and is flagged for changes first published in 1.0.3). One real miss (@react-native-aria/switch 0.2.5) shows nothing to any v1 rule. The counts measured afterwards suggest why: one long line under the thresholds, behind whitespace, through computed names (inferred; decision entry above). The other miss (@ensdomains/buffer 0.1.1) has no new code at all.
- **On the genuine fixes, v1 raises a false alarm on 26.56%.** Most of them are bundled builds whose hashed file names make all their code look new.
- **The data is the larger limit.** Only 11 of the 1,148 malicious versions could be fetched: the registry, and almost always jsDelivr, no longer serve removed versions, and Software Heritage rarely holds them and answers 120 requests an hour. Any rule tuned on these results would be tuned on 11 versions, 8 of them the registry's own leftovers. So whether diff checking can replace the wait is not decided here.
- **What a v2 would look at.** Each item is an idea for a new definitions entry and a new run, never a change to this one:
  - the package-wide reading;
  - a whitespace-padding marker;
  - lower line-length and entropy thresholds;
  - computed access to `global`/`process`;
  - more malicious tarballs from a source that holds them.

## What the runner and the analyzer do that the definitions do not say (found in review)

The runner and the analyzer are kept as they ran, so their blob hashes match the execution. These differences are recorded here instead of fixed.
- **No malicious outcome is affected.**
- **Two items can move a number:**
  - the deadline item, one not-obtained reason;
  - the `.` path-segment item, one genuine false alarm (51 could be 50).
- Every other item changes nothing in this run.

- **The deadline.** The runner checks the 6-hour deadline only before it starts a lookup.
  - The first lookup was at 01:18:44.781Z, so the 6 hours ended at 07:18:44.781Z.
  - The 228th lookup started before then and was waiting out a rate limit when the deadline passed. It ended at 07:20:10.931Z.
  - Read strictly, section 2 counts that version as "not looked up in time", not with the "not held" reason it got. The log does not say which version it was.
  - The held count was 7 from the 180th lookup on, so the 228th version was not held, and no outcome changes. At most that one version's not-obtained reason moves between groups, in every row it belongs to.

- **An unreadable tarball.** Definitions section 4 calls a pair undecidable when a tarball cannot be read. Instead, the runner moves on to the next source and, if none serves the version, reports "not obtained". No row has a "tarball unreadable" reason, so nothing is counted differently.
- **A failed second fetch.** A pair whose versions were both held but whose second fetch failed would be marked "held, but a second fetch failed" and left out of `not_obtained_reasons`. There is no such row.
- **A substitute publish time.** When the registry gives no publish time for the previous version of a pending pair (malicious or genuine), the Software Heritage lookup uses the new version's publish time instead. The definitions give no publish time in that case, so the lookup should have answered "no publish time". A later time selects later snapshots, so the substitute could create a hold as well as lose one.
  - **No row is affected.** Software Heritage actually looked up only four previous versions:
    - dialogflow-es 1.1.0 (held);
    - dashboard-empty-state 1.0.2 (held);
    - rxnt-healthchecks-nestjs 1.0.1-alpha-1609 (no visit with a snapshot after publication);
    - amazon-chime-sdk-js-exp 10.10.11 (origin not archived).
  - **Checked afterwards.** On 2026-10-30 at 07:48Z, from a credential-free container, the registry's packument `time` held each of those four versions. So the registry's time, not the substitute, was used. Every other previous version was "not looked up in time" (genuine ones included), so it never reached the substitute.
- **Unhashed Software Heritage entries.** A directory entry that is neither a file nor a directory is stored as `link:<path>`, with no hash check. Software Heritage stores a symlink's target as plain content, where `untar` stores `link:<target>`. In a pair with sources of both kinds, this could count a link as changed. Of the three such pairs, @ensdomains/buffer has no changed code file and the other two are flagged by other files.
- **Untested trust checks.** The runner's own checks are not unit-tested:
  - sha512 / shasum against the registry tarball;
  - each jsDelivr file's sha256 against the list;
  - each Software Heritage file's sha256 against the directory;
  - an analyzer error recorded as undecidable.

  The analyzer's checks are tested in `tools/backtest/test/delta.test.ts`.
- **An analyzer error is recorded as undecidable.** Definitions section 4 lists the undecidable cases, and an analyzer error is not one of them. The runner adds it (since 9443192; `docs/mistakes/2026-10-30-delta-regex-stack.md`), so that one file's error cannot end a run. No row has it. The runner's comment cites a README section "Runs" that does not exist; the runner is kept as it ran.
- **A `.` path segment is not removed** (the analyzer's `untar`, delta.ts). `untar` keeps a path such as `./dist/index.cjs` (a tarball entry named under `package/./`) as written. npm would extract that to the same file as `dist/index.cjs`.
  - **js-toml 1.0.2.** In this genuine fix, the dotted path is counted as added with no previous file, and it is the only file the fix's flags fire on (high-entropy line, very long line).
  - **Checked afterwards** (2026-10-30 08:18Z, `scripts/check-dot-paths.ts`, in a credential-free container). Each tarball was compared with the registry's integrity. The script prints counts only:
    - js-toml 1.0.2 has 1 dotted path, and the tarball also holds the same path without the dot: a duplicate entry. With the dot removed, the two would collide, and which copy counts is not decided here. So this false alarm could go, and 51 could be 50.
    - js-toml 1.0.1 has no dotted path.
    - @asyncapi/studio 0.20.0, 0.20.1 and 0.20.2 have no dotted path either.
  - **No malicious outcome can change.** Removing a dot can only match a changed file with a real previous file, so it can only remove flags. The two misses cannot change.
    - Of the 9 flagged, the @igh pair, both freo versions and dm3 compare every changed code file with a previous file at the same path.
    - voiceflow and kinvey removed no file.
    - The asyncapi pair, the only other case, has no dotted path.
- **The first results commit's subject** (6d9960a, "9 of 11 obtained malicious flagged") counts both disputed versions without showing them apart. The tables above show them apart.
- **A re-fetch may use another source.** When a pending pair is judged, a side is fetched again: from Software Heritage if that is where it was found, otherwise registry then jsDelivr. In principle the second source could differ from the one in `sources`. Here it does not: the 3 pending pairs judged are registry / Software Heritage, and none of their registry sides failed.
- **"Registry, hash unknown"** (definitions section 2): 0 versions. Every registry tarball used had a known hash.

## Files

- `delta-v1.json`: summary and one row per pair.
  - Each row has its sources and what each source answered, its outcome, its new capabilities and sizes, and what its changed code files contain by capability (names only).
  - For genuine fixes only, the paths where each capability is new.
- `delta-v1.log`, `run-times.txt`: the execution's log and times. `attempt1.log`: the first, failed execution.
- `scripts/run.sh`, `scripts/copycache.sh`: what ran in the container. Their comments were corrected after the run (the cache exception); only the comments changed. `scripts/inspect-miss.ts`: the after-the-result measurement of one miss (see above). `scripts/check-dot-paths.ts`: the after-the-result count of dotted paths (see above).
