// The real lookup, with no mocked spawn: a `docker` in the folder ludion is run from must never be the one that runs
// (packages/sandbox/src/docker.ts, dockerCwd). On Windows the working directory is searched before PATH; elsewhere an
// empty PATH entry means the working directory, which is what this test uses.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDockerImageCommand } from "../src/docker.ts";

describe("finding docker", () => {
  it.skipIf(process.platform === "win32")("does not run a docker that the working directory holds, even when PATH names the working directory", async () => {
    const project = mkdtempSync(join(tmpdir(), "ludion-project-"));
    const marker = join(project, "ran");
    // A shell builtin only: with PATH set to the working directory alone, no other command could be found.
    writeFileSync(join(project, "docker"), `#!/bin/sh\n: > '${marker}'\n`, { mode: 0o755 });
    const cwd = process.cwd(), path = process.env.PATH;
    try {
      process.chdir(project);
      process.env.PATH = ":";
      await expect(runDockerImageCommand(["image", "inspect", "x"], 5_000)).rejects.toThrow("Docker unavailable");
      expect(existsSync(marker)).toBe(false);
    } finally {
      process.chdir(cwd);
      process.env.PATH = path;
      rmSync(project, { recursive: true, force: true });
    }
  });
});
