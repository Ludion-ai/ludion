// axe on every page, light and dark (docs/decisions.md, Site). Runs in `test` on every PR.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { allPages } from "./pages.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("axe finds no violations on any page", async ({ page, request }) => {
      const pages = await allPages(request);
      // One test walks every page, and every lesson adds one: give each page its own few seconds.
      test.setTimeout(30_000 + pages.length * 5_000);
      for (const path of pages) {
        await page.goto(path);
        // Judge the finished page: wait for any one-off animation (the home page's replay) to end.
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === "finished" || a.playState === "idle"));
        const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const summary = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
        expect(summary, `axe on ${path} (${colorScheme})`).toEqual([]);
      }
    });
  });
}

test("no page scrolls sideways, from 320 px up (WCAG 1.4.10, reflow)", async ({ page, request }) => {
  // Every page, since one lesson's long name is enough to widen its page: durable_objects.code_update_strategy on a
  // phone, a long flag in the narrow claim column beside a lesson's panel at 1024 px. The share cards are fixed
  // 1200×630 images and left out.
  const pages = (await allPages(request)).filter((path) => !path.startsWith("/bench/og/"));
  const widths = [320, 390, 768, 1024];
  test.setTimeout(30_000 + pages.length * widths.length * 3_000);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of pages) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(client);
    }
  }
});

test("every page names its public URL as canonical", async ({ page, request }) => {
  const pages = await allPages(request);
  test.setTimeout(30_000 + pages.length * 2_000);
  for (const path of pages) {
    if (path === "/no-such-page/") continue;
    await page.goto(path);
    // Lesson and list pages: the trailing-slash URL. Teacher pages: /@<login>, which serves 200 directly.
    expect(await page.locator('link[rel="canonical"]').getAttribute("href"), path).toBe(`https://ludion.ai${path}`);
  }
});
