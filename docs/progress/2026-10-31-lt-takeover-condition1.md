# 2026-10-31 (LT) — Hijacked versions and condition 1

Definitions: `docs/decisions/2026-10-31-lt-takeover-definitions.md` (02e7c98, pushed before any fetch). Detail, data and scripts: `docs/bench/2026-10-31-lt-takeover/` (README, `lt.json`). An experiment that only reads; no gate or wait changes.

**Malicious (v5's 1,148):**
- **Condition 1 stops 1104 / 1148 (96.17%).** 44 / 1148 (3.83%) are tied by a tag of LO's 8 forms in P's repository now. 0 are unknown.
- **GH Archive:** across the 702 rows whose previous version names a GitHub repository, no `CreateEvent` for V's tag within 24 hours of V's publish. All 49 hours of every window were read (529 files, 32.88 GB, none missing).
- **Of the 44 tags now**, by the tagged commit's date:
  - 20 more than a week before V: 19 tags `vX`/`X` that do not name the package, and 1 form-3 tag (zapier-platform-legacy-scripting-runner 4.0.2, off the default branch);
  - 22 more than a week after V (who pushed the tags, and when, is not public);
  - 2 within a day after: @posthog/siphash 1.1.2 (+7.03 h) and @hyperlook/telemetry-sdk 1.0.19 (+0.74 h).
- **Strengthened** (the tag's commit reachable from the default branch): 39 / 1148 tied.
- **Condition 2** could not be measured on a malicious tarball: none of the 44 is listed in the registry.
- **V's own repository** was read from the registry for only 8 rows (1 GitHub, 7 none). For the other 1,140 it could not be read: they are not listed, and ecosyste.ms's copies carry no `repository`.
- **The same applies to P:** the 83 "P names no repository (ecosyste.ms)" rows are really "not obtained". This changes no stopped or tied count.

**Genuine (192):**
- The tag or provenance commit is reachable from the default branch for 88 / 192 (45.83%).
- **Both prongs with the strengthened condition 1: 83 / 192 (43.23%),** against 163 / 192 (84.90%) with the plain one.
- 83 rows (73 distinct commits) are not ancestors of today's default branch, all `diverged`: next 19, vite 13, react-server-dom-* 8, @sentry/* 8, …. Whether each is a backport was not checked.

**Not stopped by condition 1, by kind (dates are the tagged commits'):**
- a `vX`/`X` tag dated long before V (19);
- a tag naming the package, dated long before V (1);
- a tag whose commit is dated long after V (22). A check made after the tag appeared would tie V; when it appeared is not public;
- 2 tagged commits dated within a day after V.

**Not seen:** an attacker pushing V's tag. **Not measurable:** V naming another repository, and condition 2 on malicious code. The owner decides the gate shape.
