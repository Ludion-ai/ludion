# 2026-10-29 (LS) — The shadow's recorder: built and tested, not the replay

docs/bench/2026-10-29-shadow-recorder.
- **Built.** `tools/shadow/src/recorder.ts` follows npm's replication feed. For the 7,660 watched names it captures:
  - `time`;
  - manifests without e-mail addresses;
  - attestations;
  - tarball file lists (the tarball is not kept);
  - predecessors, and `created` for dependencies whose first publish time is not stored.

  It also stores OSV's new MAL- records daily, and stops at a storage limit.
- **Tests.** 32, in Docker without network (logs/check.log). Four deliberate mutations were each caught.
- **Not built.** The replay that judges captured versions, so there is no result for condition (b) yet. Production placement is the owner's choice.
