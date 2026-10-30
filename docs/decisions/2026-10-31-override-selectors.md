# 2026-10-31 (LB2a, #215) — An `overrides` key with a selector counts only where npm applies it

Committed before the code that follows it. This narrows rule 2 of docs/decisions/2026-10-31-lock-requirements-against-the-base.md. It changes no gate's criteria and no wait.

**Why.** An automated security pass at 549fe1e found that rule 2 read an `overrides` key `name@selector` by its name alone. A project's `{ "minimist@0.x": "0.2.4" }` then counted for a requirement `minimist ^1.2.5`, which npm does not override. A forged lock could therefore leave that requirement held by 0.2.4, unmet as npm reads it, and still pass.

**The definition (replaces how rule 2 reads a key).** A key is `name` or `name@selector`.
- A key for the required name applies to the requirement only when its selector intersects the requirement's own spec (semver, loose).
- A nested key's level is entered only when the package installed at that point of the requirer's own path is at a version the selector takes.
- A key with no selector, `*`, or an empty selector applies as before.
- A selector that cannot be read as a semver range applies to nothing.

**Checked by:** packages/cli/test/judge.test.ts, "reads npm 11's locks with overrides and with --legacy-peer-deps, and still refuses a change that adds an unmet requirement". It covers a selector that intersects and one that does not, a selector that is not a range, and nested keys with and without a matching selector.
