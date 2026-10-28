# The shadow's recorder (2026-10-29, LS)

The recorder from docs/bench/2026-10-28-shadow-design/README.md, sections 2.1 to 2.4. It records; it judges nothing. The replay (sections 2.5 to 2.7) is not built. How condition (b) will be counted is fixed in docs/decisions/2026-10-29-shadow-counting.md, before any recording. This is a source preview tool, not a production service: **where the shadow runs in production is the owner's choice (design, section 6) and is not made here.**

## What it does

`tools/shadow/src/recorder.ts`, every minute:
- **Follows the feed.** It reads `https://replicate.npmjs.com/registry/_changes` from its stored position to the end. On its first run it only takes the feed's current position: nothing before the start is read.
- **Captures each watched package that changed.** For each change in the frozen watched list (`tools/shadow/watched.json`), it reads the packument and stores:
  - on a name's first change: the full `time` map and `dist-tags`. Also the manifest and attestations of every version the watched lockfiles hold for that name, and of each dist-tag's version;
  - for each version new since the last capture: its manifest and attestations, and the file list of its registry tarball (path, size, sha256), checked against `dist.integrity`;
  - also, for each new version: its registry predecessor (the latest-published version lower by semver), and the first publish time of each dependency outside the watched set (rule 2's `created`);
  - afterwards: new or changed `time` entries, `dist-tags` changes, and the removal and deprecation of every stored version.
- **Reads OSV once per UTC day.** It reads OSV's npm `modified_id.csv` and stores every MAL- record modified since the last read, watched or not. The first read only sets the position.
- **Writes a status line per poll**: the feed position, entries read, watched changes, names pending a retry, and bytes used.

What is never stored:
- the tarball itself. It is read into memory, checked against its integrity and hashed, never extracted to disk, never run;
- e-mail addresses. Every `email` key is dropped, and addresses inside strings are replaced. The publisher check the judge makes from `_npmUser.email` (`sharedPublisher`) is computed first and stored as a boolean.

Attestation bundles are stored as served (Sigstore bundles, public).

**What leaves the machine:**
- package names and versions, in registry URLs;
- the feed position;
- OSV record ids.

The recorder refuses any host other than registry.npmjs.org, replicate.npmjs.com, api.osv.dev and osv-vulnerabilities.storage.googleapis.com, and follows no redirects.

**Failures.**
- A package whose read fails is kept in `pending` and retried on the next poll. The feed position still moves on.
- A failed poll or OSV read is a status line. The next poll retries.
- **The storage limit.** Before each write the recorder checks the data directory's size. When the next line would pass the limit, it writes one `stopped` line and records nothing more. The process stays up, idle, so a restart policy does not start it again.

## Data layout

Under the data directory:
- `state.json`: the feed position, the OSV position and day, the pending names, and `stopped`;
- `captures/<UTC day>.jsonl`: `baseline`, `change`, `version`, `deprecation`, `created` and `gone` records;
- `osv/<UTC day>.jsonl`: MAL- records;
- `status/<UTC day>.jsonl`: `start`, `feed_start`, `poll`, `osv`, `error` and `stopped` lines;
- `known/`: per-name state, used to tell what is new.

## The watched list

`tools/shadow/watched.json` was made by `node tools/shadow/src/watched.ts <sha>`, run in Docker (node:24-slim, user 1000, read-only root) on 2026-10-28T14:53:51.608Z.
- **Inputs.** This repository's root lockfile at b4d5fcb, plus the 100 noise lockfiles at their recorded SHAs, read with the judge's `lockEntries`. Ludion-ai/ludion-sandbox was still empty (GitHub: "Git Repository is empty.").
- **Result.** 101 sources, 7,660 names, 17,673 name@versions. That is the same as the design's measurement.
- **Its sha256:** `02d3e6de2cc5e4d05af15d60bb6f9ca7ac17ebd261b652c77a9ce23281674f6a`. The recorder writes it into its start line.

## Tests

`tools/shadow/test/recorder.test.ts` has 17 tests, run in Docker with no network. They cover:
- e-mail removal;
- OSV positions;
- the watched list;
- the start position;
- first-sight and new-version captures;
- the integrity mismatch and non-registry tarball refusals;
- removal and deprecation;
- retrying a failed name;
- restart from the stored position;
- names like `constructor`;
- stopping at the limit;
- the predecessor rule;
- `created` for dependencies outside the watched set;
- the allowed hosts.

Three deliberate mutations were each caught by a failing test: e-mail scrubbing, the limit check and the integrity check.

## How it is run on the owner's PC

The code is pinned to the merge commit: `git archive <merge sha>` of the files it needs, plus `semver` from the lockfile, extracted under `C:\dev\ludion-shadow-data\app\<sha>`. It runs in Docker:

```text
docker run -d --name ludion-shadow-recorder --restart unless-stopped --read-only --tmpfs /tmp \
  --user 1000:1000 --memory 2g --cpus 1 --cap-drop ALL --security-opt no-new-privileges -e HOME=/tmp \
  -v C:/dev/ludion-shadow-data/app/<sha>:/app:ro -v C:/dev/ludion-shadow-data/data:/data \
  node:24-slim node /app/tools/shadow/src/recorder.ts /data 1900000000 <sha>
```

- **The limit.** 1,900,000,000 bytes for the data directory, so that the whole folder stays under 2 GB with the code beside it.
- **The container.** It has network access, because it reads the registry and OSV. It gets no host environment and no secret.
- **Not added.** No GitHub Actions schedule, no Cloudflare resource and no account.
