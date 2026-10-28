## 2026-10-28 — The judge as an action (preview), and the dogfood record

- **action.yml at the root**, two modes for two jobs, split like judge.yml and judge-comment.yml. Mode judge: pull_request, `contents: read`. It reads the PR's files as data through the API, so it needs no checkout, and runs the bundled judge. With a read token this should also work on private repositories, but only this public repository was tried. Mode comment: workflow_run, `pull-requests: write`. It uses judge-comment.yml's checks, copied to action/*.jq, with the judge workflow's path as an input.
- **Only a release commit carries the bundle.** packages/cli/dist/cli.js and action/dist/record.js (`node action/build.ts`, which bundles .github/judge/record.ts) are not on main. On any other commit the action stops with an error and does not build. The release steps are in docs/bench/dogfood/prepublish-checklist.md.
- `files` in packages/cli is narrowed to `dist/cli.js`. The dogfood measurement has no gate; its definitions were committed first (4c441d0).

