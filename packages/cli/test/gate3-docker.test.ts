// Gate 3's new type on the real example, in real Docker. Heavy: it pulls a browser image of several GB and builds the
// application seven times, so it runs only when asked for (LUDION_GATE3_DOCKER=1), and CI does not ask yet: docs/status.md.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { acquisitionPolicy } from "../src/security/dependency-patch.ts";
import { snapshot } from "../src/security/project.ts";
import { CASES, caseProblems, runCase, type CaseName } from "./gate3-cases.ts";

const examples = resolve(import.meta.dirname, "../../../examples");

describe.skipIf(!process.env.LUDION_GATE3_DOCKER)("gate 3 on examples/nextjs-security, in Docker", () => {
  for (const name of Object.keys(CASES) as CaseName[]) {
    it(`${name}: ${CASES[name].title} is ${CASES[name].expected}`, async () => {
      const result = await runCase(name, examples, { policy: manifests => acquisitionPolicy(manifests, "npm"), snapshot });
      expect(caseProblems(name, result)).toEqual([]);
    }, 3_600_000);
  }
});
