# LP-core: stricter approval in the protected-paths check (2026-10-29)

Rules fixed beforehand in docs/decisions/2026-10-29-protected-paths-approval.md; details and raw logs in docs/bench/2026-10-29-lp-core/.

- protected-paths.yml now reads only `OWNER`/`MEMBER`/`COLLABORATOR` comments, `reviewed-sha:` on the last line only, and approves only a first line that begins with the word `APPROVE` (any case, decoration aside) without the word `NOT` or `REQUEST`. The label check fails closed on an empty answer. `action/` and `action.yml` are protected paths.
- In Docker, offline: typecheck exit 0; protected-paths-workflow.test.ts 11 passed; judge-workflow.test.ts 27 passed; node project (packages, tools) 264 passed; actionlint exit 0; 25 of 25 mutations caught (23 of 25 on the first run, two tests added).
- On real comments of #156, #158, #166 and #170, only #166's merged head 42819fa reads as approved under the new rules (5 heads under main's). Reviews must now begin with the verdict and keep `not` off the first line.
- This PR's own `protected-paths` check runs main's definition (`pull_request_target`); the new rules apply after the merge.
