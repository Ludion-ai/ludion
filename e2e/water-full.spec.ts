// Every moment of the water contrast check, written out box by box. Skipped unless asked for: it measures, it does
// not judge. docs/decisions/2026-11-02-le2e-water-sampling.md says what each value is; docs/bench/le2e/ holds the results.
//   WATER_FULL_OUT=<folder> WATER_FULL_ARM=running|paused npx playwright test e2e/water-full.spec.ts --workers=2
// WATER_FULL_TIMES=<file> visits other water times on the paused clock: JSON, { "<slug>": [milliseconds, ascending] }.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { PNG } from "pngjs";
import { boxContrast, clipAround, FIRST_MS, HIDE_TEXT, MOMENT_STEP_MS, SCREEN, targets, thresholdOf, waterMoments, waterPages } from "./water-contrast.ts";

const out = process.env.WATER_FULL_OUT;
const arm = process.env.WATER_FULL_ARM ?? "paused";
const times = process.env.WATER_FULL_TIMES ? (JSON.parse(readFileSync(process.env.WATER_FULL_TIMES, "utf8")) as Record<string, number[]>) : null;
test.skip(!out, "Measurement only: set WATER_FULL_OUT.");

/** Sends the same calls on; only remembers the last water time sent to the shader and how many frames were drawn. */
function observeWater() {
  const P = WebGL2RenderingContext.prototype;
  const obs = { t: -1, draws: 0 };
  (globalThis as unknown as { __waterObs: typeof obs }).__waterObs = obs;
  const names = new WeakMap<WebGLUniformLocation, string>();
  const getLocation = P.getUniformLocation, uniform1f = P.uniform1f, drawArrays = P.drawArrays;
  P.getUniformLocation = function (program, name) {
    const location = getLocation.call(this, program, name);
    if (location) names.set(location, name);
    return location;
  };
  P.uniform1f = function (location, value) {
    if (location && names.get(location) === "uTime") obs.t = value! * 2; // water.js sends t * 0.5
    return uniform1f.call(this, location, value);
  };
  P.drawArrays = function (mode, first, count) {
    obs.draws++;
    return drawArrays.call(this, mode, first, count);
  };
}

for (const { path } of waterPages) {
  for (const colorScheme of ["light", "dark"] as const) {
    const slug = `${path.replace(/\//g, "_")}${colorScheme}`;
    const list = times ? (times[slug] ?? []) : waterMoments(path, colorScheme);
    test(`every moment of the water (${path}, ${colorScheme})`, async ({ browser }) => {
      test.skip(list.length === 0, "No water times asked for on this page.");
      test.setTimeout(600_000);
      const started = Date.now();
      const context = await browser.newContext({ viewport: { width: 1280, height: SCREEN }, colorScheme });
      const page = await context.newPage();
      await page.addInitScript(observeWater);
      await page.clock.install({ time: 0 });
      if (arm === "paused") await page.clock.pauseAt(1000);
      await page.goto(path);
      const hasWater = await page.evaluate(() => document.documentElement.classList.contains("has-water"));
      if (!hasWater) throw new Error("No WebGL2: a skipped page is a failed measurement.");

      await page.evaluate(() => document.fonts.ready);
      await page.clock.runFor(FIRST_MS);
      await page.waitForFunction(() => document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).every((a) => a.playState === "finished" || a.playState === "idle"));
      const boxes = await targets(page, SCREEN);
      await page.addStyleTag({ content: HIDE_TEXT });
      const { clip, left, top } = clipAround(boxes);
      const observe = () => page.evaluate(() => (globalThis as unknown as { __waterObs: { t: number; draws: number } }).__waterObs);
      const drawsAtStart = (await observe()).draws;

      const rows = [];
      let now = FIRST_MS;
      for (let k = 0; k < list.length; k++) {
        const t0 = Date.now();
        if (arm === "paused") await page.clock.fastForward(list[k]! - now);
        else await page.clock.runFor(MOMENT_STEP_MS);
        now = list[k]!;
        const t1 = Date.now();
        const before = await observe();
        const png = await page.screenshot({ clip });
        const t2 = Date.now();
        const after = await observe();
        const shot = PNG.sync.read(png);
        rows.push({
          k, ms: list[k]!,
          tBefore: before.t, tAfter: after.t, drawsBefore: before.draws, drawsAfter: after.draws,
          stepMs: t1 - t0, shotMs: t2 - t1,
          values: Object.fromEntries(boxes.map((box) => [box.name, boxContrast(shot, box, left, top)])),
        });
      }
      await context.close();
      mkdirSync(out!, { recursive: true });
      writeFileSync(join(out!, `${slug}.json`), JSON.stringify({
        path, colorScheme, arm, moments: list.length, stepMs: MOMENT_STEP_MS, totalMs: Date.now() - started, drawsAtStart,
        boxes: boxes.map((b) => ({ ...b, needs: thresholdOf(b) })),
        rows,
      }));
    });
  }
}
