// `ludion judge` counts every changed version as production (docs/decisions/2026-10-29-every-change-counts-as-production.md): the lockfile's
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
// eslint, a linter: the removed split showed a linter dev-only, so this fails if that split comes back.
const lock = (a: string, b: string) => JSON.stringify({
  name: "app", lockfileVersion: 3, requires: true,
  packages: {
    "": { name: "app", devDependencies: { eslint: "^1.0.0" } },
    "node_modules/eslint": { ...entry("eslint", a), dependencies: { b: "^2.0.0" } },
    // A nested copy, dev like its parent.
    "node_modules/eslint/node_modules/b": entry("b", b),
  },
});
const manifest = JSON.stringify({ name: "app", devDependencies: { eslint: "^1.0.0" } });

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
    expect(result.changes.map(c => `${c.name}@${c.to}`).sort()).toEqual(["b@2.0.1", "eslint@1.0.1"]);
    expect(result.changes.every(c => c.dev === false)).toBe(true);
    expect(result.urgency).not.toBe("low");
    expect(result.wait_hours).not.toBe(168);
  });
});

// docs/decisions/2026-10-31-flag-only-entries-gate2.md: b 2.0.0 stays, and only its `dev` flag goes; `ludion judge`
// asks OSV (and the registry) for it, by name and version.
describe("ludion judge on an entry whose flags alone changed", () => {
  it("asks OSV for its name and version", async () => {
    const after = JSON.parse(lock("1.0.1", "2.0.0"));
    delete after.packages["node_modules/eslint/node_modules/b"].dev;
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown, init?: { body?: unknown }) => { sent.push(`${String(url)} ${String(init?.body ?? "")}`); throw new Error("offline"); });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try { await judgeCli(["--before", checkout(lock("1.0.0", "2.0.0")), "--after", checkout(JSON.stringify(after)), "--files", "package-lock.json", "--json"]); }
    finally { log.mockRestore(); vi.unstubAllGlobals(); }
    expect(sent.filter(s => s.startsWith("https://api.osv.dev/v1/querybatch ") && s.includes('"name":"b"') && s.includes('"version":"2.0.0"'))).toHaveLength(1);
  });
});

describe("ludion judge and npm-shrinkwrap.json (review of aa5d75b)", () => {
  it("does not judge package-lock.json when npm would install from npm-shrinkwrap.json instead", async () => {
    for (const side of ["before", "after"] as const) {
      const dirs = { before: checkout(lock("1.0.0", "2.0.0")), after: checkout(lock("1.0.1", "2.0.0")) };
      writeFileSync(join(dirs[side], "npm-shrinkwrap.json"), lock("1.0.0", "2.0.0"));
      await expect(judgeCli(["--before", dirs.before, "--after", dirs.after, "--files", "package-lock.json"])).rejects.toThrow("npm-shrinkwrap.json is there, and npm installs from it instead of package-lock.json");
    }
  });
});

describe("ludion judge and a requirement the change leaves unmet (review 6529858505, B1)", () => {
  it("refuses a change whose lock leaves a requirement unmet that the base met, and reads one the base already left so", async () => {
    // eslint requires b ^2.0.0; the change moves the nested b to 3.0.0, outside it, which npm install would mend unpinned.
    const dirs = { before: checkout(lock("1.0.0", "2.0.0")), after: checkout(lock("1.0.0", "3.0.0")) };
    await expect(judgeCli(["--before", dirs.before, "--after", dirs.after, "--files", "package-lock.json"])).rejects.toThrow("The change leaves a requirement unmet that npm install would fetch: package-lock.json's packages: node_modules/eslint requires b ^2.0.0, and node_modules/eslint/node_modules/b has b@3.0.0, which is not that.");
    // The same unmet requirement on both sides is the project's own: the change is judged.
    const same = { before: checkout(lock("1.0.0", "3.0.0")), after: checkout(lock("1.0.1", "3.0.0")) };
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    try { expect(typeof await judgeCli(["--before", same.before, "--after", same.after, "--files", "package-lock.json", "--now", "2027-01-01T00:00:00Z", "--json"])).toBe("number"); }
    finally { logs.mockRestore(); vi.unstubAllGlobals(); }
  });
});
