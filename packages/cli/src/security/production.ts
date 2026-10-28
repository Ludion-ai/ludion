// Gate 1's production/dev split (docs/decisions.md, "Gate 1's production/dev split, rebuilt"). Only what is shown
// dev-only is left out; when in doubt, a copy is production. The lockfile and the project's files come in as data: the
// files are read as text and never run, and no symbolic link is followed.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { lockEntries, readLock, resolveFrom, type LockEntry, type SplitSummary } from "./judge.ts";

/** The project's files at the judged commit, by path relative to the project root (forward slashes). */
export type SourceTree = {
  files: string[];
  /** The file's text, or null when it is not a regular file or is larger than the limit. */
  read(path: string): string | null;
  /** Why the tree is not complete (a folder could not be listed, too many files), or null. */
  incomplete: string | null;
};

const MAX_FILE = 16 * 1024 * 1024;
const MAX_FILES = 1_000_000;

/** Every regular file under `root` outside node_modules and .git folders. Symbolic links are not followed. */
export function readSourceTree(root: string): SourceTree {
  const files: string[] = [];
  let incomplete: string | null = null;
  const walk = (rel: string) => {
    let items;
    try { items = readdirSync(join(root, rel), { withFileTypes: true }); } catch { incomplete ??= `${rel || "."} could not be listed`; return; }
    for (const d of items) {
      if (files.length >= MAX_FILES) { incomplete ??= `more than ${MAX_FILES} files`; return; }
      const path = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { if (d.name !== "node_modules" && d.name !== ".git") walk(path); }
      else if (d.isFile()) files.push(path);
    }
  };
  walk("");
  const read = (path: string) => {
    try {
      const full = join(root, path), stat = lstatSync(full);
      return stat.isFile() && stat.size <= MAX_FILE ? readFileSync(full, "utf8") : null;
    } catch { return null; }
  };
  return { files: files.sort(), read, incomplete };
}

/** One installed copy: production or dev-only, and why. */
export type CopySplit = { path: string; name: string; version: string; production: boolean; why: string };
export type Split = {
  /** Every installed copy, by install path. */
  copies: Map<string, CopySplit>;
  /** `name@version` whose every installed copy is dev-only. */
  devOnly: Set<string>;
  summary: SplitSummary;
};

// D1: test runners, linters, formatters and type definitions (decisions, the fixed lists).
const TEST_RUNNERS = /^(jest|jest-.+|@jest\/.+|ts-jest|babel-jest|@swc\/jest|vitest|@vitest\/.+|mocha|ava|@ava\/.+|jasmine|jasmine-.+|karma|karma-.+|tap|tape|uvu|@playwright\/test|playwright|playwright-core|cypress|@cypress\/.+|testcafe|webdriverio|@wdio\/.+|nightwatch|@web\/test-runner.*|@storybook\/test-runner)$/;
const LINTERS = /^(eslint|eslint-.+|@eslint\/.+|@eslint-community\/.+|@typescript-eslint\/.+|typescript-eslint|vue-eslint-parser|@angular-eslint\/.+|@[^/]+\/eslint-(plugin|config|parser).*|stylelint|stylelint-.+|@stylistic\/.+|tslint|tslint-.+|oxlint|@oxlint\/.+|xo|standard|jshint|markdownlint|markdownlint-cli2?|commitlint|@commitlint\/.+|htmlhint|@biomejs\/.+)$/;
const FORMATTERS = /^(prettier|prettier-plugin-.+|@prettier\/.+|@[^/]+\/prettier-(plugin|config).*|dprint|@dprint\/.+)$/;
/** A test runner, linter, formatter or `@types` package (D1). */
export const devTool = (name: string) => TEST_RUNNERS.test(name) || LINTERS.test(name) || FORMATTERS.test(name) || /^@types\/.+$/.test(name);

/** P3: bundler helper libraries, and the bundlers and transpilers that put their own helpers into the output. */
const HELPERS = ["tslib", "@babel/runtime", "@babel/runtime-corejs2", "@babel/runtime-corejs3", "@babel/helpers", "babel-runtime", "core-js", "core-js-pure", "core-js-bundle", "regenerator-runtime", "@swc/helpers", "@swc/core", "typescript", "esbuild", "vite", "rollup", "webpack", "@rspack/core", "rolldown", "parcel", "browserify", "systemjs", "@vercel/ncc"];
/** P4: runtimes shipped with the app. */
const RUNTIMES = new Set(["electron", "electron-nightly", "electron-prebuilt", "electron-prebuilt-compile", "nw"]);

const CODE = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte|astro|mdx|marko)$/i;
const STYLE = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i;
const MARKUP = /\.(html|htm|ejs|hbs|handlebars|pug|njk|liquid)$/i;
const TEST_DIR = /(^|\/)(test|tests|__tests__|__mocks__|__snapshots__|__fixtures__|e2e|cypress|playwright|spec|specs)\//i;
const TEST_FILE = /\.(test|spec|e2e|cy)\.[^/]+$|(^|\/)(setupTests|setup-tests|test-setup|jest\.setup|vitest\.setup)\.[^/]+$/i;
const TOOL_CONFIG = /(^|\/)(jest|vitest|playwright|cypress|karma|ava|wdio|nightwatch|mocha|tap|eslint|prettier|stylelint|commitlint|lint-staged)\.(config|conf|workspace)(\.[^/]*)?$|(^|\/)\.(eslintrc|prettierrc|stylelintrc|lintstagedrc|commitlintrc|mocharc)[^/]*$|(^|\/)\.husky\//i;
const TYPES_FILE = /\.d\.[mc]?ts$/i;
/** P2: a build tool's configuration. */
const BUILD_TOOLS = "vite|webpack|rollup|rspack|rsbuild|rolldown|esbuild|tsup|tsdown|build|next|nuxt|astro|svelte|remix|react-router|quasar|vue|babel|postcss|tailwind|uno|unocss|craco|metro|app|electron\\.vite|electron-builder|forge|capacitor|docusaurus|snowpack|wmr|parcel|gatsby|vinxi";
const BUILD_CONFIG = new RegExp([
  `(${BUILD_TOOLS})\\.(config|conf)(\\.[^/]*)?`, "webpack\\.[^/]+\\.[cm]?[jt]s",
  "(gatsby-config|gatsby-node|gatsby-browser|gatsby-ssr|ember-cli-build|gulpfile|gruntfile)\\.[^/]+",
  "(angular|project|nx|turbo)\\.json", "electron-builder\\.(json|ya?ml)", "\\.babelrc[^/]*", "\\.postcssrc[^/]*", "\\.swcrc", "\\.parcelrc",
].map(p => `(^|\\/)${p}$`).join("|") + "|(^|\\/)\\.storybook\\/", "i");
const TSCONFIG = /(^|\/)(tsconfig|jsconfig)[^/]*\.json$/i;
const DOCKERFILE = /(^|\/)(dockerfile|containerfile)[^/]*$|\.(dockerfile|containerfile)$/i;
/** P5: files that hold production commands. */
const COMMAND_FILE = /(^|\/)(Procfile|docker-compose[^/]*\.ya?ml|compose[^/]*\.ya?ml|app\.ya?ml|render\.ya?ml|railway\.(json|toml)|fly\.toml|nixpacks\.toml|ecosystem\.config\.[^/]+|ecosystem\.json)$/i;
const COMMAND_KEY = /(command|cmd|entrypoint|start|script|exec|args|run|interpreter)/i;

const BUILTINS = new Set(builtinModules.flatMap(m => [m, m.split("/")[0]!]));
/** The package a bare module specifier names, or null for relative, absolute, URL, builtin and alias specifiers. */
export function packageOf(specifier: string): string | null {
  let s = specifier.trim();
  if (s.startsWith("~") && !s.startsWith("~/")) s = s.slice(1);
  if (!s || /^[./]/.test(s) || s.includes(":") || /^(#|@\/|~\/|\$|@@\/)/.test(s) || /[\s\\]/.test(s)) return null;
  // A bundler's query (?raw, ?worker) is not part of the name.
  const parts = s.replace(/[?#].*$/, "").split("/");
  const name = s.startsWith("@") ? (parts.length > 1 ? `${parts[0]}/${parts[1]}` : null) : parts[0]!;
  if (!name || BUILTINS.has(name) || !/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) return null;
  return name;
}

/** Module specifiers a code file loads: import/export from, import(), require(), require.resolve(). Type-only ones are erased. */
export function codeSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:import|export)\s+(type\s+)?(?:[^"';]{0,2000}?\s+from\s*)?["']([^"'\n]+)["']/g)) if (!m[1]) out.push(m[2]!);
  for (const m of text.matchAll(/\b(?:import|require(?:\.resolve)?)\s*\(\s*["'`]([^"'`\n$]+)["'`]/g)) out.push(m[1]!);
  for (const m of text.matchAll(/@jsxImportSource\s+([^\s*]+)/g)) out.push(m[1]!);
  return out;
}
/** What a stylesheet (or a component's <style>) imports: @import, @use, @forward, @plugin, @reference and url(~…). */
export function styleSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/@(?:import|use|forward|plugin|reference)\s+(?:url\(\s*)?["']?([^"')\s;]+)/g)) out.push(m[1]!);
  for (const m of text.matchAll(/url\(\s*["']?~([^"')\s]+)/g)) out.push(m[1]!);
  return out;
}
/** Packages a file names by a node_modules path (a <script src>, a copied asset). */
const nodeModulesPaths = (text: string) => [...text.matchAll(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)/g)].map(m => m[1]!);

/** Package names a build tool's configuration names: quoted strings, Babel's short names spelled out, PostCSS's object keys. */
export function configNames(text: string, kind: "babel" | "postcss" | "other"): string[] {
  const raw: string[] = [...text.matchAll(/["'`]([^"'`\n]{1,214})["'`]/g)].map(m => m[1]!);
  if (kind === "postcss") raw.push(...[...text.matchAll(/(?:^|[{,\s])([A-Za-z_@][\w@/.-]*)\s*:/g)].map(m => m[1]!));
  const out = new Set<string>();
  for (const r of raw) {
    let s = r.replace(/^module:/, "");
    // "@angular-devkit/build-angular:browser" names a builder of a package; "node:fs" or a URL names none.
    const builder = /^([^:]+):[^/]/.exec(s);
    if (builder && !/^(node|https?|data|virtual|file|npm|workspace|link|git|github)$/i.test(builder[1]!)) s = builder[1]!;
    const name = packageOf(s);
    if (name) out.add(name);
    else if (/^@[a-z0-9][\w.-]*$/i.test(s) && kind === "babel") out.add(s);
    for (const n of nodeModulesPaths(r)) out.add(n);
    if (kind !== "babel") continue;
    const base = name ?? s;
    if (base.startsWith("@")) {
      const [scope, rest] = base.split("/");
      if (rest) for (const k of ["preset", "plugin"]) { out.add(`${scope}/babel-${k}-${rest}`); out.add(`${scope}/${k}-${rest}`); }
      else for (const k of ["preset", "plugin"]) out.add(`${scope}/babel-${k}`);
    } else if (name) {
      for (const k of ["preset", "plugin"]) { out.add(`babel-${k}-${name}`); out.add(`@babel/${k}-${name}`); }
      out.add(`@babel/${name}`);
    }
  }
  return [...out];
}

const segmentsOf = (text: string) => text.split(/&&|\|\||[;|&\n]/).map(s => s.trim()).filter(Boolean);
const wordsOf = (segment: string) => segment.split(/\s+/).map(w => w.replace(/^[\["'`]+|["'`,\]]+$/g, "")).filter(Boolean);
const RUNNER = /^(npm|yarn|pnpm|bun|npx|bunx|pnpx|run-s|run-p|npm-run-all2?|concurrently|turbo|nx|lerna)$/;
/** Words after which the next word that is not a flag names a package to run. */
const EXECUTES = /^(npx|bunx|pnpx|dlx|exec|x)$/;
const LOADS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);

type Image = { holds: boolean; production: string[]; build: string[] };
/**
 * A Dockerfile: whether its final stage holds devDependencies, the commands of its final stage and the stages it is
 * built FROM (P5), and the RUN commands of the stages it copies from (P6). `ignoresNodeModules`: the build context's
 * .dockerignore leaves node_modules out.
 */
export function dockerImage(text: string, ignoresNodeModules: boolean): Image {
  type Stage = { name: string | null; from: Stage | null; holds: boolean; production: boolean; workdir: string; runs: string[]; commands: string[]; copies: Stage[] };
  const stages: Stage[] = [];
  const install = /\b(npm\s+(ci|install|i)\b|yarn(\s+install)?\s*($|--|-)|pnpm\s+(install|i)\b|bun\s+(install|i)\b)/;
  const global = /(^|\s)(-g|--global)(\s|$)|\byarn\s+global\b/;
  const omits = /--omit[= ]dev|--only[= ]prod(uction)?\b|--production\b|--prod\b|(^|\s)-P(\s|$)|NODE_ENV=["']?production/;
  const prunes = /\bnpm\s+prune\b.*(--omit[= ]dev|--production)|\bpnpm\s+prune\b.*--prod|\byarn\s+workspaces\s+focus\b.*--production/;
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  for (const line of lines) {
    const m = /^(\w+)\s+([\s\S]*)$/.exec(line);
    if (!m) continue;
    const op = m[1]!.toUpperCase(), arg = m[2]!.trim();
    if (op === "FROM") {
      const f = /^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(arg);
      const parent = stages.find(s => s.name !== null && s.name.toLowerCase() === (f?.[1] ?? "").toLowerCase()) ?? null;
      stages.push({ name: f?.[2] ?? null, from: parent, holds: parent?.holds ?? false, production: parent?.production ?? false, workdir: parent?.workdir ?? "/", runs: [], commands: [], copies: [] });
      continue;
    }
    const stage = stages.at(-1);
    if (!stage) continue;
    const command = arg.startsWith("[") ? (() => { try { return (JSON.parse(arg) as string[]).join(" "); } catch { return arg; } })() : arg;
    if ((op === "ENV" || op === "ARG") && /\bNODE_ENV\b/.test(arg)) stage.production = /\bNODE_ENV(\s*=\s*|\s+)["']?production\b/.test(arg);
    if (op === "WORKDIR") stage.workdir = arg.replace(/^["']|["']$/g, "");
    if (op === "CMD" || op === "ENTRYPOINT") stage.commands.push(command);
    if (op === "RUN") {
      stage.commands.push(command); stage.runs.push(command);
      for (const segment of segmentsOf(command)) {
        if (install.test(segment) && !global.test(segment) && !omits.test(segment) && !stage.production) stage.holds = true;
        if (prunes.test(segment)) stage.holds = false;
      }
    }
    if (op === "COPY" || op === "ADD") {
      const parts = wordsOf(arg), from = parts.find(p => /^--from=/i.test(p))?.slice(7);
      const sources = parts.filter(p => !p.startsWith("--")).slice(0, -1);
      const strip = (p: string) => p.replace(/\/+$/, "") || "/";
      if (from !== undefined) {
        const source = stages.find((s, i) => (s.name !== null && s.name.toLowerCase() === from.toLowerCase()) || String(i) === from);
        if (source) {
          stage.copies.push(source);
          if (sources.some(s => /node_modules/.test(s) || /^(\.|\.\/|\/)$/.test(s) || strip(s) === strip(source.workdir))) stage.holds ||= source.holds;
        }
      } else if (!ignoresNodeModules && sources.some(s => /node_modules/.test(s) || /^(\.|\.\/)$/.test(s))) stage.holds = true;
    }
  }
  const last = stages.at(-1);
  if (!last) return { holds: false, production: [], build: [] };
  const chain = (s: Stage | null): Stage[] => s ? [s, ...chain(s.from)] : [];
  const own = chain(last), production = own.flatMap(s => s.commands);
  const build: string[] = [], seen = new Set<Stage>(own), queue = own.flatMap(s => s.copies);
  while (queue.length) {
    const s = queue.shift()!;
    for (const c of chain(s)) {
      if (seen.has(c)) continue;
      seen.add(c);
      build.push(...c.runs);
      queue.push(...c.copies);
    }
  }
  return { holds: last.holds, production, build };
}

/** Production commands in a command file (Procfile, compose, render, fly, pm2 ecosystem, …). TOML gives every value. */
function fileCommands(file: string, text: string): string[] {
  if (/(^|\/)Procfile$/i.test(file)) return text.split(/\r?\n/).flatMap(l => { const m = /^\s*[\w.-]+\s*:\s*(.+)$/.exec(l); return m ? [m[1]!] : []; });
  if (/\.json$/i.test(file)) {
    const out: string[] = [];
    const walk = (value: unknown, key: string) => {
      if (typeof value === "string") { if (COMMAND_KEY.test(key)) out.push(value); }
      else if (Array.isArray(value)) { if (COMMAND_KEY.test(key) && value.every(v => typeof v === "string")) out.push(value.join(" ")); else value.forEach(v => walk(v, key)); }
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
    };
    try { walk(JSON.parse(text), ""); } catch { return [text]; }
    return out;
  }
  if (/\.[cm]?[jt]s$/i.test(file)) {
    // A pm2 ecosystem file: `script: 'x'`, `args: ['a', 'b']`, anywhere on a line.
    const out: string[] = [];
    for (const m of text.matchAll(/\b(\w+)\s*:\s*(?:(["'`])([^"'`\n]*)\2|\[((?:\s*["'`][^"'`\n]*["'`]\s*,?\s*)*)\])/g)) if (COMMAND_KEY.test(m[1]!)) out.push(m[3] ?? m[4]!);
    return out;
  }
  const toml = /\.toml$/i.test(file), out: string[] = [], lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /^\s*-?\s*["']?([\w.-]+)["']?\s*[:=]\s*(.*?)\s*,?\s*$/.exec(line);
    if (!m || !(toml || COMMAND_KEY.test(m[1]!))) return;
    if (m[2]) { out.push(m[2]); return; }
    // A YAML block list under the key: "command:" then "- npm", "- start".
    const items: string[] = [];
    for (const next of lines.slice(i + 1)) { const item = /^\s*-\s+(.+)$/.exec(next); if (!item) break; items.push(item[1]!); }
    if (items.length) out.push(items.join(" "));
  });
  return out;
}

/**
 * The split for one npm project: its package-lock (v2/v3) and, when given, its files at the same commit. `manifest` is
 * the root package.json, for its scripts when no source tree is given.
 */
export function productionSplit(lockText: string, source: SourceTree | null, manifest?: unknown): Split {
  const lock = readLock(lockText);
  const entries = lockEntries(lockText), byPath = new Map(entries.map(e => [e.path, e]));
  const byName = new Map<string, LockEntry[]>(), bins = new Map<string, LockEntry[]>();
  for (const e of entries) {
    byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
    const bin = lock[e.path]?.bin;
    for (const b of typeof bin === "string" ? [e.name.split("/").at(-1)!] : bin && typeof bin === "object" ? Object.keys(bin) : []) bins.set(b, [...(bins.get(b) ?? []), e]);
  }
  /** The project folders: the root and every workspace folder, with their package.json fields from the lockfile. */
  const folders = Object.entries(lock).filter(([path, item]) => !path.includes("node_modules/") && item && typeof item === "object" && !item.link).map(([path, item]) => ({ dir: path ? `${path}/` : "", item }));
  const seeds = new Map<string, string>();
  const seed = (e: LockEntry | undefined, why: string) => { if (e && !seeds.has(e.path)) seeds.set(e.path, why); };
  /** What a file at `file` loads for `name`: the nearest node_modules up its path, else every installed copy of that name. */
  const seedFrom = (file: string, name: string | null, why: string) => {
    if (!name) return;
    const parts = file.split("/").slice(0, -1);
    for (let i = parts.length; i >= 0; i--) {
      const found = byPath.get(`${parts.slice(0, i).map(p => `${p}/`).join("")}node_modules/${name}`);
      if (found) { seed(found, why); return; }
    }
    for (const e of byName.get(name) ?? []) seed(e, why);
  };

  // P0, P3, P4.
  for (const e of entries) {
    if (!e.dev) seed(e, "not dev in the lockfile");
    if (RUNTIMES.has(e.name)) seed(e, "a runtime shipped with the app");
  }
  for (const { dir } of folders) for (const name of HELPERS) seed(resolveFrom(byPath, dir, name), `a bundler helper library, resolved from ${dir || "the root"}`);

  let incomplete = source?.incomplete ?? null;
  const imagesWithDev: string[] = [];
  const scripts = new Map<string, Record<string, unknown>>();
  const production: { from: string; text: string }[] = [], build: { from: string; text: string }[] = [];
  if (source) {
    const has = new Set(source.files);
    const text = (file: string) => { const t = source.read(file); if (t === null) incomplete ??= `${file} could not be read`; return t; };
    const ignores = (path: string) => { const t = has.has(path) ? source.read(path) : null; return t !== null && /^\s*(\*\*\/|\/|\.\/)?node_modules(\/\*{0,2})?\/?\s*$/m.test(t); };
    for (const file of source.files) {
      const base = file.split("/").at(-1)!, dir = file.slice(0, file.length - base.length);
      if (base === "package.json") {
        const t = text(file);
        let pkg: any = null;
        try { pkg = JSON.parse(t ?? "null"); } catch { /* not JSON: nothing to read */ }
        if (pkg?.scripts && typeof pkg.scripts === "object") {
          scripts.set(dir, pkg.scripts);
          for (const s of Object.values<unknown>(pkg.scripts)) if (typeof s === "string") for (const n of nodeModulesPaths(s)) seedFrom(file, n, `named by a node_modules path in ${file}'s scripts`);
        }
        for (const field of ["babel", "postcss"] as const) if (pkg?.[field]) for (const n of configNames(JSON.stringify(pkg[field]), field)) seedFrom(file, n, `named by ${file} (${field})`);
        continue;
      }
      if (DOCKERFILE.test(file) && !/(^|\/)\.devcontainer\//.test(file)) {
        const t = text(file);
        if (t === null || !/^\s*FROM\s/im.test(t)) continue;
        if (base.replace(/dockerfile|containerfile/ig, " ").split(/[\s._-]+/).some(w => /^(dev|development|test|tests|ci|e2e)$/i.test(w))) continue;
        const image = dockerImage(t, ignores(`${dir}.dockerignore`) || ignores(`${file}.dockerignore`) || ignores(".dockerignore"));
        if (image.holds) imagesWithDev.push(file);
        for (const c of image.production) production.push({ from: file, text: c });
        for (const c of image.build) build.push({ from: `${file} (a stage it copies from)`, text: c });
        continue;
      }
      if (COMMAND_FILE.test(file)) {
        const t = text(file);
        if (t !== null) for (const c of fileCommands(file, t)) production.push({ from: file, text: c });
      }
      if (/(^|\/)vercel\.json$/i.test(file)) {
        try { const v = JSON.parse(text(file) ?? "null"); if (typeof v?.buildCommand === "string") build.push({ from: file, text: v.buildCommand }); } catch { /* not JSON */ }
      }
      if (/(^|\/)netlify\.toml$/i.test(file)) for (const m of (text(file) ?? "").matchAll(/^\s*command\s*=\s*["'](.+)["']\s*$/gm)) build.push({ from: file, text: m[1]! });
      if (BUILD_CONFIG.test(file)) {
        const t = text(file);
        if (t !== null) for (const n of configNames(t, /babel/i.test(base) ? "babel" : /postcss/i.test(base) ? "postcss" : "other")) seedFrom(file, n, `named by ${file}, a build tool's configuration`);
      }
      if (TSCONFIG.test(file)) for (const m of (text(file) ?? "").matchAll(/"jsxImportSource"\s*:\s*"([^"]+)"/g)) seedFrom(file, packageOf(m[1]!), `jsxImportSource in ${file}`);
      if (TEST_DIR.test(file) || TEST_FILE.test(file) || TOOL_CONFIG.test(file) || TYPES_FILE.test(file)) continue;
      if (!CODE.test(file) && !STYLE.test(file) && !MARKUP.test(file)) continue;
      const t = text(file);
      if (t === null) continue;
      for (const s of [...codeSpecifiers(t), ...styleSpecifiers(t)]) seedFrom(file, packageOf(s), `imported by ${file}`);
      for (const n of nodeModulesPaths(t)) seedFrom(file, n, `named by a node_modules path in ${file}`);
    }
  } else if (manifest && typeof manifest === "object" && (manifest as any).scripts && typeof (manifest as any).scripts === "object") {
    scripts.set("", (manifest as any).scripts);
  }

  // P5 and P6: the commands, followed through the scripts they call.
  for (const [dir, s] of scripts) for (const [name, text] of Object.entries(s)) {
    if (typeof text !== "string") continue;
    if (/^(pre|post)?start$/.test(name)) production.push({ from: `${dir}package.json scripts.${name}`, text });
    if (/^(pre|post)?(build|generate|export)(:.*)?$/.test(name)) build.push({ from: `${dir}package.json scripts.${name}`, text });
  }
  const run = (commands: { from: string; text: string }[], kind: "production" | "build") => {
    const followed = new Set<string>();
    for (let i = 0; i < commands.length; i++) {
      const { from, text } = commands[i]!;
      const why = kind === "production" ? `${from} runs it` : `the build runs it (${from})`;
      // P6 does not make test runners, linters and formatters production.
      const use = (e: LockEntry) => { if (kind === "production" || !devTool(e.name)) seed(e, why); };
      for (const segment of segmentsOf(text)) {
        const words = wordsOf(segment), runner = words.some(w => RUNNER.test(w));
        let executes = false;
        for (const [k, w] of words.entries()) {
          for (const e of bins.get(w) ?? []) use(e);
          const named = packageOf(w.replace(/^npm:/, "").replace(/(.)@[^/@]*$/, "$1"));
          if (named && (k === 0 || executes || LOADS.has(words[k - 1] ?? ""))) for (const e of byName.get(named) ?? []) use(e);
          if (EXECUTES.test(w)) executes = true;
          else if (!w.startsWith("-")) executes = false;
          if (!runner) continue;
          const script = w.replace(/^npm:/, ""), glob = script.endsWith("*") ? script.slice(0, -1) : null;
          for (const [dir, s] of scripts) for (const [name, body] of Object.entries(s)) {
            if (typeof body !== "string" || !(name === script || (glob !== null && glob !== "" && name.startsWith(glob))) || followed.has(`${dir}\0${name}`)) continue;
            followed.add(`${dir}\0${name}`);
            commands.push({ from: `${dir}package.json scripts.${name} (from ${from})`, text: body });
          }
        }
      }
    }
  };
  run(production, "production");
  run(build, "build");

  // D2 needs the whole source tree and no production image holding devDependencies. Otherwise only D1 can show a copy
  // dev-only: every declared dependency that is not a D1 package, and every copy no declared dependency reaches, is production.
  const ruleB = !!source && incomplete === null && !imagesWithDev.length;
  const declared: [LockEntry, string][] = [];
  for (const { dir, item } of folders) for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(item[group] && typeof item[group] === "object" ? item[group] : {})) {
      const target = resolveFrom(byPath, dir, name);
      if (target) declared.push([target, `declared by ${dir || "the root"}`]);
    }
  }
  const close = (start: [LockEntry, string][]) => {
    const reached = new Map<string, string>(), queue: LockEntry[] = [];
    const add = (e: LockEntry, why: string) => { if (!reached.has(e.path)) { reached.set(e.path, why); queue.push(e); } };
    for (const [e, why] of start) add(e, why);
    while (queue.length) {
      const e = queue.shift()!, item = lock[e.path] ?? {};
      for (const group of ["dependencies", "optionalDependencies", "peerDependencies"]) for (const name of Object.keys(item[group] && typeof item[group] === "object" ? item[group] : {})) {
        const dep = resolveFrom(byPath, `${e.path}/`, name);
        if (dep) add(dep, `a dependency of ${e.name}@${e.version} at ${e.path}, which is production`);
      }
    }
    return reached;
  };
  if (!ruleB) {
    const because = !source ? "the source tree was not given" : incomplete !== null ? `the source tree is incomplete: ${incomplete}` : `the final stage of ${imagesWithDev.join(", ")} holds devDependencies`;
    for (const [e, why] of declared) if (!devTool(e.name)) seed(e, `${why}, not a test runner, linter, formatter or @types package, and ${because}`);
    const reachable = close(declared);
    for (const e of entries) if (!reachable.has(e.path)) seed(e, `reached from no declared dependency, and ${because}`);
  }
  const productionCopies = close([...seeds].map(([path, why]): [LockEntry, string] => [byPath.get(path)!, why]));

  const copies = new Map<string, CopySplit>();
  for (const e of entries) {
    const why = productionCopies.get(e.path);
    copies.set(e.path, { path: e.path, name: e.name, version: e.version, production: why !== undefined, why: why ?? (ruleB ? "dev-only (D2): dev in the lockfile, and no import, build tool, production command or production image reaches it" : "dev-only (D1): reached only through test runners, linters, formatters or @types packages") });
  }
  const devOnly = new Set<string>(), versions = new Map<string, boolean>();
  for (const c of copies.values()) { const key = `${c.name}@${c.version}`; versions.set(key, (versions.get(key) ?? true) && !c.production); }
  for (const [key, dev] of versions) if (dev) devOnly.add(key);
  return { copies, devOnly, summary: { source: !source ? "not_given" : incomplete !== null ? "incomplete" : "read", incomplete, images_with_dev: imagesWithDev } };
}
