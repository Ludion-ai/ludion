## 2026-10-28 (cycle 3) — Two rules into CLAUDE.md; the follow-ups to #156, #157 and #158's reviews

The rules and the review follow-ups are in #166 (decisions: the entry of the same name). Checked in Docker at dd86e86, offline, with a read-only root, as a non-root user: typecheck exit 0; judge-workflow.test.ts 27 passed (20 before); packages 8 files, 237 passed; actionlint found nothing on both judge workflows; 8 mutations re-run one at a time, each caught. After #166's first review (B1), `protected-paths` passes only when the latest review of the current head approves; the checks of that fix are in the bench README. Raw output and details: docs/bench/2026-10-28-l3-protected/.

