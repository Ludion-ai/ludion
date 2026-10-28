# The shadow's recorder (2026-10-29, LS)

The recorder from docs/bench/2026-10-28-shadow-design/README.md, sections 2.1 to 2.4. It records; it judges nothing.
- **Not built.** The replay (design, sections 2.5 to 2.7).
- **Fixed first.** How condition (b) will be counted, and what the recorder must capture for it: docs/decisions/2026-10-29-shadow-counting.md, sections 4 and 9. That was decided before any recording.
- **Not a production service.** This is a source preview tool. Where the shadow runs in production is the owner's choice (design, section 6), and it is not made here.

## What it does

`tools/shadow/src/recorder.ts`, every minute:
- **Follows the feed.** It reads `https://replicate.npmjs.com/registry/_changes` from its stored position to the end. On its first run it takes only the feed's current position, and records that moment as the feed start. Nothing before it is read.
- **Captures each watched package that changed.** For each change in the frozen watched list (`tools/shadow/watched.json`), it reads the packument and stores:
  - **on a name's first change:**
    - the full `time` map and `dist-tags`;
    - the manifest and attestations of every version the watched lockfiles hold for that name, and of each dist-tag's version;
    - every version published at or after the feed start, captured as new;
  - **for each new version:**
    - its manifest and attestations;
    - the file list of its registry tarball (path, size, sha256), checked against `dist.integrity`;
    - its registry predecessor, if not yet stored: the latest-published version lower by semver and published before it;
    - the first publish time of each dependency whose time is not yet stored (rule 2's `created`);
  - **afterwards:** new or changed `time` entries, `dist-tags` changes, each stored version's removal (once), and its deprecation.
- **Retries.**
  - A failed read of a whole package is retried on the next poll. So is a failed read for a new version: its attestations, its tarball or a dependency's `created`.
  - After 60 failed capture attempts the recorder writes a `gave_up` record: for the version, or for the package and each of its versions still retried. A catch-up poll over several feed pages can count more than one attempt.
  - A version removed before its capture was complete gets a `gave_up` record at once, and stops the retries.
  - A dependency the registry does not have is a `created` record with status 404, not a failure. It is read again on each later capture attempt of a version that depends on it: a retry, or a later version.
  - The feed position moves on once a page is handled.
  - One document can never hold the feed. An error on one package keeps only that package pending.
  - A dependency name that is not a valid npm name is logged and skipped.
- **Reads OSV once per UTC day.** It reads OSV's npm `modified_id.csv` and stores every MAL- record modified since the last read, watched or not. The first read only sets the position. A record that cannot be read is an error line, and the day's read goes on. That record is read again on later polls, and given up with a record after 60.
- **Writes a status line per poll**: the feed position, entries read, watched changes, names pending a retry, and bytes used.

What is not stored:
- **The tarball.** It is read into memory and checked against its integrity, and inflated in memory under a 256 MB limit. It is hashed, never extracted to disk and never run.
- **E-mail addresses in manifests and OSV records.**
  - Every `email` key is dropped.
  - Addresses inside strings are replaced, including `mailto:` ones. Package specs and URLs that only look like addresses are left alone, such as `p@1.0.1`, `npm:x@1.0.0`, `git@github.com` in an `ssh://` URL, and scoped tarball URLs.
  - The publisher check the judge makes from `_npmUser.email` (`sharedPublisher`) is computed first and stored as a boolean.
  - **Not scrubbed:** attestation bundles (public Sigstore bundles, stored as served), the keys of `time` and `dist-tags`, and error snippets in status lines.
  - **Known limits of the pattern.** It also removes look-alikes such as `react@next.js`.
    - It misses an address followed by `_`, `:` or `-`, one after `/`, and punycode top-level domains (`xn--`).
    - Two object keys that both scrub to `[email removed]` become one.
    - It also misses anything that is not written as an address.

**What leaves the machine:**
- package names and versions, in registry URLs;
- the feed position;
- OSV record ids.

The recorder refuses any host other than registry.npmjs.org, replicate.npmjs.com, api.osv.dev and osv-vulnerabilities.storage.googleapis.com, and follows no redirects.

**The storage limit.**
- **What is counted.** The recorder keeps a running count of the data directory's bytes, read from disk at start.
- **The stop.** Before each append it checks that the line still fits under the limit. If not, it writes one `stopped` line and records nothing more, and it stays stopped after a restart. The process stays up, idle, so a restart policy does not start it again.
- **Overshoot.** The per-package `known/` files and `state.json` are rewritten without that check, so the limit can be passed by about one such file.

## Data layout

Under the data directory:
- `state.json`: the feed position and start, the OSV position and day, the pending names and their failure counts, OSV records to read again, and `stopped`;
- `captures/<UTC day>.jsonl`: `baseline`, `change`, `version` (reason `new`, `retry`, `lockfile` or `predecessor`), `deprecation`, `created`, `gave_up` and `gone` records;
- `osv/<UTC day>.jsonl`: MAL- records;
- `status/<UTC day>.jsonl`: `start`, `feed_start`, `poll`, `osv`, `error` and `stopped` lines;
- `known/`: per-name state, used to tell what is new.

**For the replay.**
- **Duplicates.** A crash between an append and the `known/` write can repeat a capture's records on the next poll. The replay must deduplicate them: by type, name, version and content, ignoring `fetched_at`.
- **Timestamps.** `fetched_at` and the feed start come from the container's clock, and npm's `time` from npm's. A drift between them shifts the capture lag and the first-sight cut-off by that much.

## The watched list

`tools/shadow/watched.json` was made by `node tools/shadow/src/watched.ts <sha>`, run in Docker (node:24-slim, user 1000, read-only root) on 2026-10-28T14:53:51.608Z.
- **Inputs.** This repository's root lockfile at b4d5fcb, plus the 100 noise lockfiles at their recorded SHAs, read with the judge's `lockEntries`. Ludion-ai/ludion-sandbox was still empty (GitHub: "Git Repository is empty.").
- **Result.** 101 sources, 7,660 names, 17,673 name@versions. That is the same as the design's measurement.
- **Its sha256:** `02d3e6de2cc5e4d05af15d60bb6f9ca7ac17ebd261b652c77a9ce23281674f6a`. The recorder writes it into its start line.

## Tests

`tools/shadow/test/recorder.test.ts` has 35 tests. They run in Docker with no network, using node:24-slim pinned by digest. The run is `scripts/check.sh`, and its output is `logs/check.log`:
- typecheck exit 0;
- 35 of 35 passed;
- six deliberate mutations, each making tests fail: e-mail scrubbing off, the storage limit off, the integrity check off, first-sight new versions off, the give-up guard off, and the give-up of a package's versions off.

The tests cover:
- **e-mail removal**, including look-alikes, `mailto:`, non-ASCII addresses and addresses used as keys;
- **OSV:** positions, a record that cannot be read and is read again later, and one export read a day;
- **the watched list;**
- **the feed:** the start position, every page of a long feed, and restart from the stored position;
- **captures:** first-sight captures, including a version published after the feed start; new-version captures; removal recorded once, and deprecation; a package that is gone;
- **refusals:** an integrity mismatch, a non-registry tarball, a tarball too large, one without sha512, and a gzip bomb;
- **retries:** a failed package, and a failed attestation and tarball read. Giving up after 60 capture attempts (a version on its own, and a package with the versions it still retried), and at once for a version removed mid-retry. A damaged `known/` file at give-up does not hold the feed. A missing dependency recorded as a 404;
- **bad input:** a malformed dependency name and a malformed packument, neither of which holds the feed; names like `constructor`;
- **the limit:** stopping at it, and staying stopped after a restart;
- **the predecessor rule;**
- **`created`** for dependencies whose time is not stored;
- **hosts:** a refused host, and the allowed hosts.

## How it is run on the owner's PC

The code is pinned to the merge commit: `git archive <merge sha>` of the files it needs, plus `semver` from the lockfile, extracted under `C:\dev\ludion-shadow-data\app\<sha>`. It runs in Docker:

```text
docker run -d --name ludion-shadow-recorder --restart unless-stopped --read-only --tmpfs /tmp \
  --user 1000:1000 --memory 2g --cpus 1 --cap-drop ALL --security-opt no-new-privileges -e HOME=/tmp \
  -v C:/dev/ludion-shadow-data/app/<sha>:/app:ro -v C:/dev/ludion-shadow-data/data:/data \
  node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 \
  node /app/tools/shadow/src/recorder.ts /data 1900000000 <sha>
```

- **The limit.** 1,900,000,000 bytes for the data directory, so that the whole folder stays under 2 GB with the code beside it.
- **The container.** It has network access, because it reads the registry and OSV. It gets no host environment and no secret.
- **Not added.** No GitHub Actions schedule, no Cloudflare resource and no account.
