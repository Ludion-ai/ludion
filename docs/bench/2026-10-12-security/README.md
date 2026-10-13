# Security inspection and fixes — 2026-10-12

Continuation of PR #67 on top of `9770f0ed53a595538c818ba29d4dff55fc349262`. These are implementation/security checks, not another FreshBench or evidence of increased product accuracy.

## Reproductions and fixes

- Remote rendered `claim`, teacher/model/check labels, and malformed ledger JSON could bypass the teaching guards. Sync now reconstructs and validates structured format-1 lessons, recovers only the legacy generated detail slot, checks its grounding, and regenerates the claim. Corrupt ledger entries are skipped. Canonical HTTPS PR links exclude credentials, query/fragment text, encoded path decorations and Unicode role-shaped payloads. This is structural input validation, not proof that every well-formed claim is true or harmless.
- Private ledger lessons could enter default Git staging through generated lessons/Cursor files. Before writing private content, sync refuses tracked generated paths (case-insensitive literal matching, including Windows), installs local ignore entries, and verifies Git honors them. It does not untrack files, rewrite Git history, or remove previously disclosed content. Git fsmonitor is disabled for the index checks.
- MCP bodies were passed to the SDK without an application byte cap. Count real streamed bytes before parsing, reject over 64 KiB with 413, and cancel excess input, including absent or dishonest Content-Length. Index JSON gets an actual-byte cap of 4 MiB per response. This bounds each input; it is not volumetric DDoS protection.
- Ledger saves validate before choosing the filename, cap serialized entries at 256 KiB, write an exclusive temporary file and rename atomically. New POSIX ledger directories/files request 0700/0600. Windows access follows existing ACLs. Oversized, nonregular and invalid entries are ignored on reads.
- Docker now drops all capabilities and prevents privilege gain in both package installation and lesson execution. Plain runs also use the host UID/GID where available. On Windows that UID/GID facility is absent; do not claim universal non-root execution. Existing network-off/read-only/resource caps remain. Own harmless CI probes exercise Node/Python with and without packages and require EROFS specifically for root writes. No arbitrary lesson code ran on the host. Docker is unavailable on this local PC; the execution evidence must come from the Linux CI run.
- `constructor` subjects no longer collide with prototype membership or shard buckets.

## Dependency audit

`audit-before.json` reports 7 High dependency alerts from two advisory families, not seven independent exploits:

- [MCP OAuth credential disclosure](https://github.com/advisories/GHSA-6qxp-vccf-f47h): the current public Worker serves MCP and does not configure an OAuth client/auth provider. No observed credential disclosure is claimed. Resolve client 2.2.0 and SDK 1.31.0 explicitly, including overrides for agents' older pinned peers.
- [sharp/librsvg crafted SVG](https://github.com/advisories/GHSA-wq5f-xc86-pv6w): conditional image-decoding risk in the development/build dependency tree; the Worker has no public image-upload path. Updating Wrangler and the Worker test plugin resolves sharp 0.35.5. Keep agents 0.27.0 rather than the downgrade proposed by audit force-fix.

A fresh `npm ci --ignore-scripts` succeeded and reported zero vulnerabilities. `audit-after.json` and `dependency-tree.log` independently confirm the patched tree. Audit zero means no advisory known to that registry at this check, not a security certification.

## Acceptance evidence

- Typecheck and build succeeded. `test.log`: 24 files, 434 tests passed, including streaming input, malformed metadata, Unicode links, case-variant Git privacy and ledger-save regressions.
- `e2e.log`: Chromium 6 passed, 1 optional screenshot test skipped.
- `tarball-smoke.log`: extracted unpublished CLI build passes help, online sync, evidence-scope output and guarded localhost source-check refusal on exact Node 22.19.0. Its metadata remains 0.1.2; npm's existing artifact has not been replaced.
- `live-sync.json`: read-only public manifest/shards at the recorded time, all 30 current format-1 lessons pass the stricter reader and sync into an isolated scratch project; public responses' SHA-256 and byte counts are recorded. The then-public manifest has no retirement metadata. This verifies compatibility with existing public data, not deployment of the fixes.
- Independent supplemental Codex review found two concrete blockers (case-sensitive Git pathspec and Unicode PR-link fragment); both were fixed with regression cases. Its later PASS is supplemental only. Its smoke verification observation was resolved by requiring EROFS.

## Boundaries and improvement priorities

Required Opus review remains BLOCKED by the already-recorded account usage limit; no extra paid account or model benchmark was used. PR stays draft until that review and the owner's merge. CI and a subsequent release/deployment must be tied to their source commit; local success alone is not production proof.

The most important remaining uncertainty is real coding value rather than how many lessons can be generated. Historical C task results in `docs/bench/2026-10-11-done3/README.md` cover 16 of 36 tasks (13/16 without vs 15/16 with); grading checks emitted files without executing them. Before expanding supply, define own harmless task acceptance checks that distinguish correct/stale implementations and run dependency-appropriate tests inside the existing sandbox. Respect the current spending pause.

Then measure pipeline yield with reviewed meaning (kind/range/silent), and join public build identity to source SHA. Avoid introducing a PostToolUse hook or another delivery layer before showing delivery is the bottleneck: the historical unrelated-context experiment found no large accuracy drop in one trial, while its recorded cost increased. These are recommendations, not additional implemented features or fresh model measurements.
