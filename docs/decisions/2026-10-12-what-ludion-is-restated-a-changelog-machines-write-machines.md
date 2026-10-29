### 2026-10-12: What Ludion is, restated: a changelog machines write, machines verify, and prune per model

- **Ludion is a changelog that machines write, machines verify, and prune per model. People sign and correct it.** CLAUDE.md's rules don't change; what changes is what gets built next and how lessons are supplied.
- **Why** (`docs/bench/2026-10-11-done3/`): Done 3's +27 points came entirely from changes a seed covers (16/30 → 28/30); changes with no seed didn't move (8/15 → 8/15). Both conditions had web search. So coverage is the only thing that moved the score. Delivery to the installed version works; scarcity of the information isn't what made it valuable.
- **No teachers yet**: every lesson so far is an agent draft. The supply has to come from a machine; people sign (the PR) and correct (`teach`, `replaces`).
- **The seed criterion changes.** It was "changes measured models get wrong × silent". It is now: **verify every change in a release's changelog and teach it**, `default`, `behavior`, `deprecated` and `renamed` first, `added` last. FreshBench is no longer the gate that decides whether a change gets a lesson; it supplies the `models` labels that `sync` prunes with.
- What this replaces: CLAUDE.md's seeds bullet ("silent changes in the wedge that measured models get wrong") described the first 30 seeds. Those stay; the next ones come from the pipeline (`tools/seed`).

