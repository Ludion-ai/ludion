# 2026-10-29 — EPSS scores are downloaded whole; no CVE ID is sent

**Owner decision, 2026-10-29 about 20:55 JST**, to the owner's Claude chat, choosing 「一覧を丸ごと取る」 for "Waiting for the owner" 4 in docs/status.md.

## Why

To rate how likely a vulnerability is to be exploited, `ludion judge` sends the CVE IDs of the advisories it found to FIRST's EPSS API (an EPSS of 0.1 or more makes the urgency high, a 24-hour wait instead of 72). The CVE IDs tell FIRST which vulnerabilities the project being judged may have. CLAUDE.md's rule was that only package names and versions are sent.

## Decided

1. **EPSS:** Ludion downloads FIRST's whole daily list of scores and looks the CVE IDs up locally, as it already does with CISA's catalog of exploited vulnerabilities. No CVE ID is sent.
2. **OSV:** the lookup of an advisory by its ID stays. The IDs are the ones OSV itself returned for the package names and versions, so sending them back tells OSV nothing new.
3. **The rule.** CLAUDE.md's rule on what is sent says this: package names and versions to OSV and the official registries, the IDs of the advisories OSV returned back to OSV, and whole lists downloaded instead of CVE IDs sent.
4. **Not built yet.** Until the download is built, `ludion judge` still sends CVE IDs to the EPSS API, and docs/status.md says so. The urgency rule (0.1 or more is high) does not change.
