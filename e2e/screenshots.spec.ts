// Design screenshots for review (docs/decisions.md, Site). Not part of CI: runs only when SCREENSHOTS_DIR is set.
//   SCREENSHOTS_DIR=<folder> npm run test:e2e -- screenshots
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { allPages } from "./pages.ts";

const dir = process.env.SCREENSHOTS_DIR;
const WIDTHS = [320, 390, 1280];
const SCHEMES = ["light", "dark"] as const;

test.skip(!dir, "Set SCREENSHOTS_DIR to capture design screenshots.");

function shotName(path: string): string {
  if (path === "/") return "home";
  if (path === "/no-such-page/") return "404";
  return path.replace(/^\/|\/$/g, "").replaceAll("/", "-");
}

test("capture actual pages at mobile and desktop widths in both themes", async ({ browser }) => {
  test.setTimeout(300_000);
  const pages = allPages();
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
        for (const path of pages) {
          const name = shotName(path);
          const result = await page.goto(path, { waitUntil: "networkidle" });
          expect(result?.status(), path).toBe(path === "/no-such-page/" ? 404 : 200);
          await page.evaluate(() => document.fonts.ready);
          const tall = await page.evaluate(() => document.documentElement.scrollHeight > 16000);
          await page.screenshot({
            path: join(dir!, `${name}-${width}-${colorScheme}.png`),
            fullPage: !tall,
            animations: "disabled",
          });
          if (!tall) {
            await page.screenshot({ path: join(dir!, `${name}-${width}-${colorScheme}-opening.png`), animations: "disabled" });
          }
          if (tall) {
            await page.locator("body > footer").scrollIntoViewIfNeeded();
            await page.screenshot({ path: join(dir!, `${name}-${width}-${colorScheme}-end.png`), animations: "disabled" });
          }
        }
      } finally {
        await context.close();
      }
    }
  }
});
