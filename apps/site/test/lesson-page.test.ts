// A lesson page draws a test's versions only when core labels the lesson differential, and then by its own package.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDifferential, isV1, validateLesson, type Lesson } from "@ludion/core";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const dist = join(root, "apps/site/dist/lessons");

function lessons(): Lesson[] {
  const out: Lesson[] = [];
  for (const subject of readdirSync(join(root, "lessons"))) {
    const dir = join(root, "lessons", subject);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const l = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (validateLesson(l).ok) out.push(l as Lesson);
    }
  }
  return out;
}

describe.skipIf(!existsSync(dist))("the versions drawing on a lesson page", () => {
  it("shows only for lessons labeled differential, with the lesson's own package as the version", () => {
    let drawn = 0;
    let passFailNotDifferential = 0;
    for (const l of lessons()) {
      const page = join(dist, l.id, "index.html");
      if (!existsSync(page)) continue;
      const html = readFileSync(page, "utf8");
      const differential = isV1(l) && isDifferential(l);
      expect(html.includes("Must pass"), l.id).toBe(differential);
      if (differential && isV1(l)) {
        drawn++;
        expect(html).toMatch(new RegExp(`class="pkg"[^>]*>\s*${l.package.name.replace(/[.*+?^${}()|[\]\/]/g, "\$&")}\s*<b`));
      } else if (isV1(l)) {
        const t = l.evidence.flatMap((e) => ("test" in e ? [e.test] : []));
        if (t.some((x) => x.expect === "fail") && t.some((x) => x.expect !== "fail")) passFailNotDifferential++;
      }
    }
    expect(drawn).toBeGreaterThan(0);
    // The pass/fail pairs that change another pin too (e.g. @vitest/browser with vitest) get no drawing.
    expect(passFailNotDifferential).toBeGreaterThan(0);
  });
});
