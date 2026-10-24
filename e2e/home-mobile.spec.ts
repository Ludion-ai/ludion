import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true });

const phones = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

async function reflow(page: Page) {
  const width = page.viewportSize()!.width;
  const sizes = await page.evaluate(() => ({ layout: document.documentElement.clientWidth, content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(sizes.layout).toBe(width);
  expect(sizes.content).toBeLessThanOrEqual(width + 1);
  expect(sizes.viewport).toBeLessThanOrEqual(width + 1);
}

async function touchTargets(locator: Locator, width: number) {
  const targets = await locator.evaluateAll((items) => items.map((el) => {
    const rect = el.getBoundingClientRect();
    return { name: el.textContent?.trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  }));
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.width, `${target.name}: touch width`).toBeGreaterThanOrEqual(24);
    expect(target.height, `${target.name}: touch height`).toBeGreaterThanOrEqual(24);
    expect(target.left, `${target.name}: left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(target.right, `${target.name}: right edge`).toBeLessThanOrEqual(width + 0.5);
  }
}

async function resizeText(page: Page) {
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll("*")].map((el) => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }));
    for (const { el, size } of sizes) if (el instanceof HTMLElement || el instanceof SVGElement) el.style.fontSize = `${size * 2}px`;
  });
}

test("a phone does not scroll sideways and keeps reachable controls", async ({ page }) => {
  for (const viewport of phones) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("[data-delivery-target=install]")).toBeVisible();
    await expect(page.locator("[data-trace-step=guard]")).toBeVisible();
    await reflow(page);
    await touchTargets(page.locator(".site-header nav a"), viewport.width);
    await touchTargets(page.locator("[data-trace-step]"), viewport.width);
    await touchTargets(page.locator("[data-delivery-target]"), viewport.width);
    await expect(page.locator("[data-delivery-target=install]")).toContainText("Install dependencies");
    await expect(page.locator("[data-delivery-target=run]")).toContainText("Run program and verifier");
    await expect(page.locator("[data-delivery-target=apply]")).toContainText("apply (planned)");
    await reflow(page);
  }
});

test("200 percent text keeps the design on the phone", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await resizeText(page);
    await reflow(page);
    await expect(page.locator("h1")).toContainText("Not a description.");
    await expect(page.locator("h1")).toContainText("Designed as a guarded, checkable capability.");
    await expect(page.locator("[data-guard-state]")).toHaveCount(4);
    await expect(page.locator("#receipt")).toContainText("Pending");
    await expect(page.locator("#isolate")).toContainText("Design example, not a run result.");
    await expect(page.locator("[data-delivery-target=run]")).toBeVisible();
    await reflow(page);
  }
});
