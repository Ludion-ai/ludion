import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnTool, trustedCommand } from "../src/command.ts";

const extension = process.platform === "win32" ? ".exe" : "";
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "ludion-tool-path-"));
  const project = join(root, "project");
  const sub = join(project, "nested");
  const global = join(root, "global");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(sub); mkdirSync(global);
  return { root, project, sub, global };
};
const binary = (dir: string, name = "git") => {
  const path = join(dir, name + extension);
  writeFileSync(path, "", { mode: 0o755 });
  return path;
};
describe("host executable trust boundary", () => {
  it("ignores project, ancestor-project and relative PATH entries and retains explicit global tools", () => {
    const f = fixture(); binary(f.project); const expected = binary(f.global);
    const env = { PATH: [".", "", f.project, f.global].join(delimiter), Path: f.project, GH_TOKEN: "synthetic" };
    const command = trustedCommand("git", f.sub, env);
    expect(command.file).toBe(realpathSync(expected));
    expect(command.env.PATH).toBe(realpathSync(f.global));
    expect(Object.keys(command.env).filter((key) => key.toLowerCase() === "path")).toEqual(["PATH"]);
    expect(command.env.GH_TOKEN).toBe("synthetic");
  });
  it("does not use npm-injected executable bins outside the selected project either", () => {
    const f = fixture(); const bin = join(f.root, "other", "node_modules", ".bin");
    mkdirSync(bin, { recursive: true }); binary(bin); const expected = binary(f.global);
    expect(trustedCommand("git", f.sub, { PATH: [bin, f.global].join(delimiter) }).file).toBe(realpathSync(expected));
  });
  it("does not let a nested Git marker hide an outer repository executable", () => {
    const f = fixture(); mkdirSync(join(f.sub, ".git"));
    const bin = join(f.project, "bin"); mkdirSync(bin); binary(bin);
    const expected = binary(f.global);
    expect(trustedCommand("git", f.sub, { PATH: [bin, f.global].join(delimiter) }).file).toBe(realpathSync(expected));
  });
  it.skipIf(process.platform === "win32")("does not follow a nominally global executable symlink back into the project", () => {
    const f = fixture(); const unsafe = binary(f.project);
    const alias = join(f.root, "alias"); mkdirSync(alias);
    // Windows symlink creation may need privileges; its cwd lookup is covered by the native probe below.
    symlinkSync(unsafe, join(alias, "git"));
    const expected = binary(f.global);
    expect(trustedCommand("git", f.sub, { PATH: [alias, f.global].join(delimiter) }).file).toBe(realpathSync(expected));
  });
  it("fails closed with the existing missing-tool status instead of falling back to cwd", () => {
    const f = fixture(); binary(f.project);
    const result = spawnTool("git", ["--version"], { cwd: f.project, env: { PATH: f.project } });
    expect(result.status).toBeNull();
    expect((result.error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
  it.skipIf(process.platform !== "win32")("uses the installed Git instead of a project-local trusted Node copy on Windows", () => {
    const f = fixture(); copyFileSync(process.execPath, join(f.project, "git.exe"));
    // The copied program is our installed Node, and --version reads no credentials or candidate code.
    expect(execFileSync("git", ["--version"], { cwd: f.project, encoding: "utf8", windowsHide: true }).trim()).toBe(process.version);
    const command = trustedCommand("git", f.project);
    expect(execFileSync(command.file, ["--version"], { cwd: f.project, env: command.env, encoding: "utf8", windowsHide: true }).trim()).toMatch(/^git version /);
  });
});
