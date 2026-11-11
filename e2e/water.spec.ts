// The water on every page that has a pool: text contrast over the canvas, and the home JavaScript budget.
// axe can't see text drawn over a canvas, so this measures it directly: hide the text, step the water's clock,
// screenshot, and take the worst background pixel under each text box (docs/decisions.md, Site; water.js).
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { boxContrast, clipAround, FIRST_MS, HIDE_TEXT, SCREEN, targets, thresholdOf, waterMoments, waterPages } from "./water-contrast.ts";

for (const { path } of waterPages) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`text over the water keeps its contrast (${path}, ${colorScheme})`, async ({ browser }) => {
      // CI renders WebGL in software, so keep each screenshot small (only the text area) and allow time.
      test.setTimeout(240_000);
      const url = path;
      const context = await browser.newContext({ viewport: { width: 1280, height: SCREEN }, colorScheme });
      const page = await context.newPage();
      // Paused from before the page loads: a frame depends on its water time alone, and each moment draws one frame
      // (a running clock made the moments depend on the machine and drew 9 to 25 frames each, in software on CI).
      await page.clock.install({ time: 0 });
      await page.clock.pauseAt(1000);
      await page.goto(url);
      const hasWater = await page.evaluate(() => document.documentElement.classList.contains("has-water"));
      test.skip(!hasWater, "No WebGL2 in this browser: the page is plain design B, which axe covers.");

      await page.evaluate(() => document.fonts.ready);
      await page.clock.runFor(FIRST_MS);

      const coverage = await page.evaluate(() => {
        const el = document.querySelector<HTMLCanvasElement>("canvas.water")!;
        const canvas = el.getBoundingClientRect();
        const pool = document.querySelector<HTMLElement>("[data-water]")!.getBoundingClientRect();
        const oldHeight = Math.min(pool.height + 64, 760);
        return {
          top: canvas.top, bottom: canvas.bottom, oldBottom: pool.top - 24 + oldHeight,
          pixels: el.width * el.height,
          maxPixels: canvas.width * oldHeight * Math.min(devicePixelRatio || 1,1.5) ** 2 + el.width + el.height,
        };
      });
      expect(coverage.top, "water reaches the page top").toBeCloseTo(0, 0);
      expect(coverage.bottom, "water keeps its previous lower edge").toBeCloseTo(coverage.oldBottom, 0);
      expect(coverage.pixels,"extended wave keeps the old raster-pixel budget").toBeLessThanOrEqual(coverage.maxPixels);

      // Let the text finish arriving (CSS animations run on real time), then record where every piece of text is.
      // Decorative context-flow paths are continuous and have no moving text. Wait for finite arrivals only.
      await page.waitForFunction(() => document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).every((a) => a.playState === "finished" || a.playState === "idle"));
      const boxes = await targets(page, SCREEN);
      expect(boxes.length, url).toBeGreaterThan(3);

      await page.addStyleTag({ content: HIDE_TEXT });
      const { clip, left, top } = clipAround(boxes);
      const worst = new Map<string, number>();
      const frames = new Set<string>();
      let now = FIRST_MS;
      for (const moment of waterMoments(path, colorScheme)) {
        await page.clock.fastForward(moment - now);
        now = moment;
        const shot = PNG.sync.read(await page.screenshot({ clip }));
        for (const box of boxes) worst.set(box.name, Math.min(worst.get(box.name) ?? Infinity, boxContrast(shot, box, left, top)));
        frames.add(createHash("sha256").update(shot.data).digest("hex"));
      }
      // A paused clock that stopped reaching the water would show one frame again and again, and still pass. This reads
      // the pixels: on some light pages every box keeps the same lowest value at every moment while the water moves.
      expect(frames.size, "the water moved between moments").toBeGreaterThan(1);

      const report = boxes.map((b) => `${b.name}: ${worst.get(b.name)!.toFixed(2)} (needs ${thresholdOf(b)})`);
      const lowest = [...report].sort((x, y) => parseFloat(x.split(": ")[1]!) - parseFloat(y.split(": ")[1]!)).slice(0, 8);
      console.log(`Worst contrast over the water (${url}, ${colorScheme}), lowest first:\n  ${lowest.join("\n  ")}`);
      const failing = boxes.filter((b) => worst.get(b.name)! < thresholdOf(b));
      expect(failing.map((b) => report[boxes.indexOf(b)]), "text whose background got too close to its color").toEqual([]);
      await context.close();
    });
  }
}

test("the home page's JavaScript stays within 60 KB gzipped", async ({ page }) => {
  // Keep each body's promise and wait for all of them: summing as they arrive raced the end of the test, so a run
  // counted only the scripts whose bodies had come back (1, 6 or 8 files) or failed with "response.body: Test ended".
  const bodies: Promise<Buffer>[] = [];
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") bodies.push(res.body());
  });
  await page.goto("/", { waitUntil: "networkidle" });
  const scripts = await Promise.all(bodies);
  const total = scripts.reduce((sum, body) => sum + gzipSync(body).length, 0);
  console.log(`Home JavaScript: ${scripts.length} file(s), ${(total / 1024).toFixed(1)} KB gzipped`);
  expect(scripts.length).toBeGreaterThan(0);
  expect(total).toBeLessThanOrEqual(60 * 1024);
});
