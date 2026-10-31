# 2026-10-31 (LB2a, #215) — The npm corpus adds alias locks; the identity rule is written down; V3 stays refused

Committed before the alias shape is generated. It extends docs/decisions/2026-10-31-lock-corpus-against-npm.md and docs/decisions/2026-10-31-lock-corpus-npm12.md on the brain's direction for #215 (after the V3 report). The corpus's other shapes, the variants and the gates G1 and G3 stay as written there. It changes no wait.

## 1. The identity rule

The package at a location must be the one the spec that requires it names: for an ordinary spec, the package named by the location (`node_modules/minimist` must hold minimist); for an `npm:` alias spec, the package the alias points at (`"minimist": "npm:left-pad@1.3.0"` must find left-pad there). A location whose package is another one refuses the change, in `packages` and in a v2 lock's npm 6 tree, at the top and nested. This is what `newUnmetRequirements` (judge.ts) already does; this entry makes it a rule with its own tests.

## 2. V3 stays refused

`npm ls --package-lock-only` does not look at which package a location holds when its spec is a range: it checks the version only. Ludion does. So for V3 (`name: "left-pad"` added at a location a range requires), the expected answer is fixed as "Ludion refuses", for every V3 in the corpus, whatever npm reports. G2 is judged on the other variants as before (npm 12.2.1's report).

## 3. The alias shape

A seventh shape, **alias**, written by each npm version (7.10.0, 8.19.4, 9.8.1, 10.8.2, 11.19.1, 12.2.1) at lockfileVersion 2 and 3 in the same images and the same way:
- the project requires `"minimist": "npm:left-pad@1.3.0"` (an alias under another real package's name, at the top) and `mkdirp` 0.5.1 (which requires minimist 0.0.8, so a real minimist is installed nested under it);
- a workspace requires `"is-number": "npm:left-pad@1.2.0"` while the project requires is-number 7.0.0, so npm places that alias at a nested location.

The generator makes its variants (V0 to V4, as for any shape), and npm 12.2.1 and npm 11.19.1 report on each.

**Gates for it:**
- G1 and G3 as for every lock.
- **A1:** every alias lock npm writes is read, and the base leaves no requirement unmet (`unmetRequirements` with its package.json is empty): Ludion takes what npm wrote.
- **A2:** if main's reader reads an alias lock that #215 refuses or finds unmet, that is a narrowing and is fixed in #215, never by dropping the lock.
- G2 on its variants as above (V3 refused; the rest against npm 12.2.1).
