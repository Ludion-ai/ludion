measurement date (UTC): 2026-10-30

| group | repos | countable | not countable | lag median | lag p90 | exposure median | exposure p90 | behind (lag > 0) | EOL series |
|---|---|---|---|---|---|---|---|---|---|
| all | 100 | 100 | 0 | 9 | 1807 | 9 | 2075 | 54 | 39 |
| php | 50 | 50 | 0 | 0 | 1457 | 0 | 1891 | 24 | 17 |
| node | 50 | 50 | 0 | 9 | 2075 | 10 | 2075 | 30 | 22 |
| configured | 20 | 20 | 0 | 0 | 9 | 0 | 10 | 7 | 2 |
| not_configured | 80 | 80 | 0 | 9 | 2075 | 9.5 | 2174 | 47 | 37 |
| configuration_unknown | 0 | 0 | 0 | - | - | - | - | 0 | 0 |
| dependabot_docker | 12 | 12 | 0 | 0 | 9 | 0 | 94 | 5 | 2 |
| renovate | 8 | 8 | 0 | 0 | 10 | 0 | 10 | 2 | 0 |
| both | 0 | 0 | 0 | - | - | - | - | 0 | 0 |

digest pinned: 16 of 100 (php 7, node 9)
repositories with an untagged PHP release newer than the pinned one: 2

| stratum | outcome | repositories |
|---|---|---|
| node | rejected:chosen-in-php | 1 |
| node | rejected:no-qualifying-from | 289 |
| node | rejected:owner-already-chosen | 1 |
| node | rejected:pushed-before-2025-10-30 | 480 |
| node | selected | 50 |
| php | rejected:no-qualifying-from | 359 |
| php | rejected:pushed-before-2025-10-30 | 629 |
| php | selected | 50 |


LR2 items (yes / no / could not be counted):

| item | all | php | node |
|---|---|---|---|
| test_script | 34 / 66 / 0 | 12 / 38 / 0 | 22 / 28 / 0 |
| test_sign | 51 / 49 / 0 | 24 / 26 / 0 | 27 / 23 / 0 |
| offline_build | 8 / 92 / 0 | 7 / 43 / 0 | 1 / 49 / 0 |
| expose | 45 / 55 / 0 | 17 / 33 / 0 | 28 / 22 / 0 |
| healthcheck | 11 / 89 / 0 | 4 / 46 / 0 | 7 / 43 / 0 |
| expose_and_healthcheck | 9 / 91 / 0 | 4 / 46 / 0 | 5 / 45 / 0 |
| expose_or_healthcheck | 47 / 53 / 0 | 17 / 33 / 0 | 30 / 20 / 0 |
| deploy_workflow | 19 / 81 / 0 | 9 / 41 / 0 | 10 / 40 / 0 |
| deploy_platform | 2 / 98 / 0 | 1 / 49 / 0 | 1 / 49 / 0 |
| deploy | 21 / 79 / 0 | 10 / 40 / 0 | 11 / 39 / 0 |
| eol | 39 / 61 / 0 | 17 / 33 / 0 | 22 / 28 / 0 |
| digest | 16 / 84 / 0 | 7 / 43 / 0 | 9 / 41 / 0 |

Decision 4: kept patched with no person: 0 of 100 (0.0%; 95% Wilson 0.0% to 3.7%)
Not what Ludion can do — H1 to H5 met: 0 of 100 (0.0%; 95% Wilson 0.0% to 3.7%); of them deploy on merge 0 / 0 / 0

| step | of | yes | no | could not be counted |
|---|---|---|---|---|
| H1 image is php | 100 | 50 | 50 | 0 |
| H2 phpImage accepts the Dockerfile | 50 | 4 | 46 | 0 |
| H3 series not past end of life | 4 | 1 | 3 | 0 |
| H4 builds with no network | 1 | 1 | 0 | 0 |
| H5 any test sign | 1 | 0 | 1 | 0 |
| H6 reaches the repository with no person (not built: no automatic merge, no release) | 0 | 0 | 0 | 0 |

php images, phpImage's answer:

- 45: refused: Dockerfile frontend directives and continuations are not supported in this preview.
- 4: accepted
- 1: refused: ADD, external COPY and RUN network/mount overrides are not supported by the offline validator.
