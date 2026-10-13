// The water on every page that has a pool: text contrast over the canvas, and the home JavaScript budget.
// axe can't see text drawn over a canvas, so this measures it directly: hide the text, step the water's clock,
// screenshot, and take the worst background pixel under each text box (docs/decisions.md, Site; water.js).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { gzipSync } from "node:zlib";

const MOMENTS = 40;
const STEP_MS = 300; // 40 moments over 12 s: before, during, and after the ring
const SMALL_TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;

interface Target {
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  color: [number, number, number];
  large: boolean;
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Every piece of text across the opening (including header and hero) inside the first `screen` px: its box, its
 * color, and whether WCAG counts it as large. Text on a panel with its own background (the seal, a code block) is left
 * out: the water is under the panel, not under the text. Found from the text itself (each element with its own non-blank text), so every page with
 * water is covered without a list of selectors.
 */
async function targets(page: Page, screen: number): Promise<Target[]> {
  return page.evaluate((screen) => {
    if (!document.querySelector("[data-water]")) return [];
    const out: Target[] = [];
    const seen = new Map<string, number>();
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      if (el.closest(".visually-hidden, canvas, svg")) continue;
      // Text on its own panel (the seal, a code block) sits on that panel's color, not over the water.
      let onPanel = false;
      for (let p: HTMLElement | null = el; p && p !== document.body; p = p.parentElement) {
        const bg = getComputedStyle(p).backgroundColor;
        const alpha = bg.startsWith("rgba") ? Number(bg.split(",")[3]!.replace(")", "")) : bg === "transparent" ? 0 : 1;
        if (alpha > 0) {
          onPanel = true;
          break;
        }
      }
      if (onPanel) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom + window.scrollY > screen) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const [cr, cg, cb] = style.color.match(/\d+(\.\d+)?/g)!.map(Number) as [number, number, number];
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const base = `${el.tagName.toLowerCase()}${el.classList[0] ? `.${el.classList[0]}` : ""}`;
      const i = (seen.get(base) ?? 0) + 1;
      seen.set(base, i);
      out.push({
        name: `${base}${i > 1 ? ` ${i}` : ""}`,
        rect: { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height },
        color: [cr, cg, cb],
        large: size >= 24 || (bold && size >= 18.66),
      });
    }
    return out;
  }, screen) as Promise<Target[]>;
}

const SCREEN = 1100;
// The home replay over 12 s (before, during, and after the ring), the other pools over 6 s.
const pages: { path: string | ((request: APIRequestContext) => Promise<string>); moments: number }[] = [
  { path: "/", moments: MOMENTS },
  { path: "/bench/", moments: 20 },
  { path: "/lessons/", moments: 20 },
  {
    // The newest lesson verified across versions: its evidence (the pool) has the most text near the top.
    path: async (request) => {
      const index = (await (await request.get("/index.json")).json()) as { lessons: { id: string; verified_by: string }[] };
      const l = index.lessons.find((x) => x.verified_by === "differential") ?? index.lessons[0]!;
      return `/lessons/${l.id}/`;
    },
    moments: 20,
  },
];

for (const { path, moments } of pages) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`text over the water keeps its contrast (${typeof path === "string" ? path : "a lesson"}, ${colorScheme})`, async ({ browser, request }) => {
      // CI renders WebGL in software, so keep each screenshot small (only the text area) and allow time.
      test.setTimeout(240_000);
      const url = typeof path === "string" ? path : await path(request);
      const context = await browser.newContext({ viewport: { width: 1280, height: SCREEN }, colorScheme });
      const page = await context.newPage();
      await page.clock.install({ time: 0 });
      await page.goto(url);
      const hasWater = await page.evaluate(() => document.documentElement.classList.contains("has-water"));
      test.skip(!hasWater, "No WebGL2 in this browser: the page is plain design B, which axe covers.");

      await page.evaluate(() => document.fonts.ready);
      await page.clock.runFor(100);

      const coverage = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>("canvas.water")!.getBoundingClientRect();
        const pool = document.querySelector<HTMLElement>("[data-water]")!.getBoundingClientRect();
        return { top: canvas.top, bottom: canvas.bottom, oldBottom: pool.top - 24 + Math.min(pool.height + 64, 760) };
      });
      expect(coverage.top, "water reaches the page top").toBeCloseTo(0, 0);
      expect(coverage.bottom, "water keeps its previous lower edge").toBeCloseTo(coverage.oldBottom, 0);

      // Let the text finish arriving (CSS animations run on real time), then record where every piece of text is.
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === "finished" || a.playState === "idle"));
      const boxes = await targets(page, SCREEN);
      expect(boxes.length, url).toBeGreaterThan(3);

      // Hide the text, keep the layout: only the water and the page remain under each box.
      await page.addStyleTag({ content: ".has-water body > :not(canvas) { visibility: hidden !important; }" });
      const left = Math.floor(Math.min(...boxes.map((b) => b.rect.x)));
      const top = Math.floor(Math.min(...boxes.map((b) => b.rect.y)));
      const right = Math.ceil(Math.max(...boxes.map((b) => b.rect.x + b.rect.width)));
      const bottom = Math.ceil(Math.max(...boxes.map((b) => b.rect.y + b.rect.height)));
      const clip = { x: left, y: top, width: right - left, height: bottom - top };
      const worst = new Map<string, number>();
      for (let moment = 0; moment < moments; moment++) {
        await page.clock.runFor(STEP_MS);
        const shot = PNG.sync.read(await page.screenshot({ clip }));
        for (const box of boxes) {
          let min = Infinity;
          const bx = box.rect.x - left, by = box.rect.y - top;
          const x0 = Math.max(0, Math.floor(bx)), x1 = Math.min(shot.width, Math.ceil(bx + box.rect.width));
          const y0 = Math.max(0, Math.floor(by)), y1 = Math.min(shot.height, Math.ceil(by + box.rect.height));
          for (let y = y0; y < y1; y += 2) {
            for (let x = x0; x < x1; x += 2) {
              const i = (y * shot.width + x) * 4;
              min = Math.min(min, contrast(box.color, [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!]));
            }
          }
          worst.set(box.name, Math.min(worst.get(box.name) ?? Infinity, min));
        }
      }

      const report = boxes.map((b) => `${b.name}: ${worst.get(b.name)!.toFixed(2)} (needs ${b.large ? LARGE_TEXT_MIN : SMALL_TEXT_MIN})`);
      const lowest = [...report].sort((x, y) => parseFloat(x.split(": ")[1]!) - parseFloat(y.split(": ")[1]!)).slice(0, 8);
      console.log(`Worst contrast over the water (${url}, ${colorScheme}), lowest first:\n  ${lowest.join("\n  ")}`);
      const failing = boxes.filter((b) => worst.get(b.name)! < (b.large ? LARGE_TEXT_MIN : SMALL_TEXT_MIN));
      expect(failing.map((b) => report[boxes.indexOf(b)]), "text whose background got too close to its color").toEqual([]);
      await context.close();
    });
  }
}

test("the home page's JavaScript stays within 60 KB gzipped", async ({ page }) => {
  const scripts: Buffer[] = [];
  page.on("response", async (res) => {
    if (res.request().resourceType() === "script") scripts.push(await res.body());
  });
  await page.goto("/", { waitUntil: "networkidle" });
  const total = scripts.reduce((sum, body) => sum + gzipSync(body).length, 0);
  console.log(`Home JavaScript: ${scripts.length} file(s), ${(total / 1024).toFixed(1)} KB gzipped`);
  expect(scripts.length).toBeGreaterThan(0);
  expect(total).toBeLessThanOrEqual(60 * 1024);
});
