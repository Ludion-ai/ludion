// Gate 1's production/dev split (production.ts; docs/decisions.md, "Gate 1's production/dev split, rebuilt"): only what
// is shown dev-only is left out, and when in doubt a copy is production.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge, lockEntries, lockExtraneous, renderJudgement, type VersionFacts } from "../src/security/judge.ts";
import { codeSpecifiers, configNames, dockerImage, packageOf, productionSplit, readSourceTree, styleSpecifiers, type SourceTree } from "../src/security/production.ts";

const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
type Pkg = { version?: string; dev?: boolean; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; bin?: Record<string, string>; name?: string };
/** A package-lock v3: the root declares `root`, every other key is an install path. */
function lockOf(root: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }, packages: Record<string, Pkg>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "app", ...root },
      ...Object.fromEntries(Object.entries(packages).map(([path, p]) => {
        const name = p.name ?? path.split("node_modules/").at(-1)!;
        return [path, { version: p.version ?? "1.0.0", resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${p.version ?? "1.0.0"}.tgz`, integrity: INTEGRITY, ...(p.name ? { name: p.name } : {}), ...(p.dev ? { dev: true } : {}), ...(p.dependencies ? { dependencies: p.dependencies } : {}), ...(p.peerDependencies ? { peerDependencies: p.peerDependencies } : {}), ...(p.bin ? { bin: p.bin } : {}) }];
      })),
      ...extra,
    },
  });
}
const tree = (files: Record<string, string | null>): SourceTree => ({ files: Object.keys(files).sort(), read: path => files[path] ?? null, incomplete: null });
const devOnly = (lock: string, source: SourceTree | null, manifest?: unknown) => [...productionSplit(lock, source, manifest).devOnly].sort();

/** A Vite app: react in production, vite and its plugin, a test runner and a linter as dev, and an unused dev tool. */
const app = lockOf(
  { dependencies: { react: "^18" }, devDependencies: { vite: "^5", "@vitejs/plugin-react": "^4", vitest: "^1", eslint: "^9", nodemon: "^3", lodash: "^4", sass: "^1" } },
  {
    "node_modules/react": { dependencies: { "loose-envify": "^1" } },
    "node_modules/loose-envify": {},
    "node_modules/vite": { dev: true, dependencies: { esbuild: "^0.21", rollup: "^4" }, bin: { vite: "bin/vite.js" } },
    "node_modules/esbuild": { dev: true },
    "node_modules/rollup": { dev: true },
    "node_modules/@vitejs/plugin-react": { dev: true, dependencies: { "@babel/core": "^7" } },
    "node_modules/@babel/core": { dev: true },
    "node_modules/vitest": { dev: true, dependencies: { "tinypool": "^1", vite: "^5" }, bin: { vitest: "vitest.mjs" } },
    "node_modules/tinypool": { dev: true },
    "node_modules/eslint": { dev: true, dependencies: { "ajv": "^6" }, bin: { eslint: "bin/eslint.js" } },
    "node_modules/ajv": { dev: true },
    "node_modules/nodemon": { dev: true, dependencies: { semver: "^7" }, bin: { nodemon: "bin/nodemon.js" } },
    "node_modules/semver": { dev: true },
    "node_modules/lodash": { dev: true },
    "node_modules/sass": { dev: true, bin: { sass: "sass.js" } },
  },
);
const appSource = (over: Record<string, string | null> = {}) => tree({
  "package.json": JSON.stringify({ scripts: { dev: "nodemon server.js", build: "vite build", test: "vitest", lint: "eslint ." } }),
  "vite.config.ts": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });`,
  "src/main.tsx": `import React from "react";\nimport type { Foo } from "lodash";\n`,
  "src/main.test.tsx": `import { describe } from "vitest";\nimport _ from "lodash";`,
  ...over,
});

describe("the split without the source tree (D1 only)", () => {
  it("leaves out only what test runners, linters, formatters and @types packages alone reach", () => {
    expect(devOnly(app, null)).toEqual(["ajv@1.0.0", "eslint@1.0.0", "tinypool@1.0.0", "vitest@1.0.0"]);
  });
  it("keeps a copy production when anything else also reaches it, and keeps copies nothing declared reaches", () => {
    const lock = lockOf({ devDependencies: { jest: "^29", nodemon: "^3" } }, {
      "node_modules/jest": { dev: true, dependencies: { shared: "^1" } },
      "node_modules/nodemon": { dev: true, dependencies: { shared: "^1" } },
      "node_modules/shared": { dev: true },
      "node_modules/orphan": { dev: true },
    });
    expect(devOnly(lock, null)).toEqual(["jest@1.0.0"]);
  });
  it("says which split it used", () => {
    expect(productionSplit(app, null).summary).toEqual({ source: "not_given", incomplete: null, images_with_dev: [] });
  });
});

describe("the split with the source tree (D2)", () => {
  it("keeps what the source, the build configuration and the build reach, and leaves out the rest", () => {
    // vite: imported by vite.config.ts and a helper (P3), with esbuild and rollup through its dependencies; the plugin:
    // imported by the configuration; nodemon: only the dev script; lodash: a type-only import and a test file.
    expect(devOnly(app, appSource())).toEqual(["ajv@1.0.0", "eslint@1.0.0", "lodash@1.0.0", "nodemon@1.0.0", "sass@1.0.0", "semver@1.0.0", "tinypool@1.0.0", "vitest@1.0.0"]);
    const split = productionSplit(app, appSource());
    expect(split.summary.source).toBe("read");
    expect(split.copies.get("node_modules/@babel/core")!.why).toContain("@vitejs/plugin-react");
  });
  it("follows declared dependencies from what the source imports, build-time ones too", () => {
    expect(devOnly(app, appSource({ "src/util.ts": `const _ = require("lodash");` }))).not.toContain("lodash@1.0.0");
    expect(devOnly(app, appSource({ "src/a.ts": `export * from "nodemon";` }))).not.toContain("semver@1.0.0");
  });
  it("counts a stylesheet import, CSS-only or not, and a node_modules path in markup", () => {
    expect(devOnly(app, appSource({ "src/app.scss": `@use "lodash/theme";` }))).not.toContain("lodash@1.0.0");
    expect(devOnly(app, appSource({ "src/app.css": `@import "~lodash/x.css";` }))).not.toContain("lodash@1.0.0");
    expect(devOnly(app, appSource({ "index.html": `<script src="/node_modules/lodash/lodash.js"></script>` }))).not.toContain("lodash@1.0.0");
  });
  it("does not count tests, test and lint configuration, or type declarations", () => {
    const left = devOnly(app, appSource({ "test/setup.ts": `import "lodash";`, "eslint.config.js": `import n from "nodemon";`, "types/x.d.ts": `import "lodash";`, "src/x.spec.js": `require("nodemon")` }));
    expect(left).toContain("lodash@1.0.0");
    expect(left).toContain("nodemon@1.0.0");
  });
  it("keeps what a start script runs, a development server included, and the scripts it calls", () => {
    const withStart = (start: string) => appSource({ "package.json": JSON.stringify({ scripts: { start, serve: "nodemon server.js", build: "vite build" } }) });
    expect(devOnly(app, withStart("nodemon server.js"))).not.toContain("nodemon@1.0.0");
    expect(devOnly(app, withStart("npm run serve"))).not.toContain("semver@1.0.0");
    expect(devOnly(app, withStart("node -r lodash/register server.js"))).not.toContain("lodash@1.0.0");
  });
  it("keeps what the build runs, but not the test runners and linters it runs", () => {
    const source = appSource({ "package.json": JSON.stringify({ scripts: { build: "npm run lint && sass src:dist && vite build", lint: "eslint ." } }) });
    const left = devOnly(app, source);
    expect(left).not.toContain("sass@1.0.0");
    expect(left).toContain("eslint@1.0.0");
  });
  it("keeps what a build tool's configuration names, Babel's short names and PostCSS's keys included", () => {
    expect(devOnly(app, appSource({ "babel.config.json": `{"plugins": ["lodash"]}` }))).not.toContain("lodash@1.0.0");
    expect(configNames(`{"presets": ["env", "@babel/react", "module:metro-react-native-babel-preset"]}`, "babel")).toEqual(expect.arrayContaining(["babel-preset-env", "@babel/preset-env", "@babel/preset-react", "metro-react-native-babel-preset"]));
    expect(configNames(`module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }`, "postcss")).toEqual(expect.arrayContaining(["tailwindcss", "autoprefixer"]));
    const angular = configNames(`{"builder": "@angular-devkit/build-angular:application", "x": "node:fs", "y": "https://a.b/c"}`, "other");
    expect(angular).toContain("@angular-devkit/build-angular");
    expect(angular).not.toContain("node");
    expect(angular).not.toContain("https");
  });
  it("keeps a shipped runtime and every bundler helper a project folder resolves, but not a nested copy under a dev tool", () => {
    const lock = lockOf({ devDependencies: { electron: "^30", eslint: "^9" } }, {
      "node_modules/electron": { dev: true },
      "node_modules/tslib": { dev: true },
      "node_modules/eslint": { dev: true, dependencies: { tslib: "^1" } },
      "node_modules/eslint/node_modules/tslib": { dev: true, version: "1.0.0" },
    });
    const split = productionSplit(lock, tree({ "src/a.js": "" }));
    expect(split.copies.get("node_modules/electron")!.production).toBe(true);
    expect(split.copies.get("node_modules/tslib")!.production).toBe(true);
    expect(split.copies.get("node_modules/eslint/node_modules/tslib")!.production).toBe(false);
  });
  it("leaves a version out only when every installed copy of it is dev-only", () => {
    const lock = lockOf({ devDependencies: { a: "^1", b: "^1" } }, {
      "node_modules/a": { dev: true, dependencies: { x: "^1" } },
      "node_modules/b": { dev: true, dependencies: { x: "^1" } },
      "node_modules/x": { dev: true },
      "node_modules/b/node_modules/x": { dev: true },
    });
    expect(devOnly(lock, tree({ "src/a.js": `import "a";` }))).toEqual(["b@1.0.0"]);
  });
  it("falls back to D1 when a source file cannot be read or the tree is incomplete", () => {
    expect(productionSplit(app, appSource({ "src/huge.js": null })).summary).toEqual({ source: "incomplete", incomplete: "src/huge.js could not be read", images_with_dev: [] });
    expect(devOnly(app, appSource({ "src/huge.js": null }))).toEqual(devOnly(app, null));
    expect(devOnly(app, { ...appSource(), incomplete: "more than 1000000 files" })).toEqual(devOnly(app, null));
  });
});

describe("production images and commands", () => {
  it("falls back to D1 when a production image's final stage holds devDependencies", () => {
    const full = appSource({ Dockerfile: "FROM node:22\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD [\"node\", \"server.js\"]\n", ".dockerignore": "node_modules\n" });
    const split = productionSplit(app, full);
    expect(split.summary.images_with_dev).toEqual(["Dockerfile"]);
    expect([...split.devOnly].sort()).toEqual(devOnly(app, null));
  });
  it("trusts an image that omits devDependencies, prunes them, or copies only the build output", () => {
    const pruned = "FROM node:22 AS build\nWORKDIR /app\nRUN npm ci && npm run build\nRUN npm prune --omit=dev\nFROM build\nCMD npm start\n";
    expect(dockerImage(pruned, false).holds).toBe(false);
    const omitted = "FROM node:22\nENV NODE_ENV=production\nRUN npm ci\nCOPY dist ./dist\n";
    expect(dockerImage(omitted, false).holds).toBe(false);
    const staged = "FROM node:22 AS build\nWORKDIR /app\nRUN npm ci\nRUN npx vite build\nFROM nginx\nCOPY --from=build /app/dist /usr/share/nginx/html\n";
    expect(dockerImage(staged, false)).toEqual({ holds: false, held: [], production: [], build: ["npm ci", "npx vite build"] });
  });
  it("finds devDependencies copied from a stage, or from a build context that keeps node_modules", () => {
    expect(dockerImage("FROM node:22 AS deps\nWORKDIR /app\nRUN npm ci\nFROM node:22-slim\nCOPY --from=deps /app/node_modules ./node_modules\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22 AS deps\nWORKDIR /app\nRUN yarn install --frozen-lockfile\nFROM node:22-slim\nCOPY --from=deps /app /app\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22\nCOPY . .\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22\nCOPY . .\n", true).holds).toBe(false);
    expect(dockerImage("FROM node:22\nRUN npm install -g pm2\n", false).holds).toBe(false);
  });
  it("holds only the packages whose folders an image copies out of node_modules (L1c)", () => {
    const build = "FROM node:22 AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n";
    const picked = `${build}FROM node:22-slim AS base\nCOPY --from=builder /app/dist ./dist\nCOPY --from=builder /app/node_modules/pino-pretty ./node_modules/pino-pretty\nCOPY --from=builder /app/node_modules/@swc/helpers/ ./node_modules/@swc/helpers\nCOPY --from=builder /app/node_modules/a/node_modules/b ./b\nFROM base\nCMD ["node", "dist/a.js"]\n`;
    expect(dockerImage(picked, false)).toMatchObject({ holds: false, held: ["node_modules/pino-pretty", "node_modules/@swc/helpers", "node_modules/a/node_modules/b"] });
    expect(dockerImage("FROM node:22\nCOPY node_modules/lodash ./node_modules/lodash\n", false)).toMatchObject({ holds: false, held: ["node_modules/lodash"] });
    expect(dockerImage("FROM node:22\nCOPY node_modules/lodash ./node_modules/lodash\n", true)).toMatchObject({ holds: false, held: [] });
    // JSON form and flags.
    expect(dockerImage(`${build}FROM node:22-slim\nCOPY --from=builder --chown=1000:1000 --link ["/app/node_modules/foo", "./x"]\n`, false)).toMatchObject({ holds: false, held: ["node_modules/foo"] });
    // A stage copied whole passes on what it holds by name.
    expect(dockerImage(`${build}FROM node:22 AS mid\nWORKDIR /app\nCOPY --from=builder /app/node_modules/lodash ./node_modules/lodash\nFROM node:22-slim\nCOPY --from=mid /app /app\n`, false)).toMatchObject({ holds: false, held: ["node_modules/lodash"] });
    // A folder copied out of a stage that put another package there holds that package too (#190 review, 3).
    expect(dockerImage(`${build}FROM node:22 AS mid\nCOPY --from=builder /app/node_modules/lodash /app/node_modules/foo\nFROM node:22-slim\nCOPY --from=mid /app/node_modules/foo ./node_modules/foo\n`, false).held.sort()).toEqual(["node_modules/foo", "node_modules/lodash"]);
    // From a stage that holds no devDependency (a global install), a folder holds none (#190 review, 5b).
    expect(dockerImage("FROM node:22 AS g\nRUN npm install -g pm2\nFROM node:22-slim\nCOPY --from=g /usr/local/lib/node_modules/pm2 /usr/local/lib/node_modules/pm2\n", false)).toMatchObject({ holds: false, held: [] });
    // Anything that is not one package's folder still holds every devDependency: node_modules itself, a dot folder, a
    // wildcard, a scope alone, a path inside a package, or the working folder.
    for (const source of ["/app/node_modules", "/app/node_modules/", "/app/node_modules/.bin", "/app/node_modules/.prisma", "/app/node_modules/@img*", "/app/node_modules/pino-*", "/app/node_modules/@scope", "/app/node_modules/a/b", "/app/node_modules/a/node_modules", "/app", "/"]) {
      expect(dockerImage(`${build}FROM node:22-slim\nCOPY --from=builder ${source} ./x\n`, false).holds).toBe(true);
    }
    // A package folder that is the stage's working folder is the whole working folder (#190 review, 1).
    expect(dockerImage("FROM node:22 AS b\nWORKDIR /app/node_modules/foo\nCOPY package*.json ./\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /app/node_modules/foo /srv\n", false).holds).toBe(true);
    // So is one above the working folder, and the root or the working folder in other spellings (#190 delta review, 1, 4).
    for (const [workdir, source] of [["/app/node_modules/foo/sub", "/app/node_modules/foo"], ["/app/server", "/app"], ["/app", "/app/."], ["/app", "/app//"], ["/app", "//"], ["/app", "/."]]) {
      expect(dockerImage(`FROM node:22 AS b\nWORKDIR ${workdir}\nCOPY package*.json ./\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b ${source} /srv\n`, false).holds).toBe(true);
    }
    // `..` resolved as Docker does, and a relative WORKDIR after an absolute one (#190 second delta review, 2, 3).
    for (const [workdir, source] of [["/app", "/app/sub/.."], ["/app", "/.."], ["/app", "../"], ["/srv/../app", "/app"], ["/srv\nWORKDIR app", "/srv/app"], ["/srv\nWORKDIR app", "/srv"]]) {
      expect(dockerImage(`FROM node:22 AS b\nWORKDIR ${workdir}\nCOPY package*.json ./\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b ${source} /srv\n`, false).holds).toBe(true);
    }
    expect(dockerImage("FROM node:22\nCOPY x/.. /app\n", false).holds).toBe(true);
    // A WORKDIR that holds a variable is kept as written, and a relative source still matches the working folder as
    // written (#190 third delta review, 1, 2).
    for (const [base, source] of [["WORKDIR /app\nFROM base AS builder\nARG APP_DIR=/usr/src/app\nWORKDIR $APP_DIR", "$APP_DIR"], ["WORKDIR /app\nFROM base AS builder\nWORKDIR ${APP_DIR}", "${APP_DIR}/"], ["WORKDIR /srv\nWORKDIR app\nFROM base AS builder", "app"]]) {
      expect(dockerImage(`FROM node:22 AS base\n${base}\nCOPY package*.json ./\nRUN npm ci\nFROM node:22-slim\nCOPY --from=builder ${source} /x\n`, false).holds).toBe(true);
    }
    expect(dockerImage("FROM node:22\nCOPY / /app\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22\nCOPY / /app\n", true).holds).toBe(false);
    // A package folder copied together with something that holds devDependencies.
    expect(dockerImage(`${build}FROM node:22-slim\nCOPY --from=builder /app/node_modules/lodash /app/node_modules ./node_modules\n`, false)).toMatchObject({ holds: true, held: ["node_modules/lodash"] });
    expect(dockerImage("FROM node:22\nCOPY node_modules/lodash . ./\n", false).holds).toBe(true);
    // ADD can unpack an archive, so a path under node_modules still holds every devDependency.
    expect(dockerImage(`${build}FROM node:22-slim\nADD --from=builder /app/node_modules/lodash ./node_modules/lodash\n`, false)).toMatchObject({ holds: true, held: [] });
    expect(dockerImage("FROM node:22\nADD node_modules/deps.tgz ./node_modules/\n", false)).toMatchObject({ holds: true, held: [] });
  });
  it("finds a held folder by its install path, so an alias counts, and keeps D1 only for a folder it cannot find (L1c)", () => {
    const aliased = lockOf({ devDependencies: { "my-lodash": "npm:lodash@^4" } }, { "node_modules/my-lodash": { dev: true, name: "lodash" }, "node_modules/lodash": { dev: true, version: "2.0.0" } });
    const image = (folder: string) => tree({ "package.json": "{}", Dockerfile: `FROM node:22 AS b\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /app/node_modules/${folder} ./node_modules/${folder}\n` });
    const split = productionSplit(aliased, image("my-lodash"));
    expect(split.summary.images_with_dev).toEqual([]);
    expect(split.copies.get("node_modules/my-lodash")?.production).toBe(true);
    expect(split.copies.get("node_modules/lodash")?.production).toBe(false);
    const unknown = productionSplit(aliased, image("generated"));
    expect(unknown.summary.images_with_dev).toEqual(["Dockerfile"]);
    expect(unknown.copies.get("node_modules/lodash")?.why).toContain("copies a node_modules folder that matches no installed copy");
    // A scoped folder, and one in a workspace's node_modules.
    const ws = lockOf({ devDependencies: { "@s/a": "^1" } }, { "node_modules/@s/a": { dev: true }, "node_modules/c": { dev: true }, "packages/api/node_modules/foo": { dev: true } }, { "packages/api": { name: "api" } });
    const both = productionSplit(ws, tree({ "package.json": "{}", Dockerfile: "FROM node:22 AS b\nWORKDIR /app\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /app/node_modules/@s/a ./node_modules/@s/a\nCOPY --from=b /app/packages/api/node_modules/foo ./foo\n" }));
    expect(both.summary.images_with_dev).toEqual([]);
    expect([...both.devOnly]).toEqual(["c@1.0.0"]);
    // A project folder whose name ends in node_modules: its copy is found at that path (#190 second delta review, 1).
    const xnm = lockOf({ devDependencies: { a: "^1", c: "^1" } }, { "node_modules/a": { dev: true }, "node_modules/c": { dev: true }, "xnode_modules/node_modules/a": { dev: true, version: "2.0.0" } }, { xnode_modules: { name: "x" } });
    const odd = productionSplit(xnm, tree({ "package.json": "{}", Dockerfile: "FROM node:22 AS b\nWORKDIR /app\nCOPY . .\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /app/xnode_modules/node_modules/a ./x\n" }));
    expect(odd.copies.get("xnode_modules/node_modules/a")?.production).toBe(true);
    expect(odd.devOnly.has("a@2.0.0")).toBe(false);
  });
  it("keeps D1 only when a held folder is a link, even if a nested copy shares its name (#190 review, 2)", () => {
    const links = (extra: Record<string, unknown>) => lockOf({ devDependencies: { x: "^1" } }, { "node_modules/x": { dev: true }, "packages/ws-a/node_modules/tool": { dev: true }, ...extra }, { "packages/ws-a": { name: "ws-a" }, "node_modules/ws-a": { resolved: "packages/ws-a", link: true } });
    const source = tree({ "package.json": "{}", Dockerfile: "FROM node:22 AS b\nWORKDIR /app\nCOPY . .\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /app/node_modules/ws-a ./node_modules/ws-a\n" });
    for (const lock of [links({}), links({ "node_modules/x/node_modules/ws-a": { dev: true } })]) {
      const split = productionSplit(lock, source);
      expect(split.summary.images_with_dev).toEqual(["Dockerfile"]);
      expect([...split.devOnly]).toEqual([]);
    }
    // A link in a middle segment: the COPY follows it to another folder (#190 delta review, 2).
    const middle = lockOf({ devDependencies: { x: "^1" } }, { "node_modules/x": { dev: true }, "node_modules/a/node_modules/b": { dev: true }, "packages/a/node_modules/b": { dev: true, version: "2.0.0" }, "packages/a/node_modules/tool": { dev: true } }, { "packages/a": { name: "a" }, "node_modules/a": { resolved: "packages/a", link: true } });
    const viaLink = productionSplit(middle, tree({ "package.json": "{}", Dockerfile: "FROM node:22 AS b\nWORKDIR /app\nCOPY . .\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /app/node_modules/a/node_modules/b ./b\n" }));
    expect(viaLink.summary.images_with_dev).toEqual(["Dockerfile"]);
    expect([...viaLink.devOnly]).toEqual([]);
  });
  it("uses D2 when the image copies only package folders, and makes what it holds production (L1c)", () => {
    const dockerfile = "FROM node:22 AS builder\nWORKDIR /app\nRUN npm ci\nRUN npm run build\nFROM node:22-slim\nCOPY --from=builder /app/dist ./dist\nCOPY --from=builder /app/node_modules/nodemon ./node_modules/nodemon\nCMD [\"node\", \"dist/a.js\"]\n";
    const split = productionSplit(app, appSource({ Dockerfile: dockerfile }));
    expect(split.summary.images_with_dev).toEqual([]);
    expect(split.copies.get("node_modules/nodemon")).toMatchObject({ production: true, why: expect.stringContaining("held by Dockerfile's final stage") });
    // nodemon's own dependency is followed; the rest is D2 as without the image.
    expect(split.copies.get("node_modules/semver")?.production).toBe(true);
    expect(devOnly(app, appSource({ Dockerfile: dockerfile }))).toEqual(devOnly(app, appSource()).filter(v => v !== "nodemon@1.0.0" && v !== "semver@1.0.0"));
    // A copy nested in a held package is held too; another copy of the same name is not.
    const nested = lockOf({ devDependencies: { a: "^1", b: "^1" } }, { "node_modules/a": { dev: true }, "node_modules/a/node_modules/b": { dev: true, version: "2.0.0" }, "node_modules/b": { dev: true } });
    const held = productionSplit(nested, tree({ "package.json": "{}", Dockerfile: "FROM node:22 AS b\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /node_modules/a /node_modules/a\n" }));
    expect(held.copies.get("node_modules/a/node_modules/b")?.production).toBe(true);
    expect([...held.devOnly]).toEqual(["b@1.0.0"]);
    // Without such a copy, the image still sends the split to D1 only; so does another Dockerfile that holds them.
    expect(productionSplit(app, appSource({ Dockerfile: dockerfile.replace("/app/node_modules/nodemon ./node_modules/nodemon", "/app/node_modules ./node_modules") })).summary.images_with_dev).toEqual(["Dockerfile"]);
    expect(productionSplit(app, appSource({ "api/Dockerfile": dockerfile, Dockerfile: "FROM node:22\nRUN npm ci\nCMD node a.js\n" })).summary.images_with_dev).toEqual(["Dockerfile"]);
  });
  it("collects what an image holds by name, and seeds held copies, in linear time", () => {
    const quick = (f: () => unknown) => { const t0 = performance.now(); f(); return performance.now() - t0; };
    const chain = ["FROM node:22 AS a0\nRUN npm ci", ...Array.from({ length: 16_000 }, (_, k) => `FROM a${k} AS a${k + 1}\nCOPY --from=a${k} /node_modules/p${k} /node_modules/p${k}\nCOPY --from=a${k} /app /app`), "FROM a16000"].join("\n");
    let image: ReturnType<typeof dockerImage> | null = null;
    expect(quick(() => { image = dockerImage(chain, false); })).toBeLessThan(1500);
    expect(image!.held.length).toBe(16_000);
    // Many copies sharing one folder name, and many Dockerfiles each copying a folder.
    const many: Record<string, Pkg> = { "node_modules/a": { dev: true } };
    for (let k = 0; k < 20_000; k++) many[`node_modules/p${k}/node_modules/a`] = { dev: true };
    const files: Record<string, string> = { "package.json": "{}" };
    for (let k = 0; k < 2000; k++) files[`d${k}/Dockerfile`] = "FROM node:22 AS b\nRUN npm ci\nFROM node:22-slim\nCOPY --from=b /node_modules/a /node_modules/a\n";
    expect(quick(() => productionSplit(lockOf({}, many), tree(files)))).toBeLessThan(3000);
    // Many held folders, each matching one of many copies with the same last folder name.
    const lines = Array.from({ length: 20_000 }, (_, k) => `COPY --from=b /node_modules/p${k}/node_modules/a /x${k}`).join("\n");
    expect(quick(() => productionSplit(lockOf({}, many), tree({ "package.json": "{}", Dockerfile: `FROM node:22 AS b\nRUN npm ci\nFROM node:22-slim\n${lines}\n` })))).toBeLessThan(3000);
  });
  it("ignores development Dockerfiles, and runs the production stage's commands", () => {
    const dev = appSource({ "Dockerfile.dev": "FROM node:22\nRUN npm install\nCMD npm run dev\n", ".devcontainer/Dockerfile": "FROM node:22\nRUN npm install\n" });
    expect(productionSplit(app, dev).summary.images_with_dev).toEqual([]);
    const prod = appSource({ Dockerfile: "FROM node:22\nENV NODE_ENV production\nRUN npm ci\nCMD [\"npx\", \"nodemon\", \"server.js\"]\n" });
    expect(devOnly(app, prod)).not.toContain("nodemon@1.0.0");
  });
  it("reads production commands from a Procfile and deployment configuration", () => {
    expect(devOnly(app, appSource({ Procfile: "web: nodemon server.js\n" }))).not.toContain("nodemon@1.0.0");
    expect(devOnly(app, appSource({ "docker-compose.yml": "services:\n  web:\n    command:\n      - nodemon\n      - server.js\n" }))).not.toContain("nodemon@1.0.0");
    expect(devOnly(app, appSource({ "ecosystem.config.js": "module.exports = { apps: [{ script: 'nodemon', args: 'server.js' }] };" }))).not.toContain("nodemon@1.0.0");
  });
  it("reads a hosting platform's build command", () => {
    expect(devOnly(app, appSource({ "vercel.json": JSON.stringify({ buildCommand: "sass src:dist" }) }))).not.toContain("sass@1.0.0");
    expect(devOnly(app, appSource({ "netlify.toml": "[build]\n  command = \"sass src:dist\"\n" }))).not.toContain("sass@1.0.0");
  });
});

describe("reading imports", () => {
  it("names a package by its first segment and ignores relative, builtin, URL and alias specifiers", () => {
    expect(["lodash/fp", "@scope/pkg/sub", "~bootstrap/scss/x", "pdfjs-dist/build/pdf.worker?worker", "./a", "/abs", "node:fs", "fs", "@/components", "~/x", "#imports", "$app/stores", "https://x.y/z", "virtual:pwa"].map(s => packageOf(s)))
      .toEqual(["lodash", "@scope/pkg", "bootstrap", "pdfjs-dist", null, null, null, null, null, null, null, null, null, null]);
  });
  it("reads static, dynamic and required imports and the JSX pragma, but not type-only imports", () => {
    const text = `import a from "a";\nimport type { B } from "b";\nimport { type C, d } from "c";\nexport * from "e";\nexport type { F } from "f";\nconst g = await import("g");\nrequire.resolve('h');\nimport "i";\n/** @jsxImportSource preact */`;
    expect(codeSpecifiers(text).sort()).toEqual(["a", "c", "e", "g", "h", "i", "preact"]);
    expect(styleSpecifiers(`@import "tailwindcss";\n@plugin "daisyui";\n@use 'sass:math';\nbackground: url(~leaflet/dist/x.png);`)).toEqual(["tailwindcss", "daisyui", "sass:math", "leaflet/dist/x.png"]);
  });
});

describe("reading the source tree", () => {
  it("reads regular files only, outside node_modules and .git, and follows no symbolic link", () => {
    const root = mkdtempSync(join(tmpdir(), "ludion-src-")), outside = mkdtempSync(join(tmpdir(), "ludion-out-"));
    try {
      mkdirSync(join(root, "src")); mkdirSync(join(root, "node_modules/x"), { recursive: true }); mkdirSync(join(root, ".git"));
      writeFileSync(join(root, "src/a.js"), "import 'a';");
      writeFileSync(join(root, "node_modules/x/index.js"), "");
      writeFileSync(join(root, ".git/config"), "");
      writeFileSync(join(outside, "secret.js"), "import 'secret';");
      symlinkSync(join(outside, "secret.js"), join(root, "src/link.js"));
      symlinkSync(outside, join(root, "linked-dir"));
      const t = readSourceTree(root);
      expect(t.files).toEqual(["src/a.js"]);
      expect(t.read("src/link.js")).toBeNull();
      expect(t.incomplete).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });
});

describe("the lockfile reader's extraneous folders", () => {
  const folder = { name: "@netlify/ai-gateway", version: "1.0.0", extraneous: true, dependencies: { "@netlify/api": "^14" } };
  it("skips an installed package's own workspace folder that npm records as extraneous", () => {
    const lock = lockOf({ dependencies: { a: "^1" } }, { "node_modules/a": {} }, { "node_modules/primitives/packages/ai-gateway": folder });
    expect(lockEntries(lock).map(e => e.path)).toEqual(["node_modules/a"]);
    expect(lockExtraneous(lock)).toEqual([`node_modules/primitives/packages/ai-gateway ${JSON.stringify(folder)}`]);
    expect(productionSplit(lock, null).copies.size).toBe(1);
  });
  it("still refuses such a path when it is not extraneous, or carries a tarball, a hash, a link or a dot segment", () => {
    for (const [path, item] of [
      ["node_modules/primitives/packages/ai-gateway", { ...folder, extraneous: false }],
      ["node_modules/primitives/packages/ai-gateway", { ...folder, resolved: "https://evil.example/x.tgz" }],
      ["node_modules/primitives/packages/ai-gateway", { ...folder, integrity: INTEGRITY }],
      ["node_modules/primitives/packages/ai-gateway", { ...folder, link: true }],
      ["node_modules/primitives/../ai-gateway", folder],
    ] as const) expect(() => lockEntries(lockOf({}, {}, { [path]: item }))).toThrow("Unexpected package-lock path");
  });
  it("stops the judge when such a folder is added, removed or changed", () => {
    const fact: VersionFacts = { published_at: "2026-10-01T00:00:00Z", present: true, deprecated: null, publisher: "alice", shared_publisher: false, provenance: null, install_scripts: [], dependencies: [], integrity: INTEGRITY, malicious: [], advisories: [], package_created: "2020-01-01T00:00:00Z" };
    const j = judge({
      changes: [{ path: "node_modules/a", name: "a", from: "1.0.0", to: "1.0.1", dev: false, resolved: "https://registry.npmjs.org/a/-/a-1.0.1.tgz", integrity: INTEGRITY, replaced: null }],
      facts: new Map([["a@1.0.0", fact], ["a@1.0.1", fact]]), fixes: [], files: ["package-lock.json"], now: new Date("2026-10-28T00:00:00Z"), direct: ["a"],
      extraneous: [`node_modules/primitives/packages/ai-gateway ${JSON.stringify(folder)}`],
      split: { source: "not_given", incomplete: null, images_with_dev: [] },
    });
    expect(j.verdict).toBe("stop");
    expect(j.findings.some(f => f.gate === 4 && f.effect === "stop" && f.message.includes("extraneous"))).toBe(true);
    expect(renderJudgement(j)).toContain("without the source tree (no --source)");
  });
});

describe("after #168's review: what section 2 calls production is not left out", () => {
  /** Dev packages the root declares, plus `unused`, which must stay dev-only so the tree is read under D2. */
  const lock = (names: string[], bins: Record<string, string> = {}) => lockOf(
    { devDependencies: Object.fromEntries([...names, "unused"].map(n => [n, "^1"])) },
    Object.fromEntries([...names, "unused"].map(n => [`node_modules/${n}`, { dev: true, ...(bins[n] ? { bin: { [bins[n]]: "cli.js" } } : {}) }])),
  );
  const left = (names: string[], files: Record<string, string>, bins: Record<string, string> = {}) => {
    const out = devOnly(lock(names, bins), tree({ "package.json": "{}", ...files }));
    expect(out).toContain("unused@1.0.0");
    return out;
  };
  it("reads a code file named like a Dockerfile as source (1)", () => {
    expect(left(["handlebars"], { "src/dockerfile.ts": "import Handlebars from 'handlebars';" })).not.toContain("handlebars@1.0.0");
    expect(left(["js-yaml"], { "scripts/dockerfile-snippets.ts": "import yaml from 'js-yaml'" })).not.toContain("js-yaml@1.0.0");
  });
  it("does not let a type-only declaration swallow the next import (2)", () => {
    expect(left(["some-ui"], { "src/a.ts": "export type Props = {\n  title: string\n}\nexport { Button } from 'some-ui'\n" })).not.toContain("some-ui@1.0.0");
    expect(left(["foo"], { "src/a.ts": "// we import type helpers below\nimport x from 'foo'\n" })).not.toContain("foo@1.0.0");
    expect(left(["types-only"], { "src/a.ts": "import type { A } from 'types-only';\nexport type { B } from 'types-only';\n" })).toContain("types-only@1.0.0");
  });
  it("reads literal imports with comments, apostrophes or no spaces (3)", () => {
    const out = left(["chart.js", "pkg", "listed", "min"], {
      "src/a.ts": "const c = await import(/* webpackChunkName: \"x\" */ 'chart.js');\nconst p = import(/* @vite-ignore */ \"pkg\");\n",
      "src/b.ts": "import {\n  a, // don't remove\n  b,\n} from 'listed';\n",
      "src/c.min.js": "import{a}from\"min\";",
    });
    for (const n of ["chart.js", "pkg", "listed", "min"]) expect(out).not.toContain(`${n}@1.0.0`);
  });
  it("counts builtin-named packages that a build tool's configuration names, but not builtin imports (4)", () => {
    const out = left(["buffer", "process", "events"], {
      "webpack.config.js": "module.exports = { resolve: { fallback: { buffer: require.resolve('buffer/') } }, plugins: [new webpack.ProvidePlugin({ process: 'process/browser' })] };",
      "src/a.js": "import { EventEmitter } from 'events';",
    });
    expect(out).not.toContain("buffer@1.0.0");
    expect(out).not.toContain("process@1.0.0");
    expect(out).toContain("events@1.0.0");
  });
  it("finds full installs in a heredoc, under a command's own NODE_ENV, or with dev asked for (5)", () => {
    expect(dockerImage("FROM node:22\nRUN <<EOF\nnpm ci\nnpm run build\nEOF\nCMD node server.js\n", false)).toMatchObject({ holds: true, production: expect.arrayContaining([expect.stringContaining("npm run build")]) });
    expect(dockerImage("FROM node:22\nENV NODE_ENV=production\nRUN NODE_ENV=development npm ci && npm run build\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22\nRUN npm ci --production=false\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22\nENV NODE_ENV=production\nRUN npm ci --include=dev\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22\nENV NODE_ENV=production\nRUN npm ci\n", false).holds).toBe(false);
    expect(dockerImage("FROM node:22\nRUN NODE_ENV=production npm ci\n", false).holds).toBe(false);
  });
  it("reads --flag=value loaders and ./node_modules/.bin commands (6)", () => {
    expect(left(["tsx"], { "package.json": JSON.stringify({ scripts: { start: "node --import=tsx src/server.ts" } }) })).not.toContain("tsx@1.0.0");
    expect(left(["dotenv"], { "package.json": JSON.stringify({ scripts: { start: "node --require=dotenv/config server.js" } }) })).not.toContain("dotenv@1.0.0");
    expect(left(["serve"], { "package.json": JSON.stringify({ scripts: { start: "./node_modules/.bin/serve -s build" } }) }, { serve: "serve" })).not.toContain("serve@1.0.0");
  });
  it("reads every item of a stylesheet import list and skips Less options (7)", () => {
    expect(styleSpecifiers("@import 'bootstrap/scss/functions', 'animate.css';\n@import (reference) '~lesslib/x.less';")).toEqual(expect.arrayContaining(["bootstrap/scss/functions", "animate.css", "~lesslib/x.less"]));
    const out = left(["animate.css", "lesslib"], { "src/a.scss": "@import 'x/y', 'animate.css';", "src/b.less": "@import (reference) '~lesslib/x.less';" });
    expect(out).not.toContain("animate.css@1.0.0");
    expect(out).not.toContain("lesslib@1.0.0");
  });
  it("reads YAML block-scalar commands and pm2's script with its args (8)", () => {
    expect(left(["tsx"], { "docker-compose.yml": "services:\n  api:\n    command: >\n      tsx src/server.ts\n    ports:\n      - 3000\n" }, { tsx: "tsx" })).not.toContain("tsx@1.0.0");
    const pm2 = { "ecosystem.config.js": "module.exports = { apps: [{ name: 'web', script: 'npm', args: 'run serve' }] };", "package.json": JSON.stringify({ scripts: { serve: "serve -s build" } }) };
    expect(left(["serve"], pm2, { serve: "serve" })).not.toContain("serve@1.0.0");
  });
  it("matches test folder names as written, reads node_modules paths anywhere in build configuration, and walks package.json fields", () => {
    expect(left(["foo"], { "Test/helper.ts": "import 'foo';" })).not.toContain("foo@1.0.0");
    expect(left(["icons"], { "electron-builder.yml": "extraResources:\n  - from: node_modules/icons/dist\n" })).not.toContain("icons@1.0.0");
    expect(left(["babel-plugin-x"], { "package.json": JSON.stringify({ babel: { presets: [["env", { note: "it's" }]], plugins: ["x"] } }) })).not.toContain("babel-plugin-x@1.0.0");
  });
});

describe("crafted files cannot make the reader backtrack without end", () => {
  const quick = (f: () => unknown) => { const t0 = performance.now(); f(); return performance.now() - t0; };
  it("reads many comments in an import call, many unquoted array items and long blank runs in linear time", () => {
    expect(quick(() => codeSpecifiers(`import(${"/**/".repeat(5000)} x`))).toBeLessThan(1000);
    expect(codeSpecifiers(`import(${"/* a */".repeat(3)}'ok')`)).toEqual(["ok"]);
    const lock = lockOf({ devDependencies: { x: "^1" } }, { "node_modules/x": { dev: true } });
    const files = {
      "ecosystem.config.js": `module.exports = { apps: [{ script: [${'"a" '.repeat(5000)}`,
      "docker-compose.yml": `${" ".repeat(200_000)}-${" ".repeat(200_000)}x`,
      Dockerfile: `FROM node:22${"\n".repeat(200_000)}`,
      ".dockerignore": " \n".repeat(200_000),
      "netlify.toml": " \n".repeat(200_000),
      "src/a.js": "",
    };
    expect(quick(() => productionSplit(lock, tree(files)))).toBeLessThan(3000);
  });
  it("reads #168's delta-review inputs in linear time: each took seconds when quadratic", () => {
    const n = 40_000;
    expect(quick(() => codeSpecifiers("import type {".repeat(n)))).toBeLessThan(1000);
    expect(quick(() => codeSpecifiers("require(/*".repeat(n)))).toBeLessThan(1000);
    expect(quick(() => codeSpecifiers("require(//".repeat(n)))).toBeLessThan(1000);
    expect(quick(() => codeSpecifiers(`${"require(/*".repeat(n)}*/${" ".repeat(1_000_000)}'${"a".repeat(1_000_000)}`))).toBeLessThan(1000);
    expect(quick(() => styleSpecifiers("@import ".repeat(n)))).toBeLessThan(1000);
    const lock = lockOf({ devDependencies: { x: "^1" } }, { "node_modules/x": { dev: true } });
    for (const compose of ["command: >\n".repeat(n), "command:\n".repeat(n), "- command:\n".repeat(n), Array.from({ length: 3000 }, (_, k) => `${" ".repeat(k)}command: >`).join("\n")]) {
      expect(quick(() => productionSplit(lock, tree({ "docker-compose.yml": compose, "src/a.js": "" })))).toBeLessThan(1500);
    }
    const stages = ["FROM node:22 AS a0", ...Array.from({ length: 16_000 }, (_, k) => `FROM a${k} AS a${k + 1}\nRUN true`), "FROM node:22", "COPY --from=a16000 /x /x"].join("\n");
    expect(quick(() => dockerImage(stages, false))).toBeLessThan(1500);
    expect(quick(() => dockerImage(`FROM node:22\n${"RUN x <<EOF\n".repeat(n)}`, false))).toBeLessThan(1500);
  });
});

describe("after #168's delta review: what c381a85 counted is not lost", () => {
  it("ends a stylesheet clause at a line break, so unquoted imports in Sass and Stylus are all read (A)", () => {
    expect(styleSpecifiers("@import foo\n@import bar")).toEqual(expect.arrayContaining(["foo", "bar"]));
    expect(styleSpecifiers("@import nib\n@import \"vars\"")).toEqual(expect.arrayContaining(["nib", "vars"]));
    expect(styleSpecifiers("@import bootstrap\n.a\n  content: \"x\"")).toContain("bootstrap");
    expect(styleSpecifiers("@import 'a',\n  'b';")).toEqual(expect.arrayContaining(["a", "b"]));
    expect(styleSpecifiers("@import \"@fontsource/inter\";")).toContain("@fontsource/inter");
  });
  it("does not let a type-only brace list cross quotes or semicolons (B)", () => {
    expect(codeSpecifiers("// Prefer `import type {` for types; see docs\nimport { a } from 'real'")).toContain("real");
  });
  it("reads here-strings and shifts as written, and a heredoc only with its closing line (C)", () => {
    const copy = "FROM node:22 AS deps\nWORKDIR /app\nRUN npm ci\nFROM node:22-slim\nRUN grep -q foo <<< \"foo bar\"\nRUN echo $((1<<2))\nCOPY --from=deps /app/node_modules ./node_modules\n";
    expect(dockerImage(copy, false).holds).toBe(true);
    expect(dockerImage("FROM node:22 AS deps\nRUN npm ci\nFROM node:22-slim\nRUN cat <<EOF\nno end\nCOPY --from=deps /node_modules ./node_modules\n", false).holds).toBe(true);
    expect(dockerImage("FROM node:22\nRUN <<-EOT\n  npm ci\n  EOT\nCMD node a.js\n", false).holds).toBe(true);
  });
  it("reads an import call after any number of comments, and a stylesheet list that continues on the next line", () => {
    const quick = (f: () => unknown) => { const t0 = performance.now(); f(); return performance.now() - t0; };
    expect(codeSpecifiers(`require(${"/* c */ ".repeat(40)}'deep')`)).toEqual(["deep"]);
    expect(codeSpecifiers(`import(${"// c\n".repeat(40)}"deep")`)).toEqual(["deep"]);
    expect(styleSpecifiers("@import \"a\"\n  , \"b\";")).toEqual(expect.arrayContaining(["a", "b"]));
    expect(styleSpecifiers("@import\n  \"foo\";")).toContain("foo");
    expect(quick(() => codeSpecifiers(`${"require(/**/".repeat(40_000)}'x')`))).toBeLessThan(1000);
    expect(quick(() => styleSpecifiers(`@import "x ${"@import \"y ".repeat(40_000)}`))).toBeLessThan(1000);
    expect(quick(() => styleSpecifiers(`${"@import 'a', ".repeat(40_000)}`))).toBeLessThan(1000);
  });
  it("after the second delta review: shell-word heredoc delimiters, unquoted lists, at-rules in strings and comments, many scripts", () => {
    const quick = (f: () => unknown) => { const t0 = performance.now(); f(); return performance.now() - t0; };
    for (const word of ["END-SCRIPT", "'EOF.sh'", "\"x y\""]) {
      const close = word.replace(/^["']|["']$/g, "");
      expect(dockerImage(`FROM node:22\nWORKDIR /app\nRUN <<${word}\nnpm ci\nnpm run build\n${close}\nCMD ["node", "a.js"]\n`, false).holds).toBe(true);
    }
    expect(styleSpecifiers("@import bourbon, neat")).toEqual(expect.arrayContaining(["bourbon", "neat"]));
    expect(styleSpecifiers("@import \"a @import b\", \"pkg\";")).toContain("pkg");
    expect(styleSpecifiers("@import url(\"https://cdn.example/x.css?q=@use \"), 'pkg';")).toContain("pkg");
    expect(styleSpecifiers("@import 'a', /* @use x */ 'pkg';")).toContain("pkg");
    const scripts = Object.fromEntries(Array.from({ length: 4000 }, (_, k) => [`s${k}`, `npm run s${k + 1} && run-p s* x`]));
    const lock = lockOf({ devDependencies: { x: "^1" } }, { "node_modules/x": { dev: true } });
    expect(quick(() => productionSplit(lock, tree({ "package.json": JSON.stringify({ scripts: { start: "npm run s0", ...scripts } }), "src/a.js": "" })))).toBeLessThan(1500);
  });
  it("says in the comment that pnpm gets no split", () => {
    const fact: VersionFacts = { published_at: "2026-10-01T00:00:00Z", present: true, deprecated: null, publisher: "alice", shared_publisher: false, provenance: null, install_scripts: [], dependencies: [], integrity: INTEGRITY, malicious: [], advisories: [], package_created: "2020-01-01T00:00:00Z" };
    const j = judge({ changes: [], facts: new Map([["a@1.0.0", fact]]), fixes: [], files: ["pnpm-lock.yaml"], now: new Date("2026-10-28T00:00:00Z"), lockfile: "pnpm-lock", split: { source: "pnpm", incomplete: null, images_with_dev: [] } });
    expect(renderJudgement(j)).toContain("No production/dev split for pnpm-lock.yaml");
  });
});
