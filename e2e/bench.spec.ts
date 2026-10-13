// /bench: the old /models address redirects to it, and each model page's share card is a 1200×630 PNG.
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("/models redirects to /bench", async ({ request }) => {
  for (const path of ["/models", "/models/"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(301);
    expect(new URL(res.headers()["location"]!, "http://x").pathname, path).toBe("/bench/");
  }
});

test("each model page names its share card, and the card is a 1200×630 PNG", async ({ page, request }) => {
  const bench = (await (await request.get("/bench.json")).json()) as { done3: { rows: { model: string }[] } | null };
  const ids = [...new Set((bench.done3?.rows ?? []).map((r) => r.model))];
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    await page.goto(`/bench/${id}/`);
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image).toBe(`https://ludion.ai/bench/og/${id}.png`);
    expect(await page.locator('meta[name="twitter:card"]').getAttribute("content")).toBe("summary_large_image");
    const res = await request.get(`/bench/og/${id}.png`);
    expect(res.status()).toBe(200);
    const png = PNG.sync.read(await res.body());
    expect([png.width, png.height]).toEqual([1200, 630]);
  }
});

test("/bench, /lessons, and a lesson never scroll sideways, at any width their layouts switch around", async ({ page }) => {
  for (const path of ["/bench/", "/lessons/", "/lessons/01M4T6BQ9DJH2BCV6Q28GH4HJ1/"]) {
    for (const width of [360, 390, 700, 761, 800, 900, 1010, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const res = await page.goto(path);
      if (res?.status() === 404) break; // a lesson id that a later main no longer has
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(client);
    }
  }
});
