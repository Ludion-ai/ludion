## 2026-10-28 — Moving dependencies are capped at the fix's publish time

The rerun did not meet the malicious gate (docs/bench/2026-10-28-backtest-rerun). The owner keeps the wait table and changes how the dependencies that move with a fix are chosen instead. Three rules, for npm first and then Composer and pnpm:

**Rule 1: nothing in the change may be newer than the fix.** T is the publish time of the fixed version A@x; when one change fixes several packages, the latest of their publish times. A change that fixes no advisory takes the project's changed direct dependencies as its targets. Every other version the change installs must either already be in the current lockfile (the same name and version anywhere in it) or have been published strictly before T. A version published at or after T stops the change. An unknown T, no target, or a version with no publish time makes it undecidable.

- npm, first as a check on the lockfile diff after the fact: in `ludion judge`, and on the candidate lockfile in `ludion patch`. Preferring the locked version when it satisfies the range is left to npm, whose lockfile-only install keeps such versions; the check enforces the cap. Publish times come from the registry.
- Composer: the candidate `composer.lock` against the baseline in `ludion patch`, with release times from Packagist's metadata (`https://repo.packagist.org/p2/<name>.json`). Limit: Packagist's `time` is the release's commit or tag date, which the author sets, not a registry publish time. A backdated release is not caught by this rule.
- pnpm: Ludion has no pnpm fix path. `ludion judge` reads a `pnpm-lock.yaml` change as the name@version set it adds and applies rules 1–3 and the registry checks. Gate 4 and the per-path resolution diff are not implemented for pnpm, so a pnpm judgement is at best undecidable, never ready.

**Rule 2: a young new dependency stops.** The dependencies are the names a changed version declares that the version it replaces did not, plus packages new to the lockfile. For each, its package's first publish is read: npm `time.created`, Composer the earliest release time. The change stops when that first publish is later than T minus the base wait of the change's urgency (the table's wait before any extension). An unknown first publish makes the change undecidable. Older new dependencies still extend the wait as before. `ludion patch` computes no urgency for Composer, so it uses the longest wait, 168h.

First publish is the earliest of `time.created` and every version's publish time. An unpublished and re-created package gets a new `created` while its old versions keep their times (found while writing backtest v3, before it ran).

**Rule 3: the judgement always shows the count.** The comment always shows T and the number of versions published at or after T, including when it is 0. The `ludion patch` receipt records the same.

