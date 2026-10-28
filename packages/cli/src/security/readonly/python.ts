// Read-only Python inventory: exact names and versions from uv.lock, poetry.lock, Pipfile.lock and the exact pins of
// requirements.txt, for OSV's PyPI ecosystem. Nothing here patches, plans or runs project code. Whatever cannot be
// read exactly (git, URL and local sources, unpinned requirements, unknown lock formats, other requirement files) is
// a limitation; a file that cannot be parsed at all throws. Text copied from a file into a message is bounded and
// escaped.
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { textFile } from "../inventory.ts";
import { clip, isTable, parseToml, quoted, type TomlTable, type TomlValue } from "./python-toml.ts";
import type { ReadOnlyInventory, ReadOnlyPackage } from "./types.ts";

/** What one Python file contributes: packages, the project's own packages it skipped, and what it could not read. */
export type PythonFile = { packages: ReadOnlyPackage[]; project: string[]; limitations: string[] };

const MAX_PACKAGES = 2000;
const LOCKS = ["uv.lock", "poetry.lock", "Pipfile.lock"] as const;
const FILES = [...LOCKS, "requirements.txt", "pyproject.toml", "Pipfile"] as const;
/** PEP 508 project names. */
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const NAME_START = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/;
/** PEP 440 versions in any spelling the specification accepts (Appendix B). OSV normalizes them; see the PR record. */
const VERSION = /^v?(?:\d+!)?\d+(?:\.\d+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?(?:-\d+|[-_.]?(?:post|rev|r)[-_.]?\d*)?(?:[-_.]?dev[-_.]?\d*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;

/** PEP 503 normal form, the name sent to OSV. */
export function normalizeName(name: string): string { return name.replace(/[-_.]+/g, "-").toLowerCase(); }
export function isVersion(version: string): boolean { return version.length <= 100 && VERSION.test(version); }

/** A bounded list for a limitation sentence. */
function list(items: string[], max = 10): string {
  return items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
}
function shown(value: unknown): string {
  if (value === undefined) return "missing";
  if (typeof value === "string") return quoted(value, 40);
  return typeof value === "number" || typeof value === "boolean" ? String(value) : `a ${Array.isArray(value) ? "list" : typeof value}`;
}
function plural(n: number, one: string, many: string): string { return `${n} ${n === 1 ? one : many}`; }
function reason(error: unknown): string { return clip((error instanceof Error ? error.message : String(error)).replace(/[.;]? ?(?:the file was not read\.)?$/, ""), 200); }
/** Appends without spreading, so a list of any length cannot overflow the call stack. */
function append<T>(target: T[], items: Iterable<T>): T[] { for (const item of items) target.push(item); return target; }

/** Distinct name and version pairs; a pair is direct if any source says so. Above 2,000 the inventory is refused. */
function collect(packages: ReadOnlyPackage[], into = new Map<string, ReadOnlyPackage>()): Map<string, ReadOnlyPackage> {
  for (const p of packages) {
    const key = `${p.name}\0${p.version}`, seen = into.get(key);
    if (seen) seen.direct ||= p.direct;
    else into.set(key, { ...p });
    if (into.size > MAX_PACKAGES) throw new Error("Python inventory exceeds 2,000 distinct package versions.");
  }
  return into;
}

function lockPackages(value: TomlValue | undefined, file: string): TomlTable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isTable)) throw new Error(`${file}: package must be an array of [[package]] tables.`);
  if (value.length > MAX_PACKAGES * 2) throw new Error(`${file} lists more than ${MAX_PACKAGES * 2} packages.`);
  return value as TomlTable[];
}
function lockName(entry: TomlTable, file: string): string {
  if (typeof entry.name !== "string" || entry.name.length > 200 || !NAME.test(entry.name)) throw new Error(`${file}: a [[package]] has no valid name (${shown(entry.name)}); the file was not read.`);
  return normalizeName(entry.name);
}
/** Top-level entries a lock reader does not know: what is under them was not read. */
function unknownEntries(lock: TomlTable, known: Set<string>, file: string): string[] {
  const unknown = Object.keys(lock).filter(k => !known.has(k));
  return unknown.length ? [`${file} has top-level entries this reader does not know (${list(unknown.map(k => quoted(k, 40)))}); anything in them was not read.`] : [];
}

const UV_SOURCES = new Set(["registry", "git", "url", "path", "directory", "editable", "virtual"]);
const UV_TOP = new Set(["version", "revision", "requires-python", "resolution-markers", "supported-markers", "required-markers", "conflicts", "options", "manifest", "package", "distribution"]);
/**
 * uv.lock (format version 1): registry packages are the inventory. The project's own packages (the editable or
 * virtual package at ".", and workspace members) are skipped; every other source is a limitation. Direct means
 * named in the dependencies, optional dependencies or dependency groups of one of the project's own packages.
 * uv still reads the pre-0.3 [[distribution]] spelling of [[package]]; a lock with both is refused, as uv refuses it.
 */
export function parseUvLock(text: string): PythonFile {
  const lock = parseToml(text, "uv.lock");
  if (lock.version !== 1) return { packages: [], project: [], limitations: [`uv.lock has lock format version ${shown(lock.version)}; this reader knows version 1 only, so its packages were not read.`] };
  if (lock.package !== undefined && lock.distribution !== undefined) throw new Error("uv.lock has both [[package]] and [[distribution]], which uv refuses; the file was not read.");
  const entries = lockPackages(lock.package ?? lock.distribution, "uv.lock");
  // Workspace members are the project's own packages too. A member list that cannot be read marks nothing direct.
  const manifest = lock.manifest, listed = isTable(manifest) ? manifest.members : undefined;
  const members = manifest !== undefined && !isTable(manifest) ? null
    : listed === undefined ? new Set<string>()
    : Array.isArray(listed) && listed.every(m => typeof m === "string") ? new Set((listed as string[]).map(normalizeName)) : null;
  const registry: { name: string; version: string }[] = [], roots: TomlTable[] = [], project: string[] = [];
  const unknown: string[] = [], invalid: string[] = [], local: string[] = [];
  for (const entry of entries) {
    const name = lockName(entry, "uv.lock"), source = entry.source;
    const kinds = isTable(source) ? Object.keys(source).filter(k => UV_SOURCES.has(k)) : [];
    const kind = kinds[0];
    const extra = isTable(source) ? Object.keys(source).filter(k => !UV_SOURCES.has(k) && !(k === "subdirectory" && (kind === "url" || kind === "git"))) : [];
    if (!isTable(source) || kinds.length !== 1 || extra.length || typeof source[kind!] !== "string") { unknown.push(name); continue; }
    if (kind === "registry") {
      if (typeof entry.version !== "string" || !isVersion(entry.version)) invalid.push(`${name} (${shown(entry.version)})`);
      else registry.push({ name, version: entry.version });
    } else if ((kind === "editable" || kind === "virtual") && (source[kind] === "." || members?.has(name))) {
      project.push(name);
      roots.push(entry);
    } else local.push(`${name} (${kind})`);
  }
  // Direct only when every dependency list of the project's own packages reads exactly; otherwise nothing is marked.
  const direct = new Map<string, Set<string> | true>();
  let exact = members !== null;
  for (const root of roots) {
    const lists: TomlValue[] = root.dependencies === undefined ? [] : [root.dependencies];
    // dependency-groups is uv's newer name for dev-dependencies.
    for (const key of ["optional-dependencies", "dev-dependencies", "dependency-groups"]) {
      const groups = root[key];
      if (isTable(groups)) append(lists, Object.values(groups));
      else if (groups !== undefined) exact = false;
    }
    for (const group of lists) {
      if (!Array.isArray(group)) { exact = false; continue; }
      for (const dep of group) {
        if (!isTable(dep) || typeof dep.name !== "string" || (dep.version !== undefined && typeof dep.version !== "string")) { exact = false; continue; }
        const key = normalizeName(dep.name), seen = direct.get(key);
        if (dep.version === undefined) direct.set(key, true);
        else if (seen !== true) direct.set(key, (seen ?? new Set()).add(dep.version as string));
      }
    }
  }
  const isDirect = (p: { name: string; version: string }) => { const d = direct.get(p.name); return exact && (d === true || !!d?.has(p.version)); };
  const limitations = unknownEntries(lock, UV_TOP, "uv.lock");
  if (unknown.length) limitations.push(`uv.lock: ${plural(unknown.length, "package has a source", "packages have a source")} this reader does not know, so ${unknown.length === 1 ? "it was" : "they were"} not checked: ${list(unknown)}.`);
  if (invalid.length) limitations.push(`uv.lock: ${plural(invalid.length, "registry package has", "registry packages have")} no PEP 440 version, so ${invalid.length === 1 ? "it was" : "they were"} not checked: ${list(invalid)}.`);
  if (local.length) limitations.push(`uv.lock: ${plural(local.length, "package comes", "packages come")} from git, URL or local path sources rather than a registry and ${local.length === 1 ? "was" : "were"} not checked against advisories: ${list(local)}.`);
  if (registry.length && !exact) limitations.push("uv.lock: the project's workspace members or dependency lists could not be read exactly, so no package is marked direct.");
  else if (registry.length && !roots.length) limitations.push('uv.lock names no project package (editable or virtual at "."), so no package is marked direct.');
  return { packages: [...collect(registry.map(p => ({ ...p, direct: isDirect(p) }))).values()], project, limitations };
}

const POETRY_TOP = new Set(["package", "metadata", "extras"]);
/**
 * poetry.lock (lock-version 1.x or 2.x): packages from PyPI or a legacy (simple index) source are the inventory;
 * git, directory, file and url sources are limitations. Direct comes from pyproject.toml's names when given.
 */
export function parsePoetryLock(text: string, direct: Set<string> | null = null): PythonFile {
  const lock = parseToml(text, "poetry.lock");
  const version = isTable(lock.metadata) ? lock.metadata["lock-version"] : undefined;
  const major = typeof version === "string" && /^\d+\.\d+$/.test(version) ? Number(version.split(".")[0]) : NaN;
  if (major !== 1 && major !== 2) return { packages: [], project: [], limitations: [`poetry.lock has lock-version ${shown(version)}; this reader knows 1.x and 2.x only, so its packages were not read.`] };
  const packages: ReadOnlyPackage[] = [], unknown: string[] = [], invalid: string[] = [], local: string[] = [];
  for (const entry of lockPackages(lock.package, "poetry.lock")) {
    const name = lockName(entry, "poetry.lock"), source = entry.source;
    if (source !== undefined) {
      const type = isTable(source) ? source.type : undefined;
      if (type === "git" || type === "directory" || type === "file" || type === "url") { local.push(`${name} (${type})`); continue; }
      if (type !== "legacy") { unknown.push(`${name} (${shown(type)})`); continue; }
    }
    if (typeof entry.version !== "string" || !isVersion(entry.version)) { invalid.push(`${name} (${shown(entry.version)})`); continue; }
    packages.push({ name, version: entry.version, direct: !!direct?.has(name) });
  }
  const limitations = unknownEntries(lock, POETRY_TOP, "poetry.lock");
  if (unknown.length) limitations.push(`poetry.lock: ${plural(unknown.length, "package has a source type", "packages have a source type")} this reader does not know, so ${unknown.length === 1 ? "it was" : "they were"} not checked: ${list(unknown)}.`);
  if (invalid.length) limitations.push(`poetry.lock: ${plural(invalid.length, "package has", "packages have")} no PEP 440 version, so ${invalid.length === 1 ? "it was" : "they were"} not checked: ${list(invalid)}.`);
  if (local.length) limitations.push(`poetry.lock: ${plural(local.length, "package comes", "packages come")} from git, URL or local path sources rather than a registry and ${local.length === 1 ? "was" : "were"} not checked against advisories: ${list(local)}.`);
  return { packages: [...collect(packages).values()], project: [], limitations };
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * Pipfile.lock (pipfile-spec 6): every category ("default", "develop" and custom ones) maps names to entries whose
 * "version" is "==x.y.z". A path "." entry is the project itself; git, path, file and inexact entries are limitations.
 */
export function parsePipfileLock(text: string, direct: Set<string> | null = null): PythonFile {
  let lock: unknown;
  try { lock = JSON.parse(text); } catch { throw new Error("Pipfile.lock is not valid JSON; the file was not read."); }
  if (!plain(lock)) throw new Error("Pipfile.lock is not a JSON object; the file was not read.");
  const spec = plain(lock._meta) ? lock._meta["pipfile-spec"] : undefined;
  if (spec !== 6) return { packages: [], project: [], limitations: [`Pipfile.lock has pipfile-spec ${shown(spec)}; this reader knows spec 6 only, so its packages were not read.`] };
  const packages: ReadOnlyPackage[] = [], project: string[] = [], local: string[] = [], inexact: string[] = [];
  for (const [category, entries] of Object.entries(lock)) {
    if (category === "_meta") continue;
    if (!plain(entries)) throw new Error(`Pipfile.lock: ${shown(category)} is not a map of packages; the file was not read.`);
    for (const [raw, entry] of Object.entries(entries)) {
      if (raw.length > 200 || !NAME.test(raw) || !plain(entry)) throw new Error(`Pipfile.lock: ${shown(raw)} in ${shown(category)} is not a valid package entry; the file was not read.`);
      const name = normalizeName(raw);
      if (entry.path === "." || entry.path === "./") { project.push(name); continue; }
      const kind = ["git", "hg", "svn", "bzr", "path", "file"].find(k => entry[k] !== undefined) ?? (entry.editable !== undefined ? "editable" : undefined);
      if (kind) { local.push(`${name} (${kind})`); continue; }
      const pin = typeof entry.version === "string" ? /^==([^=].*)$/.exec(entry.version.trim())?.[1]?.trim() : undefined;
      if (!pin || !isVersion(pin)) { inexact.push(`${name} (${shown(entry.version)})`); continue; }
      packages.push({ name, version: pin, direct: !!direct?.has(name) });
    }
  }
  const limitations: string[] = [];
  if (local.length) limitations.push(`Pipfile.lock: ${plural(local.length, "package comes", "packages come")} from git, URL or local path sources rather than a registry and ${local.length === 1 ? "was" : "were"} not checked against advisories: ${list(local)}.`);
  if (inexact.length) limitations.push(`Pipfile.lock: ${plural(inexact.length, "package has", "packages have")} no exact ==version, so ${inexact.length === 1 ? "it was" : "they were"} not checked: ${list(inexact)}.`);
  return { packages: [...collect(packages).values()], project, limitations };
}

/** Python's str whitespace (str.isspace), which pip's comment and strip rules use. */
const PY_SPACE = new RegExp("[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]");
const PY_SPACES = new RegExp(`${PY_SPACE.source}+`);
/** The line boundaries of Python's str.splitlines(), which pip splits a requirements file on. */
const LINE_BREAK = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]");
const isSpace = (c: string | undefined): boolean => c !== undefined && PY_SPACE.test(c);
/** str.strip(chars) without a regex, so a long run cannot make it quadratic. */
function strip(text: string, isStripped: (c: string | undefined) => boolean = isSpace): string {
  let start = 0, end = text.length;
  while (start < end && isStripped(text[start])) start++;
  while (end > start && isStripped(text[end - 1])) end--;
  return text.slice(start, end);
}

const UTF8_NAMES = /^(?:utf8|u8|utf|utf8sig|cp65001|utf8ucs2|utf8ucs4)$/;
const ASCII_COMPATIBLE = /^(?:ascii|usascii|646|latin1|l1|iso8859\d{1,2}|cp125\d|windows125\d)$/;
const UNDECODED = new RegExp("[\\0\\ufffd]");
/**
 * pip decodes a requirements file by its BOM or a PEP 263 coding cookie in its first two lines. Only text that reads
 * the same as UTF-8 is read here: a UTF-16 or UTF-32 file, invalid UTF-8 or another declared encoding is refused,
 * never read as a single comment line.
 */
function requirementsText(text: string): string {
  if (UNDECODED.test(text)) throw new Error("requirements.txt is not UTF-8 text (it has NUL or undecodable bytes, as a UTF-16 or UTF-32 file does); the file was not read.");
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  for (const line of text.split("\n").slice(0, 2)) {
    const cookie = line.startsWith("#") ? /coding[:=]\s*([-\w.]+)/.exec(line)?.[1] : undefined;
    if (!cookie) continue;
    const codec = cookie.toLowerCase().replace(/[-_.]/g, "");
    if (UTF8_NAMES.test(codec) || (ASCII_COMPATIBLE.test(codec) && !/[^\x00-\x7f]/.test(text))) break;
    throw new Error(`requirements.txt declares the encoding ${quoted(cookie, 40)}; only text that reads the same as UTF-8 is read, so the file was not read.`);
  }
  return text;
}

/** A comment starts at a "#" at the start of the line or after whitespace (a URL's "#egg=" is not one). */
function uncommented(line: string): string {
  for (let at = line.indexOf("#"); at >= 0; at = line.indexOf("#", at + 1)) if (at === 0 || isSpace(line[at - 1])) return line.slice(0, at);
  return line;
}
/**
 * pip's logical lines (req_file.preprocess): split as str.splitlines() does; a line ending in a backslash continues
 * onto the next, with every backslash at either end removed; a comment line ends a continuation; comments are removed
 * and the line stripped.
 */
function requirementLines(text: string): { line: number; content: string }[] {
  const out: { line: number; content: string }[] = [];
  let pending: string[] = [], start = 0;
  const comment = (line: string) => { let i = 0; while (isSpace(line[i])) i++; return line[i] === "#"; };
  for (const [i, line] of text.split(LINE_BREAK).entries()) {
    const isComment = comment(line);
    if (!line.endsWith("\\") || isComment) {
      const piece = isComment ? ` ${line}` : line;
      if (pending.length) { pending.push(piece); out.push({ line: start, content: pending.join("") }); pending = []; }
      else out.push({ line: i + 1, content: piece });
    } else {
      if (!pending.length) start = i + 1;
      pending.push(strip(line, c => c === "\\"));
    }
  }
  if (pending.length) out.push({ line: start, content: pending.join("") });
  return out.map(l => ({ line: l.line, content: strip(uncommented(l.content)) })).filter(l => l.content);
}

/** A requirement's name and what follows its optional [extras], or null when it does not start with a name. */
function namedRequirement(requirement: string): { name: string; rest: string } | null {
  const name = NAME_START.exec(requirement)?.[0];
  if (!name) return null;
  let rest = strip(requirement.slice(name.length));
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) return null;
    const extras = rest.slice(1, end).split(",").map(e => strip(e));
    if (!(extras.length === 1 && extras[0] === "") && !extras.every(e => NAME.test(e))) return null;
    rest = strip(rest.slice(end + 1));
  }
  return { name: normalizeName(name), rest };
}

/** Options that change where packages come from or how they build, but not which name and version a pin names. */
const GLOBAL_OPTIONS = new Set(["-i", "--index-url", "--extra-index-url", "--no-index", "-f", "--find-links", "--trusted-host", "--pre", "--prefer-binary", "--require-hashes", "--only-binary", "--no-binary", "--use-feature"]);
const EGG = /#egg=([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/;

/**
 * requirements.txt: only exact pins (name==version, with optional extras, markers and --hash options) are read.
 * Includes (-r, -c) are not followed. Anything else is listed as not pinned; "." or "-e ." is the project itself.
 */
export function parseRequirements(text: string): PythonFile {
  const packages: ReadOnlyPackage[] = [], project: string[] = [], unpinned: string[] = [], markers: string[] = [], unreadable: number[] = [];
  let includes = 0;
  const local = (target: string, line: number): void => {
    const path = target.replace(/\[[^\]]*\]$/, "");
    if (path === "." || path === "./") project.push("the project at .");
    else { const egg = EGG.exec(target)?.[1]; unpinned.push(egg ? normalizeName(egg) : /^[A-Za-z0-9._/-]{1,80}$/.test(target) ? target : `a URL, VCS or path requirement (line ${line})`); }
  };
  for (const { line, content } of requirementLines(requirementsText(text))) {
    const tokens = content.split(PY_SPACES);
    if (content.startsWith("-")) {
      const flag = tokens[0]!.split("=")[0]!;
      if (["-r", "--requirement", "-c", "--constraint"].includes(flag) || /^-[rc]\S/.test(flag)) includes++;
      else if (flag === "-e" || flag === "--editable" || /^-e\S/.test(flag)) {
        const separate = tokens[0] === "-e" || tokens[0] === "--editable";
        const target = separate ? tokens[1] : tokens[0]!.replace(/^(?:-e|--editable=)/, "");
        if (!target || tokens.length > (separate ? 2 : 1)) unreadable.push(line);
        else local(target, line);
      } else if (!GLOBAL_OPTIONS.has(flag)) unreadable.push(line);
      continue;
    }
    // As pip does: the requirement ends at the first token that starts with "-"; only --hash may follow it.
    const at = tokens.findIndex(t => t.startsWith("-"));
    const requirement = (at < 0 ? tokens : tokens.slice(0, at)).join(" "), options = at < 0 ? [] : tokens.slice(at);
    let hashes = true;
    for (let i = 0; i < options.length; i++) {
      if (/^--hash=[A-Za-z0-9]+:[A-Fa-f0-9]+$/.test(options[i]!)) continue;
      if (options[i] === "--hash" && /^[A-Za-z0-9]+:[A-Fa-f0-9]+$/.test(options[i + 1] ?? "")) { i++; continue; }
      hashes = false;
    }
    if (!hashes) { unreadable.push(line); continue; }
    if (/^(?:[a-z][a-z0-9+.-]*:\/\/|(?:git|hg|svn|bzr)\+|\.|\/|~)/i.test(requirement)) { local(requirement, line); continue; }
    const named = namedRequirement(requirement);
    if (named?.rest.startsWith("@")) { unpinned.push(named.name); continue; }
    if (/\.(?:whl|zip|tar\.gz|tgz|tar\.bz2)(?:$|[\s;])/i.test(requirement)) { local(requirement, line); continue; }
    if (!named) { unreadable.push(line); continue; }
    const semi = named.rest.indexOf(";");
    let spec = strip(semi < 0 ? named.rest : named.rest.slice(0, semi));
    if (spec.startsWith("(") && spec.endsWith(")")) spec = strip(spec.slice(1, -1));
    const version = /^==\s*([^\s,;=*()]+)$/.exec(spec)?.[1];
    if (!version || !isVersion(version)) { unpinned.push(named.name); continue; }
    if (semi >= 0 && strip(named.rest.slice(semi + 1))) markers.push(named.name);
    packages.push({ name: named.name, version, direct: true });
  }
  const limitations: string[] = [];
  if (includes) limitations.push(`requirements.txt includes other files with -r or -c (${plural(includes, "line", "lines")}); they were not read.`);
  if (unpinned.length) limitations.push(`requirements.txt: ${plural(unpinned.length, "requirement is", "requirements are")} not an exact name==version pin and ${unpinned.length === 1 ? "was" : "were"} not checked: ${list(unpinned)}.`);
  if (unreadable.length) limitations.push(`requirements.txt: ${plural(unreadable.length, "line", "lines")} could not be read as a requirement or option and ${unreadable.length === 1 ? "was" : "were"} not checked (line ${list(unreadable.map(String))}).`);
  if (markers.length) limitations.push(`requirements.txt: environment markers were not evaluated; ${plural(markers.length, "pin with a marker is", "pins with markers are")} checked as if installed: ${list(markers)}.`);
  return { packages: [...collect(packages).values()], project, limitations };
}

/** A PEP 508 requirement's name; throws when the string does not start with one. */
function requirementName(value: TomlValue, file: string): string {
  const name = typeof value === "string" ? /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(value)?.[1] : undefined;
  if (!name) throw new Error(`${file}: a requirement could not be read (${shown(value)}).`);
  return normalizeName(name);
}
function tableKeys(value: TomlValue | undefined, file: string, what: string): string[] {
  if (value === undefined) return [];
  if (!isTable(value)) throw new Error(`${file}: ${what} is not a table.`);
  return Object.keys(value).map(k => { if (!NAME.test(k)) throw new Error(`${file}: ${shown(k)} in ${what} is not a package name.`); return normalizeName(k); });
}
function stringList(value: TomlValue | undefined, file: string, what: string, groups = false): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${file}: ${what} is not a list.`);
  // PEP 735 groups may include another group ({ include-group = "x" }); that names no package.
  const names: string[] = [];
  for (const v of value) if (!(groups && isTable(v) && typeof v["include-group"] === "string" && Object.keys(v).length === 1)) names.push(requirementName(v, file));
  return names;
}

/**
 * The requirement names pyproject.toml declares: [project] dependencies and optional dependencies, PEP 735
 * [dependency-groups], and Poetry's dependency tables (without "python"). dynamic is true when [project] leaves its
 * dependencies to the build backend. Throws when any of it cannot be read exactly.
 */
export function pyprojectRequirements(text: string): { names: string[]; dynamic: boolean } {
  const file = "pyproject.toml", doc = parseToml(text, file);
  const project = doc.project, tool = doc.tool, groups = doc["dependency-groups"];
  if (project !== undefined && !isTable(project)) throw new Error(`${file}: [project] is not a table.`);
  if (tool !== undefined && !isTable(tool)) throw new Error(`${file}: [tool] is not a table.`);
  if (groups !== undefined && !isTable(groups)) throw new Error(`${file}: [dependency-groups] is not a table.`);
  const names: string[] = [];
  if (project) {
    append(names, stringList(project.dependencies, file, "[project] dependencies"));
    const optional = project["optional-dependencies"];
    if (optional !== undefined && !isTable(optional)) throw new Error(`${file}: [project.optional-dependencies] is not a table.`);
    for (const [extra, list] of Object.entries(optional ?? {})) append(names, stringList(list, file, `optional dependencies ${shown(extra)}`));
  }
  for (const [group, list] of Object.entries(groups ?? {})) append(names, stringList(list, file, `dependency group ${shown(group)}`, true));
  const poetry = tool?.poetry;
  if (poetry !== undefined) {
    if (!isTable(poetry)) throw new Error(`${file}: [tool.poetry] is not a table.`);
    append(names, tableKeys(poetry.dependencies, file, "[tool.poetry.dependencies]").filter(n => n !== "python"));
    append(names, tableKeys(poetry["dev-dependencies"], file, "[tool.poetry.dev-dependencies]"));
    const poetryGroups = poetry.group;
    if (poetryGroups !== undefined && !isTable(poetryGroups)) throw new Error(`${file}: [tool.poetry.group] is not a table.`);
    for (const [group, body] of Object.entries(poetryGroups ?? {})) {
      if (!isTable(body)) throw new Error(`${file}: Poetry group ${shown(group)} is not a table.`);
      append(names, tableKeys(body.dependencies, file, `Poetry group ${shown(group)} dependencies`));
    }
  }
  const dynamic = project?.dynamic;
  if (dynamic !== undefined && (!Array.isArray(dynamic) || !dynamic.every(d => typeof d === "string"))) throw new Error(`${file}: [project] dynamic is not a list of strings.`);
  return { names: [...new Set(names)], dynamic: !!dynamic?.some(d => d === "dependencies" || d === "optional-dependencies") };
}

/** The package names a Pipfile declares, in [packages], [dev-packages] and custom categories. Throws when unreadable. */
export function pipfileRequirements(text: string): string[] {
  const doc = parseToml(text, "Pipfile"), names: string[] = [];
  for (const [section, body] of Object.entries(doc)) {
    if (["source", "requires", "scripts", "pipenv"].includes(section)) continue;
    append(names, tableKeys(body, "Pipfile", `section ${shown(section)}`));
  }
  return [...new Set(names)];
}

/**
 * Requirements files other than requirements.txt (requirements-dev.txt, dev-requirements.txt, test-requirements.txt,
 * a requirements/ directory): listed, never read.
 */
function otherRequirementFiles(root: string): string[] {
  const read = existsSync(join(root, "requirements.txt")) ? lstatSync(join(root, "requirements.txt")) : undefined;
  // On a case-insensitive disk, Requirements.txt is the file read as requirements.txt.
  const isRead = (n: string) => { const s = lstatSync(join(root, n)); return !!read && s.ino === read.ino && s.dev === read.dev; };
  return readdirSync(root).filter(n => (/^[A-Za-z0-9._-]*requirements[A-Za-z0-9._-]*\.txt$/i.test(n) || n.toLowerCase() === "requirements") && !isRead(n))
    .map(n => n.toLowerCase() === "requirements" && lstatSync(join(root, n)).isDirectory() ? `${n}/` : n).sort();
}

/**
 * The Python inventory of a project root, or null when it has no Python dependency file this reader knows. Every lock
 * file present is read and their packages combined; requirements.txt adds its exact pins, and a pin that a lock lists
 * at the same version keeps the lock's direct mark. A pyproject.toml without uv.lock or poetry.lock, or a Pipfile
 * without Pipfile.lock, is a limitation when it declares requirements: their versions are not guessed.
 */
export function readPython(root: string): ReadOnlyInventory | null {
  const has = (file: string) => existsSync(join(root, file));
  const others = otherRequirementFiles(root);
  if (!FILES.some(has) && !others.length) return null;
  const files: string[] = [], limitations: string[] = [], project: string[] = [];
  const read = (file: string): string => { const text = textFile(root, file); files.push(file); return text; };
  const packages = new Map<string, ReadOnlyPackage>();
  const add = (result: PythonFile) => { collect(result.packages, packages); append(project, result.project); append(limitations, result.limitations); };
  /** A lock whose direct marks come from its manifest: a missing or unreadable manifest is a limitation, not silence. */
  const withManifest = (lock: string, manifest: string, names: (text: string) => string[], parse: (text: string, direct: Set<string> | null) => PythonFile) => {
    const text = read(lock);
    let direct: Set<string> | null = null, why = `there is no ${manifest} beside it`;
    if (has(manifest)) {
      try { direct = new Set(names(read(manifest))); } catch (error) { why = `${manifest} could not be read (${reason(error)})`; }
    }
    const result = parse(text, direct);
    if (!direct && result.packages.length) result.limitations.push(`${lock}: ${why}, so no package from it is marked direct.`);
    add(result);
  };
  const locks = LOCKS.filter(has);
  if (has("uv.lock")) add(parseUvLock(read("uv.lock")));
  if (has("poetry.lock")) withManifest("poetry.lock", "pyproject.toml", t => pyprojectRequirements(t).names, parsePoetryLock);
  if (has("Pipfile.lock")) withManifest("Pipfile.lock", "Pipfile", pipfileRequirements, parsePipfileLock);
  if (has("requirements.txt")) {
    const pins = parseRequirements(read("requirements.txt"));
    // A lock's direct and indirect marks win over requirements.txt, which marks every pin direct.
    pins.packages = pins.packages.filter(p => !packages.has(`${p.name}\0${p.version}`));
    add(pins);
  }
  // A manifest no lock covers: its requirements are a limitation, their versions are not guessed.
  if (has("pyproject.toml") && !has("uv.lock") && !has("poetry.lock")) {
    const text = read("pyproject.toml");
    try {
      const declared = pyprojectRequirements(text);
      if (declared.names.length || declared.dynamic) limitations.push(`pyproject.toml declares ${declared.dynamic ? "dependencies dynamically" : plural(declared.names.length, "requirement", "requirements")} and no lock file (uv.lock, poetry.lock) pins them; unpinned project requirements were not checked and their versions were not guessed.`);
    } catch (error) {
      limitations.push(`pyproject.toml could not be read (${reason(error)}); any requirements it declares were not checked.`);
    }
  }
  if (has("Pipfile") && !has("Pipfile.lock")) {
    const text = read("Pipfile");
    try {
      const declared = pipfileRequirements(text);
      if (declared.length) limitations.push(`Pipfile declares ${plural(declared.length, "package", "packages")} and there is no Pipfile.lock; unpinned requirements were not checked and their versions were not guessed.`);
    } catch (error) {
      limitations.push(`Pipfile could not be read (${reason(error)}); any requirements it declares were not checked.`);
    }
  }
  if (others.length) limitations.push(`Only requirements.txt is read; other requirements files were not checked: ${list(others)}.`);
  const scope: string[] = [];
  if (locks.length) scope.push(`locked_registry_packages (${locks.join(", ")})`);
  if (has("requirements.txt")) scope.push("exact_pins_in_requirements_txt");
  if (!scope.length) scope.push("no_locked_or_pinned_packages");
  if (project.length) scope.push(`project_itself_not_scanned (${list([...new Set(project)])})`);
  return { ecosystem: "PyPI", files, scope: scope.join("; "), packages: [...packages.values()], limitations };
}
