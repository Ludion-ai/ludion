# LO2 and LD2: is a version tied to a source release, and does the source diff explain its new capabilities? (2026-10-30)

These lanes test a gate shape that LO's result suggested:
- the version is tied to a release in its repository (a tag, or a provenance commit);
- every new capability in its tarball diff (LD's rules) also appears in the source diff between the two releases.

Measured on the 192 genuine fixes and the 11 obtained malicious versions of lane LD. **It is an experiment that only reads.** No product code, gate or wait changed.

The definitions are in `docs/decisions/2026-10-30-lold2-release-link-definitions.md`. They were committed (18c7a5d) and pushed (GitHub records the push at 12:22:31Z), before any tarball, reference list, tag, commit or source archive was fetched for these lanes, and are unchanged.

## When things were fixed, and what ran

| What | Commit | Time (UTC) |
| --- | --- | --- |
| Definitions | 18c7a5d | committed 12:22:32Z (local clock), push recorded by GitHub at 12:22:31Z |
| Runner, helpers, self-test | 1ec489c | committed before the first smoke run |
| Runner: `--only` for smoke runs, and a lost line break fixed | 3a9bd45 | committed after the smoke runs |
| **The execution** (the result), at 3a9bd45 | — | 12:32:29Z–12:44:12Z, exit 0 (`run.log`) |
| The §3 time statistics recounted without rounding, from the committed rows (found in review) | `scripts/recount-tag-time.ts` | after the review's first round |

- **Smoke runs** (outputs kept outside the repository and discarded, never the result):
  - at 1ec489c, first 6 genuine rows: failed once on the cache volume's owner (fixed outside the code), then ran;
  - with `--only` on 5 genuine rows (undici 6.21.1, @portkey-ai/gateway 1.14.0, mermaid 11.10.0, better-auth 1.2.10, ghost 6.0.9), to try the source diff: failed once because a comment had swallowed the line holding `import { execFileSync }`, then ran with the working tree that became 3a9bd45.
  - No definition changed after them.
- **Setup.** The execution ran in Docker (node:24, Node v24.22.2, git 2.39.5) as user 1000, with a read-only root, a tmpfs `/tmp`, no credentials and no forwarded environment. The command was `docker run --rm --name lold2-run --read-only --tmpfs /tmp:rw,size=2g --user 1000 --memory 10g -v lold2-w:/w:ro -v lold2-cache:/cache -v <this folder>:/out node:24 sh /w/docs/bench/2026-10-30-lold2/scripts/run.sh 3a9bd457b8dae2a6d1423936a5723fa8304d7c6e`. The commit in `run.log` is that argument, not read inside the container.
  - The repository at 3a9bd45 (`git archive`, dependencies installed with scripts off) was mounted read-only.
  - The self-test (`scripts/selftest.ts`) passed first.
- **Nothing reached the host but the results.** Tarballs and source archives were held in memory. Git fetched only commit and tag objects (`--filter=tree:0`) into the tmpfs.
- **The cache** (a named volume) held JSON answers and reference lists only. It was deleted at 12:44:22Z.
- **Inputs.** `lold2.json`'s `data` gives the SHA-256 of `delta-v1.json` and `lo.json`. The third input, `docs/bench/2026-10-28-backtest-v5/malicious-v5.json` (only its `disputed` flags are read), is not hashed there; at 3a9bd45 its SHA-256 is `54184b17…4bfd4`, unchanged since v5 (51a8f0b).
- **Blob hashes.** `lold2.json` records the git blob hashes of the runner, the helpers, LO's `lo.ts`, `delta.ts`, `archives-v5.ts`, `npm-facts.ts` and `judge.ts`; they equal 3a9bd45's.
- **Requests** (`lold2.json`, `run.requests`): registry 580, registry tarballs 403, GitHub reference lists 19, git fetches 172 (0 failed), source archives 39 (1 failed: HTTP 404).

## LO2 — is the fixed version tied to a release?

**172 of 192 genuine fixes (89.58%) are tied** (definitions §2, a re-count of LO's run).

| Tied by | Rows |
| --- | --- |
| Tag form 1 (`vX`) | 119 |
| Tag form 2 (`X`) | 33 |
| Tag form 3 (`N@X`) | 15 |
| Tag form 4 (`U@X`) | 1 |
| Provenance commit (no tag) | 4 |
| **Not tied** | **20** |

These counts include LO's 4 rows that had a release but were not comparable for LO's own reasons, so they differ from LO's release-kind counts of the comparable rows (118, 31, 14, 1, 4).

**The 20 not tied**, by LO's reason (none has attestations):
- no `repository` field: 9;
- no tag of the 8 forms in the named repository: 7;
- a repository not on GitHub: 2;
- a repository field not understood: 2.

**Tag and provenance together** (shown; provenance read now for all 192):

| | Rows |
| --- | --- |
| Tag and provenance | 64 |
| Tag only | 104 |
| Provenance only | 4 |
| Neither | 20 |

68 of the 192 fixed versions have a provenance that `provenanceFrom` reads; 124 have no attestations.

### When was the tagged commit made, against the publish time?

All 168 tag-tied rows were fetched; every peeled commit equals the one LO recorded (no tag moved).

**The numbers below are from `tag-time-recount.json`, not from `lold2.json`'s `lo2.tag_time`.** The runner rounded each difference to 0.01 h before its statistics and buckets, which §3 does not say. So a commit made seconds after the publish counted in (−1, 0]. The recount (`scripts/recount-tag-time.ts`) reads the committed timestamps of the same rows, without rounding and without a new fetch. `lold2.json` is kept as the execution wrote it.
- What the rounding changed: commit time, (−24, −1] 22 → 21, (−1, 0] 141 → 137 and (0, 1] 3 → 8; tagger time, (−1, 0] 83 → 69 and (0, 1] 9 → 23; the provenance commits' Q3, −0.06 → −0.07.

**Commit time minus publish time** (hours; negative = the commit was made before the publish):

| n | min | Q1 | median | Q3 | max |
| --- | --- | --- | --- | --- | --- |
| 168 | −98.63 | −0.18 | −0.04 | −0.01 | 0.53 |

| ≤ −168 | (−168, −24] | (−24, −1] | (−1, 0] | (0, 1] | (1, 24] | (24, 168] | > 168 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2 | 21 | 137 | 8 | 0 | 0 | 0 |

- **In 160 of 168, the tagged commit was made before the publish.**
- **In the other 8, it was made at most 0.53 h after it:**
  - 5 within 3 seconds: @plone/volto 16.34.0, 17.22.1 and 18.24.0; xml-crypto 6.0.1; @node-saml/node-saml 5.1.0;
  - formidable 3.5.3, 61 seconds;
  - react-server-dom-turbopack 19.0.2, 954 seconds;
  - @jitbit/htmlsanitizer 2.0.3, 1,909 seconds.
- The two earliest: zx 8.8.5 (−98.63 h) and next-auth 4.24.12 (−43.97 h).

**Tagger time minus publish time** (shown; the 97 annotated tags of the 168, 57.74%):

| n | min | Q1 | median | Q3 | max |
| --- | --- | --- | --- | --- | --- |
| 97 | −43.97 | −0.08 | −0.02 | 0 | 75.63 |

| ≤ −168 | (−168, −24] | (−24, −1] | (−1, 0] | (0, 1] | (1, 24] | (24, 168] | > 168 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 1 | 69 | 23 | 2 | 1 | 0 |

- The latest: vega 6.2.0, tagged 75.63 h after the publish.

**Provenance commits** (4 rows): −0.20 h to −0.02 h, median −0.12 h.

**What this does not show:** when a tag was pushed. Commit and tagger times are written by whoever makes them and can be set to any value, and GitHub does not give an anonymous reader the push time of a tag. So these numbers do not show whether an attacker could add a tag after publishing.

### Did the malicious versions' previous versions name a repository?

| Of the 11 malicious versions | Count |
| --- | --- |
| The previous version names a repository | 2 / 11 |
| …a GitHub repository | 2 / 11 |
| **The field removed** in the malicious version | **0 / 11** |
| Both name the same `owner/repo` | 2 / 11 |

- **The 9 malicious versions without a `repository` field had none in the previous version either.** So, in this sample, the field was not removed by the malicious version.
- **The 2 that name one:**
  - @react-native-aria/switch 0.2.4 → 0.2.5;
  - @voiceflow/natural-language-commander 0.5.1 → 0.5.3.
- **The two disputed versions (v5)**, freo-design-system 1.0.4 and @ensdomains/buffer 0.1.1: no repository in either version.
- All 11 previous `package.json` files were read from integrity-checked registry tarballs.

## LD2 — does the source diff explain the tarball's new capabilities?

| Outcome (192 genuine fixes) | Count | Share |
| --- | --- | --- |
| No new capability (files matched by content) | 168 | 87.50% |
| All explained by the source diff | 11 | 5.73% |
| **Unexplained capability** | **8** | **4.17%** |
| Not comparable | 5 | 2.60% |

- **Among the 187 comparable: 8 unexplained (4.28%).**
- **Not comparable:**
  - no release for the fixed version: 4 (@anthropic-ai/claude-code 1.0.93, 1.0.105 and 2.0.31; flowise-components 2.2.4);
  - the previous commit's source archive answered HTTP 404: 1 (pbkdf2 3.1.3).

### Matching files by content

- **v1 (the same path), reproduced:** 51 of 192 flagged, as LD.
- **By content:** 24 of 192 flagged. Content matching removed 27 pairs and added none.
  - All 15 vite pairs are clean by content.
  - The other 12 removed: mcp-remote 0.1.16, ghost 6.0.9, @fedify/fedify 1.6.8, @fastify/reply-from 12.5.0, js-toml 1.0.2, better-auth 1.2.10 and 1.1.16, react-router 7.5.2, mermaid 10.9.4, x402 0.5.2, @apollo/sandbox 2.7.2, astro 5.14.3.
- **The malicious side** (shown; the 8 rows with both tarballs in the registry): 7 flagged by both v1 and content matching, 1 clean by both (@react-native-aria/switch 0.2.5, LD's miss). The 3 read from Software Heritage were not computed. Content matching removed no malicious flag here.

### The 8 with an unexplained capability

| Pair | Tarball's new capabilities | Unexplained |
| --- | --- | --- |
| parse-server 8.0.1 → 8.0.2 | fetch, long base64, high-entropy line, very long line | very long line |
| mermaid 11.9.0 → 11.10.0 | high-entropy line, very long line | both |
| next 15.2.1 → 15.2.2 | net, very long line | very long line |
| better-auth 1.4.1 → 1.4.2 | fetch, high-entropy line, very long line | all three |
| @vitest/browser 3.0.3 → 3.0.4 | fetch, WebSocket, high-entropy line, very long line | all four |
| @openai/codex 0.38.0 → 0.39.0 | binary | binary |
| vega 6.1.2 → 6.2.0 | fetch | fetch |
| next 15.0.4 → 15.0.5 | fetch, eval, very long line | all three |

- **3 of the 8 are unexplained only by obfuscation markers** of built files (very long line, high-entropy line): parse-server, mermaid, next 15.2.2.
- **5 have an unexplained capability of rules 1–6:** better-auth 1.4.2, @vitest/browser 3.0.4, @openai/codex 0.39.0, vega 6.2.0, next 15.0.5.
  - In 4 of them it is `fetch` (with `WebSocket` and `eval` in one each).
  - In @openai/codex it is a binary.
- Whether these come from bundled dependencies or from build output was not measured.

**Per capability** (pairs where it is new / unexplained / explained; the rest not comparable):

| Capability | New | Unexplained | Explained |
| --- | --- | --- | --- |
| very long line | 8 | 6 | 1 |
| high-entropy line | 7 | 3 | 1 |
| new dependency | 7 | 0 | 5 |
| fetch | 6 | 4 | 2 |
| child_process | 3 | 0 | 3 |
| net | 2 | 0 | 2 |
| eval | 2 | 1 | 1 |
| binary | 2 | 1 | 1 |
| WebSocket | 1 | 1 | 0 |
| new Function | 1 | 0 | 0 |
| dns | 1 | 0 | 1 |
| http(s) | 1 | 0 | 1 |
| long base64 | 1 | 0 | 1 |

### Both prongs together (shown)

**163 of 192 genuine fixes (84.90%) are tied and have no unexplained capability.** The other 29 (15.10%) would stop:
- 20 not tied;
- 8 tied with an unexplained capability;
- 1 tied but not comparable (pbkdf2 3.1.3).

## What this does not measure

- **The malicious side of LD2.** None of the 11 obtained malicious versions is tied to a release (LO), and no hijacked version of the kind this gate is for (a popular package that keeps its `repository`) was obtained. How often such a version would have an unexplained capability is unknown.
- **A wider source diff.** Only the package directory was compared. Capabilities from sibling packages, from bundled dependencies or from the lockfile were not looked for.
- **Minified files.** Similarity is by lines, so a new minified file of one long line matches no previous file (29 of mermaid 11.10.0's 163 changed code files had no predecessor).
- **The push time of tags** (above).

## What the runner and the definitions leave open (recorded, not changed)

- **The 2 GiB limit** (§6, as LO's) is applied to the gunzipped archive, not to the sum of file sizes as LO did. No archive reached it.
- **The previous version's provenance repository** (§6) is compared with the fixed version's `owner/repo` ignoring case, where §6 says "the same `owner/repo`". One row used it: @openai/codex 0.38.0, whose provenance matched `openai/codex`. `lold2.json` does not keep the previous provenance's repository text, so whether it matched only when ignoring case cannot be checked from the committed data.
- **The not-comparable reason's label.** `ld2.not_comparable_by_reason` labels pbkdf2 3.1.3 "previous commit", where §6 names it "source archive not read". The detail field holds the full text: "previous commit: source archive not read: HTTP 404".
- **Attempts on a source archive.** On a 4xx answer other than 429, the runner stops after one attempt, where §6 says 3 attempts; LO's runner does the same. The one such answer was pbkdf2's 404.
- **Test files** in the source package directory count (§6 says so); `undici`'s `net` and `dns` are also new in `test/interceptors/dns.js`.
- **The tag-tied counts include rows LO could not compare** (above), as §2 says (any `release`).

## Files

- `lold2.json`: the summary, and one row per version:
  - genuine: LO's release, provenance now, publish time, the tag's commit, committer, author and tagger times, the tarball and source diffs (capabilities and up to 20 paths each), and the outcome;
  - malicious: the previous and malicious versions' repository readings and the shown content diff (capability names only, no paths).
- `tag-time-recount.json`: §3's statistics recounted from `lold2.json` without rounding (the numbers this README gives for §3).
- `lold2.log`, `run.log`: the execution's log and times.
- `scripts/recount-tag-time.ts`: the recount.
- `scripts/lold2.ts`: the helpers.
- `scripts/run-lold2.ts`: the runner.
- `scripts/selftest.ts`: the helpers' checks on made-up inputs.
- `scripts/run.sh`: what ran in the container.
