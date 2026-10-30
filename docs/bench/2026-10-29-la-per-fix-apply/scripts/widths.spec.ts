// The pages whose text #204 changed, at 320 px and 1280 px: no sideways scroll, and the apply step's text is laid out
// inside the page. Copied into e2e/ inside the container only; not part of CI.
import { expect, test } from "@playwright/test";

for (const width of [320, 1280]) {
  test(`home and start at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/start/"]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      console.log(`${path} ${width}px scrollWidth=${scroll} clientWidth=${client}`);
      expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(client);
    }
    await page.getByText("3 · Validate, then apply", { exact: true }).click();
    for (const selector of [".apply-branches", ".apply-needs"]) {
      const box = await page.locator(selector).boundingBox();
      console.log(`${selector} ${width}px x=${box?.x} width=${box?.width}`);
      expect(box && box.x >= 0 && box.x + box.width <= width, `${selector} at ${width}px`).toBe(true);
    }
  });
}
