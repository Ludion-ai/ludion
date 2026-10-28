# 2026-10-29 (L1) — The noise count is not "fixed", and not re-measured

The noise rerun's count gate is not met: 938 × 3 = 2,814 > 1,867 (docs/bench/2026-10-28-noise-v2). The night-v2 task for lane L1 was to break the increase from 560 down by package and, if it could be fixed, to fix it and re-measure under #155's definitions without loosening the split's definition.

**Decision.** No code change, and no re-measurement.
- **Why.** docs/bench/2026-10-29-l1-count-breakdown traces all 378 added (repository, package) pairs to a rule of section 2 of "Gate 1's production/dev split, rebuilt" (docs/decisions.md). It found none that the code counts beyond section 2's text. So the count can come down only by changing the definition, and this task does not allow that.
- **Readings left as they are.** The breakdown found several places where the text could be read more narrowly:
  - test-runner configurations with an extra name part (`vitest.integration.config.ts`);
  - names in a build configuration that keep a package out of the output (tsup's `external`, electron-builder's `!**/node_modules/x/**`);
  - JSON object keys outside PostCSS configuration (angular.json's `"glob"`, nx.json's generator defaults);
  - a project's or target's own name that equals a package (`"name": "storybook"`);
  - type-only references in a build configuration (`@type {import('x')}`, `/// <reference types="x" />`), where section 2 already excludes `import type` from imports;
  - `$schema` paths into node_modules, and a lockfile embedded as a string in a generated file;
  - D1 only for the whole lockfile when one production image holds devDependencies.

  Choosing one of those narrower readings now, after seeing the result, would loosen the definition, so none is made. Each is listed for the owner in the bench README, "What would change the count".
- **What stays.** The count gate is not met (938). The miss gate is not met (11 misses in 4 repositories). The wait table and the gates are unchanged.
- **The owner's part.** A definition change would be a new entry, committed before a new run, as in #155 and #168.
