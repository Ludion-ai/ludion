# Security policy

Ludion decides whether a dependency update is safe to take, so a flaw in Ludion itself can let an unsafe update through. Please report one privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can see the report.

Please do not open a public issue, pull request or discussion for a suspected vulnerability.

A useful report says:

- what is affected (the command, the GitHub Action, the site, or the published package and its version);
- how to reproduce it, with the smallest input you can find;
- what happens and what you expected;
- whether you believe it is being exploited.

## What happens next

Ludion is maintained by a small team. We aim to acknowledge a report within 7 days and to agree on a disclosure date with you. When a fix is released, we publish a GitHub security advisory and credit you unless you ask us not to.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.3.x previews | Yes |
| 0.1.x | No |

## Scope

In scope:

- the `ludion-ai` npm package and the CLI in `packages/cli`;
- the GitHub Action (`action.yml` and `action/`);
- this repository's workflows;
- the site at ludion.ai.

Two kinds of finding count as vulnerabilities in Ludion: a judgement that passes an update it should have stopped, and an update to Ludion that could be used to attack its users.

Out of scope:

- vulnerabilities in third-party packages Ludion reports on (report them to that project or to the GitHub Advisory Database).

What Ludion checks and does not check is listed in docs/status.md; a limitation stated there is not a vulnerability.
