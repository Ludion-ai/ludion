// The layout sweep behind "Every page down to 320 px" (docs/decisions.md): every page at each width and color scheme,
// flagging a page that scrolls sideways, an element past the window's edge, and an element whose content is wider
// than its box. The water canvas is hidden first (it is 100vw wide on purpose). Not part of CI; the e2e tests check
// the sideways scroll.
//   npm run build -w @ludion/site
//   npx wrangler dev --port 8799 --ip 127.0.0.1
//   node docs/site/2026-10-13-ui-fixes/sweep.mjs > sweep.txt
// Env: BASE (http://127.0.0.1:8799), WIDTHS (320,390,768,1280), SCHEMES (light), EXTRA (more paths, comma-separated).
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://127.0.0.1:8799";
const browser = await chromium.launch();
const request = (await browser.newContext()).request;
const index = await (await request.get(`${BASE}/index.json`)).json();
const bench = await (await request.get(`${BASE}/bench.json`)).json();
const models = [...new Set([...(bench.done3?.rows ?? []), ...(bench.without_tools?.rows ?? [])].map((r) => r.model))];
const pages = [
  "/",
  "/lessons/",
  "/start/",
  "/bench/",
  "/bench/method/",
  ...models.map((m) => `/bench/${m}/`),
  ...[...new Set(index.lessons.map((l) => l.subject))].map((s) => `/${s}/`),
  ...index.lessons.map((l) => `/lessons/${l.id}/`),
  ...Object.values(index.teachers).map((t) => `/@${t.login.toLowerCase()}`),
  "/no-such-page/",
];
if (process.env.EXTRA) pages.push(...process.env.EXTRA.split(","));
// One run log.
for (const m of models.slice(0, 1)) {
  const html = await (await request.get(`${BASE}/bench/${m}/`)).text();
  const run = new RegExp(`href="(/bench/${m}/[^"/]+/)"`).exec(html)?.[1];
  if (run) pages.push(run);
}
const widths = (process.env.WIDTHS ?? "320,390,768,1280").split(",").map(Number);
const schemes = (process.env.SCHEMES ?? "light").split(",");
const issues = [];
for (const width of widths) {
  for (const colorScheme of schemes) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
    page.on("response", (r) => r.status() >= 400 && !r.url().includes("no-such-page") && errors.push(`${r.status()} ${r.url()}`));
    for (const path of pages) {
      errors.length = 0;
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const found = await page.evaluate(() => {
        for (const c of document.querySelectorAll("canvas.water")) c.style.display = "none";
        const out = [];
        const root = document.documentElement;
        if (root.scrollWidth > root.clientWidth) out.push(`page scrollWidth ${root.scrollWidth} > ${root.clientWidth}`);
        const vw = root.clientWidth;
        const name = (el) =>
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : "") +
          (typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).join(".")}` : "") +
          ` "${(el.textContent ?? "").trim().slice(0, 40)}"`;
        for (const el of document.querySelectorAll("body *")) {
          if (el.closest("canvas, svg, .visually-hidden, script, style")) continue;
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // Inside something that scrolls or clips sideways on purpose: its edges are that box's business.
          let scroller = null;
          for (let a = el.parentElement; a; a = a.parentElement) {
            const o = getComputedStyle(a).overflowX;
            if (o === "auto" || o === "scroll" || o === "hidden") {
              scroller = a;
              break;
            }
          }
          if (!scroller && (r.right > vw + 0.5 || r.left < -0.5)) out.push(`off-screen ${Math.round(r.left)}..${Math.round(r.right)} ${name(el)}`);
          const ox = style.overflowX;
          if ((ox === "visible" || ox === "clip") && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && style.display !== "inline")
            out.push(`overflows ${el.scrollWidth}>${el.clientWidth} ${name(el)}`);
          if (ox === "hidden" && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== "ellipsis") out.push(`clipped ${el.scrollWidth}>${el.clientWidth} ${name(el)}`);
        }
        return out;
      });
      for (const f of found.slice(0, 12)) issues.push(`${width} ${colorScheme} ${path}: ${f}`);
      if (found.length > 12) issues.push(`${width} ${colorScheme} ${path}: ... ${found.length - 12} more`);
      for (const e of errors) issues.push(`${width} ${colorScheme} ${path}: ERR ${e}`);
    }
    await context.close();
  }
}
console.log(issues.join("\n") || "no issues");
await browser.close();
