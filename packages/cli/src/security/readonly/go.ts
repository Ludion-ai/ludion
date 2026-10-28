import { lstatSync } from "node:fs";
import { join } from "node:path";
import { textFile } from "../inventory.ts";
import type { ReadOnlyInventory, ReadOnlyPackage } from "./types.ts";

/**
 * Go, read only: go.mod's require list. Since Go 1.17 (module graph pruning) it names every module the build needs;
 * `// indirect` marks the ones the main module does not import itself. go.sum is not the inventory: it also holds
 * checksums of modules outside the build list. The Go distribution is two OSV packages, `stdlib` (the standard library
 * compiled into the program) and `toolchain` (cmd/go and the other commands run at build time), both at the version on
 * go.mod's toolchain line. Module versions are kept exactly as go.mod writes them (OSV matches them with or without the
 * leading v, pseudo-versions and +incompatible included); the toolchain's "go" prefix is dropped, since OSV does not match
 * "go1.22.5" as a stdlib version.
 */
export const GO_SCOPE = "go.mod require list, the module build list since Go 1.17 (go.sum was not used as the inventory: it also records modules outside the build list), plus the Go standard library and go command (OSV packages stdlib and toolchain) at the version on go.mod's toolchain line. That line is the minimum toolchain under the default GOTOOLCHAIN=auto; a newer installed Go, or a GOTOOLCHAIN setting, builds instead.";

type Token = { text: string; kind: "word" | "string" | "punct" };
type Directive = { verb: string; args: Token[]; comment?: string; line: number };

const fail = (line: number, why: string): never => { throw new Error(`go.mod line ${line}: ${why}.`); };
const isPunct = (token: Token | undefined, text: string) => token?.kind === "punct" && token.text === text;
const shown = (text: string) => JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}...` : text);

/** One line of go.mod as Go's lexer reads it: // comments (never inside a quoted string), double-quoted strings, punctuation and words. */
function lex(raw: string, line: number): { tokens: Token[]; comment?: string } {
  const tokens: Token[] = [];
  for (let i = 0; i < raw.length;) {
    const c = raw[i]!;
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (raw.startsWith("//", i)) return { tokens, comment: raw.slice(i + 2).replace(/\r$/, "") };
    if (raw.startsWith("/*", i)) fail(line, "go.mod files must use // comments");
    if ("()[]{},".includes(c)) { tokens.push({ text: c, kind: "punct" }); i++; continue; }
    if (c === "`") fail(line, "backquoted strings are not valid in go.mod");
    if (c === '"') {
      let text = "";
      for (i++; ;) {
        if (i >= raw.length) fail(line, "unterminated quoted string");
        const d = raw[i++]!;
        if (d === '"') break;
        if (d === "\\") {
          const escaped = raw[i++];
          if (escaped !== '"' && escaped !== "\\") fail(line, "unsupported escape in quoted string");
          text += escaped;
        } else text += d;
      }
      tokens.push({ text, kind: "string" });
      continue;
    }
    let text = "";
    while (i < raw.length && !" \t\r()[]{},".includes(raw[i]!) && !raw.startsWith("//", i)) {
      if (raw.startsWith("/*", i)) fail(line, "go.mod files must use // comments");
      if (/[\p{C}\p{Z}]/u.test(raw[i]!)) fail(line, "unexpected character");
      text += raw[i++];
    }
    tokens.push({ text, kind: "word" });
  }
  return { tokens };
}

const BLOCK_VERBS = new Set(["module", "godebug", "require", "exclude", "replace", "retract", "tool", "ignore"]);
const KNOWN_VERBS = new Set([...BLOCK_VERBS, "go", "toolchain"]);

/** Single-line directives and `verb ( ... )` blocks, each block line becoming its own directive. */
function directives(text: string): Directive[] {
  const out: Directive[] = [];
  let block: { verb: string; line: number } | undefined;
  for (const [index, raw] of text.replace(/^﻿/, "").split("\n").entries()) {
    const line = index + 1, { tokens, comment } = lex(raw, line);
    if (!tokens.length) continue;
    if (block) {
      if (isPunct(tokens[0], ")")) {
        if (tokens.length > 1) fail(line, "expected a newline after the closing parenthesis");
        block = undefined;
      } else out.push({ verb: block.verb, args: tokens, ...(comment === undefined ? {} : { comment }), line });
      continue;
    }
    const verb = tokens[0]!;
    if (verb.kind !== "word" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(verb.text)) fail(line, "expected a directive such as require or replace");
    const opens = tokens.findIndex(t => isPunct(t, "("));
    if (opens !== -1) {
      if (opens !== 1 || !(tokens.length === 2 || (tokens.length === 3 && isPunct(tokens[2], ")")))) fail(line, "a block must open with a directive name and ( at the end of the line");
      if (KNOWN_VERBS.has(verb.text) && !BLOCK_VERBS.has(verb.text)) fail(line, `${verb.text} cannot be written as a block`);
      if (tokens.length === 2) block = { verb: verb.text, line };
      else if (!KNOWN_VERBS.has(verb.text)) out.push({ verb: verb.text, args: [], line });
      continue;
    }
    out.push({ verb: verb.text, args: tokens.slice(1), ...(comment === undefined ? {} : { comment }), line });
  }
  if (block) fail(block.line, `the ${block.verb} block is never closed`);
  return out;
}

// Go module paths: ASCII letters, digits and - . _ ~, elements separated by /, no element starting or ending with a dot.
const ELEMENT = "[A-Za-z0-9_~-](?:[A-Za-z0-9._~-]*[A-Za-z0-9_~-])?";
const MODULE_PATH = new RegExp(`^${ELEMENT}(?:/${ELEMENT})*$`);
// A full semantic version with Go's leading v; pseudo-versions are prereleases. Build metadata only as +incompatible.
const IDENT = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const MODULE_VERSION = new RegExp(`^v(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${IDENT}(?:\\.${IDENT})*)?(?:\\+incompatible)?$`);
const GO_VERSION = /^([1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:[a-z]+[0-9]+)?$/;
const TOOLCHAIN = /^(?:default|go1(?:\.[0-9A-Za-z.+_-]*)?)$/;
const RELEASE_TOOLCHAIN = /^go([1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function argument(token: Token | undefined, line: number): string {
  if (!token || token.kind === "punct") fail(line, `unexpected ${token ? shown(token.text) : "end of line"}`);
  if (token!.kind === "word" && /["'`]/.test(token!.text)) fail(line, "an unquoted value cannot contain a quote");
  if (!token!.text) fail(line, "empty value");
  return token!.text;
}
function modulePath(token: Token | undefined, line: number): string {
  const path = argument(token, line);
  if (path.length > 300 || !MODULE_PATH.test(path)) fail(line, `invalid module path ${shown(path)}`);
  return path;
}
function moduleVersion(token: Token | undefined, line: number): string {
  const version = argument(token, line);
  if (version.length > 128 || !MODULE_VERSION.test(version)) fail(line, `invalid module version ${shown(version)} (expected a full version such as v1.2.3)`);
  return version;
}
/** Go's own test: the line's comment is exactly "indirect", or starts with "indirect;". */
function isIndirect(comment: string | undefined): boolean {
  const fields = comment?.trim().split(/\s+/).filter(Boolean) ?? [];
  return (fields.length === 1 && fields[0] === "indirect") || (fields.length > 1 && fields[0] === "indirect;");
}
/** Go's modfile.IsDirectoryPath: a replacement written as a path on any operating system is a local directory. */
const isDirectoryPath = (path: string) => path === "." || path === ".." || /^(?:\.\.?[/\\]|[/\\]|[A-Za-z]:)/.test(path);

const PRUNING = "before Go 1.17 the require list need not name every module the build uses (module graph pruning is not in effect), so some modules may be missing from this inventory";

/**
 * The inventory one go.mod declares. Replaced requirements are left out and listed in limitations: a local directory
 * is not a published version, and a module replacement is not substituted (neither the original, which the build does
 * not use, nor the replacement is checked). exclude and retract do not change the inventory and are only validated.
 * Malformed lines throw; an unknown directive is ignored and listed.
 */
export function parseGoMod(text: string): { packages: ReadOnlyPackage[]; limitations: string[] } {
  let module: string | undefined, go: string | undefined, toolchain: string | undefined;
  const required = new Map<string, { version: string; direct: boolean }>();
  // "path\0version" or "path\0" -> the replacement "path version", or null for a local directory, whose path is
  // compared (same) to find conflicting replacements but never reported.
  const replaced = new Map<string, { target: string | null; same: string }>();
  const unknown = new Map<string, number>();
  for (const { verb, args, comment, line } of directives(text)) {
    const count = (n: number, usage: string) => { if (args.length !== n) fail(line, `expected ${usage}`); };
    switch (verb) {
      case "module":
        count(1, "module <path>");
        if (module !== undefined) fail(line, "repeated module directive");
        module = argument(args[0], line);
        break;
      case "go":
        count(1, "go <version>");
        if (go !== undefined) fail(line, "repeated go directive");
        if (args[0]!.kind !== "word" || !GO_VERSION.test(args[0]!.text)) fail(line, `invalid go version ${shown(args[0]!.text)}`);
        go = args[0]!.text;
        break;
      case "toolchain":
        count(1, "toolchain <name>");
        if (toolchain !== undefined) fail(line, "repeated toolchain directive");
        if (args[0]!.kind !== "word" || !TOOLCHAIN.test(args[0]!.text) || args[0]!.text.length > 64) fail(line, `invalid toolchain ${shown(args[0]!.text)}`);
        toolchain = args[0]!.text;
        break;
      case "require": {
        count(2, "require <module path> <version>");
        const path = modulePath(args[0], line), version = moduleVersion(args[1], line);
        if (required.has(path)) fail(line, `${path} is required more than once`);
        required.set(path, { version, direct: !isIndirect(comment) });
        break;
      }
      case "exclude":
        count(2, "exclude <module path> <version>");
        modulePath(args[0], line); moduleVersion(args[1], line);
        break;
      case "replace": {
        const arrow = args[1]?.kind === "word" && args[1].text === "=>" ? 1 : 2;
        if (args.length < arrow + 2 || args.length > arrow + 3 || args[arrow]?.kind !== "word" || args[arrow]!.text !== "=>") fail(line, "expected replace <module path> [<version>] => <module path> <version> | <directory>");
        const from = modulePath(args[0], line), fromVersion = arrow === 2 ? moduleVersion(args[1], line) : "";
        const to = argument(args[arrow + 1], line);
        let target: string | null;
        if (isDirectoryPath(to)) {
          if (args.length === arrow + 3) fail(line, "a replacement directory cannot have a version");
          target = null;
        } else {
          if (args.length !== arrow + 3) fail(line, "a replacement module needs a version (a directory must start with ./, ../ or /)");
          target = `${modulePath(args[arrow + 1], line)} ${moduleVersion(args[arrow + 2], line)}`;
        }
        const key = `${from}\0${fromVersion}`, same = target ?? `\0${to}`, previous = replaced.get(key);
        if (previous && previous.same !== same) fail(line, `conflicting replacements for ${from}${fromVersion ? ` ${fromVersion}` : ""}`);
        replaced.set(key, { target, same });
        break;
      }
      case "retract":
        if (isPunct(args[0], "[")) {
          if (args.length !== 5 || !isPunct(args[2], ",") || !isPunct(args[4], "]")) fail(line, "expected retract [<low>, <high>]");
          moduleVersion(args[1], line); moduleVersion(args[3], line);
        } else {
          count(1, "retract <version> or retract [<low>, <high>]");
          moduleVersion(args[0], line);
        }
        break;
      case "godebug":
        count(1, "godebug <key>=<value>");
        if (args[0]!.kind !== "word" || !argument(args[0], line).includes("=")) fail(line, "expected godebug <key>=<value>");
        break;
      case "tool": case "ignore":
        count(1, `${verb} <path>`);
        argument(args[0], line);
        break;
      default:
        if (!unknown.has(verb)) unknown.set(verb, line);
    }
  }
  if (module === undefined) throw new Error("go.mod has no module directive.");

  const packages: ReadOnlyPackage[] = [], limitations: string[] = [];
  for (const [path, { version, direct }] of required) {
    // Go: a replacement for this exact version wins over one for every version of the module.
    const key = replaced.has(`${path}\0${version}`) ? `${path}\0${version}` : `${path}\0`;
    if (replaced.has(key)) {
      const { target } = replaced.get(key)!;
      limitations.push(target === null
        ? `${path} ${version} is replaced by a local directory; its code is not a published module version, so it was not checked.`
        : `${path} ${version} is replaced by ${target}; Ludion does not substitute replacements, so the replacement was not checked, and ${path} ${version}, which the build does not use, was left out.`);
    } else if (!path.split("/")[0]!.includes(".")) {
      limitations.push(`${path} ${version} has no dot in its first path element, so it is not a published module path; it was not checked.`);
    } else packages.push({ name: path, version, direct });
  }

  const goVersion = go === undefined ? undefined : GO_VERSION.exec(go)!.slice(1, 4).map(n => Number(n ?? 0));
  if (go === undefined) limitations.push(`go.mod has no go directive, so Go treats it as go 1.16; ${PRUNING}.`);
  else if (goVersion![0] === 1 && goVersion![1]! < 17) limitations.push(`go.mod declares go ${go}; ${PRUNING}.`);

  const release = toolchain === undefined ? null : RELEASE_TOOLCHAIN.exec(toolchain);
  const stdlib = "so the Go standard library and go command (stdlib, toolchain) were not checked";
  if (toolchain === undefined) limitations.push(`go.mod has no toolchain line${go === undefined ? "" : `; its go ${go} line is a minimum, not the toolchain in use`}. The Go toolchain in use is unknown, ${stdlib}.`);
  else if (toolchain === "default") limitations.push(`go.mod says toolchain default, so the Go toolchain in use is unknown, ${stdlib}.`);
  else if (!release) limitations.push(`go.mod's toolchain ${toolchain} is not a release name of the form goX.Y.Z, ${stdlib}.`);
  else {
    // A go line of 1.22 or 1.22rc1 is older than 1.22.0, so comparing the numbers alone is enough.
    const version = release.slice(1, 4).map(Number), differs = goVersion ? version.findIndex((n, i) => n !== goVersion[i]) : -1;
    if (differs !== -1 && version[differs]! < goVersion![differs]!) limitations.push(`go.mod's toolchain ${toolchain} is older than its go ${go} line, so the Go toolchain in use is unknown, ${stdlib}.`);
    else {
      const plain = version.join(".");
      packages.push({ name: "stdlib", version: plain, direct: true }, { name: "toolchain", version: plain, direct: true });
    }
  }
  for (const [verb, line] of unknown) limitations.push(`go.mod directive ${verb} (line ${line}) is not one Ludion reads; it was ignored and may change the build.`);
  if (packages.length > 2000) throw new Error("Advisory scan exceeds 2,000 distinct installed package versions.");
  return { packages, limitations };
}

function present(root: string, name: string): boolean {
  try { lstatSync(join(root, name)); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** The Go inventory of a project root, or null without a go.mod. */
export function readGo(root: string): ReadOnlyInventory | null {
  if (!present(root, "go.mod")) return null;
  const { packages, limitations } = parseGoMod(textFile(root, "go.mod"));
  if (present(root, "go.work")) limitations.push("go.work is present; workspace modules and go.work replacements were not read, so the build list may differ from go.mod.");
  return { ecosystem: "Go", files: ["go.mod"], scope: GO_SCOPE, packages, limitations };
}
