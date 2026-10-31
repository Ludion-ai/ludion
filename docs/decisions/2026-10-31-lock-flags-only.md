# 2026-10-31 (LB2a, #215) — An npm lock entry the fix does not plan may differ from the base in its flags only

Committed before the code that follows it, on the brain's answer for #215's B1 (ludion-ops#1, comment 6539200199, item 1: option (a), not (b)). It replaces, for flags only, the PR job's rule that every lock entry a fix neither plans nor adds is exactly as at the base. It changes no gate's criteria and no wait.

**Why.** The review of e9559e4 (PR #215, comment 6538813186, B1) ran npm 12.2.1 the way Ludion writes a candidate, on a project with node-fetch 2.6.1 in `dependencies` and whatwg-url 5.0.0 in `devDependencies`. The fix to node-fetch 2.6.7 requires `whatwg-url ^5.0.0`, so npm drops `"dev": true` from whatwg-url, tr46 and webidl-conversions. Their version, `resolved` and `integrity` do not change. `patch` applies the fix and main's PR job opens its PR; #215's PR job refused it, and because one content problem refuses the whole artifact, it stopped every other fix's PR of that run, on every run. Refusing what main delivers is a narrowing, and one honest fix stopping every PR goes against the goal. Option (b), keeping the refusal and putting the narrowing to the owner, is not taken.

## 1. The rule

In the PR job's check of package-lock.json (deliver.ts, `npmLockProblem`), an install path that the fix neither moves (planned) nor adds, and that the base also has, passes when it is the same as at the base apart from the flags `dev`, `optional`, `devOptional` and `peer`:
- with those four keys left out, the entry must be deep-equal to the base's;
- in the fix, each of the four is absent or `true` (the only values npm writes);
- every other key, `inBundle` included, must be as at the base, as before.

A v2 lock's npm 6 tree carries the same flags; readLock already requires it to say the same as `packages`, so the tree follows the same rule.

The registry comparison that follows (deliver.ts, `npmAgain`) skips such an entry as it skips an unchanged one: its requirements, `os`, `cpu` and `libc` are the base's, not the fix's.

## 2. Why this is light, and what remains open

- The version, `resolved` and `integrity` are the base's, so no new code comes in. What the flags change is whether `npm ci --omit=dev` (and `--omit=optional`, `--omit=peer`) installs the package.
- Main's PR job does not look at flags at all, so this is not worse than main.
- **The hole that remains:** a forged artifact can rewrite flags so that a package that is in the base's lock only for development is installed in production, or a production package is left out of a production install. The code it brings is already in the base's lock. docs/status.md lists this among the checks that are not built.
- **Next (LFLAGS, after #215, not in this lane):** Ludion computes each entry's flags from the candidate lock's graph (by which dependency paths it is reached from the root) and takes a flag change only where it matches; checked against locks npm wrote.

## 3. The fixtures (N1, N2 of the review)

Under packages/cli/test/fixtures/npm-corpus/extra/, written in Docker as the corpus was (docs/bench/2026-10-31-lb2a-npm-corpus):
- **inbundle:** the project `{"dependencies": {"npm": "10.9.2"}}`, written with `--ignore-scripts` by npm 7.10.0, 8.19.4, 9.8.1, 10.8.2 and 11.19.1 in the corpus's images and by npm 12.2.1 in its image, asked for lockfileVersion 2 and 3: 12 locks with `inBundle` entries.
- **node-fetch:** B1's pair, written by npm 12.2.1 at lockfileVersion 2 and 3: the base from the project's package.json, then the fix from the base's lock with node-fetch at 2.6.7, with dependency-patch.ts's npm flags.
- npm 12.2.1's and npm 11.19.1's `npm ls --all --package-lock-only --json` on each, with `--network none`.

**Gates for them:**
- **B1:** for each node-fetch pair, `contentProblem("npm", …)` is null, `lockEntryChanges` is only node-fetch, npm 12.2.1 reports no new counted problem, and `newUnmetRequirements` is empty (npm takes it, Ludion takes it). The same pair with any other change to an unplanned entry, a flag set to a value other than `true`, or a changed `inBundle` is still refused.
- **N1:** every inbundle lock is read by main's reader and by #215's (G1, G3), and `unmetRequirements` with its package.json is empty.

**When a gate fails:** as in docs/decisions/2026-10-31-lock-corpus-against-npm.md, the result is reported as it is; the gate and these definitions are not loosened after seeing it.
