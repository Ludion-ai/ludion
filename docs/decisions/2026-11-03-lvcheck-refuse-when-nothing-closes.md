# 2026-11-03 — The PR job refuses an npm fix that closes no live advisory, or whose receipt names one it does not close (LVCHECK, first step)

Decided on 2026-11-03 at 15:54 JST, and committed before the code that does it. The wait table and every gate's numeric criteria are not changed. Composer, Maven and the official images are not touched.

## Why, and why before 2026-11-30

The PR job treats the validation job's artifact as untrusted (CLAUDE.md, "A job that runs candidate code has no write permission and no secrets"). On main it takes the fix's package, V and advisory IDs from the receipt and checks their form, not their values. docs/decisions/2026-11-03-oldest-resolution-in-product.md, section 5, left this to a separate piece of work: a receipt that names a sibling as the fix leaves `recheckOldest` nothing to read, and the judge has no term for whether a change is a fix at all.

So an artifact forged by an escape from the validation job could open a PR in Ludion's name saying "Fixes GHSA-…" over a version the judge does not stop. In PR mode the stop is a person, and what that person reads is that line. So this comes before the release in PR mode, not only before automatic merge.

## What the PR job does now

In `recheckOldest` (packages/cli/src/security/oldest.ts), for each npm fix, before anything else it decides:

1. **`closed`.** For each change, from OSV and not from the receipt: the advisories on the version moved from, not on the version moved to, not marked withdrawn. This is the reading it already did, moved ahead of its early return.
2. **Nothing closed: refused.** If no change in the fix closes a live advisory, the fix is refused with a reason. No branch is pushed and no PR is opened.
3. **A name not closed: refused.** If the receipt lists, on a change, an advisory that change does not close, the fix is refused with a reason.

The reasons are constants in oldest.ts. A read that fails refuses the fix, as every read in this check does. Only names and versions, and back to OSV the IDs it returned, are sent, and no package's code is run.

**The two lines people read.** The PR's Advisories row and the commit's "Fixes …" line (deliver.ts) are written from the receipt's list. The PR job pushes the commit as the validation job made it, so it cannot rewrite that message, and a body that differed from the commit would be a second story. So a name that is not closed refuses the fix rather than being dropped. With item 3, every ID in those two lines is one `closed` holds. An advisory `closed` holds and the receipt does not name is not added.

**A real fix is not refused by this.** `ludion patch` plans a change's advisories from OSV's records on the version moved from, leaving out withdrawn ones, and stops a fix when anything is left on its package after the re-scan. So its receipt's list is inside `closed`, unless OSV changes between the two jobs; then the fix is refused, and the next run decides again.

## What this does not do

- **That V is the smallest fixed version.** A forged artifact can still name a later V, in range of a real advisory. That is the next step of LVCHECK, and it is not here. This step holds only that the fix closes something, and that its text says only what it closes.
- **Each change.** One change that closes a live advisory is enough for the fix to go on; another change of the same package that closes nothing is not refused, as long as its receipt names nothing for it.
- **`ludion patch`.** It plans from OSV already, and is not changed.
- **`ludion judge`,** on an existing update such as a Dependabot PR, is not changed.
- **Whether a live advisory applies to the project** (gate 1's conditions). This reads OSV's records on the versions, as the plan does.
