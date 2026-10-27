# Security-update pivot — 2026-10-27

The owner authorized repurposing Ludion while retaining its existing UI and reusable infrastructure. The first adapter uses official PHP release metadata and official Docker images.

Local checks: typecheck and workspace/sample builds passed; 666 unit/integration tests passed (7 skipped); 25 security-adapter tests passed; 29 browser checks passed (2 skipped), including keyboard/copy behavior, mobile/200% text reflow, reduced motion and axe checks. The screenshot capture passed and generated 36 PNGs for three routes at 320/390/1280 in light/dark themes; desktop home, mobile home and mobile setup were visually inspected. A later build updated an inherited visible mobile label from program to PHP patch.

Real Docker runs: PHP 8.4.26-cli-alpine → 8.4.27-cli-alpine. apply changed only FROM and pinned its digest. validation-only left source unchanged. Intentional baseline and candidate test failures both left source unchanged. A rescan found no newer same-branch security release. See JSON receipts for actual hashes/digests and outcomes. Durations are single local observations with cached images and do not establish a service-level objective.

npm audit initially reported 14 findings; compatible upgrades plus an explicit Agents SDK/MCP server peer-compatible update and Vitest 4.1.12 resolved all findings at check time. No --force or peer-dependency bypass was used. Zero audit findings is not proof that the application has no vulnerabilities.

These are application smoke contracts, not exploit regressions. Production deployment, remote inventory, host package updates, Java, complete advisory/EOL coverage and same-tag image rebuilds are unsupported. Nothing was installed on production or published to npm. Remote CI and the repository's protected-file fresh-context review remain separate gates.
