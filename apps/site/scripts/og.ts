// Share cards: after `astro build`, screenshot each /bench/og/<model>/ page (the model's FreshBench table, laid out
// at 1200×630) into dist/bench/og/<model>.png, next to the rest of the build. /bench/<model>/ names it as og:image.
// Needs Chromium for Playwright: npx playwright install chromium.
//   node scripts/og.ts [dist dir]
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

/** A static file server over the built site, on a free port of 127.0.0.1. */
function serve(dir: string): Promise<Server> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

async function makeCards(dist: string): Promise<string[]> {
  const cards = join(dist, "bench", "og");
  const models = existsSync(cards) ? readdirSync(cards, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  if (!models.length) return [];
  const server = await serve(dist);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
    const written: string[] = [];
    for (const model of models) {
      await page.goto(`${base}/bench/og/${model}/`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const out = join(cards, `${model}.png`);
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
      written.push(out);
    }
    return written;
  } finally {
    await browser.close();
    server.close();
  }
}

const dist = process.argv[2] ?? "dist";
const written = await makeCards(dist);
// Every card page must have its image: /bench/<model>/ names it in og:image, and the deploy runs no e2e to notice.
const missing = existsSync(join(dist, "bench", "og"))
  ? readdirSync(join(dist, "bench", "og"), { withFileTypes: true }).filter((d) => d.isDirectory() && !existsSync(join(dist, "bench", "og", `${d.name}.png`))).map((d) => d.name)
  : [];
if (missing.length) throw new Error(`No share card was written for ${missing.join(", ")}.`);
console.log(`[ludion] Share cards: ${written.length ? written.join(", ") : "none (no /bench/og pages)"}`);
