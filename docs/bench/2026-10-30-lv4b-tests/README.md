# LV4b — the mutations of #214's cloud review, applied again

The cloud review of #214 (https://github.com/Ludion-ai/ludion/pull/214#issuecomment-6517309422, Mutations) listed changes to `osvIds` and to `ludion patch`'s note line; five of them passed every test. LV4b added tests and narrowed cli.ts, then applied every mutation in that list again.

- `run.sh`: run in Docker (image ludion-sa-node24-tools, Node 24.22.1, jq on PATH) on a copy of the tree: `npm ci --ignore-scripts`, typecheck, build, `npx vitest run`, then `mutate-lv4b.mjs`.
- `mutate-lv4b.mjs`: each mutation edits one file with split/join (it must match exactly once), runs the patch-cli, judge, dependencies, candidate-judge and judge-cli tests (the files the review used), and restores the file. Wrongly written mutations would print NOT APPLIED; none did.
- `mutate.log`: the raw output. 13 of 13 caught.
- `test-summary.log`: the end of the full `vitest run` before the mutations: 34 files, 1142 passed, none skipped.

The cli.ts mutations are written against the new exact comparison: each one adds a further case in which the note is left out (`EXACT || <case>`), so it can only hide notes, as in the review.
