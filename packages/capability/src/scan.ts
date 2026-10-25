/** Structural JS/TS scan for the P1 guard. Not a full parser.
 *  Allowlist: anything the tokenizer does not model is an error, and an error is never applicable.
 *  Code may contain only ASCII identifiers, numbers, strings, templates, comments, the listed
 *  punctuation, and the whitespace characters space, tab, LF, CR, VT and FF. A leading U+FEFF is
 *  skipped and a leading `#!` line is a comment. U+2028/U+2029 outside a string or block comment,
 *  `#` not followed by an identifier, `-->`, `<!--`, unbalanced `()`, `[]` or `{}`, and any other character are errors.
 *  Comments and string or template text are removed. `${...}` expressions stay.
 *  Brace ids follow source `{` `}` pairs, so an object literal is its own block.
 *  `already_fixed` compares those ids (innermost pair).
 *  A backslash in code, `with (`, or bare `eval` is an error. A `/` or `/=` that
 *  is not clearly division is an error: regexp literals are not supported.
 *  A use of a name other than the receiver of `name.a.b(` is unmodeled.
 *  An ASI `const`/`let`/`var` still declares its names and marks them unmodeled.
 */

export type CallSite = { recv: string; members: string[]; line: number; braceId: number; tok: number };
export type Binding = { local: string; via: "import" | "alias"; kind: "named" | "namespace"; imported: string; module: string };
export type Shadow = { name: string; from: number; to: number };

export type Analysis = {
  error?: string;
  calls: CallSite[];
  bindings: Binding[];
  shadows: Shadow[];
  /** Uses the scanner cannot bind. `tok` -1 is a hoisted `var`, a global-object access, or an ASI declaration. */
  unmodeled: Array<{ name: string; tok: number }>;
  /** `require(...)` and `import(...)` module names. Null when the argument is not a single string literal. */
  dynamicLoads?: Array<string | null>;
};

type Token = { k: "ident" | "num" | "str" | "punct"; s: string; line: number };

/** Whitespace the tokenizer models. NBSP, U+FEFF (after offset 0), U+2028 and U+2029 are not in it. */
const CODE_SPACE = new Set([" ", "\t", "\n", "\r", "\v", "\f"]);
/** Single-character punctuation the tokenizer models. Anything else in code is an error. */
const SINGLE_PUNCT = new Set(["{", "}", "(", ")", "[", "]", ";", ",", ".", "<", ">", "+", "-", "*", "%", "&", "|", "^", "!", "~", "?", ":", "=", "@", "#"]);
const OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Identifiers that are not a division left-hand side. A following `/` is refused. */
const SLASH_KEYWORD = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "finally", "for", "function",
  "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "of", "package",
  "private", "protected", "public", "return", "static", "super", "switch", "this", "throw",
  "try", "typeof", "var", "void", "while", "with", "yield",
]);
const MULTI_PUNCT = [">>>=", ">>=", "<<=", "===", "!==", "...", ">>>", "&&=", "||=", "??=", "=>", "?.", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "**", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];

function slashIsDivision(tokens: readonly Token[]): boolean {
  const prev = tokens[tokens.length - 1];
  if (!prev) return false;
  if (prev.k === "num" || prev.k === "str") return true;
  if (prev.s === "]") return true;
  return prev.k === "ident" && !SLASH_KEYWORD.has(prev.s);
}

type TokResult = { tokens: Token[]; error?: string };

function tokenize(src: string): TokResult {
  const tokens: Token[] = [];
  const modeStack: Array<"code" | "sq" | "dq" | "tmpl" | "line" | "block"> = ["code"];
  const interpBrace: number[] = [];
  let i = 0;
  let line = 1;
  let brace = 0;
  /** Open `(`, `[`, `{` and template `${` (as `{`), innermost last. */
  const nest: string[] = [];
  let buf = "";
  let bufLine = 1;

  const mode = () => modeStack[modeStack.length - 1] ?? "code";
  const fail = (error: string): TokResult => ({ tokens, error });
  const bumpLine = (index: number, count: number) => {
    for (let k = 0; k < count; k++) {
      const c = src[index + k];
      const n = src[index + k + 1];
      if (c === "\n" || (c === "\r" && n !== "\n")) line++;
    }
  };
  const take = (count: number) => {
    bumpLine(i, count);
    i += count;
  };
  const push = (tok: Token) => tokens.push(tok);

  if (src.startsWith("\uFEFF")) i = 1;
  // A hashbang is only valid at the very start of the file. It is a line comment.
  if (src.startsWith("#!", i)) {
    modeStack.push("line");
    take(2);
  }

  while (i < src.length) {
    const c = src[i] ?? "";
    const next = src[i + 1];
    const m = mode();

    if (m === "line") {
      // JS ends a `//` comment at U+2028/U+2029. The scanner does not model that line break.
      if (c === "\u2028" || c === "\u2029") return fail("line separator in comment");
      take(1);
      if (c === "\n" || (c === "\r" && next !== "\n")) modeStack.pop();
      continue;
    }
    if (m === "block") {
      if (c === "*" && next === "/") {
        take(2);
        modeStack.pop();
        continue;
      }
      if (i === src.length - 1) return fail("unclosed comment");
      take(1);
      continue;
    }
    if (m === "sq" || m === "dq") {
      const q = m === "sq" ? "'" : '"';
      if (c === "\\") {
        if (next === undefined) return fail("unclosed string");
        if (next === "n") buf += "\n";
        else if (next === "r") buf += "\r";
        else if (next === "t") buf += "\t";
        else if (next === "\n") buf += "";
        else if (next === "\r") {
          buf += "";
          take(src[i + 2] === "\n" ? 3 : 2);
          continue;
        } else buf += next;
        take(2);
        continue;
      }
      if (c === "\n" || c === "\r") return fail("unclosed string");
      if (c === q) {
        modeStack.pop();
        push({ k: "str", s: buf, line: bufLine });
        buf = "";
        take(1);
        continue;
      }
      buf += c;
      take(1);
      continue;
    }
    if (m === "tmpl") {
      if (c === "\\") {
        if (next === undefined) return fail("unclosed template");
        take(next === "\r" && src[i + 2] === "\n" ? 3 : 2);
        continue;
      }
      if (c === "`") {
        modeStack.pop();
        take(1);
        continue;
      }
      if (c === "$" && next === "{") {
        take(2);
        brace++;
        nest.push("{");
        interpBrace.push(brace);
        modeStack.push("code");
        continue;
      }
      take(1);
      continue;
    }

    // `\u0076i` is still the identifier `vi`. A backslash in code cannot be modeled.
    if (c === "\\") return fail("backslash in code");

    if (CODE_SPACE.has(c)) {
      take(1);
      continue;
    }
    // NBSP, U+FEFF, U+2028, U+2029 and other non-ASCII characters in code are not modeled.
    if ((c.codePointAt(0) ?? 0) > 127) return fail("unsupported character in code");
    // HTML-like comments (`<!--`, and `-->` at a line start in scripts) are not modeled.
    if (src.startsWith("-->", i) || src.startsWith("<!--", i)) return fail("html-like comment");
    if (c === "/" && next === "/") {
      modeStack.push("line");
      take(2);
      continue;
    }
    if (c === "/" && next === "*") {
      modeStack.push("block");
      take(2);
      continue;
    }
    if (c === "'" || c === '"') {
      modeStack.push(c === "'" ? "sq" : "dq");
      buf = "";
      bufLine = line;
      take(1);
      continue;
    }
    if (c === "`") {
      modeStack.push("tmpl");
      take(1);
      continue;
    }
    // `//` and `/*` are comments. Any other `/` or `/=` is division only when the
    // previous token cannot start a regexp. Regex literals are not supported.
    if (c === "/") {
      const op = next === "=" ? "/=" : "/";
      if (!slashIsDivision(tokens)) return fail("regexp or ambiguous slash");
      push({ k: "punct", s: op, line });
      take(op.length);
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      const startLine = line;
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j] ?? "")) j++;
      const s = src.slice(start, j);
      push({ k: "ident", s, line: startLine });
      take(j - start);
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(next ?? ""))) {
      const start = i;
      const startLine = line;
      let j = i;
      if (src[j] === "0" && /[xXoObB]/.test(src[j + 1] ?? "")) j += 2;
      while (j < src.length && /[0-9a-fA-F_]/.test(src[j] ?? "")) j++;
      if (src[j] === ".") {
        j++;
        while (j < src.length && /[0-9_]/.test(src[j] ?? "")) j++;
      }
      if (/[eE]/.test(src[j] ?? "")) {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < src.length && /[0-9_]/.test(src[j] ?? "")) j++;
      }
      if (src[j] === "n") j++;
      const s = src.slice(start, j);
      push({ k: "num", s, line: startLine });
      take(j - start);
      continue;
    }

    if (!SINGLE_PUNCT.has(c)) return fail("unsupported character in code");
    // `#` is modeled only as a private name (`#x`). A `#!` after the first line is not a hashbang.
    if (c === "#" && !/[A-Za-z_$]/.test(next ?? "")) return fail("unsupported character in code");
    let punct = c;
    let plen = 1;
    for (const candidate of MULTI_PUNCT) {
      if (src.startsWith(candidate, i)) {
        punct = candidate;
        plen = candidate.length;
        break;
      }
    }
    if (punct === "(" || punct === "[" || punct === "{") nest.push(punct);
    if (punct === ")" || punct === "]" || punct === "}") {
      if (nest.pop() !== OPENER[punct]) return fail("unbalanced brackets");
    }
    if (punct === "{") brace++;
    if (punct === "}") {
      if (brace <= 0) return fail("unbalanced braces");
      if (interpBrace.length > 0 && brace === interpBrace[interpBrace.length - 1]) {
        brace--;
        interpBrace.pop();
        modeStack.pop();
        take(plen);
        continue;
      }
      brace--;
    }
    push({ k: "punct", s: punct, line });
    take(plen);
  }

  if (mode() === "block") return fail("unclosed comment");
  if (mode() === "sq" || mode() === "dq") return fail("unclosed string");
  if (mode() === "tmpl" || interpBrace.length > 0 || modeStack.length !== 1) return fail("unclosed template");
  if (brace !== 0) return fail("unbalanced braces");
  if (nest.length !== 0) return fail("unbalanced brackets");
  return { tokens };
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function longer(members: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && members.length > prefix.length && prefix.every((part, index) => members[index] === part);
}

type ChainShape = "exact" | "longer" | "no";

function chainShape(
  kind: Binding["kind"],
  imported: string,
  members: readonly string[],
  target: { export: string; member: readonly string[] },
): ChainShape {
  const path = kind === "namespace" ? members.slice(1) : members;
  if (kind === "namespace" && members[0] !== target.export) return "no";
  if (kind === "named" && imported !== target.export) return "no";
  if (same(path, target.member)) return "exact";
  if (longer(path, target.member)) return "longer";
  return "no";
}

export function resolveTarget(
  analysis: Analysis,
  target: { module: string; export: string; member: readonly string[] },
): { matches: Array<{ line: number; via: "import" | "alias"; braceId: number }>; unresolved: boolean } {
  const matches: Array<{ line: number; via: "import" | "alias"; braceId: number }> = [];
  let unresolved = false;
  if (analysis.error) return { matches, unresolved };
  // Allowlist: the only accepted binding is one top-level `import { <export> } from "<module>"`,
  // with no alias, no namespace import of the module, no other binding or declaration of that
  // name anywhere in the file, and no `require`/`import()` of the module (or a computed one).
  const mod = target.module;
  if ((analysis.dynamicLoads ?? []).some((m) => m === null || m === mod || m.startsWith(`${mod}/`))) unresolved = true;
  for (const b of analysis.bindings) {
    if (b.module !== mod) continue;
    if (b.kind === "namespace") unresolved = true;
    if (b.imported === target.export && b.via === "alias") unresolved = true;
  }
  if (analysis.bindings.filter((b) => b.local === target.export).length > 1) unresolved = true;
  if (analysis.shadows.some((s) => s.name === target.export)) unresolved = true;
  for (const access of analysis.unmodeled) {
    // tok -1 is hoisted `var` or `globalThis.vi`. The declaration's own shadow must not hide it.
    const covered = access.tok >= 0 && analysis.shadows.some((s) => s.name === access.name && access.tok >= s.from && access.tok < s.to);
    if (covered) continue;
    const live = analysis.bindings.some((b) => {
      if (b.local !== access.name || b.module !== target.module) return false;
      if (b.kind === "namespace") return true;
      return b.imported === target.export;
    });
    // A same-named receiver we cannot model is unresolved even without a live import.
    if (live || access.name === target.export) unresolved = true;
  }
  for (const call of analysis.calls) {
    const covered = analysis.shadows.some((s) => s.name === call.recv && call.tok >= s.from && call.tok < s.to);
    const live = analysis.bindings.filter((b) => b.local === call.recv && b.module === target.module && !covered);
    let matched = false;
    for (const b of live) {
      const shape = chainShape(b.kind, b.imported, call.members, target);
      // `vi.restoreAllMocks.apply(` starts with the target and is longer. It is not a match.
      if (shape === "longer") unresolved = true;
      if (shape !== "exact") continue;
      matches.push({ line: call.line, via: b.kind === "namespace" ? "import" : b.via, braceId: call.braceId });
      matched = true;
      break;
    }
    if (matched) continue;
    const exportExact = call.recv === target.export && same(call.members, target.member);
    const exportLonger = call.recv === target.export && longer(call.members, target.member);
    const shadowed = covered && analysis.bindings.some((b) => {
      if (b.local !== call.recv || b.module !== target.module) return false;
      return chainShape(b.kind, b.imported, call.members, target) === "exact";
    });
    const shadowedLonger = covered && analysis.bindings.some((b) => {
      if (b.local !== call.recv || b.module !== target.module) return false;
      return chainShape(b.kind, b.imported, call.members, target) === "longer";
    });
    if (exportExact || exportLonger || shadowed || shadowedLonger) unresolved = true;
  }
  return { matches, unresolved };
}

type Pattern = { names: string[]; at: number[]; next: number };

function readPattern(tokens: Token[], i: number): Pattern {
  const t = tokens[i];
  if (!t) return { names: [], at: [], next: i };
  if (t.k === "ident") return { names: [t.s], at: [i], next: i + 1 };
  if (t.s === "{") return readObjectPattern(tokens, i);
  if (t.s === "[") return readArrayPattern(tokens, i);
  return { names: [], at: [], next: i };
}

function readObjectPattern(tokens: Token[], i: number): Pattern {
  const names: string[] = [];
  const at: number[] = [];
  let j = i + 1;
  while (j < tokens.length && tokens[j]?.s !== "}") {
    const t = tokens[j];
    if (!t || t.s === ",") {
      j++;
      continue;
    }
    if (t.s === "...") {
      j++;
      if (tokens[j]?.k === "ident") {
        names.push(tokens[j]!.s);
        at.push(j);
        j++;
      }
      continue;
    }
    if (t.k === "ident" || t.k === "str") {
      const keyAt = j;
      j++;
      if (tokens[j]?.s === ":") {
        j++;
        const inner = readPattern(tokens, j);
        names.push(...inner.names);
        at.push(...inner.at);
        j = inner.next;
      } else if (t.k === "ident") {
        names.push(t.s);
        at.push(keyAt);
      }
      if (tokens[j]?.s === "=") j = skipExpr(tokens, j + 1);
      continue;
    }
    j++;
  }
  if (tokens[j]?.s === "}") j++;
  return { names, at, next: j };
}

function readArrayPattern(tokens: Token[], i: number): Pattern {
  const names: string[] = [];
  const at: number[] = [];
  let j = i + 1;
  while (j < tokens.length && tokens[j]?.s !== "]") {
    const t = tokens[j];
    if (!t || t.s === ",") {
      j++;
      continue;
    }
    if (t.s === "...") j++;
    const inner = readPattern(tokens, j);
    if (inner.next === j) {
      j++;
      continue;
    }
    names.push(...inner.names);
    at.push(...inner.at);
    j = inner.next;
    if (tokens[j]?.s === "=") j = skipExpr(tokens, j + 1);
  }
  if (tokens[j]?.s === "]") j++;
  return { names, at, next: j };
}

function skipExpr(tokens: Token[], i: number): number {
  let b = 0;
  let p = 0;
  let a = 0;
  let guard = 0;
  while (i < tokens.length && guard++ < tokens.length + 2) {
    const s = tokens[i]?.s;
    if (b === 0 && p === 0 && a === 0 && (s === "," || s === ";" || s === ")" || s === "]" || s === "}")) return i;
    if (s === "{") b++;
    else if (s === "}") b--;
    else if (s === "(") p++;
    else if (s === ")") p--;
    else if (s === "[") a++;
    else if (s === "]") a--;
    i++;
  }
  return i;
}

/**
 * `skipExpr` for every start index in one pass. Valid only when `()`, `[]`, `{}` are balanced and
 * properly nested, which `tokenize` guarantees. Keeps arrow chains (`x=>x=>...`) linear.
 */
function exprEnds(tokens: Token[]): Int32Array {
  const n = tokens.length;
  const match = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = tokens[i]?.s;
    if (s === "(" || s === "[" || s === "{") stack.push(i);
    else if (s === ")" || s === "]" || s === "}") {
      const open = stack.pop();
      if (open !== undefined) match[open] = i;
    }
  }
  const end = new Int32Array(n + 1);
  end[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    const s = tokens[i]?.s;
    if (s === "," || s === ";" || s === ")" || s === "]" || s === "}") end[i] = i;
    else if ((s === "(" || s === "[" || s === "{") && match[i]! >= 0) end[i] = end[match[i]! + 1]!;
    else if (s === "(" || s === "[" || s === "{") end[i] = n;
    else end[i] = end[i + 1]!;
  }
  return end;
}

function skipType(tokens: Token[], i: number): number {
  let b = 0;
  let p = 0;
  let a = 0;
  let ang = 0;
  let guard = 0;
  while (i < tokens.length && guard++ < tokens.length + 2) {
    const s = tokens[i]?.s;
    if (b === 0 && p === 0 && a === 0 && ang === 0 && (s === "=" || s === "," || s === ";" || s === ")" || s === "}")) return i;
    if (s === "<") ang++;
    else if (s === ">") ang = Math.max(0, ang - 1);
    else if (s === "{") b++;
    else if (s === "}") b--;
    else if (s === "(") p++;
    else if (s === ")") p--;
    else if (s === "[") a++;
    else if (s === "]") a--;
    i++;
  }
  return i;
}

function finishPattern(tokens: Token[], i: number): number {
  if (tokens[i]?.s === ":") return skipType(tokens, i + 1);
  return i;
}

function readParams(tokens: Token[], parenIndex: number): { names: string[]; at: number[]; after: number } {
  const names: string[] = [];
  const at: number[] = [];
  let i = parenIndex + 1;
  let depth = 1;
  let expect = true;
  let guard = 0;
  while (i < tokens.length && depth > 0 && guard++ < tokens.length + 2) {
    const t = tokens[i];
    if (!t) break;
    if (t.s === "(") {
      depth++;
      i++;
      continue;
    }
    if (t.s === ")") {
      depth--;
      if (depth === 0) break;
      i++;
      continue;
    }
    if (depth !== 1) {
      i++;
      continue;
    }
    if (t.s === ",") {
      expect = true;
      i++;
      continue;
    }
    if (t.s === "...") {
      i++;
      continue;
    }
    if (t.s === ":" || t.s === "=") {
      expect = false;
      i = skipType(tokens, i + 1);
      continue;
    }
    if (expect && (t.s === "{" || t.s === "[")) {
      const pat = readPattern(tokens, i);
      names.push(...pat.names);
      at.push(...pat.at);
      i = pat.next;
      expect = false;
      continue;
    }
    if (expect && t.k === "ident") {
      names.push(t.s);
      at.push(i);
      expect = false;
      i++;
      continue;
    }
    i++;
  }
  return { names, at, after: Math.min(tokens.length, i + 1) };
}

function paramsBeforeArrow(tokens: Token[], arrow: number): { names: string[]; at: number[] } {
  const prev = tokens[arrow - 1];
  if (!prev) return { names: [], at: [] };
  if (prev.k === "ident") {
    if (prev.s === "async") return { names: [], at: [] };
    return { names: [prev.s], at: [arrow - 1] };
  }
  if (prev.s !== ")") return { names: [], at: [] };
  let p = 0;
  for (let j = arrow - 1; j >= 0; j--) {
    const s = tokens[j]?.s;
    if (s === ")") p++;
    else if (s === "(") {
      p--;
      if (p === 0) {
        const params = readParams(tokens, j);
        return { names: params.names, at: params.at };
      }
    }
  }
  return { names: [], at: [] };
}

function statementStart(tokens: Token[], i: number): boolean {
  if (i === 0) return true;
  const p = tokens[i - 1];
  if (!p) return true;
  if (p.s === ";" || p.s === "{" || p.s === "}") return true;
  return p.k === "ident" && (p.s === "export" || p.s === "declare");
}

function isForHead(tokens: Token[], constIndex: number): boolean {
  const prev = tokens[constIndex - 1];
  if (prev?.s !== "(") return false;
  const before = tokens[constIndex - 2];
  if (before?.s === "for") return true;
  return before?.s === "await" && tokens[constIndex - 3]?.s === "for";
}

function collectCalls(tokens: Token[], i: number, braceId: number, calls: CallSite[]) {
  const t = tokens[i];
  // `V.vi.restoreAllMocks(` is one call. The `vi` after `.` is not a second receiver.
  // A longer chain (`vi.restoreAllMocks.apply(`) is kept whole so resolveTarget can reject it.
  if (t?.k !== "ident" || tokens[i - 1]?.s === ".") return;
  const members: string[] = [];
  let j = i + 1;
  while (tokens[j]?.s === "." && tokens[j + 1]?.k === "ident") {
    members.push(tokens[j + 1]!.s);
    j += 2;
  }
  if (members.length === 0 || tokens[j]?.s !== "(") return;
  calls.push({ recv: t.s, members, line: t.line, braceId, tok: i });
}

/** Static `import` declarations at the top level only (brace depth 0). */
function bindingsFrom(tokens: Token[], bound: Set<number>): Binding[] {
  const bindings: Binding[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.s === "{") depth++;
    else if (tokens[i]?.s === "}") depth--;
    if (tokens[i]?.s !== "import" || depth !== 0) continue;
    const next = tokens[i + 1];
    if (!next || next.s === "(" || next.s === ".") continue;
    let j = i + 1;
    let typeOnly = false;
    if (tokens[j]?.s === "type") {
      const after = tokens[j + 1];
      if (after && (after.s === "{" || after.s === "*" || after.k === "ident")) {
        typeOnly = true;
        j++;
      }
    }
    let namespace: string | null = null;
    let defaultName: string | null = null;
    const named: Array<{ imported: string; local: string; alias: boolean; typeOnly: boolean }> = [];
    const readNamed = () => {
      if (tokens[j]?.s !== "{") return;
      j++;
      while (j < tokens.length && tokens[j]?.s !== "}") {
        if (tokens[j]?.s === ",") {
          j++;
          continue;
        }
        let specType = false;
        if (tokens[j]?.s === "type" && tokens[j + 1]?.k === "ident") {
          specType = true;
          j++;
        }
        const importedTok = tokens[j];
        if (importedTok?.k !== "ident") {
          j++;
          continue;
        }
        const importedAt = j;
        j++;
        let local = importedTok.s;
        let alias = false;
        let localAt = importedAt;
        if (tokens[j]?.s === "as" && tokens[j + 1]?.k === "ident") {
          alias = true;
          local = tokens[j + 1]!.s;
          localAt = j + 1;
          j += 2;
        }
        bound.add(importedAt);
        bound.add(localAt);
        named.push({ imported: importedTok.s, local, alias, typeOnly: specType });
      }
      if (tokens[j]?.s === "}") j++;
    };
    if (tokens[j]?.s === "*") {
      j++;
      if (tokens[j]?.s !== "as" || tokens[j + 1]?.k !== "ident") continue;
      namespace = tokens[j + 1]!.s;
      bound.add(j + 1);
      j += 2;
    } else if (tokens[j]?.s === "{") readNamed();
    else if (tokens[j]?.k === "ident") {
      defaultName = tokens[j]!.s;
      bound.add(j);
      j++;
      if (tokens[j]?.s === ",") {
        j++;
        if (tokens[j]?.s === "*") {
          j++;
          if (tokens[j]?.s === "as" && tokens[j + 1]?.k === "ident") {
            namespace = tokens[j + 1]!.s;
            bound.add(j + 1);
            j += 2;
          }
        } else readNamed();
      }
    } else if (tokens[j]?.k === "str") continue;
    else continue;
    if (tokens[j]?.s !== "from" || tokens[j + 1]?.k !== "str") continue;
    const moduleName = tokens[j + 1]!.s;
    if (typeOnly) continue;
    if (namespace) bindings.push({ local: namespace, via: "import", kind: "namespace", imported: "*", module: moduleName });
    if (defaultName) bindings.push({ local: defaultName, via: "import", kind: "named", imported: "default", module: moduleName });
    for (const n of named) {
      if (n.typeOnly) continue;
      bindings.push({ local: n.local, via: n.alias ? "alias" : "import", kind: "named", imported: n.imported, module: moduleName });
    }
  }
  return bindings;
}

const OBJECT_PRED = new Set([
  "=", "(", "[", ",", "return", "throw", "yield", "await", "new", "void", "typeof", "delete", "default",
  "&&", "||", "??", "?", "!", "~", "&", "|", "^",
  "+", "-", "*", "/", "%", "**",
  "==", "===", "!=", "!==", "<", ">", "<=", ">=",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "in", "of", "instanceof", "...",
]);

function isClassBodyOpen(tokens: Token[], i: number): boolean {
  const prev = tokens[i - 1];
  if (!prev) return false;
  if (prev.s === "class") return true;
  if (prev.k !== "ident") return false;
  if (tokens[i - 2]?.s === "class" || tokens[i - 2]?.s === "extends") return true;
  let j = i - 1;
  while (j >= 1 && tokens[j - 1]?.s === "." && tokens[j]?.k === "ident") j -= 2;
  return tokens[j]?.k === "ident" && tokens[j - 1]?.s === "extends";
}

function colonIsTernary(tokens: Token[], colon: number): boolean {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let k = colon - 1; k >= 0; k--) {
    const s = tokens[k]?.s;
    if (s === ")") paren++;
    else if (s === "(") {
      if (paren === 0) return false;
      paren--;
    } else if (s === "]") bracket++;
    else if (s === "[") {
      if (bracket === 0) return false;
      bracket--;
    } else if (s === "}") brace++;
    else if (s === "{") {
      if (brace === 0) return false;
      brace--;
    } else if (paren === 0 && bracket === 0 && brace === 0 && s === "?") return true;
    else if (paren === 0 && bracket === 0 && brace === 0 && (s === ";" || s === "=>")) return false;
  }
  return false;
}

function classifyBrace(tokens: Token[], i: number, kindStack: readonly string[]): "block" | "object" | "class" {
  if (isClassBodyOpen(tokens, i)) return "class";
  const prev = tokens[i - 1];
  if (!prev) return "block";
  if (prev.s === "=>" || prev.s === "else" || prev.s === "do" || prev.s === "try" || prev.s === "finally") return "block";
  if (prev.s === ")") return "block";
  if (prev.s === ":") {
    if (kindStack[kindStack.length - 1] === "object") return "object";
    return colonIsTernary(tokens, i - 1) ? "object" : "block";
  }
  if (prev.s === "{") return kindStack[kindStack.length - 1] === "object" ? "object" : "block";
  if (OBJECT_PRED.has(prev.s)) return "object";
  return "block";
}

function skipBracket(tokens: Token[], i: number): number {
  let depth = 0;
  let guard = 0;
  while (i < tokens.length && guard++ < tokens.length + 2) {
    const s = tokens[i]?.s;
    if (s === "[") depth++;
    else if (s === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function isPropName(t: Token | undefined): boolean {
  if (!t) return false;
  return t.k === "ident" || t.k === "str" || t.k === "num";
}

function modifierContinues(t: Token | undefined): boolean {
  if (!t) return false;
  return t.s === "*" || t.s === "[" || t.s === "get" || t.s === "set" || isPropName(t);
}

/** Method `name(params) {` at an object or class member. `resume` is the body `{`. */
function methodParamsAt(tokens: Token[], i: number): { names: string[]; at: number[]; nameAt: number; resume: number } | null {
  let j = i;
  const leading = new Set(["static", "public", "private", "protected", "readonly", "override", "abstract", "declare", "async"]);
  while (j < tokens.length) {
    const cur = tokens[j];
    if (!cur || !leading.has(cur.s) || !modifierContinues(tokens[j + 1]) || tokens[j + 1]?.s === "(") break;
    j++;
  }
  if (tokens[j]?.s === "*" && modifierContinues(tokens[j + 1])) j++;
  if ((tokens[j]?.s === "get" || tokens[j]?.s === "set") && isPropName(tokens[j + 1])) j++;
  let nameAt = -1;
  if (tokens[j]?.s === "[") j = skipBracket(tokens, j);
  else if (isPropName(tokens[j])) {
    nameAt = j;
    j++;
  } else return null;
  if (tokens[j]?.s === "<") j = skipAngles(tokens, j);
  if (tokens[j]?.s !== "(") return null;
  const params = readParams(tokens, j);
  let k = params.after;
  if (tokens[k]?.s === ":") k = skipType(tokens, k + 1);
  if (tokens[k]?.s !== "{") return null;
  return { names: params.names, at: params.at, nameAt, resume: k };
}

const GLOBAL_OBJECTS = new Set(["globalThis", "global", "window", "self"]);

function isMemberCallReceiver(tokens: Token[], i: number): boolean {
  let j = i + 1;
  if (tokens[j]?.s !== ".") return false;
  while (tokens[j]?.s === "." && tokens[j + 1]?.k === "ident") j += 2;
  return tokens[j]?.s === "(";
}

function noteGlobalAccess(tokens: Token[], i: number, unmodeled: Array<{ name: string; tok: number }>): void {
  const op = tokens[i + 1]?.s;
  if (op === "." || op === "?.") {
    const prop = tokens[i + 2];
    if (prop?.k === "ident") unmodeled.push({ name: prop.s, tok: -1 });
    if (op === "?." && prop?.s === "[" && tokens[i + 3]?.k === "str") unmodeled.push({ name: tokens[i + 3]!.s, tok: -1 });
    return;
  }
  if (op === "[" && tokens[i + 2]?.k === "str") unmodeled.push({ name: tokens[i + 2]!.s, tok: -1 });
}

/** Value uses, `eval`, and `with (`. Import specifiers and declaration names are not uses. */
function collectRisks(
  tokens: Token[],
  bound: ReadonlySet<number>,
  methodNames: ReadonlySet<number>,
): { error?: string; unmodeled: Array<{ name: string; tok: number }> } {
  const unmodeled: Array<{ name: string; tok: number }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t?.k !== "ident") continue;
    const prev = tokens[i - 1]?.s;
    const afterDot = prev === "." || prev === "?.";
    if (!afterDot && t.s === "eval") return { error: "eval", unmodeled };
    // `obj = { with(x) {} }` is a method. `with (x)` in a block is the statement.
    if (!afterDot && t.s === "with" && tokens[i + 1]?.s === "(" && !methodNames.has(i)) return { error: "with", unmodeled };
    if (!afterDot && GLOBAL_OBJECTS.has(t.s)) noteGlobalAccess(tokens, i, unmodeled);
    if (afterDot || bound.has(i) || isMemberCallReceiver(tokens, i)) continue;
    unmodeled.push({ name: t.s, tok: i });
  }
  return { unmodeled };
}

/** Every `require` use and every `import(` call. A non-literal or computed argument is null. */
function dynamicLoadsFrom(tokens: Token[]): Array<string | null> {
  const loads: Array<string | null> = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t?.k !== "ident") continue;
    const prev = tokens[i - 1]?.s;
    if (prev === "." || prev === "?.") continue;
    const isRequire = t.s === "require" && tokens[i + 1]?.s !== ":";
    const isImportCall = t.s === "import" && tokens[i + 1]?.s === "(";
    if (!isRequire && !isImportCall) continue;
    const arg = tokens[i + 2];
    const close = tokens[i + 3]?.s;
    if (tokens[i + 1]?.s === "(" && arg?.k === "str" && (close === ")" || (isImportCall && close === ","))) loads.push(arg.s);
    else loads.push(null);
  }
  return loads;
}

export function analyze(source: string): Analysis {
  const toked = tokenize(source);
  if (toked.error) return { error: toked.error, calls: [], bindings: [], shadows: [], unmodeled: [] };
  const tokens = toked.tokens;
  const ends = exprEnds(tokens);
  const calls: CallSite[] = [];
  const shadows: Shadow[] = [];
  const hoisted: Array<{ name: string; tok: number }> = [];
  const asiUnmodeled: Array<{ name: string; tok: number }> = [];
  const bound = new Set<number>();
  const methodNames = new Set<number>();
  const open: Array<{ name: string; from: number; depth: number }> = [];
  const frameStarts = [0];
  const braceStack = [0];
  const kindStack: Array<"block" | "object" | "class"> = ["block"];
  let nextBrace = 1;
  let depth = 0;
  let paren = 0;
  let bracket = 0;
  let pendingParams: string[] | null = null;
  let pendingLoop: string[] | null = null;
  let decl: { depth: number; paren: number; bracket: number } | null = null;
  let openVar = false;
  let openAsi = false;

  const remember = (indexes: readonly number[]) => {
    for (const index of indexes) bound.add(index);
  };
  // `var` is function-hoisted. A shadow that starts at the keyword would hide the use before it.
  const noteVar = (names: readonly string[]) => {
    for (const name of names) hoisted.push({ name, tok: -1 });
  };

  const declare = (name: string, from: number, at = depth) => open.push({ name, from, depth: at });
  const closeDeeperThan = (d: number, to: number) => {
    for (let n = open.length - 1; n >= 0; n--) {
      const item = open[n];
      if (item && item.depth > d) {
        shadows.push({ name: item.name, from: item.from, to });
        open.splice(n, 1);
      }
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) break;
    if (t.s === "{") {
      depth++;
      const id = nextBrace++;
      braceStack.push(id);
      kindStack.push(classifyBrace(tokens, i, kindStack));
      frameStarts.push(i);
      const params = pendingParams ?? pendingLoop;
      pendingParams = null;
      pendingLoop = null;
      if (params) for (const name of params) declare(name, i, depth);
      continue;
    }
    if (t.s === "}") {
      if (depth > 0) depth--;
      closeDeeperThan(depth, i);
      braceStack.pop();
      frameStarts.pop();
      if (kindStack.length > 1) kindStack.pop();
      if (decl && depth < decl.depth) {
        decl = null;
        openVar = false;
        openAsi = false;
      }
      continue;
    }
    if (t.s === "(") {
      paren++;
      continue;
    }
    if (t.s === ")") {
      if (paren > 0) paren--;
      continue;
    }
    if (t.s === "[") {
      bracket++;
      continue;
    }
    if (t.s === "]") {
      if (bracket > 0) bracket--;
      continue;
    }
    if (t.s === ";" && decl) {
      decl = null;
      openVar = false;
      openAsi = false;
    }
    if (t.s === "=>") {
      const params = paramsBeforeArrow(tokens, i);
      remember(params.at);
      if (tokens[i + 1]?.s === "{") pendingParams = params.names;
      else {
        const end = ends[i + 1] ?? tokens.length;
        for (const name of params.names) shadows.push({ name, from: i, to: end });
      }
    }
    if ((t.s === "const" || t.s === "let" || t.s === "var") && isForHead(tokens, i)) {
      const pat = readPattern(tokens, i + 1);
      remember(pat.at);
      if (t.s === "var") noteVar(pat.names);
      let j = finishPattern(tokens, pat.next);
      let p = 0;
      while (j < tokens.length) {
        const s = tokens[j]?.s;
        if (s === "(") p++;
        else if (s === ")") {
          if (p === 0) {
            j++;
            break;
          }
          p--;
        }
        j++;
      }
      if (tokens[j]?.s === "{") pendingLoop = pat.names;
      else {
        const end = ends[Math.min(j, tokens.length)] ?? tokens.length;
        for (const name of pat.names) shadows.push({ name, from: i, to: end });
      }
      i = Math.max(i, j - 1);
      continue;
    }
    const declWord = t.s === "const" || t.s === "let" || t.s === "var";
    const afterDot = tokens[i - 1]?.s === "." || tokens[i - 1]?.s === "?.";
    const objectKey = tokens[i + 1]?.s === ":";
    // For-heads are handled above. A declaration whose previous token is not a
    // statement boundary still binds its names, but the newline is ASI: the names
    // stay unmodeled so a bound name or the target export is binding_unresolved.
    const declToken = declWord && !afterDot && !objectKey;
    const continueDecl = decl !== null && decl.depth === depth && decl.paren === paren && decl.bracket === bracket && t.s === ",";
    if ((declToken && tokens[i + 1]) || continueDecl) {
      const pat = readPattern(tokens, i + 1);
      remember(pat.at);
      if (declToken) {
        openVar = t.s === "var";
        openAsi = !statementStart(tokens, i);
      }
      if (openVar) noteVar(pat.names);
      if (openAsi) {
        for (const name of pat.names) asiUnmodeled.push({ name, tok: -1 });
      }
      for (const name of pat.names) declare(name, i);
      i = Math.max(i, finishPattern(tokens, pat.next) - 1);
      decl = { depth, paren, bracket };
      continue;
    }
    if (t.s === "catch" && tokens[i + 1]?.s === "(") {
      const params = readParams(tokens, i + 1);
      remember(params.at);
      pendingParams = params.names;
      i = params.after - 1;
      continue;
    }
    const kindHere = kindStack[kindStack.length - 1];
    const prev = tokens[i - 1];
    const atMember = prev === undefined || prev.s === "{" || prev.s === "," || prev.s === ";" || prev.s === "}";
    const methodStart = t.k === "ident" || t.k === "str" || t.k === "num" || t.s === "*" || t.s === "[";
    if (atMember && (kindHere === "object" || kindHere === "class") && methodStart) {
      const method = methodParamsAt(tokens, i);
      if (method) {
        remember(method.at);
        if (method.nameAt >= 0) methodNames.add(method.nameAt);
        pendingParams = method.names;
        i = method.resume - 1;
        continue;
      }
    }
    if (t.s === "function") {
      let j = i + 1;
      if (tokens[j]?.s === "*") j++;
      if (tokens[j]?.k === "ident" && (tokens[j + 1]?.s === "(" || tokens[j + 1]?.s === "<")) {
        declare(tokens[j]!.s, frameStarts[frameStarts.length - 1] ?? 0);
        bound.add(j);
        j++;
      }
      if (tokens[j]?.s === "<") {
        let ang = 0;
        while (j < tokens.length) {
          if (tokens[j]?.s === "<") ang++;
          else if (tokens[j]?.s === ">") {
            ang--;
            if (ang === 0) {
              j++;
              break;
            }
          }
          j++;
        }
      }
      if (tokens[j]?.s === "(") {
        const params = readParams(tokens, j);
        remember(params.at);
        pendingParams = params.names;
        i = Math.max(i, params.after - 1);
      }
      continue;
    }
    if (t.s === "class" && tokens[i + 1]?.k === "ident") {
      declare(tokens[i + 1]!.s, i);
      bound.add(i + 1);
    }
    collectCalls(tokens, i, braceStack[braceStack.length - 1] ?? 0, calls);
  }
  closeDeeperThan(-1, tokens.length);
  const bindings = bindingsFrom(tokens, bound);
  const risks = collectRisks(tokens, bound, methodNames);
  if (risks.error) return { error: risks.error, calls: [], bindings: [], shadows: [], unmodeled: [] };
  return { calls, bindings, shadows, unmodeled: [...hoisted, ...asiUnmodeled, ...risks.unmodeled], dynamicLoads: dynamicLoadsFrom(tokens) };
}

type Val =
  | { t: "lit"; v: string | number | boolean | null }
  | { t: "obj"; props: Array<{ key: string; value: Val }>; hasSpread: boolean; ambiguous: boolean }
  | { t: "expr" };

export type ConfigRead =
  | { kind: "absent" }
  | { kind: "not-static" }
  | { kind: "parse_failed"; detail: string }
  | { kind: "value"; value: string | number | boolean | null };

/** A property value. A literal counts only when the next token ends the property (`,` or `}`). */
function parseValue(tokens: Token[], i: number): { val: Val; next: number } {
  const read = parseValueRaw(tokens, i);
  if (read.val.t === "lit" && tokens[read.next]?.s !== "," && tokens[read.next]?.s !== "}") {
    return { val: { t: "expr" }, next: skipExpr(tokens, read.next) };
  }
  return read;
}

function parseValueRaw(tokens: Token[], i: number): { val: Val; next: number } {
  const t = tokens[i];
  if (!t) return { val: { t: "expr" }, next: i };
  if (t.s === "{") return parseObject(tokens, i);
  if (t.k === "str") return { val: { t: "lit", v: t.s }, next: i + 1 };
  if (t.k === "num") return { val: { t: "lit", v: Number(t.s.replaceAll("_", "")) }, next: i + 1 };
  if (t.s === "-" && tokens[i + 1]?.k === "num") {
    return { val: { t: "lit", v: -Number(tokens[i + 1]!.s.replaceAll("_", "")) }, next: i + 2 };
  }
  if (t.s === "true") return { val: { t: "lit", v: true }, next: i + 1 };
  if (t.s === "false") return { val: { t: "lit", v: false }, next: i + 1 };
  if (t.s === "null") return { val: { t: "lit", v: null }, next: i + 1 };
  return { val: { t: "expr" }, next: skipExpr(tokens, i) };
}

function parseObject(tokens: Token[], i: number): { val: Val; next: number } {
  const props: Array<{ key: string; value: Val }> = [];
  let hasSpread = false;
  let ambiguous = false;
  let j = i + 1;
  let guard = 0;
  while (j < tokens.length && tokens[j]?.s !== "}" && guard++ < tokens.length + 2) {
    const t = tokens[j];
    if (!t || t.s === ",") {
      j++;
      continue;
    }
    if (t.s === "...") {
      hasSpread = true;
      j = skipExpr(tokens, j + 1);
      continue;
    }
    if (t.s === "[") {
      // Computed keys are not a static object. A string literal key can still be overwritten at runtime.
      ambiguous = true;
      j = skipBracket(tokens, j);
      if (tokens[j]?.s === ":") j = parseValue(tokens, j + 1).next;
      continue;
    }
    if (t.k !== "ident" && t.k !== "str" && t.k !== "num") {
      j++;
      continue;
    }
    if ((t.s === "get" || t.s === "set") && tokens[j + 1]?.k === "ident") {
      ambiguous = true;
      j += 2;
      if (tokens[j]?.s === "(") j = skipExpr(tokens, j);
      if (tokens[j]?.s === "{") j = skipExpr(tokens, j);
      continue;
    }
    const key = t.s;
    j++;
    if (tokens[j]?.s === "(") {
      ambiguous = true;
      j = skipExpr(tokens, j);
      if (tokens[j]?.s === "{") j = skipExpr(tokens, j);
      continue;
    }
    if (props.some((p) => p.key === key)) ambiguous = true;
    if (tokens[j]?.s === ":") {
      const v = parseValue(tokens, j + 1);
      props.push({ key, value: v.val });
      j = v.next;
      continue;
    }
    props.push({ key, value: { t: "expr" } });
  }
  if (tokens[j]?.s === "}") j++;
  return { val: { t: "obj", props, hasSpread, ambiguous }, next: j };
}

function lookup(obj: Val, path: string[]): "absent" | "not-static" | string | number | boolean | null {
  if (obj.t !== "obj") return "not-static";
  if (obj.hasSpread || obj.ambiguous) return "not-static";
  const [head, ...rest] = path;
  if (head === undefined) return "not-static";
  const prop = obj.props.find((p) => p.key === head);
  if (!prop) return "absent";
  if (rest.length === 0) return prop.value.t === "lit" ? prop.value.v : "not-static";
  if (prop.value.t !== "obj") return "not-static";
  return lookup(prop.value, rest);
}

/** Keys that make the effective config depend on other files or entries. */
const MULTI_CONFIG_KEYS = new Set(["projects", "workspace"]);

function hasMultiConfigKey(val: Val): boolean {
  if (val.t !== "obj") return false;
  return val.props.some((p) => MULTI_CONFIG_KEYS.has(p.key) || hasMultiConfigKey(p.value));
}

function skipAngles(tokens: Token[], i: number): number {
  if (tokens[i]?.s !== "<") return i;
  let d = 0;
  while (i < tokens.length) {
    if (tokens[i]?.s === "<") d++;
    else if (tokens[i]?.s === ">") {
      d--;
      if (d === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function declaresDefineConfig(tokens: Token[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) break;
    if (t.s === "function" && (tokens[i + 1]?.s === "defineConfig" || (tokens[i + 1]?.s === "*" && tokens[i + 2]?.s === "defineConfig"))) return true;
    if (t.s === "class" && tokens[i + 1]?.s === "defineConfig") return true;
    if (t.s !== "const" && t.s !== "let" && t.s !== "var") continue;
    if (tokens[i - 1]?.s === "." || tokens[i - 1]?.s === "?.") continue;
    if (tokens[i + 1]?.s === ":") continue;
    if (readPattern(tokens, i + 1).names.includes("defineConfig")) return true;
  }
  return false;
}

/** `defineConfig(` is vitest/vite's helper only for this exact unaliased import. */
function isTrustedDefineConfig(tokens: Token[]): boolean {
  const locals = bindingsFrom(tokens, new Set()).filter((b) => b.local === "defineConfig");
  const binding = locals.length === 1 ? locals[0] : undefined;
  if (!binding || binding.via !== "import" || binding.kind !== "named" || binding.imported !== "defineConfig") return false;
  if (binding.module !== "vitest/config" && binding.module !== "vite") return false;
  return !declaresDefineConfig(tokens);
}

/**
 * Allowlist: the only readable config is one `export default defineConfig({ ... })` where
 * `defineConfig` is the unaliased top-level import from "vitest/config" or "vite", used nowhere
 * else, with a static object argument and no `projects`/`workspace` key. Every other shape
 * (another export form, a wrapper, a callback, `mergeConfig`, `module.exports`) is not-static.
 */
export function readConfigKey(source: string, key: string): ConfigRead {
  const toked = tokenize(source);
  if (toked.error) return { kind: "parse_failed", detail: toked.error };
  const tokens = toked.tokens;
  const path = key.split(".").filter((s) => s.length > 0);
  if (!isTrustedDefineConfig(tokens)) return { kind: "not-static" };
  let defaults = 0;
  let defineUses = 0;
  let root: Val | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) break;
    if (t.k === "ident" && t.s === "mergeConfig" && tokens[i + 1]?.s === "(") return { kind: "not-static" };
    if (t.k === "ident" && t.s === "module" && tokens[i + 1]?.s === "." && tokens[i + 2]?.s === "exports") return { kind: "not-static" };
    const prev = tokens[i - 1]?.s;
    if (t.k === "ident" && t.s === "defineConfig" && prev !== "." && prev !== "?.") defineUses++;
    if (t.k === "ident" && t.s === "export" && tokens[i + 1]?.s === "default") {
      defaults++;
      const shaped = tokens[i + 2]?.s === "defineConfig" && tokens[i + 3]?.s === "(" && tokens[i + 4]?.s === "{";
      if (!shaped) return { kind: "not-static" };
      const obj = parseObject(tokens, i + 4);
      if (tokens[obj.next]?.s !== ")") return { kind: "not-static" };
      root = obj.val;
    }
  }
  // One use in the import specifier and one in the default export call. Any other use
  // (a reassignment, a second call, passing it as a value) is not modeled.
  if (defaults !== 1 || defineUses !== 2 || !root) return { kind: "not-static" };
  if (hasMultiConfigKey(root)) return { kind: "not-static" };
  const found = lookup(root, path);
  if (found === "not-static") return { kind: "not-static" };
  if (found === "absent") return { kind: "absent" };
  return { kind: "value", value: found };
}
