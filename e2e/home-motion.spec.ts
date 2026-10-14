import { expect, test, type Locator, type Page } from "@playwright/test";
import semver from "semver";
import type { IndexEntry } from "@ludion/core";

type ShardLesson = IndexEntry & { models?: Record<string, "knows" | "misses"> };

const transforms = (papers: Locator) => papers.evaluateAll(items => items.map(item => item.getAttribute("transform")));

// Exercise the same visibility event a background tab delivers without relying on
// headless Chrome's platform-specific handling of bringToFront().
async function hidden(page: Page, value: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

test("paper diagrams show the actual package population and retain unmeasured lessons through the model gate", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const lens = page.locator("[data-project-lens]");
  const selected = lens.locator("[data-lens-case]:not([hidden])");
  for (const [project, subject, version] of [["vitest-5", "vitest", "5.0.3"], ["vitest-4", "vitest", "4.0.0"], ["wrangler-current", "wrangler", "4.148.0"]] as const) {
    const shard = await (await request.get(`/index/${subject}.json`)).json() as { lessons: ShardLesson[] };
    await lens.locator("[data-lens-project]").selectOption(project);
    for (const model of ["claude-haiku-5-5", "claude-opus-5-5"]) {
      await lens.locator("[data-lens-model]").selectOption(model);
      const expected = { unmatched: 0, known: 0, misses: 0, unmeasured: 0 };
      for (const lesson of shard.lessons) {
        const state = !semver.satisfies(version, lesson.version!, { includePrerelease: true })
          ? "unmatched" : lesson.models?.[model] === "knows" ? "known" : lesson.models?.[model] === "misses" ? "misses" : "unmeasured";
        expected[state]++;
      }
      // Both responsive drawings depict the entire population, not just the three disclosed previews.
      for (const drawing of [".machine-wide", ".machine-tall"]) {
        const diagram = selected.locator(drawing);
        await expect(diagram).toHaveAttribute("aria-hidden", "true");
        await expect(diagram.locator("[data-lens-token]")).toHaveCount(shard.lessons.length);
        for (const state of Object.keys(expected) as (keyof typeof expected)[]) {
          await expect(diagram.locator(`[data-lens-token][data-state="${state}"]`)).toHaveCount(expected[state]);
        }
      }
      await expect(selected.locator(".included-count b")).toHaveText(String(expected.misses + expected.unmeasured));
      await expect(selected.locator("[data-lens-inspection]")).not.toHaveAttribute("open", "");
    }
  }
});

test("selection makes the paper route move, then settles and stops offscreen or with reduced motion", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const lens = page.locator("[data-project-lens]");
  await lens.scrollIntoViewIfNeeded();
  const selected = lens.locator("[data-lens-case]:not([hidden])");
  const papers = selected.locator(".machine-wide [data-lens-token]");
  await lens.locator("[data-lens-model]").selectOption("claude-opus-5-5");
  await page.clock.runFor(100);
  const start = await transforms(papers);
  await page.clock.runFor(900);
  expect(await transforms(papers)).not.toEqual(start);
  await page.clock.runFor(2500);
  const end = await transforms(papers);
  await expect(lens).toHaveAttribute("data-lens-progress", "1");
  await page.clock.runFor(500);
  expect(await transforms(papers)).toEqual(end);
  // Unknown knowledge is included; its paper remains fully present in the final context.
  expect(await selected.locator('.machine-wide [data-state="unmeasured"]').count()).toBeGreaterThan(0);
  expect(await selected.locator('.machine-wide [data-state="unmeasured"]').evaluateAll(items => items.every(item => (item as SVGGElement).style.opacity === "1"))).toBe(true);
  await lens.locator("[data-lens-model]").selectOption("claude-haiku-5-5");
  await page.clock.runFor(300);
  await page.locator("h1").scrollIntoViewIfNeeded();
  await page.clock.runFor(100);
  // IntersectionObserver is a native browser task; wait for its notification
  // before advancing the mocked animation clock through the background period.
  await expect(lens).toHaveAttribute("data-lens-playing", "false");
  const offscreen = await transforms(papers);
  await page.clock.runFor(3000);
  expect(await transforms(papers)).toEqual(offscreen);
  await lens.scrollIntoViewIfNeeded();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await lens.locator("[data-lens-model]").selectOption("claude-opus-5-5");
  await page.clock.runFor(100);
  const reduced = await transforms(papers);
  await page.clock.runFor(3000);
  expect(await transforms(papers)).toEqual(reduced);
  await expect(lens).toHaveAttribute("data-lens-progress", "1");
});

test("inheritance comparison draws a moving old and current route, then honors reduced motion and offscreen pause", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const trace = page.locator("[data-lesson-trace]");
  const graphic = trace.locator("[data-trace-graphic]");
  const papers = graphic.locator("[data-trace-paper]");
  await graphic.scrollIntoViewIfNeeded();
  await trace.locator('[data-trace-step="teacher"]').press("Enter");
  await trace.locator('[data-trace-step="change"]').press("Enter");
  await page.clock.runFor(150);
  await expect(trace).toHaveAttribute("data-trace-moving", "true");
  const start = await transforms(papers);
  await page.clock.runFor(800);
  expect(await transforms(papers)).not.toEqual(start);
  await page.clock.runFor(2200);
  await expect(trace).toHaveAttribute("data-trace-moving", "false");
  const end = await transforms(papers);
  await page.clock.runFor(300);
  expect(await transforms(papers)).toEqual(end);
  await trace.locator('[data-trace-step="teacher"]').press("Enter");
  await trace.locator('[data-trace-step="change"]').press("Enter");
  await page.clock.runFor(300);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.runFor(100);
  await expect(trace).toHaveAttribute("data-trace-moving", "false");
  const reduced = await transforms(papers);
  await page.clock.runFor(3000);
  expect(await transforms(papers)).toEqual(reduced);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await trace.locator('[data-trace-step="teacher"]').press("Enter");
  await trace.locator('[data-trace-step="change"]').press("Enter");
  await page.clock.runFor(300);
  await page.locator("h1").scrollIntoViewIfNeeded();
  await page.clock.runFor(100);
  await expect(trace).toHaveAttribute("data-trace-moving", "false");
  const offscreen = await transforms(papers);
  await page.clock.runFor(3000);
  expect(await transforms(papers)).toEqual(offscreen);
});

test("delivery distinguishes reference wiring from inline copies and halts active scenes when the document is hidden", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const delivery = page.locator("[data-delivery]");
  await delivery.locator("[data-delivery-visual]").scrollIntoViewIfNeeded();
  await page.clock.runFor(2700);
  for (const [id, mode] of [["cursor", "inline"], ["codex", "reference"]] as const) {
    await delivery.locator(`[data-delivery-target="${id}"]`).press("Enter");
    await expect(delivery.locator(".destination-file")).toHaveAttribute("data-mode", mode);
    const received = delivery.locator(".world-received");
    await page.clock.runFor(120);
    const before = await received.evaluate(item => getComputedStyle(item).opacity);
    await page.clock.runFor(1900);
    const after = await received.evaluate(item => getComputedStyle(item).opacity);
    expect(Number(after)).toBeGreaterThan(Number(before));
    await page.clock.runFor(800);
    await expect(received).toHaveCSS("opacity", "1");
  }
  await delivery.locator("[data-delivery-replay]").press("Enter");
  await page.clock.runFor(400);
  await expect(delivery).toHaveAttribute("data-delivery-playing", "true");
  await hidden(page, true);
  await expect(delivery).toHaveAttribute("data-delivery-playing", "false");
  const paused = await delivery.locator(".packet").getAttribute("style");
  await page.clock.runFor(3000);
  expect(await delivery.locator(".packet").getAttribute("style")).toBe(paused);
  await hidden(page, false);
  await page.clock.runFor(100);
  await expect(delivery).toHaveAttribute("data-delivery-playing", "false");
  // Restoring visibility settles the scene; it does not secretly restart an endless replay.
  await expect(delivery.locator(".world-received")).toHaveCSS("opacity", "1");
});

test("hiding the document cancels the package and inheritance replays without continuing background movement", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const lens = page.locator("[data-project-lens]");
  await lens.scrollIntoViewIfNeeded();
  await lens.locator("[data-lens-model]").selectOption("claude-opus-5-5");
  await page.clock.runFor(200);
  await expect(lens).toHaveAttribute("data-lens-playing", "true");
  await hidden(page, true);
  await expect(lens).toHaveAttribute("data-lens-playing", "false");
  const lensPapers = lens.locator("[data-lens-case]:not([hidden]) .machine-wide [data-lens-token]");
  const settled = await transforms(lensPapers);
  await page.clock.runFor(3000);
  expect(await transforms(lensPapers)).toEqual(settled);
  await hidden(page, false);
  const trace = page.locator("[data-lesson-trace]");
  await trace.locator("[data-trace-graphic]").scrollIntoViewIfNeeded();
  await trace.locator('[data-trace-step="teacher"]').press("Enter");
  await trace.locator('[data-trace-step="change"]').press("Enter");
  await page.clock.runFor(200);
  await expect(trace).toHaveAttribute("data-trace-moving", "true");
  await hidden(page, true);
  await expect(trace).toHaveAttribute("data-trace-moving", "false");
  const tracePapers = trace.locator("[data-trace-paper]");
  const paused = await transforms(tracePapers);
  await page.clock.runFor(3000);
  expect(await transforms(tracePapers)).toEqual(paused);
  await hidden(page, false);
});
