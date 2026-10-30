# 2026-10-30 — LB: the scheduled workflow, one PR per fix (stage 1)

docs/status.md, "Missing before complete", items 1 and 2. Start: main fcbff49. Design and checks: docs/bench/2026-10-30-lb-design.

**Built.** Two more modes of the root action (`patch`, `pull-request`), `ludion deliver pack|open` (packages/cli/src/security/deliver.ts) and the template a user copies (action/patch-workflow.yml). The validation job holds `contents: read` only. The PR job holds `contents: write` and `pull-requests: write` and runs no dependency code. It checks the artifact as untrusted data, including what each changed file says (manifest recomputed, Dockerfile FROM only, composer.lock entry by entry), and checks again against the official registries (the npm judge, Packagist's dist and source for Composer, Docker Hub's digest for PHP) before it pushes anything.

**Not run on GitHub.** Both jobs' commands ran locally in Docker, with a bare repository as GitHub's Git and a stand-in for GitHub's API. Nothing was placed in a user repository or in ludion-sandbox. Nothing is released.

**Results** (`logs/e2e.log`, at the PR's last code; each case ran the workflow twice, clones depth 1 with HEAD detached):

| Case | Validation job, each run | PR job, run 1 | PR job, run 2 |
|---|---|---|---|
| npm-two (lodash, minimist 1.2.5) | lodash 4.17.20 → 4.18.0 failed (the judge stops: 4.18.0 is deprecated); minimist 1.2.5 → 1.2.6 applied (`ready_except_build`); patch exit 2 | PR #1 opened for `ludion/npm/minimist-1.2.6`, changing package.json and package-lock.json (the judge, run again in the PR job, agreed) | `open_pr_exists #1`; no push, no PR |
| php | PHP 8.4.26 → 8.4.27 applied; exit 0 | PR #1 opened for `ludion/php/8.4.27`, changing Dockerfile (Docker Hub's digest for the tag matched) | `open_pr_exists #1` |
| composer | symfony/http-foundation 5.4.0 → 5.4.54 applied; exit 0 | PR #1 opened, changing composer.json and composer.lock (Packagist's dist and source matched) | `open_pr_exists #1` |
| maven | commons-text 1.9 → 1.10.0 failed (alone it brings commons-lang3 3.12.0, still vulnerable, as in LA); commons-lang3 3.11 → 3.18.0 applied; exit 2 | PR #1 opened, changing pom.xml | `open_pr_exists #1` |
| npm (examples/npm-security as is) | lodash 4.17.20 → 4.18.0 failed (judge stop); exit 2 | nothing to open (0 applied, 1 failed) | the same |

In every case with a fix, the stand-in received one POST (one PR). Run 2's commit differed (a new commit time) and was not pushed.

**Found on the way.** The first e2e run showed every real fix refused (a mode check that rejected 100755 files). After the content checks were added, the Composer fix was refused once because the tool image's Composer rewrote `plugin-api-version`. Both were fixed with tests. Two fresh-context reviews asked for changes: comment 6512945643 at d714435 (content not checked; a refused PR left a fix stuck) and comment 6513266881 at 21cfbc5 (Composer archives from any repository; any digest under the PHP tag). All four are addressed; what stays open is written in the design's "What these checks do not cover".

**Observed, not this lane's.** For examples/npm-security, the plan's fixed version for lodash is 4.18.0, which the registry marks deprecated ("Bad release. Please use lodash@4.17.21 instead"). The judge stops that fix and no PR is opened. How the fixed version is chosen belongs to LV.

**Checks** (at the PR's last code). tsc 0; `vitest --project node packages/cli/test` 20 files, 784 passed, 19 skipped (an earlier run of the same code failed one timing test of readonly-rust under load, 1,163 ms against 1,000; that file then passed alone). Mutations: 48 of 48 caught.
