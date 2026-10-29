## 2026-10-27 — Security-update pivot

The owner authorized repurposing Ludion, reusing useful code and the existing UI, and removing obsolete product content. The first executable adapter targets exact official PHP Docker images in single-stage Dockerfiles. This tests a real security-release-to-source-update path without pretending the current lockfile reader inventories live PHP servers. Same-branch security releases trigger an update; official image digests are pinned, old and new application tests must pass, and source must remain unchanged before --apply. watch repeats this in a foreground process. Production deployment, host package management, Java, same-tag image rebuilds and complete CVE/EOL coverage remain unsupported and are labeled so.

Reuse: existing Astro design and components, CLI bundle/distribution, capability Docker runner, Worker/CSP/redirects and deployment pipeline. Removed from the active funnel: v3 capability-design messaging, lesson teaching/plugin/MCP setup promotion, and the old start-page flow. Existing sync/teach, public data and MCP routes stay compatible; deleting them now would break existing users without improving the security adapter. Historical documentation and evidence are archived/preserved.

No new service, account, secret or paid API is required. The security CLI uses php.net metadata and Docker official images. Docker test execution is offline; failures never imply safety. The public npm package is not republished by this change. CLAUDE.md is updated so later work follows the authorized pivot; its protected-file PR review/owner-merge rule remains.


