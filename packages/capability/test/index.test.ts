import { describe, expect, it } from "vitest";
import * as glob from "../src/glob.ts";
import * as index from "../src/index.ts";
import * as schema from "../src/schema.ts";

describe("package entry", () => {
  it("re-exports every schema and glob export unchanged", () => {
    const idx = index as Record<string, unknown>;
    for (const [k, v] of Object.entries({ ...schema, ...glob })) {
      expect({ k, same: idx[k] === v }).toEqual({ k, same: true });
    }
    expect(Object.keys(schema).length).toBeGreaterThan(10);
  });

  it("resolves through the package name", async () => {
    const pkg = (await import("@ludion/capability")) as Record<string, unknown>;
    expect(pkg.Receipt).toBe(schema.Receipt);
    expect(pkg.globMatch).toBe(glob.globMatch);
  });
});