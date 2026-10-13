// The list and the lesson page set a claim in parts; the parts must be the claim, word for word.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Index } from "@ludion/core";
import { ADDED_SENTENCE, claimParts, joinParts, SILENT_SENTENCE } from "../src/build/claim-parts.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

describe("claimParts", () => {
  it("cuts a generated claim into its headline, detail, and closing sentence", () => {
    const silent = `vitest >=4.0.0 changed what \`vi.restoreAllMocks\` does. It no longer resets spies. ${SILENT_SENTENCE}`;
    expect(claimParts(silent)).toEqual({ head: "vitest >=4.0.0 changed what `vi.restoreAllMocks` does.", detail: "It no longer resets spies.", tail: { text: SILENT_SENTENCE, kind: "silent" } });
    expect(claimParts(`agents >=0.24.0 added \`transport\`. ${ADDED_SENTENCE}`)).toEqual({ head: "agents >=0.24.0 added `transport`.", detail: "", tail: { text: ADDED_SENTENCE, kind: "added" } });
    expect(claimParts("Python 3.12 removed distutils (PEP 632); use setuptools.")).toEqual({ head: "Python 3.12 removed distutils (PEP 632); use setuptools.", detail: "", tail: null });
  });

  const built = join(root, "apps/site/dist/index.json");
  it.skipIf(!existsSync(built))("gives back every claim on the site word for word", () => {
    const index = JSON.parse(readFileSync(built, "utf8")) as Index;
    for (const l of index.lessons) expect(joinParts(claimParts(l.claim)), l.id).toBe(l.claim);
  });
});
