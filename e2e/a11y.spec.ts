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
