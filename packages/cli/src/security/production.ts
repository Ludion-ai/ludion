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
// Names as section 2 writes them (lowercase): another spelling is source.
const TEST_DIR = /(^|\/)(test|tests|__tests__|__mocks__|__snapshots__|__fixtures__|e2e|cypress|playwright|spec|specs)\//;
const TEST_FILE = /\.(test|spec|e2e|cy)\.[^/]+$|(^|\/)(setupTests|setup-tests|test-setup|jest\.setup|vitest\.setup)\.[^/]+$/;
const TOOL_CONFIG = /(^|\/)(jest|vitest|playwright|cypress|karma|ava|wdio|nightwatch|mocha|tap|eslint|prettier|stylelint|commitlint|lint-staged)\.(config|conf|workspace)(\.[^/]*)?$|(^|\/)\.(eslintrc|prettierrc|stylelintrc|lintstagedrc|commitlintrc|mocharc)[^/]*$|(^|\/)\.husky\//;
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

const BUILTINS = new Set(builtinModules);
/**
 * The package a bare module specifier names, or null for relative, absolute, URL and alias specifiers. A builtin
 * specifier (`events`, `fs/promises`) names none in an import, but `buffer/` and `process/browser` name packages.
 * `builtins: false` is for a build tool's configuration, where a quoted `buffer` names the installed package (P2).
 */
export function packageOf(specifier: string, builtins = true): string | null {
  let s = specifier.trim();
  if (s.startsWith("~") && !s.startsWith("~/")) s = s.slice(1);
  if (!s || /^[./]/.test(s) || s.includes(":") || /^(#|@\/|~\/|\$|@@\/)/.test(s) || /[\s\\]/.test(s)) return null;
  // A bundler's query (?raw, ?worker) is not part of the name.
  const bare = s.replace(/[?#].*$/, ""), parts = bare.split("/");
  if (builtins && BUILTINS.has(bare)) return null;
  const name = s.startsWith("@") ? (parts.length > 1 ? `${parts[0]}/${parts[1]}` : null) : parts[0]!;
  if (!name || !/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) return null;
  return name;
}

/** The first position at or after `from` where `token` occurs (-1: none), by binary search over positions listed once. */
function finder(text: string): (token: string, from: number) => number {
  const positions = new Map<string, number[]>();
  return (token, from) => {
    let at = positions.get(token);
    if (!at) { at = []; for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + 1)) at.push(i); positions.set(token, at); }
    let lo = 0, hi = at.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid]! >= from) hi = mid; else lo = mid + 1; }
    return at[lo] ?? -1;
  };
}

/**
 * The literal specifier of each `import(…)`, `require(…)` and `require.resolve(…)` call, after any whitespace and any
 * number of comments. Linear on any file: where a comment ends is a lookup, where skipping from a position ends is
 * remembered for every position passed, and each specifier position is read once, however many calls reach it.
 */
function callSpecifiers(text: string): string[] {
  const out: string[] = [], quoted = /(["'\x60])([^"'\x60\n$]+)\1/y, next = finder(text);
  const settled = new Map<number, number>(), specifierAt = new Map<number, string | null>();
  const skip = (start: number) => {
    const path: number[] = [];
    let p = start, end = settled.get(p);
    while (end === undefined) {
      path.push(p);
      let q = p;
      while (q < text.length && /\s/.test(text[q]!)) q++;
      const close = text.startsWith("/*", q) ? next("*/", q + 2) : text.startsWith("//", q) ? next("\n", q + 2) : -1;
      // An unclosed comment, or no comment: the specifier, if any, starts here.
      if (close < 0) { end = q; break; }
      p = text.startsWith("/*", q) ? close + 2 : close + 1;
      end = settled.get(p);
    }
    for (const at of path) settled.set(at, end);
    return end;
  };
  for (const m of text.matchAll(/\b(?:import|require(?:\.resolve)?)\s*\(/g)) {
    const p = skip(m.index! + m[0].length);
    if (!specifierAt.has(p)) { quoted.lastIndex = p; specifierAt.set(p, quoted.exec(text)?.[2] ?? null); }
    const specifier = specifierAt.get(p);
    if (specifier) out.push(specifier);
  }
  return out;
}
/**
 * Module specifiers a code file loads: every `from "x"`, `import "x"`, `import()`, `require()` and `require.resolve()`
 * with a literal specifier. Only a strictly type-only import or export (`import type { A } from "x"`) is erased; its
 * brace list cannot hold quotes, semicolons or braces, so it cannot swallow another import.
 */
export function codeSpecifiers(text: string): string[] {
  const out: string[] = [], typeOnly = new Set<number>();
  for (const m of text.matchAll(/\b(?:import|export)\s+type\s+(?:\{[^{}"'\x60;]{0,2000}\}|\*\s*as\s+[\w$]+|[\w$]+)\s*(from\s*(["'])[^"'\n]+\2)/g)) typeOnly.add(m.index! + m[0].length - m[1]!.length);
  for (const m of text.matchAll(/\bfrom\s*(["'])([^"'\n]+)\1/g)) if (!typeOnly.has(m.index!)) out.push(m[2]!);
  for (const m of text.matchAll(/\bimport\s*(["'])([^"'\n]+)\1/g)) out.push(m[2]!);
  out.push(...callSpecifiers(text));
  for (const m of text.matchAll(/@jsxImportSource\s+([^\s*]+)/g)) out.push(m[1]!);
  return out;
}
/**
 * What a stylesheet (or a component's <style>) imports: every item of an @import, @use, @forward, @plugin or
 * @reference list, and url(~…). A clause ends at `;`, `{`, `}` or an `@` outside quotes and comments, and is read
 * twice: as written, and ending at a line break unless the line ends with a comma (Sass's indented syntax, Stylus). A
 * Less option such as `(reference)` is skipped, and an unquoted list (`@import bourbon, neat`) gives every item.
 * c381a85's reading (the first item) is kept beside them.
 */
export function styleSpecifiers(text: string): string[] {
  const out: string[] = [], next = finder(text);
  /** The clause from `p`; with `lines`, a line break ends it unless the line ends with a comma (Sass's indented syntax, Stylus). */
  const clauseAt = (start: number, limit: number, lines: boolean) => {
    let p = start, clause = "", lastSolid = "";
    while (p < limit && clause.length < 4000) {
      const c = text[p]!;
      if (c === '"' || c === "'") {
        const end = next(c, p + 1), nl = next("\n", p + 1);
        if (end < 0 || end >= limit || (nl >= 0 && nl < end)) break;
        clause += text.slice(p, end + 1); p = end + 1; lastSolid = c; continue;
      }
      // A comment is jumped over, so an `@` in it does not end the clause; what it quotes is still read.
      if (c === "/" && text[p + 1] === "*") {
        const end = next("*/", p + 2);
        if (end < 0 || end >= limit) break;
        clause += text.slice(p, end + 2); p = end + 2; continue;
      }
      if (c === ";" || c === "{" || c === "}" || c === "@") break;
      if (c === "\n" && lines && lastSolid !== ",") break;
      if (!/\s/.test(c)) lastSolid = c;
      clause += c; p++;
    }
    return clause.replace(/^\s*\([^)]*\)\s*/, "");
  };
  const rules = [...text.matchAll(/@(?:import|use|forward|plugin|reference)\s+/g)];
  // Which rules stand outside quotes and block comments: only those end another rule's clause. One pass over the text.
  const outside: boolean[] = [];
  for (let i = 0, r = 0, quote = "", comment = false; i < text.length && r < rules.length; i++) {
    while (r < rules.length && rules[r]!.index === i) outside[r++] = !quote && !comment;
    const c = text[i];
    if (comment) { if (c === "*" && text[i + 1] === "/") { comment = false; i++; } }
    else if (quote) { if (c === quote || c === "\n") quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === "/" && text[i + 1] === "*") { comment = true; i++; }
  }
  // A rule's clause runs to the next rule outside quotes and comments (a rule inside them: to the next rule of any kind),
  // so the clauses of rules outside them never overlap, and the whole file is read in linear time.
  const limits: number[] = [];
  for (let k = rules.length - 1, nextOutside = text.length; k >= 0; k--) {
    limits[k] = outside[k] ? nextOutside : rules[k + 1]?.index ?? text.length;
    if (outside[k]) nextOutside = rules[k]!.index!;
  }
  // Both readings are kept: a list that runs across lines in CSS, and one item per line in the indented syntaxes.
  for (const [k, m] of rules.entries()) for (const clause of [true, false].map(lines => clauseAt(m.index! + m[0].length, limits[k]!, lines))) {
    const quoted = [...clause.matchAll(/["']([^"'\n]+)["']/g)].map(q => q[1]!), urls = [...clause.matchAll(/url\(\s*["']?([^"')\s]+)/g)].map(u => u[1]!);
    if (quoted.length || urls.length) out.push(...quoted, ...urls);
    else for (const item of clause.split(",")) { const bare = /^\s*([^\s,;]+)/.exec(item); if (bare) out.push(bare[1]!); }
  }
  for (const m of text.matchAll(/@(?:import|use|forward|plugin|reference)\s+(?:url\(\s*)?["']?([^"')\s;]+)/g)) out.push(m[1]!);
  for (const m of text.matchAll(/url\(\s*["']?~([^"')\s]+)/g)) out.push(m[1]!);
  return [...new Set(out)];
}
/** Packages a file names by a node_modules path (a <script src>, a copied asset). */
const nodeModulesPaths = (text: string) => [...text.matchAll(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)/g)].map(m => m[1]!);

/**
 * Package names a build tool's configuration names: quoted strings (and, for a JSON value, every string and key), every
 * node_modules/<name> path, Babel's short names spelled out, PostCSS's object keys. A builtin's name counts here.
 */
export function configNames(text: string, kind: "babel" | "postcss" | "other", json?: unknown): string[] {
  const raw: string[] = [...text.matchAll(/["'`]([^"'`\n]{1,214})["'`]/g)].map(m => m[1]!);
  const walk = (value: unknown): void => {
    if (typeof value === "string") raw.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { raw.push(k); walk(v); }
  };
  walk(json);
  if (kind === "postcss") raw.push(...[...text.matchAll(/(?:^|[{,\s])([A-Za-z_@][\w@/.-]*)\s*:/g)].map(m => m[1]!));
  const out = new Set<string>(nodeModulesPaths(text));
  for (const r of raw) {
    let s = r.replace(/^module:/, "");
    // "@angular-devkit/build-angular:browser" names a builder of a package; "node:fs" or a URL names none.
    const builder = /^([^:]+):[^/]/.exec(s);
    if (builder && !/^(node|https?|data|virtual|file|npm|workspace|link|git|github)$/i.test(builder[1]!)) s = builder[1]!;
    const name = packageOf(s, false);
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
/** A command's words, with `--import=x` split into `--import x` and `./node_modules/.bin/x` read as the bin `x`. */
const commandWords = (segment: string) => wordsOf(segment).flatMap(w => {
  const loader = /^(-r|--require|--import|--loader|--experimental-loader)=(.+)$/.exec(w);
  return loader ? [loader[1]!, loader[2]!.replace(/^["']|["']$/g, "")] : [w.replace(/^(\.\/)?(.*\/)?node_modules\/\.bin\//, "")];
});
const RUNNER = /^(npm|yarn|pnpm|bun|npx|bunx|pnpx|run-s|run-p|npm-run-all2?|concurrently|turbo|nx|lerna)$/;
/** Words after which the next word that is not a flag names a package to run. */
const EXECUTES = /^(npx|bunx|pnpx|dlx|exec|x)$/;
const LOADS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);

type Image = { holds: boolean; held: string[]; production: string[]; build: string[] };
/**
 * A COPY source that is one package's folder in node_modules: its install path from the first node_modules on
 * (`/app/node_modules/@scope/name` is `node_modules/@scope/name`, `/app/node_modules/a/node_modules/b` is
 * `node_modules/a/node_modules/b`). Anything else (node_modules itself, `.bin`, `.prisma`, a wildcard, a path inside a
 * package) is null.
 */
function packageFolder(source: string): string | null {
  if (/[*?[\]]/.test(source)) return null;
  const parts = source.replace(/\/+$/, "").split("/"), at = parts.indexOf("node_modules");
  if (at < 0) return null;
  const out: string[] = [];
  for (let i = at; i < parts.length;) {
    if (parts[i] !== "node_modules") return null;
    const scoped = parts[i + 1]?.startsWith("@") ? 2 : 1, name = parts.slice(i + 1, i + 1 + scoped).join("/");
    if (parts.length < i + 1 + scoped || !/^(@[\w-][\w.-]*\/)?[\w-][\w.-]*$/.test(name)) return null;
    out.push(`node_modules/${name}`);
    i += 1 + scoped;
  }
  return out.join("/");
}
/**
 * A Dockerfile: whether its final stage holds devDependencies, the package folders (install paths, see packageFolder) it
 * holds because it copies only those folders out of node_modules, the commands of its final stage and the stages it is
 * built FROM (P5), and the RUN commands of the stages it copies from (P6). `ignoresNodeModules`: the build context's
 * .dockerignore leaves node_modules out.
 */
export function dockerImage(text: string, ignoresNodeModules: boolean): Image {
  /** `named`: the stage holds package folders, its own or through `heldFrom` (kept as each is added, so it is O(1)). */
  type Stage = { name: string | null; from: Stage | null; holds: boolean; held: string[]; heldFrom: Stage[]; named: boolean; production: boolean; workdir: string; workdirAsWritten: string; runs: string[]; commands: string[]; copies: Stage[] };
  const stages: Stage[] = [];
  const install = /\b(npm\s+(ci|install|i)\b|yarn(\s+install)?\s*($|--|-)|pnpm\s+(install|i)\b|bun\s+(install|i)\b)/;
  const global = /(^|\s)(-g|--global)(\s|$)|\byarn\s+global\b/;
  const omits = /--omit[= ]dev|--only[= ]prod(uction)?\b|--production(?![= ]?false)\b|--prod(?![= ]?false)\b|(^|\s)-P(\s|$)/;
  // Asks for devDependencies whatever NODE_ENV says (beyond section 2's text, in the safe direction).
  const includes = /--include[= ]dev\b|--production[= ]?false\b|--prod[= ]?false\b/;
  const prunes = /\bnpm\s+prune\b.*(--omit[= ]dev|--production(?![= ]?false))|\bpnpm\s+prune\b.*--prod(?![= ]?false)|\byarn\s+workspaces\s+focus\b.*--production/;
  // Continuation lines are joined; a BuildKit heredoc (RUN <<EOF … EOF) becomes one RUN whose lines are its commands.
  const lines: string[] = [], raw = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  // Where each possible closing line is, as written and trimmed (for `<<-`), so finding one is a lookup, not a scan.
  const exact = new Map<string, number[]>(), trimmed = new Map<string, number[]>();
  raw.forEach((l, j) => { for (const [map, key] of [[exact, l], [trimmed, l.trim()]] as const) { const at = map.get(key); if (at) at.push(j); else map.set(key, [j]); } });
  /** Stages by name (lowercase) and by index, for FROM and COPY --from. */
  const named = new Map<string, Stage>();
  const after = (indices: number[] | undefined, i: number) => { let lo = 0, hi = indices?.length ?? 0; while (lo < hi) { const mid = (lo + hi) >> 1; if (indices![mid]! > i) hi = mid; else lo = mid + 1; } return indices?.[lo] ?? -1; };
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    // `<<` as its own word (not `<<<`, not `1<<2`), a delimiter that is one shell word (`EOF`, `END-SCRIPT`,
    // `'EOF.sh'`), and a closing line.
    const doc = /^(RUN\b.*?\s)<<(-?)[ \t]*(?:(["'])([^"'\n]+)\3|([^\s<"']+))(.*)$/i.exec(line);
    const word = doc ? doc[4] ?? doc[5]! : "";
    const end = doc ? after((doc[2] ? trimmed : exact).get(word), i) : -1;
    if (!doc || end < 0) { lines.push(line); continue; }
    lines.push(`${doc[1]} ${doc[6]}\n${raw.slice(i + 1, end).join("\n")}`);
    i = end;
  }
  for (const line of lines) {
    const m = /^(\w+)\s+([\s\S]*)$/.exec(line);
    if (!m) continue;
    const op = m[1]!.toUpperCase(), arg = m[2]!.trim();
    if (op === "FROM") {
      const f = /^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(arg);
      const parent = named.get((f?.[1] ?? "").toLowerCase()) ?? null;
      const stage: Stage = { name: f?.[2] ?? null, from: parent, holds: parent?.holds ?? false, held: [], heldFrom: parent ? [parent] : [], named: parent?.named ?? false, production: parent?.production ?? false, workdir: parent?.workdir ?? "/", workdirAsWritten: parent?.workdirAsWritten ?? "/", runs: [], commands: [], copies: [] };
      stages.push(stage);
      if (stage.name !== null && !named.has(stage.name.toLowerCase())) named.set(stage.name.toLowerCase(), stage);
      continue;
    }
    const stage = stages.at(-1);
    if (!stage) continue;
    const command = arg.startsWith("[") ? (() => { try { return (JSON.parse(arg) as string[]).join(" "); } catch { return arg; } })() : arg;
    if ((op === "ENV" || op === "ARG") && /\bNODE_ENV\b/.test(arg)) stage.production = /\bNODE_ENV(\s*=\s*|\s+)["']?production\b/.test(arg);
    // Two readings of the working folder, and a source matching either counts: as written (main's reading), and a
    // relative WORKDIR resolved against the one before it. A variable that holds an absolute path matches as written.
    if (op === "WORKDIR") {
      const w = arg.replace(/^["']|["']$/g, "");
      stage.workdir = w.startsWith("/") ? w : `${stage.workdir.replace(/\/+$/, "")}/${w}`;
      stage.workdirAsWritten = w;
    }
    if (op === "CMD" || op === "ENTRYPOINT") stage.commands.push(command);
    if (op === "RUN") {
      stage.commands.push(command); stage.runs.push(command);
      for (const segment of segmentsOf(command)) {
        // A command's own NODE_ENV=… wins over the stage's.
        const own = /(?:^|\s)NODE_ENV=["']?([^\s"']*)/.exec(segment), production = own ? own[1] === "production" : stage.production;
        if (install.test(segment) && !global.test(segment) && (includes.test(segment) || (!omits.test(segment) && !production))) stage.holds = true;
        else if (prunes.test(segment)) stage.holds = false;
      }
    }
    if (op === "COPY" || op === "ADD") {
      const parts = wordsOf(arg), from = parts.find(p => /^--from=/i.test(p))?.slice(7);
      const sources = parts.filter(p => !p.startsWith("--")).slice(0, -1);
      // A path as a folder from the root (a COPY --from path is read from the stage's root): empty and `.` segments
      // dropped, `..` resolved and clamped at the root, as Docker does. "" is the root (or the build context's root).
      const folderOf = (p: string) => {
        const out: string[] = [];
        for (const s of p.split("/")) { if (s === "..") out.pop(); else if (s !== "" && s !== ".") out.push(s); }
        return out.length ? `/${out.join("/")}` : "";
      };
      // One package's folder out of node_modules holds that package (and what is nested in it), not every devDependency.
      // Not for ADD, which can unpack an archive. The root, the working folder or a folder above it still holds them,
      // whatever its path.
      const folders = sources.map(s => op === "COPY" ? packageFolder(s) : null);
      const strip = (p: string) => p.replace(/\/+$/, "") || "/";
      const holdsAll = (s: string, k: number, source: Stage | null) => {
        if (folders[k] === null && /node_modules/.test(s)) return true;
        // The text as written against the working folder as written, as before.
        if (source !== null && (/^(\.|\.\/|\/)$/.test(s) || strip(s) === strip(source.workdirAsWritten))) return true;
        const n = folderOf(s);
        if (n === "" || source === null) return n === "";
        return [source.workdir, source.workdirAsWritten].some(workdir => { const w = folderOf(workdir); return n === w || w.startsWith(`${n}/`); });
      };
      if (from !== undefined) {
        const source = named.get(from.toLowerCase()) ?? (/^\d+$/.test(from) ? stages[Number(from)] : undefined);
        if (source) {
          stage.copies.push(source);
          if (sources.some((s, k) => holdsAll(s, k, source))) { stage.holds ||= source.holds; stage.heldFrom.push(source); stage.named ||= source.named; }
          // A folder from a stage that holds devDependencies or package folders: that folder, and whatever that stage
          // holds by name (it may have copied another package there). From any other stage it holds no devDependency.
          if ((source.holds || source.named) && folders.some(f => f !== null)) {
            for (const f of folders) if (f !== null) stage.held.push(f);
            stage.heldFrom.push(source);
            stage.named = true;
          }
        }
      } else if (!ignoresNodeModules) {
        for (const f of folders) if (f !== null) { stage.held.push(f); stage.named = true; }
        if (sources.some((s, k) => holdsAll(s, k, null))) stage.holds = true;
      }
    }
  }
  const last = stages.at(-1);
  if (!last) return { holds: false, held: [], production: [], build: [] };
  // Each stage is visited once, by loops, so a long FROM chain costs linear time and no recursion.
  const own: Stage[] = [], seen = new Set<Stage>();
  for (let at: Stage | null = last; at && !seen.has(at); at = at.from) { seen.add(at); own.push(at); }
  const production = own.flatMap(s => s.commands), build: string[] = [], queue = own.flatMap(s => s.copies);
  for (let q = 0; q < queue.length; q++) {
    for (let at: Stage | null = queue[q]!; at && !seen.has(at); at = at.from) {
      seen.add(at);
      build.push(...at.runs);
      queue.push(...at.copies);
    }
  }
  // What the final stage holds by name: its own folder copies and those of the stages it inherits, each stage once.
  const held = new Set<string>(), inherited = new Set<Stage>([last]), walk = [last];
  for (let q = 0; q < walk.length; q++) {
    for (const name of walk[q]!.held) held.add(name);
    for (const s of walk[q]!.heldFrom) if (!inherited.has(s)) { inherited.add(s); walk.push(s); }
  }
  return { holds: last.holds, held: [...held], production, build };
}

/** Production commands in a command file (Procfile, compose, render, fly, pm2 ecosystem, …). TOML gives every value. */
function fileCommands(file: string, text: string): string[] {
  if (/(^|\/)Procfile$/i.test(file)) return text.split(/\r?\n/).flatMap(l => { const m = /^\s*[\w.-]+\s*:\s*(.+)$/.exec(l); return m ? [m[1]!] : []; });
  if (/\.json$/i.test(file)) {
    const out: string[] = [];
    const walk = (value: unknown, key: string) => {
      if (typeof value === "string") { if (COMMAND_KEY.test(key)) out.push(value); }
      else if (Array.isArray(value)) { if (COMMAND_KEY.test(key) && value.every(v => typeof v === "string")) out.push(value.join(" ")); else value.forEach(v => walk(v, key)); }
      else if (value && typeof value === "object") {
        // pm2: `script` runs with its `args`.
        const o = value as Record<string, unknown>, args = Array.isArray(o.args) ? o.args.join(" ") : o.args;
        if (typeof o.script === "string" && typeof args === "string") out.push(`${o.script} ${args}`);
        for (const [k, v] of Object.entries(value)) walk(v, k);
      }
    };
    try { walk(JSON.parse(text), ""); } catch { return [text]; }
    return out;
  }
  if (/\.[cm]?[jt]s$/i.test(file)) {
    // A pm2 ecosystem file: `script: 'x'`, `args: ['a', 'b']`, anywhere on a line, and each object's script with its args.
    const out: string[] = [];
    const value = (m: RegExpMatchArray) => m[3] ?? m[4]!.replace(/["'`,]/g, " ");
    // Each array item is a quoted string, then spaces and at most one comma: one way to match, so no runaway backtracking.
    const pair = /\b(\w+)\s*:\s*(?:(["'`])([^"'`\n]*)\2|\[\s*((?:["'`][^"'`\n]*["'`]\s*(?:,\s*)?)*)\])/g;
    for (const m of text.matchAll(pair)) if (COMMAND_KEY.test(m[1]!)) out.push(value(m));
    for (const o of text.matchAll(/\{[^{}]*\}/g)) {
      const found = new Map([...o[0].matchAll(pair)].map(m => [m[1]!, value(m)]));
      if (found.has("script") && found.has("args")) out.push(`${found.get("script")} ${found.get("args")}`);
    }
    return out;
  }
  const toml = /\.toml$/i.test(file), out: string[] = [], lines = text.split(/\r?\n/);
  const indent = (l: string) => l.length - l.trimStart().length;
  // Lines a block scalar or a block list takes are its value, not keys, and are not read again: linear time.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!, m = /^[ \t]*(?:-[ \t]*)?["']?([\w.-]+)["']?[ \t]*[:=][ \t]*(.*)$/.exec(line);
    if (m) m[2] = m[2]!.trim().replace(/,$/, "").trim();
    if (!m || !(toml || COMMAND_KEY.test(m[1]!))) continue;
    // A YAML block scalar (`command: >` or `|`): the more-indented lines after it.
    if (/^[>|][+-]?\d*$/.test(m[2]!)) {
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && (!lines[j]!.trim() || indent(lines[j]!) > indent(line)); j++) body.push(lines[j]!.trim());
      out.push(body.join("\n"));
      i = j - 1;
      continue;
    }
    if (m[2]) { out.push(m[2]); continue; }
    // A YAML block list under the key: "command:" then "- npm", "- start".
    const items: string[] = [];
    let j = i + 1;
    for (let item: RegExpExecArray | null; j < lines.length && (item = /^\s*-\s+(.+)$/.exec(lines[j]!)); j++) items.push(item[1]!);
    if (items.length) out.push(items.join(" "));
    i = j - 1;
  }
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
  // Arrays grow in place, so many copies of one name cost linear time.
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => { const at = map.get(key); if (at) at.push(value); else map.set(key, [value]); };
  for (const e of entries) {
    add(byName, e.name, e);
    const bin = lock[e.path]?.bin;
    for (const b of typeof bin === "string" ? [e.name.split("/").at(-1)!] : bin && typeof bin === "object" ? Object.keys(bin) : []) add(bins, b, e);
  }
  /** The project folders: the root and every workspace folder, with their package.json fields from the lockfile. */
  const folders = Object.entries(lock).filter(([path, item]) => !path.includes("node_modules/") && item && typeof item === "object" && !item.link).map(([path, item]) => ({ dir: path ? `${path}/` : "", item }));
  const seeds = new Map<string, string>();
  /** node_modules paths that are links (workspaces, `file:`). A COPY follows the link, so such a folder is not known. */
  const linked = new Set(Object.keys(lock).filter(p => p.includes("node_modules/") && lock[p]?.link));
  /** Install and link paths by their part from the first whole node_modules segment on (`packages/api/node_modules/a` under `node_modules/a`), built when first needed. */
  let byFolder: Map<string, string[]> | null = null;
  const folderPaths = () => {
    if (!byFolder) {
      const map = new Map<string, string[]>();
      for (const p of [...entries.map(e => e.path), ...linked]) add(map, p.slice(p.startsWith("node_modules/") ? 0 : p.indexOf("/node_modules/") + 1), p);
      byFolder = map;
    }
    return byFolder;
  };
  /** The lockfile paths a held folder (`node_modules/a`, see packageFolder) is: at that path in the root or in a project folder. */
  const heldPaths = (f: string) => folderPaths().get(f) ?? [];
  /** Whether a path, or a package folder it is nested in, is a link: a COPY of it follows the link. */
  const throughLink = (p: string) => { for (let q = p; ; ) { if (linked.has(q)) return true; const up = q.lastIndexOf("/node_modules/"); if (up < 0) return false; q = q.slice(0, up); } };
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
  const imagesWithDev: string[] = [], unmatchedImages = new Set<string>(), heldBy = new Map<string, string>();
  const scripts = new Map<string, Record<string, unknown>>();
  const production: { from: string; text: string }[] = [], build: { from: string; text: string }[] = [];
  if (source) {
    const has = new Set(source.files);
    const text = (file: string) => { const t = source.read(file); if (t === null) incomplete ??= `${file} could not be read`; return t; };
    const ignores = (path: string) => { const t = has.has(path) ? source.read(path) : null; return t !== null && /^[ \t]*(\*\*\/|\/|\.\/)?node_modules(\/\*{0,2})?\/?[ \t]*\r?$/m.test(t); };
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
        for (const field of ["babel", "postcss"] as const) if (pkg?.[field]) for (const n of configNames(JSON.stringify(pkg[field]), field, pkg[field])) seedFrom(file, n, `named by ${file} (${field})`);
        continue;
      }
      // A Dockerfile is a file so named with a FROM line; any other file so named (src/dockerfile.ts) is read below as usual.
      const dockerfileText = DOCKERFILE.test(file) && !/(^|\/)\.devcontainer\//.test(file) ? text(file) : null;
      if (dockerfileText !== null && /^[ \t]*FROM[ \t]/im.test(dockerfileText) && !base.replace(/dockerfile|containerfile/ig, " ").split(/[\s._-]+/).some(w => /^(dev|development|test|tests|ci|e2e)$/i.test(w))) {
        const image = dockerImage(dockerfileText, ignores(`${dir}.dockerignore`) || ignores(`${file}.dockerignore`) || ignores(".dockerignore"));
        // D2: what the production image holds is not dev-only. A held folder is the installed copy at that install path in
        // the root or a project folder (by path, so an alias counts); it and what is nested in it are seeded after this
        // loop. A held folder that is a link, or no installed copy's, sends the split to D1 only, as before.
        if (image.holds) imagesWithDev.push(file);
        let unmatched = false;
        for (const f of image.held) {
          const at = heldPaths(f);
          if (!at.length || at.some(throughLink)) unmatched = true;
          else for (const p of at) if (!heldBy.has(p)) heldBy.set(p, file);
        }
        if (unmatched && !image.holds) { imagesWithDev.push(file); unmatchedImages.add(file); }
        for (const c of image.production) production.push({ from: file, text: c });
        for (const c of image.build) build.push({ from: `${file} (a stage it copies from)`, text: c });
      }
      if (COMMAND_FILE.test(file)) {
        const t = text(file);
        if (t !== null) for (const c of fileCommands(file, t)) production.push({ from: file, text: c });
      }
      if (/(^|\/)vercel\.json$/i.test(file)) {
        try { const v = JSON.parse(text(file) ?? "null"); if (typeof v?.buildCommand === "string") build.push({ from: file, text: v.buildCommand }); } catch { /* not JSON */ }
      }
      if (/(^|\/)netlify\.toml$/i.test(file)) for (const m of (text(file) ?? "").matchAll(/^[ \t]*command[ \t]*=[ \t]*["'](.+)["'][ \t]*\r?$/gm)) build.push({ from: file, text: m[1]! });
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
    // Every copy in a folder a production image holds, nested ones included: one pass for all Dockerfiles.
    if (heldBy.size) for (const e of entries) for (let p = e.path; ;) {
      const file = heldBy.get(p);
      if (file !== undefined) { seed(e, `held by ${file}'s final stage, which copies its package folder (or one it is nested in) out of node_modules`); break; }
      const up = p.lastIndexOf("/node_modules/");
      if (up < 0) break;
      p = p.slice(0, up);
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
  // Scripts by name, and their names in order, so following `npm run x` or `run-p x:*` is a lookup, not a walk.
  const byScript = new Map<string, [string, string][]>();
  for (const [dir, s] of scripts) for (const [name, body] of Object.entries(s)) {
    if (typeof body !== "string") continue;
    const at = byScript.get(name);
    if (at) at.push([dir, body]); else byScript.set(name, [[dir, body]]);
  }
  const scriptNames = [...byScript.keys()].sort();
  const withPrefix = (prefix: string) => {
    let lo = 0, hi = scriptNames.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (scriptNames[mid]! < prefix) lo = mid + 1; else hi = mid; }
    const out: string[] = [];
    for (let k = lo; k < scriptNames.length && scriptNames[k]!.startsWith(prefix); k++) out.push(scriptNames[k]!);
    return out;
  };
  const run = (commands: { from: string; text: string }[], kind: "production" | "build") => {
    const followed = new Set<string>(), expanded = new Set<string>();
    for (let i = 0; i < commands.length; i++) {
      const { from, text } = commands[i]!;
      const why = kind === "production" ? `${from} runs it` : `the build runs it (${from})`;
      // P6 does not make test runners, linters and formatters production.
      const use = (e: LockEntry) => { if (kind === "production" || !devTool(e.name)) seed(e, why); };
      for (const n of nodeModulesPaths(text)) for (const e of byName.get(n) ?? []) use(e);
      for (const segment of segmentsOf(text)) {
        const words = commandWords(segment), runner = words.some(w => RUNNER.test(w));
        let executes = false;
        for (const [k, w] of words.entries()) {
          for (const e of bins.get(w) ?? []) use(e);
          const named = packageOf(w.replace(/^npm:/, "").replace(/(.)@[^/@]*$/, "$1"));
          if (named && (k === 0 || executes || LOADS.has(words[k - 1] ?? ""))) for (const e of byName.get(named) ?? []) use(e);
          if (EXECUTES.test(w)) executes = true;
          else if (!w.startsWith("-")) executes = false;
          if (!runner) continue;
          const script = w.replace(/^npm:/, ""), glob = script.endsWith("*") ? script.slice(0, -1) : null;
          // A glob already expanded has queued every script it matches.
          const names = glob === null ? [script] : glob === "" || expanded.has(glob) ? [] : (expanded.add(glob), withPrefix(glob));
          for (const name of names) for (const [dir, body] of byScript.get(name) ?? []) {
            if (followed.has(`${dir}\0${name}`)) continue;
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
    const because = !source ? "the source tree was not given" : incomplete !== null ? `the source tree is incomplete: ${incomplete}` : imagesWithDev.map(f => unmatchedImages.has(f) ? `the final stage of ${f} copies a node_modules folder that matches no installed copy` : `the final stage of ${f} holds devDependencies`).join(", and ");
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
