## 2026-10-28 — Rule 1's same-release exception, and backtest v4's definitions

**When it was decided.** The owner set this exception after backtest v3's genuine-fix results and before looking at its malicious results (the owner's task, 2026-10-28 14:53 JST). In the genuine results, rule 1 stopped 29 of the 200 sampled fixes, 14 of them for no other reason. Nearly all were monorepo siblings published seconds after the fix in the same release: next, then `@next/env` 5 to 11 seconds later. Disclosure: v3's malicious run had already been committed (ac4e1bf, 14:50 JST) and summarised in PR #149's description when the task was written. This session read that description (7 of 1,148 versions selected, 1 missed, 156 unknown at 24h) before writing this entry. It has not read v3's per-version malicious results. The exception's terms are the owner's. The details marked "chosen here" were chosen from the rule's purpose, the code and the genuine results.

**The exception.** Rule 1 stops a version that is not in the lockfile and was published at or after T. Such a version is allowed when it belongs to the same release as a target A@x of the change:

- with provenance: A@x and the version both have build provenance, naming the same source repository and the same source commit;
- without provenance: neither has build provenance, and all three hold: the same publisher, the same version number as A@x, and published at most 15 minutes after T.

Chosen here:

- When only one of the two has provenance, or a provenance record names no repository or no commit, the exception does not apply and rule 1 stops the change. The release cannot be compared, and what cannot be judged stops.
- The publisher is the registry's `_npmUser` name. An unknown publisher on either side never matches. The version number is compared as a string. "At most 15 minutes after T" is 0 ≤ publish − T ≤ 15 min.
- The provenance branch has no time limit.
- The commit is the one the provenance statement records for the source: SLSA v1 `buildDefinition.resolvedDependencies[0].digest.gitCommit`, v0.2 `invocation.configSource.digest.sha1`.
- Where it applies: npm in `ludion judge` and `ludion patch`, and pnpm in `ludion judge` (the same registry facts). Not Composer: Packagist's metadata has neither a publisher nor provenance, so Composer keeps rule 1 without the exception.
- Rule 2 is unchanged: an allowed sibling that is a young new dependency still stops the change.
- The wait counts from the newest version in the change, siblings included. The judge already does this ("The wait counts from the newest publish among all changed versions").
- Rule 3: the judgement and the receipt list each allowed version and the branch that allowed it, next to the count of versions at or after T.

What the exception gives up: an attacker who holds the publisher's account and publishes a malicious sibling with the fix's version number within 15 minutes of the fix passes rule 1. The wait and the re-query still apply to it. A sibling built by the same workflow from the same commit is trusted as much as the fix itself.

**Backtest v4.** Backtest v3's definitions (the entry above) apply unchanged, except where noted below. The data is the same: the OSV export (sha256 `8b3170a6…`), with registry packuments, attestations and deps.dev read on the run date. v3's registry cache (read 2026-10-28) is reused, and anything it lacks is read on the run date. Also unchanged: the malicious denominator (the 1,148 versions), the fixes, the genuine sample (the first 200 by hash), scenarios (a) and (b), the gate 2 signals and their sources, the outcomes (missed, unknown, stopped) and the gates.

1. **Resolution** (v3 section 3). Each requirement resolves to the highest non-prerelease version satisfying its range, among the versions that rule 1 with the exception allows. Those are the versions published before T, and those published at or after T that the exception allows against A@x. If there are none, rule 1 stops the update. Chosen here: the backtest looks for allowed versions among those published before T + 24h. That bounds the search for same-commit siblings; the no-provenance branch has its own 15 minutes. Candidates above the highest version published before T are tried from the highest down. Publisher and provenance are read from the registry for both A@x and the candidate.
2. **Unreadable facts.** A candidate the registry no longer lists has no readable publisher or provenance. The exception could still allow it when its version and time meet the no-provenance conditions, or when A@x has provenance. In that case its check is unverified. If the candidate is a malicious V, that fix's selection of V is unknown. Otherwise the tree has an unknown branch, and resolution continues with the next allowed version. An unverified check is never counted as allowed or as stopped.
3. **Judgement time** (v3 section 4). The change is judged at its newest publish + w. The newest publish is the latest of T and the publish times of the allowed versions in A@x's tree. The genuine-fix delay (v3 section 6) uses the same newest publish: added delay = max(0, newest + w − advisory publish).
4. **Both ways in one run.** Every result is computed with the exception and without it (v3's rule, recomputed on the same data), so the exception's effect is shown on the same facts. The result with the exception is the primary one and is used for the gates.
5. **Outputs.** For each side:
   - the gates;
   - stops per signal, counted as the versions (malicious) or updates (genuine) where the signal fires, and those it stops alone;
   - how many the exception allowed something in;
   - how many of those would have been stopped without it.

   On the malicious side, listed one by one: every V the exception allowed, or whose selection it made possible through a tree it unblocked; every V selected by a fix published after V; and every V whose exception check was unverified.

**Amended before backtest v4 ran.** These come from the independent review of #151 (2026-10-28), and each makes the exception stricter:

- **The publisher must be an account.** npm trusted publishing records one shared user, "GitHub Actions" (`npm-oidc-no-reply@github.com`, with `trustedPublisher`), for every package published that way. Such a publisher counts as unknown and never matches. Gate 2's publisher comparison is unchanged.
- **With provenance, the workflow must match too**: the repository, the workflow and the commit. This is what "built by the same workflow from the same commit" above says. A different workflow in the same repository, a `pull_request_target` job say, could otherwise publish from the fix's commit.
- **Without provenance, the 15 minutes also count from the matched target's own publish.** With several targets, T is the latest one. A version published 5 minutes after T is no sibling of a target fixed a month earlier.
- **The provenance statement's subject must name the version and its tarball**: `pkg:npm/<name>@<version>` with the registry's sha512 integrity. Otherwise the lookup fails, which is undecidable. The Sigstore signature, and the repository and commit in its certificate, are still not verified. So the exception rests on the registry's checks at publish time, as gate 2's provenance comparison does.
- **A failed read keeps the receipt's count.** If `ludion patch` cannot read a publisher or provenance, the receipt keeps T and the count, and the cap is undecidable.

Round 2 of the review approved. Its non-blocking findings were handled before the run as follows:

- **More publishers count as no account.** Besides `trustedPublisher`, so does any `npm-oidc-no-reply@` email. So does any name that is not lowercase letters, digits, `.`, `_` and `-` beginning with a letter or digit: uppercase or spaces, for example. Another CI's shared user then fails closed. The few real accounts with other lowercase characters (a leading `_` or `-`, or `!~*'()`) lose the publisher branch too; that also fails closed.
- **`ludion patch`'s targets are the plan's own versions** (name and fixed version). Another added copy of a planned package can neither set T nor anchor a sibling.
- **A v0.2 source URI's ref starts at the first `@` after the host.** A tag such as `@scope/pkg@1.2.3` no longer leaves part of the ref in the repository.

Two limits are kept:

- **A statement that does not name its version makes the whole judgement undecidable**, because the subject check also covers gate 2's comparison of every changed version. That happens with a qualified purl, or a subject formatted another way. On the registry, `next@15.2.3`, `@next/env@15.2.3` and `get-jwks@11.0.2` pass the check.
- **The ref and the triggering event are not compared.** A `pull_request_target` or `workflow_run` run of the same workflow records the base commit while it builds other code. So does a statement whose claims are not bound to its certificate. Comparing `externalParameters.workflow.ref` and the event, or reading the repository and commit from the certificate's extensions, is later hardening.

Backtest v4 uses the exception as amended here.

