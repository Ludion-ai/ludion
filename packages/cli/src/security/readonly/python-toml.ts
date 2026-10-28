// A small, strict TOML reader for Python lock files (uv.lock, poetry.lock) and the manifests read next to them
// (pyproject.toml, Pipfile). It reads tables, arrays of tables, dotted keys, strings, integers, simple floats,
// booleans, arrays and inline tables, with TOML's rules on duplicate keys and redefined tables. Anything else
// (dates, hex or special numbers, unknown escapes, a malformed line) throws with the file and line: a value it
// cannot read is never skipped, because a skipped line could hide a package's name, version or source.

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export type TomlTable = { [key: string]: TomlValue };

export function isTable(value: unknown): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseToml(text: string, file: string): TomlTable {
  return new Reader(text, file).document();
}

const BARE_KEY = /[A-Za-z0-9_-]+/y;
const TOKEN = /[0-9A-Za-z_+.:-]+/y;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?\d)*)$/;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?|[eE][+-]?\d(?:_?\d)*)$/;
const PLAIN_BASIC = /[^"\\\x00-\x08\x0a-\x1f\x7f]+/y;
const PLAIN_LITERAL = /[^'\x00-\x08\x0a-\x1f\x7f]+/y;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

class Reader {
  private at = 0;
  private readonly root: TomlTable = Object.create(null);
  /** Tables a [header] has defined: a second [header] for one of them is an error. */
  private readonly defined = new WeakSet<object>();
  /** Tables created by dotted keys: a [header] may add sub-tables to them but not reopen them. */
  private readonly dotted = new WeakSet<object>();
  /** Inline tables and static arrays: complete once written. */
  private readonly frozen = new WeakSet<object>();
  /** Arrays created by [[header]]: the only arrays a header may append to. */
  private readonly tableArrays = new WeakSet<object>();

  private readonly text: string;
  private readonly file: string;

  constructor(text: string, file: string) {
    this.text = text;
    this.file = file;
    if (text.startsWith("﻿")) this.at = 1;
  }

  private fail(message: string): never {
    const line = this.text.slice(0, this.at).split("\n").length;
    throw new Error(`${this.file} line ${line}: ${message}; the file was not read.`);
  }
  private table(): TomlTable { return Object.create(null) as TomlTable; }
  private peek(): string | undefined { return this.text[this.at]; }

  document(): TomlTable {
    let current = this.root;
    for (;;) {
      this.blank();
      if (this.at >= this.text.length) return this.root;
      if (this.peek() === "[") current = this.header();
      else this.keyValue(current);
      this.endOfLine();
    }
  }

  /** Spaces, tabs, newlines and comments. */
  private blank(): void {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n") this.at++;
      else if (c === "\r" && this.text[this.at + 1] === "\n") this.at += 2;
      else if (c === "#") this.comment();
      else return;
    }
  }
  private spaces(): void { while (this.peek() === " " || this.peek() === "\t") this.at++; }
  private comment(): void {
    while (this.at < this.text.length && this.peek() !== "\n") {
      if (this.peek() === "\r" && this.text[this.at + 1] === "\n") return;
      if (CONTROL.test(this.peek()!) || this.peek() === "\r") this.fail("control character in a comment");
      this.at++;
    }
  }
  private endOfLine(): void {
    this.spaces();
    if (this.peek() === "#") this.comment();
    if (this.at >= this.text.length || this.peek() === "\n") return;
    if (this.peek() === "\r" && this.text[this.at + 1] === "\n") return;
    this.fail("expected the end of the line");
  }

  private key(): string {
    const c = this.peek();
    if (c === '"') { if (this.text.startsWith('"""', this.at)) this.fail("a key cannot be a multi-line string"); return this.basic(); }
    if (c === "'") { if (this.text.startsWith("'''", this.at)) this.fail("a key cannot be a multi-line string"); return this.literal(); }
    BARE_KEY.lastIndex = this.at;
    const match = BARE_KEY.exec(this.text);
    if (!match) this.fail("expected a key");
    this.at += match[0].length;
    return match[0];
  }
  private keyPath(): string[] {
    const path = [this.key()];
    for (;;) {
      this.spaces();
      if (this.peek() !== ".") return path;
      this.at++;
      this.spaces();
      path.push(this.key());
    }
  }

  private header(): TomlTable {
    const many = this.text.startsWith("[[", this.at);
    this.at += many ? 2 : 1;
    this.spaces();
    const path = this.keyPath();
    this.spaces();
    if (!this.text.startsWith(many ? "]]" : "]", this.at)) this.fail("unclosed table header");
    this.at += many ? 2 : 1;
    const name = path.join(".");
    let table = this.root;
    for (const key of path.slice(0, -1)) table = this.descend(table, key, name);
    const last = path.at(-1)!;
    const existing = table[last];
    if (many) {
      if (existing !== undefined && !(Array.isArray(existing) && this.tableArrays.has(existing))) this.fail(`[[${name}]] redefines a value that is not an array of tables`);
      const list = (existing ?? []) as TomlValue[];
      if (existing === undefined) { this.tableArrays.add(list); table[last] = list; }
      const created = this.table();
      this.defined.add(created);
      list.push(created);
      return created;
    }
    if (existing === undefined) {
      const created = this.table();
      this.defined.add(created);
      table[last] = created;
      return created;
    }
    if (!isTable(existing) || this.frozen.has(existing) || this.defined.has(existing) || this.dotted.has(existing)) this.fail(`table [${name}] is defined more than once`);
    this.defined.add(existing);
    return existing;
  }
  /** One step of a header path: into a table (created if missing) or into the last table of an array of tables. */
  private descend(table: TomlTable, key: string, name: string): TomlTable {
    const existing = table[key];
    if (existing === undefined) { const created = this.table(); table[key] = created; return created; }
    if (Array.isArray(existing) && this.tableArrays.has(existing)) return existing.at(-1) as TomlTable;
    if (!isTable(existing) || this.frozen.has(existing)) this.fail(`[${name}] extends a value that is not a table`);
    return existing;
  }

  private keyValue(table: TomlTable): void {
    const path = this.keyPath();
    this.spaces();
    if (this.peek() !== "=") this.fail("expected = after a key");
    this.at++;
    this.spaces();
    this.assign(table, path, this.value(0));
  }
  private assign(table: TomlTable, path: string[], value: TomlValue): void {
    for (const key of path.slice(0, -1)) {
      const existing = table[key];
      if (existing === undefined) { const created = this.table(); this.dotted.add(created); table[key] = created; table = created; }
      else if (isTable(existing) && this.dotted.has(existing) && !this.frozen.has(existing)) table = existing;
      else this.fail(`${path.join(".")} extends a value that is already defined`);
    }
    const last = path.at(-1)!;
    if (table[last] !== undefined) this.fail(`duplicate key ${JSON.stringify(path.join("."))}`);
    table[last] = value;
  }

  private value(depth: number): TomlValue {
    if (depth > 32) this.fail("values nest more than 32 levels deep");
    const c = this.peek();
    if (c === '"') return this.text.startsWith('"""', this.at) ? this.multiline('"') : this.basic();
    if (c === "'") return this.text.startsWith("'''", this.at) ? this.multiline("'") : this.literal();
    if (c === "[") return this.array(depth);
    if (c === "{") return this.inline(depth);
    TOKEN.lastIndex = this.at;
    const token = TOKEN.exec(this.text)?.[0];
    if (!token) this.fail("expected a value");
    let value: TomlValue;
    if (token === "true" || token === "false") value = token === "true";
    else if (INTEGER.test(token) || FLOAT.test(token)) value = Number(token.replace(/_/g, ""));
    else this.fail(`unsupported value ${JSON.stringify(token.slice(0, 40))} (dates, special and non-decimal numbers are not read)`);
    this.at += token.length;
    return value;
  }

  private basic(): string {
    this.at++;
    let out = "";
    for (;;) {
      PLAIN_BASIC.lastIndex = this.at;
      const run = PLAIN_BASIC.exec(this.text);
      if (run) { out += run[0]; this.at += run[0].length; }
      const c = this.peek();
      if (c === '"') { this.at++; return out; }
      if (c === "\\") { out += this.escape(); continue; }
      if (c === undefined || c === "\n" || c === "\r") this.fail("unterminated string");
      this.fail("control character in a string");
    }
  }
  private literal(): string {
    this.at++;
    PLAIN_LITERAL.lastIndex = this.at;
    const run = PLAIN_LITERAL.exec(this.text)?.[0] ?? "";
    this.at += run.length;
    if (this.peek() !== "'") this.fail(this.peek() === undefined || this.peek() === "\n" || this.peek() === "\r" ? "unterminated string" : "control character in a string");
    this.at++;
    return run;
  }
  private multiline(quote: '"' | "'"): string {
    this.at += 3;
    if (this.peek() === "\n") this.at++;
    else if (this.peek() === "\r" && this.text[this.at + 1] === "\n") this.at += 2;
    let out = "";
    for (;;) {
      const c = this.peek();
      if (c === undefined) this.fail("unterminated multi-line string");
      if (c === quote && this.text.startsWith(quote.repeat(3), this.at)) {
        let run = 3;
        while (this.text[this.at + run] === quote) run++;
        if (run > 5) this.fail("too many quotes closing a multi-line string");
        this.at += run;
        return out + quote.repeat(run - 3);
      }
      if (c === "\\" && quote === '"') {
        // A backslash at the end of a line trims the newline and the whitespace after it.
        let ahead = this.at + 1;
        while (this.text[ahead] === " " || this.text[ahead] === "\t") ahead++;
        if (this.text[ahead] === "\n" || (this.text[ahead] === "\r" && this.text[ahead + 1] === "\n")) {
          this.at = ahead;
          while (/[ \t\r\n]/.test(this.peek() ?? "")) {
            if (this.peek() === "\r" && this.text[this.at + 1] !== "\n") this.fail("lone carriage return");
            this.at++;
          }
          continue;
        }
        out += this.escape();
        continue;
      }
      if (c === "\r") { if (this.text[this.at + 1] !== "\n") this.fail("lone carriage return"); out += "\r\n"; this.at += 2; continue; }
      if (c !== "\n" && CONTROL.test(c)) this.fail("control character in a string");
      out += c;
      this.at++;
    }
  }
  private escape(): string {
    const c = this.text[this.at + 1];
    const simple = c === "b" ? "\b" : c === "t" ? "\t" : c === "n" ? "\n" : c === "f" ? "\f" : c === "r" ? "\r" : c === "e" ? "\x1b" : c === '"' ? '"' : c === "\\" ? "\\" : undefined;
    if (simple !== undefined) { this.at += 2; return simple; }
    if (c === "u" || c === "U") {
      const size = c === "u" ? 4 : 8, hex = this.text.slice(this.at + 2, this.at + 2 + size);
      const point = /^[0-9A-Fa-f]+$/.test(hex) && hex.length === size ? parseInt(hex, 16) : -1;
      if (point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) this.fail("invalid unicode escape");
      this.at += 2 + size;
      return String.fromCodePoint(point);
    }
    this.fail("unknown escape in a string");
  }

  private array(depth: number): TomlValue[] {
    this.at++;
    const list: TomlValue[] = [];
    for (;;) {
      this.blank();
      if (this.peek() === "]") { this.at++; break; }
      list.push(this.value(depth + 1));
      this.blank();
      if (this.peek() === ",") { this.at++; continue; }
      if (this.peek() === "]") { this.at++; break; }
      this.fail("expected , or ] in an array");
    }
    this.frozen.add(list);
    return list;
  }
  /** Inline tables, also spanning lines with a trailing comma (TOML 1.1). They are complete once closed. */
  private inline(depth: number): TomlTable {
    this.at++;
    const table = this.table();
    for (;;) {
      this.blank();
      if (this.peek() === "}") { this.at++; break; }
      const path = this.keyPath();
      this.spaces();
      if (this.peek() !== "=") this.fail("expected = after a key");
      this.at++;
      this.spaces();
      this.assign(table, path, this.value(depth + 1));
      this.blank();
      if (this.peek() === ",") { this.at++; continue; }
      if (this.peek() === "}") { this.at++; break; }
      this.fail("expected , or } in an inline table");
    }
    this.freeze(table);
    return table;
  }
  private freeze(value: TomlValue): void {
    if (typeof value !== "object" || this.frozen.has(value)) return;
    this.frozen.add(value);
    for (const inner of Array.isArray(value) ? value : Object.values(value)) this.freeze(inner);
  }
}
