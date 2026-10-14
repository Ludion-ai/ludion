// Design screenshots for review (docs/decisions.md, Site). Not part of CI: runs only when SCREENSHOTS_DIR is set.
//   SCREENSHOTS_DIR=<folder> npm run test:e2e -- screenshots
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.SCREENSHOTS_DIR;
const WIDTHS = [320, 390, 1280];
const SCHEMES = ["light", "dark"] as const;

test.skip(!dir, "Set SCREENSHOTS_DIR to capture design screenshots.");

test("capture actual pages at mobile and desktop widths in both themes", async ({ browser, request }) => {
  test.setTimeout(300_000);
  const response = await request.get("/index.json");
  expect(response.ok(), "The built lesson index must be available.").toBe(true);
  const index = (await response.json()) as { lessons: { id: string; subject: string }[]; teachers: Record<string, { login: string }> };
  const lesson = index.lessons[0];
  const teacher = Object.values(index.teachers)[0];
  expect(lesson, "Capture a real lesson and its subject from the index.").toBeDefined();
  expect(teacher, "Capture a real teacher from the index.").toBeDefined();
  const lookup = await browser.newPage();
  await lookup.goto("/bench/");
  const answerHref = await lookup.locator('[data-answer="with"] .full').getAttribute("href");
  await lookup.close();
  expect(answerHref, "Capture the same recorded answer the Bench links.").toBeTruthy();
  const modelHref = answerHref!.split("/").slice(0,3).join("/") + "/";
  const pages: Record<string, string> = {
    home: "/",
    start: "/start/",
    bench: "/bench/",
    lessons: "/lessons/",
    lesson: `/lessons/${lesson!.id}/`,
    teacher: `/@${teacher!.login.toLowerCase()}`,
    subject: `/${lesson!.subject}/`,
    "404": "/no-such-page/",
    method: "/bench/method/",
    model: modelHref,
    answer: answerHref!,
  };
  mkdirSync(dir!, { recursive: true });
  for (const width of WIDTHS) {
    for (const colorScheme of SCHEMES) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        reducedMotion: "reduce",
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      try {
        for (const [name, path] of Object.entries(pages)) {
          const result = await page.goto(path, { waitUntil: "networkidle" });
          expect(result?.status(), path).toBe(name === "404" ? 404 : 200);
          await page.evaluate(() => document.fonts.ready);
          const tall = await page.evaluate(() => document.documentElement.scrollHeight > 16000);
          await page.screenshot({
            path: join(dir!, `${name}-${width}-${colorScheme}.png`),
            // Software WebGL captures can become blank beyond 16384px. Capture those pages' opening and end.
            fullPage: !tall,
            animations: "disabled",
          });
          if (!tall) {
            await page.screenshot({path:join(dir!,`${name}-${width}-${colorScheme}-opening.png`),animations:"disabled"});
          }
          if (tall) {
            await page.locator("body > footer").scrollIntoViewIfNeeded();
            await page.screenshot({path:join(dir!,`${name}-${width}-${colorScheme}-end.png`),animations:"disabled"});
          }
        }
      } finally {
        await context.close();
      }
    }
  }
});
