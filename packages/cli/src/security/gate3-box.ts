// What runs inside the box for gate 3's new type (docs/decisions/2026-11-02-gate-3-type-definition.md). The CLI is one
// bundled file, so these are strings, written into the image as files. They hold no backtick, so String.raw keeps them
// as they are, apart from the constants put in with ${}. Only Node.js's own modules: the box has no network and installs nothing.

/** One fixed instant, and one fixed sequence for Math.random: the same in the build, the server and the browser. */
const FROZEN_INSTANT_MS = 1_767_225_600_000; // 2026-01-01T00:00:00Z

/** Stops the clock in the JavaScript it is loaded into. A preload for Node.js, a new-document script for the browser. */
export const FREEZE_CLOCK = String.raw`(() => {
  const instant = ${FROZEN_INSTANT_MS}, RealDate = Date;
  function FrozenDate(...args) {
    if (!new.target) return new RealDate(instant).toString();
    return args.length ? new RealDate(...args) : new RealDate(instant);
  }
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = () => instant;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  globalThis.Date = FrozenDate;
  let state = 0x2f6e2b1;
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
`;

/** Starts one line of stdout that holds the run's result, as JSON. */
export const RESULT_MARKER = "LUDION-GATE3-RESULT ";

/** The most pages one run opens; a project with more is undecidable, since "all of them" could not be kept. */
export const MAX_PAGES = 200;

/**
 * Build, types, start, crawl and tests, in one box: its scratch space is gone when the box ends. Prints one line, the
 * result. Everything else goes to stderr or nowhere, and only hashes, counts and levels are in the result.
 */
export const BOX_DRIVER = String.raw`"use strict";
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const config = JSON.parse(fs.readFileSync("/ludion/config.json", "utf8"));
const NEXT = "/app/node_modules/next/dist/bin/next";
const TSC = "/app/node_modules/typescript/bin/tsc";
const DIST = "/tmp/next";
const SCRATCH = "/tmp/scratch";
const PORT = 3000;
const ORIGIN = "http://127.0.0.1:" + PORT;
const MINUTE = 60000;
const hash = (text, length) => createHash("sha256").update(text).digest("hex").slice(0, length);
const sameStaticPaths = text => text.replace(/\/_next\/static\/[^\s"')]*/g, "/_next/static/*");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const secondsSince = started => Number(process.hrtime.bigint() - started) / 1e9;
const baseEnv = { ...process.env, ...config.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1", NODE_NO_WARNINGS: "1" };
const frozenEnv = { ...baseEnv, NODE_OPTIONS: "--require=/ludion/freeze-clock.cjs" };

/** Runs one program to its end. Its stdout is dropped; its stderr goes to the box's stderr. */
function step(program, args, env, timeoutMs) {
  const started = process.hrtime.bigint();
  return new Promise(resolve => {
    const child = spawn(program, args, { cwd: "/app", env, stdio: ["ignore", "ignore", "inherit"], detached: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); resolve({ status: "failed", exit: null, seconds: secondsSince(started) }); });
    child.on("close", exit => {
      clearTimeout(timer);
      resolve({ status: timedOut ? "timed_out" : exit === 0 ? "passed" : "failed", exit, seconds: secondsSince(started) });
    });
  });
}

const absent = () => ({ status: "absent", exit: null, seconds: 0 });

/** The GET pages the build's own lists name: no API route, no dynamic route, none of the framework's own pages. */
function pagesOfBuild() {
  const read = file => { try { return JSON.parse(fs.readFileSync(path.join(DIST, file), "utf8")); } catch { return {}; } };
  const pages = new Set();
  for (const [key, route] of Object.entries(read("app-path-routes-manifest.json"))) if (key.endsWith("/page")) pages.add(route);
  for (const route of Object.keys(read("server/pages-manifest.json"))) pages.add(route);
  return [...pages].filter(route => typeof route === "string" && route.startsWith("/")
    && !/\[|^\/_|^\/api(\/|$)|^\/(404|500)$/.test(route)).sort();
}

/** Chrome, spoken to over a pipe: nothing listens on a port, and no client library is needed. */
function startBrowser() {
  const root = "/ms-playwright";
  const folder = fs.readdirSync(root).find(name => name.startsWith("chromium_headless_shell-"));
  const program = path.join(root, folder, "chrome-headless-shell-linux64", "chrome-headless-shell");
  const child = spawn(program, ["--no-sandbox", "--no-zygote", "--disable-gpu", "--disable-crash-reporter", "--disable-breakpad", "--no-first-run",
    "--user-data-dir=/tmp/chrome", "--disk-cache-size=1", "--disable-background-networking", "--disable-component-update", "--hide-scrollbars",
    "--mute-audio", "--force-color-profile=srgb", "--font-render-hinting=none", "--remote-debugging-pipe"],
    { env: baseEnv, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const pending = new Map(), listeners = new Map();
  let next = 1, buffer = "", gone = false;
  const fail = () => { gone = true; for (const { reject } of pending.values()) reject(new Error("The browser stopped.")); pending.clear(); };
  child.on("close", fail);
  child.on("error", fail);
  child.stdio[3].on("error", fail);
  child.stdio[4].on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      } else if (message.sessionId && listeners.has(message.sessionId)) listeners.get(message.sessionId)(message.method, message.params);
    }
  });
  const send = (method, params, sessionId, timeoutMs = 30000) => new Promise((resolve, reject) => {
    if (gone) return reject(new Error("The browser stopped."));
    const id = next++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The browser did not answer " + method + ".")); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdio[3].write(JSON.stringify({ id, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
  return { send, listeners, stop: () => { try { child.kill("SIGKILL"); } catch {} }, gone: () => gone };
}

const SERIALIZE = "(() => { const out = []; const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE']);"
  + " const walk = e => { if (skip.has(e.tagName)) return;"
  + " const attrs = [...e.attributes].map(a => a.name + '=' + a.value).sort().join(' ');"
  + " const text = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue.trim()).filter(Boolean).join(' ');"
  + " out.push(e.tagName + ' ' + attrs + ' ' + text); for (const c of e.children) walk(c); };"
  + " walk(document.documentElement); return out; })()";
const STILL = "(() => { const s = document.createElement('style');"
  + " s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';"
  + " document.documentElement.appendChild(s); })()";
const SERVER_ERROR = /⨯|(^|\s)\w*Error\b/;

async function visit(browser, route, serverLines) {
  const page = { path: route, status: null, exceptions: [], console: [], dom: null, screenshot: null };
  const { browserContextId } = await browser.send("Target.createBrowserContext");
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params, timeoutMs) => browser.send(method, params, sessionId, timeoutMs);
  let loaded = () => {}, inFlight = 0, lastActive = Date.now(), mainFrame = null;
  const load = new Promise(resolve => { loaded = resolve; });
  browser.listeners.set(sessionId, (method, params) => {
    if (method === "Page.loadEventFired") loaded();
    else if (method === "Page.frameNavigated" && !params.frame.parentId) mainFrame = params.frame.id;
    else if (method === "Network.requestWillBeSent") { inFlight++; lastActive = Date.now(); }
    else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") { inFlight = Math.max(0, inFlight - 1); lastActive = Date.now(); }
    else if (method === "Network.responseReceived" && params.type === "Document" && (!mainFrame || params.frameId === mainFrame) && !page.seenDocument) { page.seenDocument = true; page.status = params.response.status; }
    else if (method === "Runtime.exceptionThrown") page.exceptions.push(hash(sameStaticPaths(JSON.stringify([params.exceptionDetails.text, params.exceptionDetails.exception && params.exceptionDetails.exception.description])), 16));
    else if (method === "Runtime.consoleAPICalled") page.console.push(params.type + ":" + hash(sameStaticPaths(JSON.stringify((params.args || []).map(a => a.value === undefined ? a.description : a.value))), 16));
    else if (method === "Log.entryAdded") page.console.push(params.entry.level + ":" + hash(sameStaticPaths(params.entry.text), 16));
  });
  const before = serverLines.count;
  try {
    for (const domain of ["Page", "Runtime", "Network", "Log"]) await send(domain + ".enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: config.freeze });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await send("Page.navigate", { url: ORIGIN + route });
    await Promise.race([load, sleep(30000)]);
    const until = Date.now() + 10000;
    while (Date.now() < until && (inFlight > 0 || Date.now() - lastActive < 500)) await sleep(50);
    const dom = await send("Runtime.evaluate", { expression: SERIALIZE, returnByValue: true });
    if (Array.isArray(dom.result && dom.result.value)) page.dom = dom.result.value.map(line => hash(sameStaticPaths(line), 8));
    await send("Runtime.evaluate", { expression: STILL });
    await sleep(100);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    page.screenshot = hash(Buffer.from(shot.data, "base64"), 32);
  } finally {
    browser.listeners.delete(sessionId);
    await browser.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }
  delete page.seenDocument;
  for (const line of serverLines.lines.slice(before)) if (SERVER_ERROR.test(line)) page.exceptions.push("server:" + hash(sameStaticPaths(line), 16));
  return page;
}

async function main() {
  const started = process.hrtime.bigint();
  const out = { schema: 1, build: absent(), types: absent(), start: absent(), crawl: { status: "absent", seconds: 0 }, tests: absent(), too_many_pages: false, pages: [], memory_peak_bytes: null, seconds: 0 };
  // The scratch space, and what was linked to it when the image was built (the Dockerfile in gate3.ts).
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  for (const name of fs.readdirSync("/ludion/original")) fs.copyFileSync(path.join("/ludion/original", name), path.join(SCRATCH, name));
  // What the build leaves in /tmp/next finds its packages from there, as it would from /app/.next.
  fs.symlinkSync("/app/node_modules", "/tmp/node_modules");

  out.build = await step(process.execPath, [NEXT, "build"], frozenEnv, 8 * MINUTE);
  if (out.build.status !== "passed") return out;

  if (fs.existsSync("/app/tsconfig.json") && fs.existsSync(TSC)) out.types = await step(process.execPath, [TSC, "--noEmit", "--incremental", "false", "--pretty", "false"], baseEnv, 4 * MINUTE);

  const startStarted = process.hrtime.bigint();
  const server = spawn(process.execPath, [NEXT, "start", "--hostname", "127.0.0.1", "--port", String(PORT)], { cwd: "/app", env: { ...frozenEnv, NODE_ENV: "production" }, stdio: ["ignore", "ignore", "pipe"], detached: true });
  const serverLines = { count: 0, lines: [] };
  let serverExited = false, partial = "";
  server.stderr.on("data", chunk => {
    process.stderr.write(chunk);
    const parts = (partial + chunk).split("\n");
    partial = parts.pop();
    for (const line of parts) { serverLines.lines.push(line); serverLines.count++; }
  });
  server.on("close", () => { serverExited = true; });
  server.on("error", () => { serverExited = true; });
  const listening = () => new Promise(resolve => {
    const socket = net.connect(PORT, "127.0.0.1");
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
  });
  let up = false;
  for (const until = Date.now() + MINUTE; Date.now() < until && !serverExited && !up;) { up = await listening(); if (!up) await sleep(100); }
  out.start = { status: up ? "passed" : "failed", exit: null, seconds: secondsSince(startStarted) };

  if (up) {
    const crawlStarted = process.hrtime.bigint();
    const routes = pagesOfBuild();
    out.too_many_pages = routes.length > ${MAX_PAGES};
    let browser = null;
    try {
      browser = startBrowser();
      await browser.send("Browser.getVersion");
      if (!out.too_many_pages) for (const route of routes) out.pages.push(await visit(browser, route, serverLines));
      out.crawl = { status: "passed", seconds: secondsSince(crawlStarted) };
    } catch (error) {
      process.stderr.write(String(error && error.stack || error) + "\n");
      out.crawl = { status: "failed", seconds: secondsSince(crawlStarted) };
    }
    if (browser) browser.stop();
  }
  try { process.kill(-server.pid, "SIGKILL"); } catch {}

  const manifest = JSON.parse(fs.readFileSync("/app/package.json", "utf8"));
  if (manifest.scripts && typeof manifest.scripts.test === "string") out.tests = await step("npm", ["test"], baseEnv, 4 * MINUTE);
  return out;
}

const whole = process.hrtime.bigint();
main().catch(error => {
  process.stderr.write(String(error && error.stack || error) + "\n");
  return { schema: 1, driver_failed: true };
}).then(out => {
  out.seconds = secondsSince(whole);
  // What the box used. The peak counts the page cache, so it reaches the limit without anything having run out; swap and
  // kills say whether something did. Not every system has these files.
  const cgroup = name => { try { return fs.readFileSync("/sys/fs/cgroup/" + name, "utf8").trim(); } catch { return null; } };
  const number = text => text === null || !/^\d+$/.test(text) ? null : Number(text);
  out.memory_peak_bytes = number(cgroup("memory.peak"));
  out.memory_swap_peak_bytes = number(cgroup("memory.swap.peak"));
  const kills = /^oom_kill (\d+)$/m.exec(cgroup("memory.events") || "");
  out.memory_oom_kills = kills ? Number(kills[1]) : null;
  process.stdout.write("\n${RESULT_MARKER}" + JSON.stringify(out) + "\n", () => process.exit(0));
});
`;
