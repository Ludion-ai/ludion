#!/usr/bin/env node
// Renders Ludion's launch film, one frame at a time: headless Chromium draws each frame of src/page at an exact time,
// the frames go straight into ffmpeg in order, and the sound is synthesized by src/audio (no recorded audio at all).
//
//   node video/render.mjs                       all three formats, with sound, into video/out/
//   node video/render.mjs --format 16x9         one format (16x9, 9x16, 1x1)
//   node video/render.mjs --stills 1,11.2,15.3  PNGs of single frames, for looking at
//   node video/render.mjs --sheet               a contact sheet (one frame every half second) per format
//   node video/render.mjs --from 10 --to 16     a part of the film (no sound)
//
// Needs the repository's own install (npm ci at the root: Playwright's Chromium and the site's fonts) and this
// folder's (npm ci --prefix video: ffmpeg). Text and numbers come from the repo's records (src/recorded.mjs).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { DURATION, FPS } from "./src/timeline.mjs";

const here = import.meta.dirname;
const repo = join(here, "..");

if (!existsSync(join(here, "node_modules/ffmpeg-static"))) {
  console.log("Installing video/ dependencies (ffmpeg) ...");
  const r = spawnSync("npm", ["ci", "--prefix", here, "--no-audit", "--no-fund"], { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const { default: ffmpeg } = await import("ffmpeg-static");
const { chromium } = await import("playwright-core");
const { loadRecorded, SOURCES } = await import("./src/recorded.mjs");
const { en } = await import("../apps/site/src/strings/en.ts");
const { synthesize } = await import("./src/audio/score.mjs");

const { values: opt } = parseArgs({
  options: {
    format: { type: "string", default: "all" },
    from: { type: "string" },
    to: { type: "string" },
    stills: { type: "string" },
    sheet: { type: "boolean" },
    workers: { type: "string", default: "4" },
    out: { type: "string", default: join(here, "out") },
    "no-audio": { type: "boolean" },
    "audio-only": { type: "boolean" },
  },
});
const FORMATS = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080] };
const formats = opt.format === "all" ? Object.keys(FORMATS) : opt.format.split(",");
for (const f of formats) if (!FORMATS[f]) throw new Error(`unknown format ${f}`);
mkdirSync(opt.out, { recursive: true });

// ---------- what the page shows ----------
const data = {
  ...loadRecorded(repo),
  tagline: en.home.headline.join(" "),
  wordmark: readFileSync(join(repo, "apps/site/src/assets/wordmark.svg"), "utf8"),
};
const font = (pkg, file) => {
  const p = join(repo, "node_modules/@fontsource-variable", pkg, "files", file);
  if (!existsSync(p)) throw new Error(`${p} is missing: run npm ci at the repository root`);
  return p;
};
const routes = {
  "/": [join(here, "src/page/index.html"), "text/html"],
  "/stage.css": [join(here, "src/page/stage.css"), "text/css"],
  "/stage.js": [join(here, "src/page/stage.js"), "text/javascript"],
  "/water.js": [join(here, "src/page/water.js"), "text/javascript"],
  "/timeline.mjs": [join(here, "src/timeline.mjs"), "text/javascript"],
  "/fonts/schibsted.woff2": [font("schibsted-grotesk", "schibsted-grotesk-latin-wght-normal.woff2"), "font/woff2"],
  "/fonts/jetbrains.woff2": [font("jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2"), "font/woff2"],
};
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/data.mjs") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(`export default ${JSON.stringify(data)};`);
  }
  const r = routes[path];
  if (path === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  if (!r) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": r[1], "cache-control": "no-store" });
  res.end(readFileSync(r[0]));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------- the browser ----------
// Chromium's new headless mode with the GPU is ~4x faster; the old headless shell (software WebGL) is the fallback.
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--force-color-profile=srgb", "--hide-scrollbars"] });
} catch {
  browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
}

async function openPage(fmt) {
  const [w, h] = FORMATS[fmt];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e));
  page.on("console", (m) => m.type() === "error" && errors.push(new Error(`${m.text()} ${m.location()?.url ?? ""}`)));
  await page.goto(`${base}?fmt=${fmt}`);
  await page.evaluate(() => window.film.ready);
  if (errors.length) throw errors[0];
  const cdp = await page.context().newCDPSession(page);
  return {
    async frame(t) {
      await page.evaluate((t) => window.film.render(t), t);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
      if (errors.length) throw errors[0];
      return Buffer.from(data, "base64");
    },
    close: () => page.close(),
  };
}

const run = (args, input) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    if (input) input(p.stdin);
  });

// ---------- stills and contact sheets ----------
if (opt.stills || opt.sheet) {
  for (const fmt of formats) {
    const page = await openPage(fmt);
    const times = opt.stills ? opt.stills.split(",").map(Number) : Array.from({ length: DURATION * 2 }, (_, i) => i / 2 + 0.25);
    const dir = join(opt.out, "stills", fmt);
    mkdirSync(dir, { recursive: true });
    const files = [];
    for (const t of times) {
      const f = join(dir, `t${t.toFixed(3).padStart(7, "0")}.png`);
      writeFileSync(f, await page.frame(t));
      files.push(f);
    }
    if (opt.sheet) {
      const cols = 6;
      const [w, h] = FORMATS[fmt];
      const tw = fmt === "16x9" ? 480 : fmt === "9x16" ? 216 : 320;
      const th = Math.round((tw * h) / w);
      const list = join(dir, "list.txt");
      writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
      await run(["-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=${tw}:${th},pad=${tw + 4}:${th + 4}:2:2:gray,tile=${cols}x${Math.ceil(files.length / cols)}`, "-frames:v", "1", join(opt.out, `sheet-${fmt}.png`)]);
      console.log(`sheet: ${join(opt.out, `sheet-${fmt}.png`)}`);
    } else console.log(`stills: ${dir}`);
    await page.close();
  }
  await browser.close();
  server.close();
  process.exit(0);
}

// ---------- the sound ----------
const from = Number(opt.from ?? 0);
const to = Number(opt.to ?? DURATION);
const withAudio = !opt["no-audio"] && from === 0 && to === DURATION;
let wav = null;
if (withAudio) {
  wav = join(opt.out, "ludion-launch.wav");
  const t0 = Date.now();
  writeFileSync(wav, synthesize(data));
  // Two-pass loudness: measure, then a linear gain to -14 LUFS with peaks kept under -1 dBTP.
  const meas = spawnSync(ffmpeg, ["-hide_banner", "-i", wav, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
  const m = JSON.parse(meas.stderr.slice(meas.stderr.lastIndexOf("{")));
  const normed = join(opt.out, "ludion-launch-norm.wav");
  await run(["-i", wav, "-af", `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`, "-ar", "48000", normed]);
  wav = normed;
  console.log(`sound: ${((Date.now() - t0) / 1000).toFixed(1)} s (measured ${m.input_i} LUFS, true peak ${m.input_tp} dBTP before normalising)`);
}

if (opt["audio-only"]) {
  // For checking the sound without ears: a spectrogram and a waveform next to the WAV.
  await run(["-i", wav, "-lavfi", "showspectrumpic=s=1800x600:legend=1:scale=log:fscale=log,format=rgb24", join(opt.out, "sound-spectrum.png")]);
  await run(["-i", wav, "-lavfi", "showwavespic=s=1800x300:split_channels=1:colors=white", join(opt.out, "sound-wave.png")]);
  await browser.close();
  server.close();
  process.exit(0);
}

// ---------- the film ----------
const workers = Math.max(1, Number(opt.workers));
for (const fmt of formats) {
  const first = Math.round(from * FPS);
  const last = Math.round(to * FPS);
  const n = last - first;
  const name = withAudio ? `ludion-launch-${fmt}.mp4` : `ludion-launch-${fmt}-${from}-${to}.mp4`;
  const file = join(opt.out, name);
  const pages = await Promise.all(Array.from({ length: workers }, () => openPage(fmt)));
  const t0 = Date.now();
  const done = new Map();
  let waiting = null;
  let written = 0;
  // Frame i is drawn by page i % workers; the writer takes them back in order.
  const produce = pages.map(async (page, k) => {
    for (let i = k; i < n; i += workers) {
      const buf = await page.frame((first + i) / FPS);
      done.set(i, buf);
      if (waiting) waiting();
      // Don't run far ahead of the writer (memory), but never block the frame it is waiting for.
      while (i + workers - written > workers * 6) await new Promise((r) => setTimeout(r, 5));
    }
  });
  const encode = run(
    [
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      ...(wav ? ["-i", wav] : []),
      "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-profile:v", "high", "-level", "4.2",
      "-x264-params", "keyint=120:min-keyint=60",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
      ...(wav ? ["-c:a", "aac", "-b:a", "320k", "-ar", "48000"] : []),
      "-movflags", "+faststart", "-shortest", file,
    ],
    async (stdin) => {
      for (let i = 0; i < n; i++) {
        while (!done.has(i)) await new Promise((r) => (waiting = r));
        const buf = done.get(i);
        done.delete(i);
        written = i + 1;
        if (!stdin.write(buf)) await new Promise((r) => stdin.once("drain", r));
        if (i % 120 === 0) process.stdout.write(`\r${fmt}: frame ${i}/${n}`);
      }
      stdin.end();
    },
  );
  await Promise.all([...produce, encode]);
  await Promise.all(pages.map((p) => p.close()));
  console.log(`\r${fmt}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${file}`);
}
await browser.close();
server.close();
console.log("Recorded sources:");
for (const [what, where] of SOURCES) console.log(`  ${what}: ${where}`);
