# 2026-10-31 — Same-tag rebuilds of official images are in the first "complete"

**Owner decision, 2026-10-30 23:30 JST** (the owner's words to the owner's Claude chat, among them 「1〜4OK」), recorded by the chat in ludion-ops#1 comment 6525272283, decision 2. The owner's words are quoted in docs/decisions/2026-10-31-counts-instead-of-days.md.

## Decided

1. **Updating to a same-tag rebuild of an official image (a new digest for the same tag) is part of the first "complete".**
2. **This withdraws same-tag image rebuilds from 2026-10-27's list of what remains unsupported** (docs/decisions/2026-10-27-security-update-pivot.md: "Production deployment, host package management, Java, same-tag image rebuilds and complete CVE/EOL coverage remain unsupported and are labeled so.").
3. **Why** (the comment's reason): official images ship fixes to OS packages as same-tag rebuilds, so this one change covers the OS fixes of every official image.

## The chat's plan for building it (same comment, not the owner's words)

Gate 2: the image is a Docker Hub official image, at the tag's current digest. Whether the official images' provenance attestations can be read is looked into, and they are used if they can. Tests for the failing side are added.

Later comments changed this plan. Comment 6531046171, 3 took the evidence from docker-library's official records instead of time, with no wait at the PR stage. Comment 6533365853, 2 then corrected that: the evidence is that each manifest digest of the tag's index is listed in docker-library/meta's builds.json and that its revision matches the GitCommit official-images gives for the tag, both read in a container with no credentials, stopping when they cannot be read or do not match; and the wait stays. The definition of the work that builds it uses those comments.

## When it takes effect

From this record's merge. The work that builds it starts after this record is on main (comment 6529705640, 6). Until docs/decisions/2026-10-31-gate-3-official-image-same-series.md takes effect, gate 3 stays as CLAUDE.md has it (comment 6529705640, 6). CLAUDE.md does not mention same-tag rebuilds; whether its text must change for this is not on the board (不明). docs/status.md says what is built.

## Undo

A later decision of the owner's, with its own record.
