# 2026-11-02 — The owner's plan goes into CLAUDE.md where the two differed (LPOLPR)

The owner made the plan 「Ludion 完成の定義：最終決定（11-02）」 policy on 2026-11-02 at 00:44 JST. "plan:N" below always means line N of the plan's own text, whose sha256 is 1e301f80a4b389bdc9623b4db7e912eff8fbfc7d97b2f1495b79f0a3a1b6c5c7; it is never a line number of a copy. The plan's copy in this repository is docs/decisions/2026-11-02-definition-of-complete-final.md (#260, not merged when this was written). That copy leaves out the plan's operational lines, so it does not have this sha256; the lines at its top say where it holds plan:N and which lines it leaves out.

This is a protected change. It takes effect when the PR is merged, under CLAUDE.md's rule for protected PRs and the owner's instruction of 14:53 below. Dates and times are JST.

## The owner's OK

- **2026-11-02 10:35.** The owner was asked for OK or NG on six items, one line each, and answered in one reply that all six were OK. Three of them are about this record:
  - a release in PR mode on 2026-11-30, before complete (2026-12-02), in place of "nothing until complete" of 2026-10-29 (14:45 below gives its condition);
  - the default is auto, and automatic merge opens on 2026-12-02 on the result of C2;
  - v1 does not inspect for obfuscated code or new network or process code, and a publisher change or a new dependency still extends the wait and notifies.
- **2026-11-02 14:45.** The owner answered a set of questions, each with its own answer. Two are about this record:
  - the release in PR mode on 2026-11-30 goes out when CI is green and no protection is broken;
  - OK to the one sentence and to "npm only".
- **2026-11-02 14:46.** The owner loosened (b): whether automatic merge opens on 2026-12-02 is decided by C2's result alone. The four weeks and the 100 judgements are kept: they go on being counted after release, as a record, and are not a condition.
- **2026-11-02 14:53.** The owner told the coordinator (Grok) that this PR and #260 go into main first, and that the coordinator may merge them. This PR is protected; the owner's word covers these two PRs only. The conditions stay: an APPROVE on the head SHA from a separate review session, nothing other than an APPROVE after it, CI green, `protected-paths` passing, mergeable clean, a squash merge with the SHA fixed. No sentence of CLAUDE.md on who merges changes.
- **The brain, 2026-11-02 14:56.** "No protection is broken" is made measurable: every row of C6's table passes, and no blocking safety finding is open. Its wording is the sentence of :11; "a safety finding" there means a blocking one. It replaces the brain's earlier advice to wait until the code is frozen, because the owner decided otherwise.
- **The rest.** The brain's answer of 2026-11-02 09:50 says the merge is the OK of gate 3's comparison (:31) and of (a) (:34). It asks for the sentences on the oldest version, the stop file, the revert and Dependabot to go in this PR, and says the brain tells the owner in one line of the tightening of the stop file and the revert.

## The two sentences that narrow what Ludion does

CLAUDE.md's Scope rule asks for the owner's OK on one sentence, and says an OK to a list does not approve a scope change inside it. The 10:35 reply was one reply to a list, so this record does not count it as settling them.

1. **Ludion v1 no longer looks for obfuscated code or new network or process code in a package; a publisher change or a new dependency still extends the wait and notifies.**
2. **Ludion v1 does not fix official PHP or Node.js images or Composer; their code and tests stay.**

The record of the 14:45 answer names "the sentence on what is defended" and "npm only". This lane reads that sentence as the first above, which had been put to the owner word for word in one question with "npm only". The brain's note of 14:56 reads it as the sentence on scope, the second above. Both are in this PR, so neither reading leaves one out. The second spells out what "npm only" leaves out, from plan:59. Maven is already out (docs/decisions/2026-11-01-definition-of-complete.md).

This lane read the record of the answer, not the question as the owner saw it. So whether the second was shown word for word is not known here.

## What CLAUDE.md says now

Line numbers are CLAUDE.md's, which keeps its 66 lines, so references to other lines stay right.

| CLAUDE.md | Sentence | From |
|---|---|---|
| :11 | One release in PR mode from 2026-11-30, when CI is green, every row of the rule-to-check table (C6) passes and no safety finding is open | The owner's first line and 14:45; the brain's wording of 14:56; plan:7, plan:34, plan:249 |
| :11 | It covers npm only; v1 does not fix official PHP or Node.js images or Composer | The owner, 14:45; plan:59 |
| :11, :34 | Automatic merge needs (a); given (a), C2's result alone decides whether it opens; the four weeks and 100 judgements are a record, not a condition | The owner, 14:46; plan:102 to plan:107; below |
| :27 | However Ludion fails, exposure is no longer than without it; the Dependabot sentence | The brain's answer; below |
| :30 | Publisher change or new dependencies extend the wait and notify; v1 does not inspect the code | The owner's third line above and 14:45; plan:196, plan:235 |
| :31 | Old is the spec: build, types, every GET page compared | plan:123 |
| :33 | The oldest version is chosen by publish time | plan:65, and the brain's answer on the next measurement |
| :33 | Apply setting: auto or pr, default auto; opens from 2026-12-02 on C2's result; until then a fix stops at a PR | The owner's second line above; plan:142, plan:199, plan:250 |
| :34 | (a) counts per attack, k always written, k=0 passes | plan:91, plan:104; below |
| :34 | "Passed" comes with n and the 95% upper bound | The brain's answer. 1 − 0.05^(1/2) = 0.7764 |
| :34 | The stop file and the revert | The brain's answer; below |

Plan:123 has more than CLAUDE.md can hold: old is run twice to remove noise, the clock is stopped, a screenshot is second to the DOM, and tests, if any, run as well. Plan:126 gives the limit: only GET pages are seen, not API routes, Server Actions or dynamic routes, and the receipt says so.

**Removed, to stay under the 14,000 bytes.** CLAUDE.md is 13,999 bytes; the limit is not raised, and the next sentence needs another one taken out or a change to the limit.

| Line | Removed | Why it can go |
|---|---|---|
| :9 | "docs/status.md says what is built today and what is missing." | :23 says it |
| :9 | "(its roadmap puts a judge of other tools' PRs first)" | docs/status.md, Waiting for the owner, item 4, says it |
| :11 | "Automatic merge also needs (a) and (b) under Product." | :34 says it |
| :11 | "; docs/status.md keeps the working list of what is missing" | :23 says it |
| :34 | "Release: none until complete (Goal; docs/decisions/2026-10-29-security-agent-no-release-until-complete.md)." | :11 says it, and docs/status.md, Release, keeps the link |
| :34 | What the shadow's four weeks count: "with zero misses on versions that received a MAL- record" | docs/decisions/2026-10-29-shadow-counting.md, which :34 names, says it |

**Kept word for word:** the sentence of :11 that says nothing is released, since docs/mistakes/2026-10-29-the-cut-redefined-ludion.md quotes it and tools/records/test/records.test.ts fails when a quoted sentence goes. The exception follows it.

**Kept though a shorter file was suggested:** Maven's clause of :54. `ludion scan` still resolves a Maven graph in a manifest-only container (docs/status.md, "Maven is read-only"), so that limit still applies.

## The release in PR mode

"From" replaces "on": the release needs the three things of :11, and it waits for them if they are not there on 2026-11-30. Freezing the code by 2026-11-28 (plan:243) is not among them. C6's table does not exist yet (docs/status.md, under the Safety table), so its condition cannot be met until it does.

## C2 and (b)

C2 is plan:102 to plan:107. The unit is the attack, with k always written and k=0 passing (plan:104). The window ends on 2026-11-26 at 00:51 and the result is on 2026-12-02 at 00:51 (plan:105). If there is a miss, automatic merge does not open, and whether it opens later is the owner's (plan:106).

**(a) stays.** Neither decision names it, and plan:89 to plan:91 keep it as a stopping condition. So "C2's result alone" is written "given (a)". docs/status.md, Release, says (a) is not shown met.

**How (b)'s count is made does not change.** tools/shadow and docs/decisions/2026-10-29-shadow-counting.md stay as they are. That record calls the count "condition (b)"; read with this one, it is a record and not a condition.

## The oldest version

"Oldest" is decided by publish time, not by version number. This is all of plan:65 that goes in here. Its condition that the version has no advisory, deprecation or withdrawal does not: the brain's answer has the next measurement compare with "no worse than today" and add taking V up by main's next-fix rule. Deprecation and withdrawal stay stops in gate 2 (:30).

## Where this tightens the plan

These sentences of the plan no longer hold.

| Plan | It said | Now | Why |
|---|---|---|---|
| plan:146 | The stop file is written by the owner, and by automation with evidence | The owner only; automation only notifies | If the one who makes the evidence also shows it, it is not evidence (plan:42, forgeable evidence) |
| plan:142 | Read the stop file before merging, with nothing on a failed read | A file that cannot be read holds automatic merge, and the PR waits for the next run | The cost is one run's delay; going on when it cannot be read means the stop does not work |
| plan:144 | A failed production crawl, like the deployment status and main's check, leads to an automatic revert | Only the deployment status and main's check. A failed crawl notifies and stops that repository's automatic merge | Anyone can knock a crawl over with load from outside; as a trigger, that would put a vulnerable version back |
| plan:173, plan:182 | Make the Dependabot PR a draft, write that it is held, and close it | Ludion does not touch it. Ludion's own PR for the same advisory links it in one line | However Ludion fails, exposure is no longer than without it: a closed Dependabot PR plus a failed Ludion is longer |

The second tier's workflow only takes the signal and starts discovery, and has no `pull-requests` permission. This PR makes no workflow; it is the sentence the workflow's lane starts from. Plan:173 and plan:182 say the same thing (one in the text, one in its table of risks), so they go together.

docs/status.md lists the three checks for C6's table, `stop-file-owner-only`, `stop-file-unreadable-holds` and `crawl-failure-does-not-revert`. None is written yet, and neither is the table.

## Not changed

- CLAUDE.md:45, and every sentence on who merges.
- The wait table and any gate's numeric criteria.
- **How a day with no recording is counted.** On 2026-11-02 at 14:45 the owner decided that it extends the period and counts as a gap, as plan:107 says, through its own protected PR. That PR comes after this one, since one protected PR is open at a time. Until it is merged, docs/decisions/2026-10-29-shadow-counting.md, section 2, still counts as it does.
- **What "k=0 passes" settles.** Plan:104 says it of C2, the shadow; the brain's line sets it on (a). In the backtests, plan:91 has k above zero today (2 stopped, 1 unknown). k=0 gives no evidence about the miss rate, which is why k is always written and "passed" comes with n and its upper bound.
- The code. docs/status.md lists what these sentences say that the code does not do yet.
