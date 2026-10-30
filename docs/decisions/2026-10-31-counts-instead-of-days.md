# 2026-10-31 — "Complete" and automatic merge are counted in events, not days

**Owner decision, 2026-10-30 23:30 JST** (the owner's words to the owner's Claude chat), recorded by the chat in ludion-ops#1 comment 6525272283, decision 1. The comment, written by the chat, lists the four decisions. The owner's words, to the chat directly at 23:30 JST, were: 「件数にするべきだ」「今からやっていくものは基本第一原理思考で疑え。そして、数学を用いるんだ」「固定時間で安全関門を作ろうとした、いや違う。そんなのでは例外が出たら終わるし、何より合理的ではない。アルゴリズムの方がよっぽど良かったやろ」「あえて第一原理思考を一旦通して一般論をなくせる時はなくす。かといって、全てを逆張りするのも良くないけどね」「1〜4OK」.

Decisions 2 to 4 of the same comment are docs/decisions/2026-10-31-same-tag-rebuilds-in-scope.md, docs/decisions/2026-10-31-gate-3-official-image-same-series.md (a proposal waiting for the owner's OK on its scope sentence) and docs/decisions/2026-10-31-share-protected-without-a-person.md.

## Decided

1. **Conditions are a number of events, not a number of days.** The two-week trial (「2週間の試用」; presumably docs/design.md's five users for two weeks, ロードマップと検証ゲート) and the "four consecutive weeks" of automatic merge's condition (b) (CLAUDE.md, Product) are both replaced by counts.
2. **Why** (the comment's reason): time stood in for the number of events. Events can be gathered faster by laying out test samples side by side, running them in parallel, watching a wider range, or replaying the past.
3. **How a count is set** (the comment's "件数の決め方（数学）", written by the chat; the owner asked for counts set by mathematics). Every condition takes the form "a rate p is at most p0, at 95% confidence".
   - With 0 failures, the count needed is n = ⌈ln 0.05 / ln(1 − p0)⌉ (about 3 / p0): 299 for p0 = 1%, 59 for p0 = 5%.
   - With k failures, the Clopper–Pearson upper bound must be at most p0.
   - To measure a share, n = z² · p(1 − p) / e². With p unknown, p = 0.5; for e = ±10% (95%), 97.
   - The samples must be independent. Many samples from one project or one package add no evidence, so the definition caps the samples per project and per package. The unit of independence is docs/decisions/2026-10-31-independent-unit-of-counts.md.

## Proposed, not fixed here

The comment gives the chat's proposal for the rows, to be fixed in a definition PR before counting starts. The comment says the owner may change p0 in the morning (2026-10-31), and that a way of counting, if changed, is changed before counting.

| Rate | p0 | Count needed with 0 failures | How gathered |
|---|---|---|---|
| A fix applied breaks the build, the tests or startup | 1% | 299 | One public sample repository, with samples pinned to old versions laid out in a workflow matrix. 20 or more projects, at most 15 from one |
| A malicious version from a takeover passes the new gates | 1% | 299 | The takeover-shaped ones of the 1,148 past cases (docs/bench/2026-10-30-delta-v1); if too few, added from forward records |
| Replacing condition (b): the shadow misses a version that received a malicious (MAL-) record | 1% | 299 | Widen the watched names. The definition is a new version of docs/decisions/2026-10-29-shadow-counting.md, fixed before counting |
| The share protected without a person (decision 4) | ±10% | 97 repositories | The same public repositories as LR's sample (Dockerfiles on the official php or node images; not on main) |
| Lateness of the scheduled run | quantiles | 200 runs or more | Run side by side at short intervals in the sample repository |

docs/decisions/2026-10-31-independent-unit-of-counts.md later changes two of these rows: the malicious-version row promises no p0, and the breakage row takes 1 to 3 from a project.

## When it takes effect

- Without effect until CLAUDE.md's release line (line 34 at main 47a21a9) is changed; where this record and CLAUDE.md disagree, CLAUDE.md wins (comment 6531046171, 1). CLAUDE.md's Product still says "four consecutive weeks" for condition (b). Whether its "at least 100 decided judgements" stays is not on the board (不明). Changing it, together with docs/status.md, is a protected PR (LC0) that the owner merges (comment 6528291928, 2; comment 6529705640, 7).
- Each row's definition is fixed in a definition PR before its counting starts.

## Undo

A later decision of the owner's, with its own record.
