# 2026-10-28 (cycle 3, LS) — Shadow operation: designed and estimated, not built

Moved here unchanged from docs/progress.md, under the one-record-per-file rule (2026-10-29). First committed in 3993a29 (2026-10-28 22:57:52 JST), with a wording change in 4f71953.

docs/bench/2026-10-28-shadow-design. The release conditions were fixed first (cdea65e, 22:49:56 JST). One measurement of public data ran in Docker (13:52:36Z–13:53:38Z).
- **Watched set.** 101 lockfiles (dogfood and the 100 noise repositories) hold 7,660 distinct names. Ludion-ai/ludion-sandbox is empty.
- **Rate.** 0.1264 new versions per name per day in a sample of 300 names: about 968 a day, about 15.3 MB of version metadata a day (`time` maps not sized).
- **MAL- cases.** No MAL- record named a watched name in the last 28 days. Only 134 of the last 365 four-week windows held one, so (b)'s miss half will most likely be met with no case.
- **Where it runs.** Options A (Actions, $0, public), B (Worker and R2, Workers Paid $5/month minimum) and C (both) are left to the owner. Nothing is built or scheduled.
