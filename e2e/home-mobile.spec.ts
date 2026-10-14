import { expect, test, type Locator, type Page } from "@playwright/test";
import semver from "semver";
import type { IndexEntry } from "@ludion/core";

test.use({ isMobile: true, hasTouch: true });

const EXTENDS = "01M4N4KZ0QT41TY27SW0E683RX";
const RESTORE = "01M4T6BQ9DJH2BCV6Q28GH4HJ1";
const phones = [
  { width: 320, height: 740 }, { width: 360, height: 800 },
  { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 844, height: 390 },
];
type ShardLesson = IndexEntry & { models?: Record<string, "knows" | "misses"> };

async function reflow(page: Page) {
  const width = page.viewportSize()!.width;
  const sizes = await page.evaluate(() => ({ layout: document.documentElement.clientWidth, content: document.documentElement.scrollWidth, viewport: innerWidth }));
  // A mobile browser can shrink the page to an overflowing layout. Comparing
  // scrollWidth only to innerWidth would incorrectly call that readable reflow.
  expect(sizes.layout).toBe(width);
  expect(sizes.content).toBeLessThanOrEqual(width + 1);
  expect(sizes.viewport).toBeLessThanOrEqual(width + 1);
}

async function touchTargets(locator: Locator, width: number) {
  const targets = await locator.evaluateAll(items => items.map(el => {
    const rect = el.getBoundingClientRect();
    return { name: el.textContent?.trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  }));
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.width, `${target.name}: touch width`).toBeGreaterThanOrEqual(43.5);
    expect(target.height, `${target.name}: touch height`).toBeGreaterThanOrEqual(43.5);
    expect(target.left, `${target.name}: left edge`).toBeGreaterThanOrEqual(-.5);
    expect(target.right, `${target.name}: right edge`).toBeLessThanOrEqual(width + .5);
  }
}

async function unclippedText(locator: Locator) {
  const failures = await locator.evaluateAll(items => items.flatMap(el => {
    const bounds = el.getBoundingClientRect();
    const result: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest(".visually-hidden,[hidden]")) continue;
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) result.push(node.textContent.trim());
      }
    }
    return result;
  }));
  expect(failures, "Visible control text must remain inside its target").toEqual([]);
}

async function selectedLabelsFit(selects: Locator) {
  const failures = await selects.evaluateAll(items => items.flatMap(item => {
    const select = item as HTMLSelectElement;
    const style = getComputedStyle(select);
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const label = select.selectedOptions[0]!.textContent!;
    const available = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (ctx.measureText(label).width <= available + 1) return [];
    // Native selects cannot wrap a chosen value. At enlarged text sizes, a
    // visible associated readout must show that complete, unchanged value.
    const mirror = select.closest("label")?.querySelector<HTMLElement>("[data-lens-selected]");
    if (!mirror || mirror.textContent?.trim() !== label.trim()) return [label];
    const mirrorStyle = getComputedStyle(mirror), rect = mirror.getBoundingClientRect();
    const shown = mirrorStyle.display !== "none" && mirrorStyle.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    return shown && rect.left >= -.5 && rect.right <= document.documentElement.clientWidth + .5 ? [] : [label];
  }));
  expect(failures, "The complete selected project/model must fit or have a visible full-value readout").toEqual([]);
}

async function resizeText(page: Page) {
  // Simulate text-only 200% resizing. This is deliberately not pinch/page zoom:
  // text doubles, while the device viewport and non-text dimensions stay fixed.
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll("*")].map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize) }));
    for (const { el, size } of sizes) if (el instanceof HTMLElement || el instanceof SVGElement) el.style.fontSize = `${size * 2}px`;
  });
}

test("phone compositions keep real selection, readable diagrams and reachable touch targets", async ({ page, request }) => {
  const shard = await (await request.get("/index/vitest.json")).json() as { lessons: ShardLesson[] };
  for (const viewport of phones) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: viewport.width === 390 ? "dark" : "light" });
    await page.goto("/"); await page.evaluate(() => document.fonts.ready);
    await reflow(page);
    await touchTargets(page.locator(".site-header nav a"), viewport.width);
    const lens = page.locator("[data-project-lens]"), current = lens.locator("[data-lens-case]:not([hidden])");
    await touchTargets(lens.locator("select"), viewport.width);
    const fontSizes = await lens.locator("select").evaluateAll(items => items.map(el => parseFloat(getComputedStyle(el).fontSize)));
    expect(fontSizes.every(size => size >= 16)).toBe(true);
    await lens.locator("[data-lens-model]").selectOption("claude-opus-5-5");
    const matching = shard.lessons.filter(lesson => semver.satisfies("5.0.3", lesson.version!, { includePrerelease: true }));
    const included = matching.filter(lesson => lesson.models?.["claude-opus-5-5"] !== "knows");
    await expect(current.locator(".selection-flow b")).toHaveText([String(shard.lessons.length), String(matching.length), String(included.length)]);
    const diagram = current.locator(".machine-tall");
    await expect(diagram).toBeVisible(); await expect(current.locator(".machine-wide")).toBeHidden();
    await diagram.scrollIntoViewIfNeeded();
    const readable = await diagram.locator("text").evaluateAll(items => items.map(el => {
      const text = el as SVGTextElement, matrix = text.getScreenCTM()!, bounds = text.getBoundingClientRect(), outer = text.ownerSVGElement!.getBoundingClientRect();
      return { text: text.textContent, font: parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b), contained: bounds.left >= outer.left - 1 && bounds.right <= outer.right + 1 && bounds.top >= outer.top - 1 && bounds.bottom <= outer.bottom + 1 };
    }));
    expect(readable.map(item => item.text)).toEqual(["Version", "Model", "Context"]);
    expect(readable.every(item => item.font >= 11.5 && item.contained), JSON.stringify(readable)).toBe(true);
    await current.locator("[data-lens-inspection] > summary").tap();
    await touchTargets(current.locator("[data-lens-select]"), viewport.width);
    await current.locator(`[data-lens-select="${RESTORE}"]`).tap();
    const lesson = current.locator(`[data-lens-lesson="${RESTORE}"]`);
    await expect(lesson.locator(".generated-claim")).toHaveText(shard.lessons.find(item => item.id === RESTORE)!.claim);
    await expect(lesson.locator(".verdict")).toHaveText("Not measured · included");
    await expect(lesson.locator(".signature")).toContainText("drafted by an agent");
    await expect(lens.locator(".lens-scope")).toContainText("Coverage is partial");
    await touchTargets(page.locator("[data-trace-step]"), viewport.width);
    await unclippedText(page.locator("[data-trace-step]"));
    const delivery = page.locator("[data-delivery]");
    await touchTargets(delivery.locator("[data-delivery-target]"), viewport.width);
    await delivery.locator('[data-delivery-target="cursor"]').tap();
    await expect(delivery.locator("[data-mobile-delivery]")).toBeVisible();
    await expect(delivery.locator("[data-mobile-destination]")).toHaveAttribute("data-mode", "inline");
    await expect(delivery.locator("[data-mobile-destination] [data-static-destination]")).toHaveText(".cursor/rules/ludion.mdc");
    await expect(delivery.locator("[data-mobile-mode]")).toHaveText("Inline context");
    await unclippedText(delivery.locator("[data-mobile-destination]"));
    await expect(delivery.locator(".delivery-scope")).toContainText("No files are changed here");
    await reflow(page);
  }
});

test("portrait and landscape reflow preserve chosen facts, native disclosures and keyboard focus", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" }); await page.goto("/");
  const index = await (await request.get("/index.json")).json() as { lessons: IndexEntry[] };
  const trace = page.locator("[data-lesson-trace]"), lens = page.locator("[data-project-lens]"), delivery = page.locator("[data-delivery]");
  await lens.locator("[data-lens-model]").selectOption("claude-opus-5-5");
  await lens.locator("[data-lens-case]:not([hidden]) [data-lens-inspection] > summary").tap();
  await trace.locator(".trace-claim > summary").tap();
  await trace.locator('[data-trace-step="teacher"]').tap();
  await delivery.locator('[data-delivery-target="cursor"]').tap();
  await delivery.locator('[data-wiring-route="cursor"] .wiring-details > summary').tap();
  const teacher = trace.locator('[data-trace-step="teacher"]'); await teacher.focus();
  for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 740 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport);
    await expect(teacher).toBeFocused(); await expect(teacher).toHaveAttribute("aria-pressed", "true");
    await expect(trace.locator('[data-trace-panel="teacher"]')).toBeVisible();
    await expect(trace.locator(".generated-claim")).toHaveText(index.lessons.find(item => item.id === EXTENDS)!.claim);
    await expect(trace.locator(".trace-signature")).toContainText("drafted by an agent");
    await expect(trace.locator(".trace-claim")).toHaveAttribute("open", "");
    await expect(lens.locator("[data-lens-model]")).toHaveValue("claude-opus-5-5");
    await expect(lens.locator("[data-lens-case]:not([hidden]) [data-lens-inspection]")).toHaveAttribute("open", "");
    await expect(delivery.locator('[data-wiring-route="cursor"] .wiring-details')).toHaveAttribute("open", "");
    await expect(delivery.locator('[data-delivery-target="cursor"]')).toHaveAttribute("aria-pressed", "true");
    await reflow(page);
  }
  await page.getByRole("link", { name: "See it work", exact: true }).tap();
  await expect(page).toHaveURL(/#in-context$/);
  await expect(page.locator("[data-moment]")).toBeVisible();
});

test("200 percent text-only resizing retains controls, selected labels and complete evidence without shrinking the mobile page", async ({ page }) => {
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/"); await page.evaluate(() => document.fonts.ready); await resizeText(page);
    await reflow(page);
    await unclippedText(page.locator(".site-header nav a"));
    const lens = page.locator("[data-project-lens]"), trace = page.locator("[data-lesson-trace]"), delivery = page.locator("[data-delivery]");
    await lens.locator("[data-lens-model]").selectOption("claude-sonnet-5-5");
    await selectedLabelsFit(lens.locator("select"));
    await unclippedText(trace.locator("[data-trace-step]"));
    await trace.locator(".trace-claim > summary").tap(); await trace.locator('[data-trace-step="evidence"]').tap();
    await expect(trace.locator(".generated-claim")).toBeVisible(); await expect(trace.locator(".trace-signature")).toContainText("drafted by an agent");
    await expect(trace.locator('[data-trace-panel="evidence"] .panel-note')).toContainText("not a live test run");
    await delivery.locator('[data-delivery-target="cursor"]').tap();
    await delivery.locator('[data-wiring-route="cursor"] .wiring-details > summary').tap();
    await unclippedText(delivery.locator("[data-mobile-destination]"));
    await expect(delivery.locator('[data-wiring-route="cursor"] pre code')).toContainText("alwaysApply: true");
    await expect(delivery.locator(".delivery-scope")).toContainText("Coverage is partial");
    await reflow(page);
  }
});

test("the native phone delivery animates into its actual destination and settles under reduced motion", async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.goto("/");
  const delivery = page.locator("[data-delivery]"), packet = delivery.locator("[data-mobile-packet]"), received = delivery.locator("[data-mobile-received]");
  await delivery.locator("[data-mobile-delivery]").scrollIntoViewIfNeeded();
  await expect(delivery).toHaveAttribute("data-delivery-playing", "true"); await page.clock.fastForward(2700);
  await delivery.locator('[data-delivery-target="cursor"]').tap();
  await expect(delivery).toHaveAttribute("data-delivery-playing", "true"); await page.clock.runFor(100);
  const initial = await packet.evaluate(el => getComputedStyle(el).transform);
  await page.clock.runFor(800);
  expect(await packet.evaluate(el => getComputedStyle(el).transform)).not.toBe(initial);
  await page.clock.fastForward(2200);
  await expect(delivery).toHaveAttribute("data-delivery-playing", "false"); await expect(received).toHaveCSS("opacity", "1");
  await expect(delivery.locator("[data-mobile-destination]")).toHaveAttribute("data-mode", "inline");
  await delivery.locator("[data-delivery-replay]").tap(); await expect(delivery).toHaveAttribute("data-delivery-playing", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(delivery).toHaveAttribute("data-delivery-playing", "false");
  await page.clock.runFor(100); const final = await packet.evaluate(el => getComputedStyle(el).transform);
  await page.clock.fastForward(3000);
  expect(await packet.evaluate(el => getComputedStyle(el).transform)).toBe(final);
  await expect(received).toHaveCSS("opacity", "1");
});
