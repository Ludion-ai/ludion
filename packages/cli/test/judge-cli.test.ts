// `ludion judge` counts every changed version as production (docs/decisions/2026-10-29-no-split-and-release-when-complete.md): the lockfile's
// own `dev` flag never lowers urgency to dev-only or the wait to 168 hours.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { judgeCli } from "../src/security/judge-cli.ts";
import type { Judgement } from "../src/security/judge.ts";

const entry = (name: string, version: string) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`,
  integrity: `sha512-${name}-${version}`,
  dev: true,
});
const lock = (a: string, b: string) => JSON.stringify({
  name: "app", lockfileVersion: 3, requires: true,
  packages: {
    "": { name: "app", devDependencies: { a: "^1.0.0" } },
    "node_modules/a": { ...entry("a", a), dependencies: { b: "^2.0.0" } },
    // A nested copy, dev like its parent.
    "node_modules/a/node_modules/b": entry("b", b),
  },
});
const manifest = JSON.stringify({ name: "app", devDependencies: { a: "^1.0.0" } });

const made: string[] = [];
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

function checkout(lockText: string): string {
  const dir = mkdtempSync(join(tmpdir(), "judge-cli-"));
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), manifest);
  writeFileSync(join(dir, "package-lock.json"), lockText);
  return dir;
}

describe("ludion judge on dev-flagged lockfile entries", () => {
  it("counts every changed version as production, nested copies included", async () => {
    const before = checkout(lock("1.0.0", "2.0.0")), after = checkout(lock("1.0.1", "2.0.1"));
    const lines: string[] = [];
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    const log = vi.spyOn(console, "log").mockImplementation((line: string) => { lines.push(line); });
    try { await judgeCli(["--before", before, "--after", after, "--files", "package-lock.json", "--now", "2027-01-01T00:00:00Z", "--json"]); }
    finally { log.mockRestore(); vi.unstubAllGlobals(); }
    const result = JSON.parse(lines.join("\n")) as Judgement;
    expect(result.changes.map(c => `${c.name}@${c.to}`)).toEqual(["a@1.0.1", "b@2.0.1"]);
    expect(result.changes.every(c => c.dev === false)).toBe(true);
    expect(result.urgency).not.toBe("low");
    expect(result.wait_hours).not.toBe(168);
  });
});
