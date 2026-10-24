import { expect, test } from "@playwright/test";

const EXAMPLE = "Design example, not a run result.";
const SECTIONS = ["guard", "verify", "isolate", "receipt"] as const;

test("the home page shows the design, pending results, and no lesson or bench links", async ({ page }) => {
  await page.goto("/");
  const heading = page.locator("h1");
  await expect(heading).toContainText("Not a description.");
  await expect(heading).toContainText("Designed as a guarded, checkable capability.");
  await expect(page.locator(".introduction")).toContainText("Nothing here is verified yet.");
  await expect(page.getByRole("link", { name: "Set up today's sync" }).first()).toHaveAttribute("href", "/start/");
  await expect(page.getByRole("link", { name: "Read the design", exact: true })).toHaveAttribute("href", "#guard");
  for (const id of SECTIONS) {
    const section = page.locator(`#${id}`);
    await expect(section).toBeVisible();
    await expect(section).toContainText(EXAMPLE);
  }
  await expect(page.locator("[data-guard-state]")).toHaveText([/applicable/, /inapplicable/, /unknown/, /stale/]);
  await expect(page.locator("#receipt")).toContainText("Pending");
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  expect(hrefs.filter((href) => href.includes("/lessons/") || href.includes("/bench"))).toEqual([]);
});

test("the design stays in the page without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Not a description.");
  await expect(page.locator(".introduction")).toContainText("Nothing here is verified yet.");
  await expect(page.getByRole("link", { name: "Read the design", exact: true })).toHaveAttribute("href", "#guard");
  for (const id of SECTIONS) await expect(page.locator(`#${id}`)).toContainText(EXAMPLE);
  await expect(page.locator("[data-guard-state]")).toHaveCount(4);
  await expect(page.locator("#receipt")).toContainText("Pending");
  await expect(page.locator("[data-trace-panel=receipt]")).toContainText("invalidates_on");
  await context.close();
});

test("changing reduced motion stops and resumes the wave without reloading", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  test.skip(!(await page.locator("html").getAttribute("class"))?.includes("has-water"), "WebGL unavailable");
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(1200);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-context-stage]")).not.toHaveClass(/active/);
  await page.clock.runFor(300);
  // Sample a broad area above the artwork. The quiet corner can quantize to identical pixels in two frames.
  const clip = { x: 320, y: 64, width: 640, height: 128 };
  const first = await page.screenshot({ clip });
  await page.clock.runFor(1200);
  expect((await page.screenshot({ clip })).equals(first)).toBe(true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("[data-context-stage]")).toHaveClass(/active/);
  await page.clock.runFor(1200);
  expect((await page.screenshot({ clip })).equals(first)).toBe(false);
});

test("home opens on the visual scene and scrolls to the guard", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const stage = page.locator("[data-context-stage]");
    await expect(stage).toHaveClass(/active/);
    const scene = page.locator("[data-context-projection]");
    const initial = await scene.evaluate((el) => getComputedStyle(el).getPropertyValue("--scroll"));
    const guard = page.locator("#guard");
    expect((await guard.boundingBox())!.y).toBeGreaterThanOrEqual(700);
    await page.getByRole("link", { name: "Read the design", exact: true }).click();
    await expect(page).toHaveURL(/#guard$/);
    await expect.poll(async () => (await guard.boundingBox())!.y).toBeCloseTo(40, 0);
    await expect(stage).not.toHaveClass(/active/);
    await expect(page.locator("[data-guard-state=applicable]")).toBeVisible();
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toHaveClass(/active/);
    await page.mouse.wheel(0, 250);
    await expect.poll(() => scene.evaluate((el) => getComputedStyle(el).getPropertyValue("--scroll"))).not.toBe(initial);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(stage).not.toHaveClass(/active/);
    await expect.poll(() => scene.evaluate((el) => el.getAttribute("style") ?? "")).not.toContain("--scroll");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
});
