# Security policy

Ludion is being built as a security agent that finds security fixes and puts them into projects automatically; today it is an unreleased source preview (docs/status.md says what is built). A flaw in Ludion itself could put an unsafe update into a project, or let someone attack the projects it updates. Please report one privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can see the report.

Please do not open a public issue, pull request or discussion for a suspected vulnerability.

A useful report says:

- what is affected (the command, the GitHub Action, the site, and the commit you used);
- how to reproduce it, with the smallest input you can find;
- what happens and what you expected;
- whether you believe it is being exploited.

## What happens next

Ludion is maintained by a small team. We aim to acknowledge a report within 7 days and to agree on a disclosure date with you. When it is fixed, we normally publish a GitHub security advisory and credit you unless you ask us not to.

## Supported versions

Nothing of the security agent is released yet: it is not released until it is complete (CLAUDE.md, Goal).

| What | Supported |
| --- | --- |
| The source on `main` (not released) | Yes |
| `ludion-ai` 0.0.1 and 0.1.x on npm (the lesson tool, which ended on 2026-10-28) | No |

## Scope

In scope:

- the CLI in `packages/cli` (`init`, `scan`, `patch`, `watch` and `judge`) and its sandbox in `packages/sandbox`;
- the GitHub Action (`action.yml` and `action/`);
- this repository's workflows;
- the site at ludion.ai.

Anything in scope that weakens Ludion's own security counts, in particular a check that passes or applies an update it should have stopped, a way to use Ludion, or an update to it, to attack the projects it updates, and Ludion sending more about a project than docs/status.md and the README say it sends.

Out of scope:

- vulnerabilities in third-party packages Ludion reports on (report them to that project or to the GitHub Advisory Database).

What Ludion checks and does not check is listed in docs/status.md; a limitation stated there is not a vulnerability.
