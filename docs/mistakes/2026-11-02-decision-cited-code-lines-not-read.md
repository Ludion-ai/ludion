# 2026-11-02 — A decision on C2 described code lines its writer had not read

- **What happened.** An answer on how to count C2 said 「範囲で一番新しい版を取る、npm の既定の解決」 (take the newest version in the range, npm's default resolution) and 「最古を含む」 (include the oldest).
  - The code does neither. tools/shadow/src/replay.ts:292 `syntheticFix` only returns a fix from prev to V; it reads no range and no resolution. replay.ts:321 only passes that to `fixes`.
  - docs/decisions/2026-11-02-c2-definition.md section 2 already said that the replay's synthetic fix treats every counted version as chosen, and a separate check of the answer said the same.
  - The answer was withdrawn, and docs/decisions/2026-11-02-c2-counting-reading.md records the reading that replaces it.
- **Why.** The withdrawal, as this lane's brief gives it, says the answer was written without reading the lines. Whether the writer had read that section of the definition by then is 不明. It is the same kind of mistake as docs/mistakes/2026-10-31-claims-written-without-reading.md, this time in a decision about how a gate is counted.
- No check that runs catches this kind of mistake yet. The review item `decision-names-code-it-read` asks that when a decision cites a file:line, its writer has read that line; someone has to remember it. The rule below is the one this record is kept under, not one that prevents the mistake.
- **Rule:** "Every mistake is traced to its cause and fed back into a rule or a check, so the same mistake cannot pass twice."
