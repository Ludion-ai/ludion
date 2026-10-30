# 2026-10-30 — A next smallest fix from another publisher or source stops

**Owner decision, 2026-10-30 13:01 JST**, to the owner's Claude chat, in the owner's words 「推奨で行く」 (taking the recommendation): when `ludion patch` takes the next smallest fixed version instead of the smallest (next-fix.ts, since #209), and that version's publisher or source differs from the smallest it passed over, the fix stops.

## Why

The next smallest fix passes over a smallest fixed version that is deprecated, no longer listed, or named by an OSV record. Deprecating and unpublishing are in the publisher's hands. Someone who takes over an npm account can deprecate the legitimate fix and publish a later version of their own, and `ludion patch` would then be steered to it (the cloud review of #209, https://github.com/Ludion-ai/ludion/pull/209#issuecomment-6513625855, finding 3). The version taken still faces the time cap, the judge's gate 2 checks, a wait from its own publish time, the OSV re-scan and the tests, but none of these compares it with the release it replaced.

## Decided

This adds a stop to gate 2, on `ludion patch` for npm only, when a version other than the smallest fixed version is taken. Nothing else changes: no gate's numbers, no row of the wait table, and not the case where the smallest is used.

1. **What is compared.** The smallest fixed version that was passed over, and the version that would be taken instead, each as the npm registry gives it (the same `registryFacts` read the judge uses: the manifest's `_npmUser`, and the provenance statement from the registry's attestation record, which must name that version and its tarball hash).
2. **How**, in the same terms as the judge's same-release exception (judge.ts `releaseIdentity`, time-cap.ts `sameRelease`):
   - Both have provenance: go on when both name a repository and a workflow, and the repository and the workflow are the same. The commit is not compared: two releases come from two commits. Otherwise stop.
   - Neither has provenance: go on when both name a publisher account and it is the same. Trusted publishing's shared user (npm-facts.ts `sharedPublisher`) is no account and never matches. Otherwise stop.
   - Anything else stops, because what cannot be judged stops (CLAUDE.md, Product): provenance on one side only, a smallest the registry no longer lists (the registry keeps no manifest for it, so there is nothing to compare), a provenance statement that cannot be read or does not name its version and tarball, and a lookup that fails.
3. **What stops.** That fix only: it is not validated, gets no branch, and fails, and the run's other fixes go on. The smallest is not used instead, since it was passed over because it cannot be used. The fix's `reason` and its receipt entry `version_choice` say what was compared (repository and workflow, or publisher, of each side) and the result. When the check lets the version through, `version_choice` records that too.
4. **What it does not cover.** A takeover that publishes from the same account, or through the same repository and workflow, passes this check, as before; it is caught only by the wait and the re-query (CLAUDE.md, Product). Composer and Maven do not take a next smallest fix, so they are unchanged.

## Undo

A later decision of the owner's, with its own record. Removing the stop again restores #209's behaviour, where an account that can deprecate the fix can steer the patch to its own version.
