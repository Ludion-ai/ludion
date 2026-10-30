# 2026-10-31 — LNODE: the official Node.js image moves to its line's newest security release

Lane LNODE (docs/status.md, Missing item 4). Definitions: docs/decisions/2026-10-31-lnode-node-image.md. Detail, scripts and logs: docs/bench/2026-10-31-lnode.

- A policy with `"ecosystem": "node"` and an exact `node:X.Y.Z[-variant]` in the Dockerfile's one `FROM` now goes through the PHP image's path: nodejs.org's index (`security: true`) gives the newest security release of the same major, the image is pinned by digest, the project's test passes on old and new offline in Docker, and the fix is one commit on `ludion/node/<version>`. The scheduled workflow's PR job checks it again, Docker Hub's digest for `library/node` included.
- Tests (in Docker, no network): tsc exit 0; the node project 36 files, 1,230 passed, 19 skipped. Mutations: 26 of 26 caught.
- End to end, locally (real nodejs.org, Docker Hub and Docker; GitHub a stand-in): examples/node-security moved 22.22.0 → 22.23.4, `FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`, one PR on run 1 and none on run 2; the PHP example still moved 8.4.26 → 8.4.27.
- Not done: a run on GitHub; gate 1, gate 2 and the waits for the image (as for PHP); the site's account of it.
