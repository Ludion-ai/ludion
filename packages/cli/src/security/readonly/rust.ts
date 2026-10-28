import { lstatSync } from "node:fs";
import { join } from "node:path";
import { textFile } from "../inventory.ts";
import { literalMembers } from "./members.ts";
import { isTable, parseToml, type TomlTable } from "./python-toml.ts";
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
 *
 * Sources can carry credentials (git+https://user:token@host/...), so no message, error or limitation ever contains any
 * part of one, nor a quoted key (v1 [metadata] keys embed sources): sources are described by kind only. A package with a
 * checksum but no source is refused, because Cargo writes checksums only on registry packages. A registry package whose
 * source and checksum lines were both removed reads as a path crate; only a cross-check against the workspace's
 * Cargo.toml files could reveal that (Cargo itself drops such an entry and resolves again).
 */
export const RUST_SCOPE = "locked_crates_io_packages_all_targets_and_features_not_workspace_or_path_crates";
/** crates.io as Cargo records it: the index's canonical id (also kept for the sparse protocol) and the sparse URL. */
const CRATES_IO = ["registry+https://github.com/rust-lang/crates.io-index", "sparse+https://index.crates.io/"];
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CRATES_IO_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** Cargo allows Unicode names for crates that are not published; they are never sent anywhere. */
const ANY_NAME = /^[\p{L}\p{M}\p{N}_-]{1,100}$/u;
/** Cargo's four lockfile protocols. Before v4, git refs are written unencoded, so a branch may contain parentheses. */
const SOURCE = /^(git|registry|sparse|path)\+\S{1,2000}$/;
const PACKAGE_KEYS = ["name", "version", "source", "checksum", "dependencies", "replace"];
/** For names, versions and bare keys only: never for a source or a quoted key. */
const show = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}…` : text);
const showKey = (key: string) => /^[A-Za-z0-9_-]{1,60}$/.test(key) ? show(key) : "a quoted key";

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
  /** A run of characters a basic string takes as they are. */
  const plain = /[^"\\\x00-\x08\x0a-\x1f\x7f]*/y;
  const string = (): string => {
    if (text.startsWith('"""', i)) fail("multi-line strings are not supported");
    let out = ""; i++;
    for (;;) {
      plain.lastIndex = i;
      const run = plain.exec(text)![0];
      out += run; i += run.length;
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
    if (text[i] !== "=") fail(`expected = after ${showKey(name)}`);
    i++; spaces();
    const item = value(); endOfLine();
    const table = tables.at(-1)!;
    if (table.keys.has(name)) fail(`duplicate key ${showKey(name)}`, at);
    table.keys.set(name, item);
  }
}

type Kind = "crates.io" | "git" | "registry" | "path";
/** `raw` is only ever a lookup key, never printed: it can contain a source. */
type Id = { name: string; version: string | null; source: string | null; kind: Kind | null; raw: string };
type Entry = { name: string; version: string; source: string | null; kind: Kind | null; dependencies: Id[]; replaced: boolean; label: string };

const UNSUPPORTED = "an unsupported source (Cargo writes git+, registry+, sparse+ and path+ sources)";
/** Null for a source Cargo does not write. */
function sourceKind(source: string): Kind | null {
  if (CRATES_IO.includes(source)) return "crates.io";
  const protocol = SOURCE.exec(source)?.[1];
  return protocol === undefined ? null : protocol === "git" ? "git" : protocol === "path" ? "path" : "registry";
}
/** A source by kind only. */
const described = (kind: Kind | null) => kind === null ? "no source (the project itself)" : kind === "crates.io" ? "crates.io" : kind === "git" ? "a git source" : kind === "registry" ? "another registry" : "a recorded path";
const slotName = (slot: number | null) => slot === null ? "replace" : `dependencies[${slot}]`;
/** Cargo's package id: `name`, `name version` or `name version (source)`. Only a validated name and version are ever printed. */
function packageId(text: string, slot: number | null, fail: (message: string) => never): Id {
  const first = text.indexOf(" "), second = first < 0 ? -1 : text.indexOf(" ", first + 1);
  const name = first < 0 ? text : text.slice(0, first);
  const version = first < 0 ? null : text.slice(first + 1, second < 0 ? undefined : second);
  const rest = second < 0 ? null : text.slice(second + 1);
  if (!ANY_NAME.test(name)) fail(`${slotName(slot)} is not a valid package id (its crate name is invalid)`);
  if (version !== null && !SEMVER.test(version)) fail(`${slotName(slot)} is not a valid package id (the version for ${show(name)} is not an exact semver version)`);
  if (rest !== null && !/^\(.+\)$/s.test(rest)) fail(`${slotName(slot)} is not a valid package id (the source for ${show(`${name} ${version}`)} is not in parentheses)`);
  const source = rest === null ? null : rest.slice(1, -1), kind = source === null ? null : sourceKind(source);
  if (source !== null && kind === null) fail(`${slotName(slot)} for ${show(`${name} ${version}`)} has ${UNSUPPORTED}`);
  return { name, version, source, kind, raw: text };
}
function entry(table: Table, label: string, root: boolean): Entry {
  let known: string | undefined;
  const fail: (message: string) => never = message => { throw new Error(`Invalid Cargo.lock ${label}${known === undefined ? "" : ` ${show(known)}`} at line ${table.line}: ${message}.`); };
  const text = (key: string): string | undefined => {
    const value = table.keys.get(key);
    if (value === undefined || typeof value === "string") return value;
    return fail(`${key} must be a string`);
  };
  for (const key of table.keys.keys()) if (!PACKAGE_KEYS.includes(key)) fail(`unsupported key ${showKey(key)}`);
  const name = text("name");
  if (name === undefined) return fail("missing name");
  if (!ANY_NAME.test(name)) fail(`invalid crate name ${show(name)}`);
  known = name;
  const version = text("version"), source = text("source") ?? null, checksum = text("checksum"), replace = text("replace");
  if (version === undefined) return fail("missing version");
  if (version.length > 100 || !SEMVER.test(version)) fail(`version ${show(version)} is not an exact semver version`);
  if (root && source !== null) fail("the [root] package has no source");
  const kind = source === null ? null : sourceKind(source);
  if (source !== null && kind === null) fail(`it has ${UNSUPPORTED}`);
  if (kind === "crates.io" && !CRATES_IO_NAME.test(name)) fail("not a valid crates.io crate name");
  if (checksum !== undefined && !/^[0-9a-f]{64}$/.test(checksum)) fail("checksum is not a SHA-256 hex digest");
  // Cargo writes a checksum only on a registry package: without a source line, this is not the project's own crate.
  if (checksum !== undefined && source === null) fail("it has a checksum but no source, which Cargo never writes (its source line may have been removed)");
  const list = table.keys.get("dependencies") ?? [];
  if (!Array.isArray(list)) return fail("dependencies must be an array of strings");
  if (replace !== undefined) packageId(replace, null, fail);
  // A repeated id is read once: Cargo's dependency edges are a set.
  const ids = new Map<string, Id>();
  list.forEach((id, n) => { if (!ids.has(id)) ids.set(id, packageId(id, n, fail)); });
  return { name, version, source, kind, dependencies: [...ids.values()], replaced: replace !== undefined, label: `${name} ${version}` };
}
const named = (list: string[]) => `(${list.length}): ${list.slice(0, 10).join(", ")}${list.length > 10 ? ` and ${list.length - 10} more` : ""}.`;

/** Pure: the crates.io packages in a Cargo.lock, and every limitation of that reading. Throws on anything malformed. */
export function parseCargoLock(text: string): { packages: ReadOnlyPackage[]; limitations: string[] } {
  const { packages, limitations } = cargoLock(text);
  return { packages, limitations };
}

/**
 * parseCargoLock, plus the workspace members' names (packages without a source; null for an unknown format) and the
 * name of every package the lock lists, whatever its source.
 */
function cargoLock(text: string): { packages: ReadOnlyPackage[]; limitations: string[]; members: string[] | null; names: string[] } {
  // The format version comes first: an unknown format is not guessed at, whatever its syntax.
  const firstTable = text.search(/^[ \t]*\[/m);
  const declared = /^[ \t]*version[ \t]*=[ \t]*([0-9]+)[ \t]*(?:#[^\r\n]*)?\r?$/m.exec(firstTable < 0 ? text : text.slice(0, firstTable))?.[1];
  const unknown = (version: string) => ({ packages: [], members: null, names: [], limitations: [`Cargo.lock format version ${version.slice(0, 12)} is not one Ludion reads (1 to 4); its packages were not read or checked.`] });
  if (declared !== undefined && !["3", "4"].includes(declared)) return unknown(declared);
  const tables = readToml(text);
  for (const [key, value] of tables[0]!.keys) {
    if (key !== "version") throw new Error(`Invalid Cargo.lock: unsupported top-level key ${showKey(key)}.`);
    if (typeof value !== "number") throw new Error("Invalid Cargo.lock: the format version must be an integer.");
    if (value !== 3 && value !== 4) return unknown(String(value));
  }
  for (const table of tables.filter(t => t.header === "metadata")) for (const value of table.keys.values()) if (typeof value !== "string") throw new Error(`Invalid Cargo.lock [metadata] at line ${table.line}: every value must be a string.`);
  let count = 0;
  const entries = tables.filter(t => t.header === "package" || t.header === "root").map(t => entry(t, t.header === "root" ? "[root]" : `[[package]] #${++count}`, t.header === "root"));
  tables.filter(t => t.header === "patch.unused").forEach((t, n) => entry(t, `[[patch.unused]] #${n + 1}`, false));
  // Indexed once, so each id is a constant number of lookups (Cargo's lookup_id in src/resolver/encode.rs). Cargo
  // compares sources without the locked commit (#fragment) that git sources carry.
  const bare = (source: string) => source.replace(/#.*$/s, "");
  const versions = new Map<string, Set<string>>(), groups = new Map<string, { all: Entry[]; paths: Entry[] }>(), exact = new Map<string, Entry>();
  for (const e of entries) {
    const key = `${e.name}\0${e.version}\0${e.source === null ? "" : `+${bare(e.source)}`}`;
    if (exact.has(key)) throw new Error(`Invalid Cargo.lock: ${e.label} from ${described(e.kind)} is listed twice.`);
    exact.set(key, e);
    const known = versions.get(e.name);
    if (known) known.add(e.version); else versions.set(e.name, new Set([e.version]));
    const group = groups.get(`${e.name}\0${e.version}`) ?? { all: [], paths: [] };
    group.all.push(e);
    if (e.source === null || e.kind === "path") group.paths.push(e);
    groups.set(`${e.name}\0${e.version}`, group);
  }
  /** A name alone needs one version; a source is matched exactly; without one, a single path package wins, as in Cargo. */
  const lookup = (id: Id): Entry | "no" | "more than one" => {
    const known = versions.get(id.name);
    if (!known) return "no";
    const version = id.version ?? (known.size === 1 ? known.values().next().value! : null);
    if (version === null) return "more than one";
    if (id.source !== null) return exact.get(`${id.name}\0${version}\0+${bare(id.source)}`) ?? "no";
    const group = groups.get(`${id.name}\0${version}`);
    if (!group) return "no";
    const pick = group.paths.length ? group.paths : group.all;
    return pick.length === 1 ? pick[0]! : "more than one";
  };
  const members = entries.filter(e => e.source === null), direct = new Set<Entry>();
  for (const member of members) for (const id of member.dependencies) {
    const found = lookup(id);
    if (typeof found === "string") throw new Error(`Invalid Cargo.lock: ${member.label} depends on ${show(`${id.name}${id.version ? ` ${id.version}` : ""}`)}${id.source === null ? "" : ` from ${described(id.kind)}`}, which matches ${found} [[package]].`);
    direct.add(found);
  }
  const packages = new Map<string, ReadOnlyPackage>();
  for (const e of entries) if (e.kind === "crates.io" && !e.replaced) {
    const key = `${e.name}\0${e.version}`, known = packages.get(key);
    packages.set(key, { name: e.name, version: e.version, direct: (known?.direct ?? false) || direct.has(e) });
  }
  if (packages.size > 2000) throw new Error("Rust inventory exceeds 2,000 distinct crates.io package versions.");
  const limitations: string[] = [];
  const labels = (pick: (e: Entry) => boolean) => [...new Set(entries.filter(pick).map(e => e.label))];
  const git = labels(e => e.kind === "git" && !e.replaced), other = labels(e => (e.kind === "registry" || e.kind === "path") && !e.replaced), replaced = labels(e => e.replaced);
  if (!members.length) limitations.push("Cargo.lock lists no workspace member (a package without a source), so direct dependencies could not be identified.");
  if (git.length) limitations.push(`Crates from git sources are outside crates.io advisory coverage and were not checked ${named(git)}`);
  if (other.length) limitations.push(`Crates from registries other than crates.io, or from a recorded path, were not checked ${named(other)}`);
  if (replaced.length) limitations.push(`Crates replaced through [replace] are not built and were not checked; each replacement is read by its own source ${named(replaced)}`);
  return { packages: [...packages.values()], limitations, members: members.map(m => m.name), names: [...new Set(entries.map(e => e.name))] };
}

/** A Cargo.toml as TOML, or the limitation that it could not be read. Only a line number is printed. */
function cargoToml(text: string, file: string): TomlTable | string {
  try { return parseToml(text, file); } catch (error) {
    const line = /\bline (\d+)/.exec(error instanceof Error ? error.message : "")?.[1];
    return `${file} could not be read as TOML${line ? ` (line ${line})` : ""}`;
  }
}
/** Cargo compares crate names with - and _ alike (the index and the lock record the published spelling). */
const crateKey = (name: string) => name.toLowerCase().replaceAll("-", "_");
const DEPENDENCY_TABLES = ["dependencies", "dev-dependencies", "build-dependencies", "dev_dependencies", "build_dependencies"];
/**
 * The crates a Cargo.toml declares: [dependencies], [dev-dependencies], [build-dependencies] and the same under
 * [target.*], by key, or by `package` for a renamed dependency (also through [workspace.dependencies] for
 * `workspace = true`). Keys and names only: no value is ever printed, because dependency entries can carry credentials.
 */
function declaredCrates(doc: TomlTable): { names: string[]; unread: number } {
  const tables: unknown[] = [], names = new Set<string>(), inherited = isTable(doc.workspace) && isTable(doc.workspace.dependencies) ? doc.workspace.dependencies : {};
  let unread = 0;
  for (const key of DEPENDENCY_TABLES) tables.push(doc[key]);
  if (isTable(doc.target)) for (const spec of Object.values(doc.target)) if (isTable(spec)) for (const key of DEPENDENCY_TABLES) tables.push(spec[key]);
  for (const table of tables) {
    if (table === undefined) continue;
    if (!isTable(table)) { unread++; continue; }
    for (const [key, value] of Object.entries(table)) {
      // `workspace = true` takes the entry, and its package rename, from [workspace.dependencies].
      const base = isTable(value) && value.workspace === true ? inherited[key] : value;
      const name = isTable(base) && typeof base.package === "string" ? base.package : key;
      if (ANY_NAME.test(name)) names.add(name); else unread++;
    }
  }
  return { names: [...names], unread };
}
type Lock = { members: string[] | null; names: string[] };
/** Reads a project file (a workspace member's Cargo.toml), or null when it cannot be read. */
type ReadMember = (path: string) => string | null;
/**
 * Whether a Cargo.lock is the lock of the Cargo.toml beside it. Cargo builds a workspace member with the lock at its
 * workspace root; a lock lists its workspace's packages as members (packages without a source) and every crate any of
 * them declares. Nothing from a Cargo.toml is printed but validated crate names and counts.
 */
export function cargoManifestLimitations(text: string, lock: Lock, readMember: ReadMember): string[] {
  const doc = cargoToml(text, "Cargo.toml");
  if (typeof doc === "string") return [`${doc}, so whether Cargo.lock is its lock was not checked.`];
  const pkg = doc.package, workspace = doc.workspace;
  if ((pkg !== undefined && !isTable(pkg)) || (workspace !== undefined && !isTable(workspace))) return ["Cargo.toml's [package] or [workspace] is not a table, so whether Cargo.lock is its lock was not checked."];
  if (!pkg && !workspace) return ["Cargo.toml has neither [package] nor [workspace], so whether Cargo.lock is its lock was not checked."];
  const limitations: string[] = [];
  if (pkg?.workspace !== undefined && !workspace) limitations.push("Cargo.toml names another directory as its workspace root (package.workspace). Cargo builds it with the Cargo.lock at that root, so the Cargo.lock here may not be the one in use.");
  const lockMembers = new Set(lock.members ?? []);
  const isMember = (name: string) => !lockMembers.size || lockMembers.has(name);
  if (pkg) {
    const name = typeof pkg.name === "string" && ANY_NAME.test(pkg.name) ? pkg.name : null;
    if (name === null) limitations.push("Cargo.toml's [package] has no valid name, so whether Cargo.lock is its lock was not checked.");
    else if (!isMember(name)) limitations.push(`Cargo.lock lists no workspace member named ${show(name)} (Cargo.toml's package), so it may be another project's lock or out of date.`);
  }
  // Every crate the manifest declares is in its lock (optional, dev, build and target ones too); one that is not means a stale lock.
  if (lock.members !== null) {
    const locked = new Set(lock.names.map(crateKey)), declared = declaredCrates(doc);
    const missing = declared.names.filter(n => !locked.has(crateKey(n)));
    if (missing.length) limitations.push(`Cargo.lock does not list ${missing.length === 1 ? "1 crate" : `${missing.length} crates`} that Cargo.toml declares, so it may be out of date and ${missing.length === 1 ? "that crate was" : "they were"} not checked ${named(missing.map(show))}`);
    if (declared.unread) limitations.push(`Cargo.toml has ${declared.unread === 1 ? "1 dependency entry" : `${declared.unread} dependency entries`} Ludion could not read, so ${declared.unread === 1 ? "it was" : "they were"} not compared with Cargo.lock.`);
  }
  // A workspace's members must be the lock's members. Only literal member paths are read (no pattern is expanded), for
  // the package name in their own Cargo.toml; anything else is one limitation.
  if (workspace && lock.members !== null) {
    const { dirs, unchecked } = literalMembers(workspace.members, workspace.exclude);
    const missing: string[] = [];
    let unreadable = unchecked;
    for (const dir of dirs) {
      const text = readMember(`${dir}/Cargo.toml`), member = text === null ? null : cargoToml(text, "member Cargo.toml");
      const name = member && typeof member !== "string" && isTable(member.package) && typeof member.package.name === "string" && ANY_NAME.test(member.package.name) ? member.package.name : null;
      if (name === null) unreadable = true; else if (!isMember(name)) missing.push(name);
    }
    if (missing.length === 1) limitations.push(`Cargo.lock lists no workspace member named ${show(missing[0]!)} (a member of Cargo.toml's [workspace]), so it may be another project's lock or out of date.`);
    else if (missing.length) limitations.push(`Cargo.lock lists none of these members of Cargo.toml's [workspace], so it may be another project's lock or out of date ${named(missing.map(show))}`);
    if (unreadable) limitations.push("Cargo.toml's workspace members given by pattern or exclude, more than 1,000 of them, or ones whose Cargo.toml could not be read were not checked against Cargo.lock.");
  }
  return limitations;
}

const present = (root: string, name: string) => lstatSync(join(root, name), { throwIfNoEntry: false }) !== undefined;

/** The Rust inventory of one directory: Cargo.lock if present, else a Cargo.toml whose versions are not locked. Null when neither exists. */
export function readRust(root: string): ReadOnlyInventory | null {
  if (present(root, "Cargo.lock")) {
    const { packages, limitations, members, names } = cargoLock(textFile(root, "Cargo.lock"));
    if (!present(root, "Cargo.toml")) return { ecosystem: "crates.io", files: ["Cargo.lock"], scope: RUST_SCOPE, packages, limitations };
    // Workspace member manifests are read for their package names only (regular files inside the project, 4 MiB cap).
    const read = (path: string) => { try { return textFile(root, path); } catch { return null; } };
    limitations.push(...cargoManifestLimitations(textFile(root, "Cargo.toml"), { members, names }, read));
    return { ecosystem: "crates.io", files: ["Cargo.lock", "Cargo.toml"], scope: RUST_SCOPE, packages, limitations };
  }
  if (!present(root, "Cargo.toml")) return null;
  textFile(root, "Cargo.toml");
  return { ecosystem: "crates.io", files: ["Cargo.toml"], scope: RUST_SCOPE, packages: [], limitations: ["Cargo.toml has no Cargo.lock beside it, so its dependency versions are not locked and were not checked (a workspace member's Cargo.lock is at the workspace root)."] };
}
