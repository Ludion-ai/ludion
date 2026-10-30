# 2026-10-30 (LO2, LD2) — Is a version tied to a source release, and does the source diff explain its new capabilities?

An experiment that only reads; no product code, gate or wait changed. Definitions: `docs/decisions/2026-10-30-lold2-release-link-definitions.md`, committed and pushed before any fetch (18c7a5d). Detail: `docs/bench/2026-10-30-lold2/README.md`. Data: lane LD's 192 genuine fixes and 11 obtained malicious versions, with LO's releases. Run at 3a9bd45, 12:32:29Z–12:44:12Z, exit 0.

- **LO2, tied to a release: 172 of 192 genuine fixes (89.58%)**: 168 by a tag, 4 by a provenance commit. 20 are not tied.
- **LO2, the tagged commit against the publish time** (168 rows): median −0.04 h, from −98.63 h to +0.53 h. 165 commits were made before the publish. Commit and tagger times can be set by whoever makes them, and the push time of a tag was not measured.
- **LO2, the malicious versions' previous versions:** 2 of 11 name a repository. The field was removed in 0 of 11: the 9 without one had none before either.
- **LD2, files matched by content:** 24 of 192 genuine fixes have a new capability (v1, by path: 51, reproduced). All 15 vite pairs are clean.
- **LD2, unexplained capability: 8 of 192 (4.17%)**; 8 of the 187 comparable (4.28%). 168 have no new capability, 11 are all explained, 5 are not comparable.
  - 3 of the 8 are unexplained only by obfuscation markers of built files.
  - 5 by `fetch`, `WebSocket`, `eval` or a binary.
- **Both prongs (shown): 163 of 192 (84.90%) would pass**; 29 would stop (20 not tied, 8 unexplained, 1 not comparable).
- **Not measured:** the malicious side of LD2. No hijacked version that keeps its `repository` was obtained, so how often such a version has an unexplained capability is unknown.
