// What e2e/water.spec.ts and e2e/water-full.spec.ts share: the text boxes, the pages, and how a box is read from a
// screenshot, so the check and its full measurement cannot drift apart.
import type { Page } from "@playwright/test";
import type { PNG } from "pngjs";

export const SMALL_TEXT_MIN = 4.5;
export const LARGE_TEXT_MIN = 3;
export const SCREEN = 1100;
export const FIRST_MS = 100;
export const MOMENT_STEP_MS = 300;

/** Hide the text, keep the layout: only the water and the page remain under each box. */
export const HIDE_TEXT = ".has-water body > :not(canvas) { visibility: hidden !important; }";

const MOMENTS = 40;
// 40 moments over 12 s on the home pages, 20 over 6 s on the start pages.
export const waterPages: { path: string; moments: number }[] = [
  { path: "/", moments: MOMENTS },
  { path: "/start/", moments: 20 },
  { path: "/ja/", moments: MOMENTS },
  { path: "/ja/start/", moments: 20 },
];

// Water times, in ms since the water started, where a dark box reached a lower value than in the page's steady moments:
// the lowest seen over a sweep of the water's time (docs/decisions/2026-11-02-le2e-water-sampling.md, docs/bench/le2e/).
// No light box needed one. They hold for the site that was measured; `e2e/water-full.spec.ts` measures them again.
const LOWEST_DARK_MOMENTS: Record<string, number[]> = {
  "/": [97300, 121000],
  "/start/": [41200],
  "/ja/": [32878, 64812],
  "/ja/start/": [54400],
};

/** The page's moments, one step apart, in ms since the water started. */
export function steadyMoments(path: string): number[] {
  const { moments } = waterPages.find((p) => p.path === path)!;
  return Array.from({ length: moments }, (_, k) => FIRST_MS + MOMENT_STEP_MS * (k + 1));
}

/** The water times a page is measured at, in ms since the water started, ascending. */
export function waterMoments(path: string, colorScheme: "light" | "dark"): number[] {
  return colorScheme === "dark" ? [...steadyMoments(path), ...LOWEST_DARK_MOMENTS[path]!] : steadyMoments(path);
}

export interface Target {
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

export const thresholdOf = (box: Target) => (box.large ? LARGE_TEXT_MIN : SMALL_TEXT_MIN);

/**
 * Every piece of text across the opening (including header and hero) inside the first `screen` px: its box, its
 * color, and whether WCAG counts it as large. Text on a panel with its own background (the seal, a code block) is left
 * out: the water is under the panel, not under the text. Found from the text itself (each element with its own non-blank text), so every page with
 * water is covered without a list of selectors.
 */
export async function targets(page: Page, screen: number): Promise<Target[]> {
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

/** The smallest screenshot that holds every box, and where it starts. */
export function clipAround(boxes: Target[]) {
  const left = Math.floor(Math.min(...boxes.map((b) => b.rect.x)));
  const top = Math.floor(Math.min(...boxes.map((b) => b.rect.y)));
  const right = Math.ceil(Math.max(...boxes.map((b) => b.rect.x + b.rect.width)));
  const bottom = Math.ceil(Math.max(...boxes.map((b) => b.rect.y + b.rect.height)));
  return { left, top, clip: { x: left, y: top, width: right - left, height: bottom - top } };
}

/** The worst contrast between a box's color and any pixel (every second one) of the screenshot under the box. */
export function boxContrast(shot: PNG, box: Target, left: number, top: number): number {
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
  return min;
}
