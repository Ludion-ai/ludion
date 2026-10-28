import { lstatSync } from "node:fs";
import { join } from "node:path";
import { textFile } from "../inventory.ts";
import type { ReadOnlyInventory, ReadOnlyPackage } from "./types.ts";

/**
 * Rust, read only: the crates.io packages that Cargo.lock (formats 1 to 4) records. Nothing is patched or planned.
 *
 * Cargo.lock lists every crate any build of the workspace can use (all targets, platforms, features, dev and build
 * dependencies), so a listed crate is not necessarily compiled into a given binary. Packages without a source are the
 * project itself (workspace members and path crates): they are not inventory, and a crate one of them names in its
 * `dependencies` is direct. Crates from git, other registries or a recorded path, and crates replaced through
 * [replace], are named in limitations. [[patch.unused]] entries are patches Cargo did not use: not in the build, so not
 * inventory. An unknown format version is a limitation and nothing is read; anything malformed throws.
 */
export const RUST_SCOPE = "locked_crates_io_packages_all_targets_and_features_not_workspace_or_path_crates";
/** crates.io as Cargo records it: the index's canonical id (also kept for the sparse protocol) and the sparse URL. */
const CRATES_IO = ["registry+https://github.com/rust-lang/crates.io-index", "sparse+https://index.crates.io/"];
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CRATES_IO_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** Cargo allows Unicode names for crates that are not published; they are never sent anywhere. */
const ANY_NAME = /^[\p{L}\p{M}\p{N}_-]{1,100}$/u;
const SOURCE = /^(git|registry|sparse|path)\+[^\s()]{1,2000}$/;
const PACKAGE_KEYS = ["name", "version", "source", "checksum", "dependencies", "replace"];
const show = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}…` : text);

type Value = string | number | string[];
type Table = { header: "" | "package" | "patch.unused" | "root" | "metadata"; line: number; keys: Map<string, Value> };

/** The TOML subset Cargo writes: comments, [[package]]/[[patch.unused]]/[root]/[metadata], bare or "quoted" keys, basic strings, integers and arrays of strings. Anything else throws. */
function readToml(text: string): Table[] {
  const tables: Table[] = [{ header: "", line: 1, keys: new Map() }];
  let i = 0, line = 1;
  const fail: (message: string, at?: number) => never = (message, at = line) => { throw new Error(`Invalid Cargo.lock at line ${at}: ${message}.`); };
  const spaces = () => { while (text[i] === " " || text[i] === "\t") i++; };
  const comment = () => { if (text[i] === "#") while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++; };
  const newline = (): boolean => {
    if (text[i] === "\r" && text[i + 1] === "\n") i++;
    if (text[i] === "\n") { i++; line++; return true; }
    return false;
  };
  const endOfLine = () => { spaces(); comment(); if (i < text.length && !newline()) fail("expected the end of the line"); };
  const blank = () => { for (;;) { spaces(); comment(); if (i >= text.length || !newline()) return; } };
  const string = (): string => {
    if (text.startsWith('"""', i)) fail("multi-line strings are not supported");
    let out = ""; i++;
    for (;;) {
      const c = text[i];
      if (c === undefined || c === "\n" || c === "\r") fail("unterminated string");
      if (c === '"') { i++; return out; }
      if (c === "\\") {
        const e = text[i + 1] ?? "", simple = ({ b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" } as Record<string, string>)[e];
        if (simple !== undefined) { out += simple; i += 2; continue; }
        const digits = e === "u" ? 4 : e === "U" ? 8 : 0, hex = text.slice(i + 2, i + 2 + digits), code = parseInt(hex, 16);
        if (!digits || !/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== digits || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail("invalid escape in string");
        out += String.fromCodePoint(code); i += 2 + digits; continue;
      }
      if ((c < " " && c !== "\t") || c === "\x7f") fail("control character in string");
      out += c; i++;
    }
  };
  const key = (): string => {
    if (text[i] === '"') return string();
    const bare = /[A-Za-z0-9_-]+/y; bare.lastIndex = i;
    const match = bare.exec(text);
    if (!match) fail("expected a key, a table header or a comment");
    i += match[0].length;
    if (text[i] === ".") fail("dotted keys are not supported");
    return match[0];
  };
  const value = (): Value => {
    if (text[i] === '"') return string();
    if (text[i] === "[") {
      const items: string[] = []; i++;
      for (;;) {
        blank();
        if (i >= text.length) fail("unterminated array");
        if (text[i] === "]") { i++; return items; }
        if (text[i] !== '"') fail("arrays may contain only strings");
        items.push(string());
        blank();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return items; }
        fail("expected , or ] in array");
      }
    }
    const integer = /(?:0|[1-9][0-9]{0,8})(?![0-9A-Za-z_.:+-])/y; integer.lastIndex = i;
    const match = integer.exec(text);
    if (!match) fail("unsupported value (only strings, arrays of strings and small integers are read)");
    i += match[0].length; return Number(match[0]);
  };
  for (;;) {
    blank();
    if (i >= text.length) return tables;
    if (text[i] === "[") {
      const header = /\[\[[ \t]*([A-Za-z0-9_.-]+)[ \t]*\]\]|\[[ \t]*([A-Za-z0-9_.-]+)[ \t]*\]/y; header.lastIndex = i;
      const match = header.exec(text), at = line;
      if (!match) fail("invalid table header");
      const name = match[1] ?? match[2]!, many = match[1] !== undefined;
      const kind = many && (name === "package" || name === "patch.unused") ? name : !many && (name === "root" || name === "metadata") ? name : fail(`unsupported table ${show(match[0])}`);
      if (!many && tables.some(t => t.header === kind)) fail(`[${kind}] appears twice`);
      i += match[0].length; endOfLine();
      tables.push({ header: kind, line: at, keys: new Map() });
      continue;
    }
    const at = line, name = key(); spaces();
    if (text[i] !== "=") fail(`expected = after ${show(name)}`);
    i++; spaces();
    const item = value(); endOfLine();
    const table = tables.at(-1)!;
    if (table.keys.has(name)) fail(`duplicate key ${show(name)}`, at);
    table.keys.set(name, item);
  }
}

type Kind = "crates.io" | "git" | "other";
type Id = { name: string; version: string | null; source: string | null };
type Entry = { name: string; version: string; source: string | null; kind: Kind | null; dependencies: Id[]; replaced: boolean; label: string };

function sourceKind(source: string, fail: (message: string) => never): Kind {
  if (CRATES_IO.includes(source)) return "crates.io";
  const protocol = SOURCE.exec(source)?.[1];
  if (!protocol) fail(`unsupported source ${show(source)}`);
  return protocol === "git" ? "git" : "other";
}
/** Cargo's package id: `name`, `name version` or `name version (source)`. */
function packageId(text: string, fail: (message: string) => never): Id {
  const first = text.indexOf(" "), second = first < 0 ? -1 : text.indexOf(" ", first + 1);
  const name = first < 0 ? text : text.slice(0, first);
  const version = first < 0 ? null : text.slice(first + 1, second < 0 ? undefined : second);
  const rest = second < 0 ? null : text.slice(second + 1);
  if (!ANY_NAME.test(name) || (version !== null && !SEMVER.test(version)) || (rest !== null && !/^\(.+\)$/s.test(rest))) fail(`invalid package id ${show(text)}`);
  const source = rest === null ? null : rest.slice(1, -1);
  if (source !== null) sourceKind(source, fail);
  return { name, version, source };
}
function entry(table: Table, label: string, root: boolean): Entry {
  let where = `${label} at line ${table.line}`;
  const fail: (message: string) => never = message => { throw new Error(`Invalid Cargo.lock ${where}: ${message}.`); };
  const text = (key: string): string | undefined => {
    const value = table.keys.get(key);
    if (value === undefined || typeof value === "string") return value;
    return fail(`${key} must be a string`);
  };
  for (const key of table.keys.keys()) if (!PACKAGE_KEYS.includes(key)) fail(`unsupported key ${show(key)}`);
  const name = text("name");
  if (name === undefined) return fail("missing name");
  if (!ANY_NAME.test(name)) fail(`invalid crate name ${show(name)}`);
  where = `${label} ${show(name)} at line ${table.line}`;
  const version = text("version"), source = text("source") ?? null, checksum = text("checksum"), replace = text("replace");
  if (version === undefined) return fail("missing version");
  if (version.length > 100 || !SEMVER.test(version)) fail(`version ${show(version)} is not an exact semver version`);
  if (root && source !== null) fail("the [root] package has no source");
  const kind = source === null ? null : sourceKind(source, fail);
  if (kind === "crates.io" && !CRATES_IO_NAME.test(name)) fail("not a valid crates.io crate name");
  if (checksum !== undefined && !/^[0-9a-f]{64}$/.test(checksum)) fail("checksum is not a SHA-256 hex digest");
  const list = table.keys.get("dependencies") ?? [];
  if (!Array.isArray(list)) return fail("dependencies must be an array of strings");
  if (replace !== undefined) packageId(replace, fail);
  return { name, version, source, kind, dependencies: list.map(id => packageId(id, fail)), replaced: replace !== undefined, label: `${name} ${version}` };
}
const named = (list: string[]) => `(${list.length}): ${list.slice(0, 10).join(", ")}${list.length > 10 ? ` and ${list.length - 10} more` : ""}.`;

/** Pure: the crates.io packages in a Cargo.lock, and every limitation of that reading. Throws on anything malformed. */
export function parseCargoLock(text: string): { packages: ReadOnlyPackage[]; limitations: string[] } {
  // The format version comes first: an unknown format is not guessed at, whatever its syntax.
  const lines = text.split(/\r?\n/), firstTable = lines.findIndex(l => l.trimStart().startsWith("["));
  const declared = lines.slice(0, firstTable < 0 ? lines.length : firstTable).map(l => /^[ \t]*version[ \t]*=[ \t]*([0-9]+)[ \t]*(?:#.*)?$/.exec(l)?.[1]).find(v => v !== undefined);
  const unknown = (version: string) => ({ packages: [], limitations: [`Cargo.lock format version ${version.slice(0, 12)} is not one Ludion reads (1 to 4); its packages were not read or checked.`] });
  if (declared !== undefined && !["3", "4"].includes(declared)) return unknown(declared);
  const tables = readToml(text);
  for (const [key, value] of tables[0]!.keys) {
    if (key !== "version") throw new Error(`Invalid Cargo.lock: unsupported top-level key ${show(key)}.`);
    if (typeof value !== "number") throw new Error("Invalid Cargo.lock: the format version must be an integer.");
    if (value !== 3 && value !== 4) return unknown(String(value));
  }
  for (const table of tables.filter(t => t.header === "metadata")) for (const [key, value] of table.keys) if (typeof value !== "string") throw new Error(`Invalid Cargo.lock [metadata] at line ${table.line}: ${show(key)} must be a string.`);
  let count = 0;
  const entries = tables.filter(t => t.header === "package" || t.header === "root").map(t => entry(t, t.header === "root" ? "[root]" : `[[package]] #${++count}`, t.header === "root"));
  tables.filter(t => t.header === "patch.unused").forEach((t, n) => entry(t, `[[patch.unused]] #${n + 1}`, false));
  // Cargo compares sources without the locked commit (#fragment) that git sources carry.
  const bare = (source: string | null) => source?.replace(/#.*$/s, "") ?? null;
  const byName = new Map<string, Entry[]>(), seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.name}\0${e.version}\0${bare(e.source) ?? ""}`;
    if (seen.has(key)) throw new Error(`Invalid Cargo.lock: ${e.label}${e.source ? ` (${show(e.source)})` : ""} is listed twice.`);
    seen.add(key);
    const same = byName.get(e.name);
    if (same) same.push(e); else byName.set(e.name, [e]);
  }
  const members = entries.filter(e => e.source === null), direct = new Set<Entry>();
  for (const member of members) for (const id of member.dependencies) {
    const found = (byName.get(id.name) ?? []).filter(e => (id.version === null || e.version === id.version) && (id.source === null || bare(e.source) === bare(id.source)));
    const text = `${id.name}${id.version ? ` ${id.version}` : ""}${id.source ? ` (${id.source})` : ""}`;
    if (found.length !== 1) throw new Error(`Invalid Cargo.lock: ${member.label} depends on ${show(text)}, which matches ${found.length ? "more than one" : "no"} [[package]].`);
    direct.add(found[0]!);
  }
  const packages = new Map<string, ReadOnlyPackage>();
  for (const e of entries) if (e.kind === "crates.io" && !e.replaced) {
    const key = `${e.name}\0${e.version}`, known = packages.get(key);
    packages.set(key, { name: e.name, version: e.version, direct: (known?.direct ?? false) || direct.has(e) });
  }
  if (packages.size > 2000) throw new Error("Rust inventory exceeds 2,000 distinct crates.io package versions.");
  const limitations: string[] = [];
  const labels = (pick: (e: Entry) => boolean) => [...new Set(entries.filter(pick).map(e => e.label))];
  const git = labels(e => e.kind === "git" && !e.replaced), other = labels(e => e.kind === "other" && !e.replaced), replaced = labels(e => e.replaced);
  if (!members.length) limitations.push("Cargo.lock lists no workspace member (a package without a source), so direct dependencies could not be identified.");
  if (git.length) limitations.push(`Crates from git sources are outside crates.io advisory coverage and were not checked ${named(git)}`);
  if (other.length) limitations.push(`Crates from registries other than crates.io, or from a recorded path, were not checked ${named(other)}`);
  if (replaced.length) limitations.push(`Crates replaced through [replace] are not built and were not checked; each replacement is read by its own source ${named(replaced)}`);
  return { packages: [...packages.values()], limitations };
}

const present = (root: string, name: string) => lstatSync(join(root, name), { throwIfNoEntry: false }) !== undefined;

/** The Rust inventory of one directory: Cargo.lock if present, else a Cargo.toml whose versions are not locked. Null when neither exists. */
export function readRust(root: string): ReadOnlyInventory | null {
  if (present(root, "Cargo.lock")) return { ecosystem: "crates.io", files: ["Cargo.lock"], scope: RUST_SCOPE, ...parseCargoLock(textFile(root, "Cargo.lock")) };
  if (!present(root, "Cargo.toml")) return null;
  textFile(root, "Cargo.toml");
  return { ecosystem: "crates.io", files: ["Cargo.toml"], scope: RUST_SCOPE, packages: [], limitations: ["Cargo.toml has no Cargo.lock beside it, so its dependency versions are not locked and were not checked (a workspace member's Cargo.lock is at the workspace root)."] };
}
