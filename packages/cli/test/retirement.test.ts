import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildIndex, generateClaim, type LessonV1 } from "@ludion/core";
import { fetchLessons } from "../src/shards.ts";

const exec = promisify(execFile);
const oldId = "01M4N6JH8SHRYQE5CPY9SN1QQJ";
const newId = "01M4N6JH8SHRYQE5CPY9SN1QQK";
const privateId = "01M4N6JH8SHRYQE5CPY9SN1QQM";
const lesson = (id: string, extra: Partial<LessonV1> = {}): LessonV1 => ({
  format: 1, id, subject: "vitest", package: { ecosystem: "npm", name: "vitest" }, versions: ">=5.0.0",
  kind: "removed", symbol: "oldOption", signal: "loud", evidence: [{ source: { url: "https://vitest.dev/guide/", quote: `The ${extra.symbol ?? "oldOption"} is removed from the package configuration.` } }],
  author: "github:probe", author_id: 1, created_at: "2026-10-12T00:00:00Z", ...extra,
});

/** Actual CLI sync, isolated ledger/project, transport on loopback. No lesson code is executed. */
async function sync({ publicLessons = [], inactive, entries, offline = false }: { publicLessons?: LessonV1[]; inactive?: string[]; entries: { lesson: LessonV1; public?: boolean }[]; offline?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "ludion-retirement-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(join(home, "ledger"), { recursive: true });
  mkdirSync(project);
  for (const e of entries) writeFileSync(join(home, "ledger", `${e.lesson.id}.json`), JSON.stringify({ lesson: e.lesson, taught_at: e.lesson.created_at, checks: { tests: "none", sources: "found" }, ...(e.public ? { public: { pr_url: "https://github.com/example/example/pull/1" } } : {}) }));
  writeFileSync(join(project, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/vitest": { version: "5.0.3" } } }));
  const index = buildIndex(publicLessons, {}, new Map([[1, "probe"]]), { org: "probe", repo: "probe" });
  const subjects = publicLessons.length ? { vitest: { lessons: index.lessons.length } } : {};
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/index/subjects.json"
      ? { built_at: index.built_at, subjects, ...(inactive === undefined ? {} : { inactive_ids: inactive }) }
      : { built_at: index.built_at, subject: "vitest", lessons: index.lessons }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    const port = (server.address() as { port: number }).port;
    await exec(process.execPath, [join(import.meta.dirname, "../src/cli.ts"), "sync", ...(offline ? ["--offline"] : []), "--dir", project], {
      env: { ...process.env, LUDION_HOME: home, LUDION_SITE: `http://127.0.0.1:${port}` }, timeout: 15000,
    });
    return readFileSync(join(project, ".ludion/lessons.md"), "utf8");
  } finally { await new Promise<void>((ok) => server.close(() => ok())); }
}

describe("corrections and retirement in actual sync", () => {
  it("does not resurrect a published ledger copy that a public correction replaces, even on an old server", async () => {
    const old = lesson(oldId);
    const correction = lesson(newId, { kind: "added", replaces: [oldId] });
    const md = await sync({ publicLessons: [old, correction], entries: [{ lesson: old, public: true }] });
    expect(md).toContain(generateClaim(correction));
    expect(md).not.toContain(generateClaim(old));
  });

  it.each(["retracted", "withheld", "replaced outside the project's subjects"])("suppresses %s ids even after a subject lost its last shard, and retains private lessons", async () => {
    const old = lesson(oldId);
    const privateLesson = lesson(privateId, { symbol: "privateOption" });
    const md = await sync({ inactive: [oldId], entries: [{ lesson: old, public: true }, { lesson: privateLesson }] });
    expect(md).not.toContain(generateClaim(old));
    expect(md).toContain(generateClaim(privateLesson));
  });

  it("applies a private correction before matching versions, even offline", async () => {
    const old = lesson(oldId);
    const correction = lesson(newId, { kind: "added", replaces: [oldId], versions: ">=6.0.0" });
    const md = await sync({ offline: true, entries: [{ lesson: old }, { lesson: correction }] });
    expect(md).not.toContain(generateClaim(old));
    expect(md).not.toContain(generateClaim(correction));
  });

  it.each([false, true])("marks public ledger status unknown without retirement metadata (offline=%s)", async (offline) => {
    const md = await sync({ offline, entries: [{ lesson: lesson(oldId), public: true }] });
    expect(md).toContain("not verified: public status unknown");
    expect(md).not.toContain("evidence checked: quote found on this machine");
  });

  it("keeps a pending public PR in the personal ledger when it has not been retired", async () => {
    const pending = lesson(oldId);
    expect(await sync({ inactive: [], entries: [{ lesson: pending, public: true }] })).toContain(generateClaim(pending));
  });

  it("refuses retirement metadata mixed with a shard from another build", async () => {
    const installed = { npm: new Map([["vitest", new Set(["5.0.3"])]]), node: "24.0.0", source: "test" };
    const fetchFn = async (url: string) => Response.json(url.endsWith("subjects.json")
      ? { built_at: "new", subjects: { vitest: { lessons: 0 } }, inactive_ids: [oldId] }
      : { built_at: "old", subject: "vitest", lessons: [] });
    await expect(fetchLessons(installed, fetchFn)).rejects.toThrow("index changed during sync");
  });
});
