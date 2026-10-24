/** Structural JS/TS scan for the P1 guard. Not a full parser.
 *  Comments and string or template text are removed. `${...}` expressions stay.
 *  Brace ids follow source `{` `}` pairs, so an object literal is its own block.
 *  `already_fixed` compares those ids (innermost pair).
 */

export type CallSite = { recv: string; members: string[]; line: number; braceId: number; tok: number };
export type Binding = { local: string; via: "import" | "alias"; kind: "named" | "namespace"; imported: string; module: string };
export type Shadow = { name: string; from: number; to: number };

export type Analysis = {
  error?: string;
  calls: CallSite[];
  bindings: Binding[];
  shadows: Shadow[];
};

type Token = { k: "ident" | "num" | "str" | "punct"; s: string; line: number };

const REGEX_AFTER = new Set(["return", "throw", "case", "typeof", "void", "delete", "in", "of", "yield", "await", "else", "do", "instanceof"]);
const NO_REGEX_PUNCT = new Set([")", "]", "++", "--"]);
const MULTI_PUNCT = [">>>=", ">>=", "<<=", "===", "!==", "...", ">>>", "&&=", "||=", "??=", "=>", "?.", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "**", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];

type TokResult = { tokens: Token[]; error?: string };

function tokenize(src: string): TokResult {
  const tokens: Token[] = [];
  const modeStack: Array<"code" | "sq" | "dq" | "tmpl" | "line" | "block"> = ["code"];
  const interpBrace: number[] = [];
  let i = 0;
  let line = 1;
  let brace = 0;
  let regexAllowed = true;
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

  while (i < src.length) {
    const c = src[i] ?? "";
    const next = src[i + 1];
    const m = mode();

    if (m === "line") {
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
        regexAllowed = false;
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
        regexAllowed = false;
        take(1);
        continue;
      }
      if (c === "$" && next === "{") {
        take(2);
        brace++;
        interpBrace.push(brace);
        modeStack.push("code");
        regexAllowed = true;
        continue;
      }
      take(1);
      continue;
    }

    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      take(1);
      continue;
    }
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
    if (c === "/" && next !== "=" && regexAllowed) {
      const start = i;
      let j = i + 1;
      let cls = false;
      let closed = false;
      while (j < src.length) {
        const rc = src[j];
        if (rc === "\n" || rc === undefined) break;
        if (rc === "\\") {
          j += 2;
          continue;
        }
        if (rc === "[") cls = true;
        else if (rc === "]") cls = false;
        else if (rc === "/" && !cls) {
          closed = true;
          j++;
          while (/[a-zA-Z]/.test(src[j] ?? "")) j++;
          break;
        }
        j++;
      }
      if (!closed) return fail("unclosed regexp");
      push({ k: "punct", s: src.slice(start, j), line });
      take(j - start);
      regexAllowed = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(c) || (c.codePointAt(0) ?? 0) > 127) {
      const start = i;
      const startLine = line;
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j] ?? "")) j++;
      const s = src.slice(start, j);
      push({ k: "ident", s, line: startLine });
      take(j - start);
      regexAllowed = REGEX_AFTER.has(s);
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
      regexAllowed = false;
      continue;
    }

    let punct = c;
    let plen = 1;
    for (const candidate of MULTI_PUNCT) {
      if (src.startsWith(candidate, i)) {
        punct = candidate;
        plen = candidate.length;
        break;
      }
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
    regexAllowed = !NO_REGEX_PUNCT.has(punct);
  }

  if (mode() === "block") return fail("unclosed comment");
  if (mode() === "sq" || mode() === "dq") return fail("unclosed string");
  if (mode() === "tmpl" || interpBrace.length > 0 || modeStack.length !== 1) return fail("unclosed template");
  if (brace !== 0) return fail("unbalanced braces");
  return { tokens };
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function resolveTarget(
  analysis: Analysis,
  target: { module: string; export: string; member: readonly string[] },
): { matches: Array<{ line: number; via: "import" | "alias"; braceId: number }>; unresolved: boolean } {
  const matches: Array<{ line: number; via: "import" | "alias"; braceId: number }> = [];
  let unresolved = false;
  if (analysis.error) return { matches, unresolved };
  for (const call of analysis.calls) {
    const covered = analysis.shadows.some((s) => s.name === call.recv && call.tok >= s.from && call.tok < s.to);
    const live = analysis.bindings.filter((b) => b.local === call.recv && b.module === target.module && !covered);
    let matched = false;
    for (const b of live) {
      const hit = b.kind === "namespace"
        ? call.members[0] === target.export && same(call.members.slice(1), target.member)
        : b.imported === target.export && same(call.members, target.member);
      if (!hit) continue;
      matches.push({ line: call.line, via: b.kind === "namespace" ? "import" : b.via, braceId: call.braceId });
      matched = true;
      break;
    }
    if (matched) continue;
    const exportShape = call.recv === target.export && same(call.members, target.member);
    const shadowedBinding = covered && analysis.bindings.some((b) => {
      if (b.local !== call.recv || b.module !== target.module) return false;
      if (b.kind === "namespace") return call.members[0] === target.export && same(call.members.slice(1), target.member);
      return b.imported === target.export && same(call.members, target.member);
    });
    if (exportShape || shadowedBinding) unresolved = true;
  }
  return { matches, unresolved };
}

function readPattern(tokens: Token[], i: number): { names: string[]; next: number } {
  const t = tokens[i];
  if (!t) return { names: [], next: i };
  if (t.k === "ident") return { names: [t.s], next: i + 1 };
  if (t.s === "{") return readObjectPattern(tokens, i);
  if (t.s === "[") return readArrayPattern(tokens, i);
  return { names: [], next: i };
}

function readObjectPattern(tokens: Token[], i: number): { names: string[]; next: number } {
  const names: string[] = [];
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
        j++;
      }
      continue;
    }
    if (t.k === "ident" || t.k === "str") {
      j++;
      if (tokens[j]?.s === ":") {
        j++;
        const inner = readPattern(tokens, j);
        names.push(...inner.names);
        j = inner.next;
      } else if (t.k === "ident") names.push(t.s);
      if (tokens[j]?.s === "=") j = skipExpr(tokens, j + 1);
      continue;
    }
    j++;
  }
  if (tokens[j]?.s === "}") j++;
  return { names, next: j };
}

function readArrayPattern(tokens: Token[], i: number): { names: string[]; next: number } {
  const names: string[] = [];
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
    j = inner.next;
    if (tokens[j]?.s === "=") j = skipExpr(tokens, j + 1);
  }
  if (tokens[j]?.s === "]") j++;
  return { names, next: j };
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

function readParams(tokens: Token[], parenIndex: number): { names: string[]; after: number } {
  const names: string[] = [];
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
      i = pat.next;
      expect = false;
      continue;
    }
    if (expect && t.k === "ident") {
      names.push(t.s);
      expect = false;
      i++;
      continue;
    }
    i++;
  }
  return { names, after: Math.min(tokens.length, i + 1) };
}

function paramsBeforeArrow(tokens: Token[], arrow: number): string[] {
  const prev = tokens[arrow - 1];
  if (!prev) return [];
  if (prev.k === "ident") return prev.s === "async" ? [] : [prev.s];
  if (prev.s !== ")") return [];
  let p = 0;
  for (let j = arrow - 1; j >= 0; j--) {
    const s = tokens[j]?.s;
    if (s === ")") p++;
    else if (s === "(") {
      p--;
      if (p === 0) return readParams(tokens, j).names;
    }
  }
  return [];
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

function bindingsFrom(tokens: Token[]): Binding[] {
  const bindings: Binding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.s !== "import") continue;
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
        j++;
        let local = importedTok.s;
        let alias = false;
        if (tokens[j]?.s === "as" && tokens[j + 1]?.k === "ident") {
          alias = true;
          local = tokens[j + 1]!.s;
          j += 2;
        }
        named.push({ imported: importedTok.s, local, alias, typeOnly: specType });
      }
      if (tokens[j]?.s === "}") j++;
    };
    if (tokens[j]?.s === "*") {
      j++;
      if (tokens[j]?.s !== "as" || tokens[j + 1]?.k !== "ident") continue;
      namespace = tokens[j + 1]!.s;
      j += 2;
    } else if (tokens[j]?.s === "{") readNamed();
    else if (tokens[j]?.k === "ident") {
      defaultName = tokens[j]!.s;
      j++;
      if (tokens[j]?.s === ",") {
        j++;
        if (tokens[j]?.s === "*") {
          j++;
          if (tokens[j]?.s === "as" && tokens[j + 1]?.k === "ident") {
            namespace = tokens[j + 1]!.s;
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

export function analyze(source: string): Analysis {
  const toked = tokenize(source);
  if (toked.error) return { error: toked.error, calls: [], bindings: [], shadows: [] };
  const tokens = toked.tokens;
  const calls: CallSite[] = [];
  const shadows: Shadow[] = [];
  const open: Array<{ name: string; from: number; depth: number }> = [];
  const frameStarts = [0];
  const braceStack = [0];
  let nextBrace = 1;
  let depth = 0;
  let paren = 0;
  let bracket = 0;
  let pendingParams: string[] | null = null;
  let pendingLoop: string[] | null = null;
  let decl: { depth: number; paren: number; bracket: number } | null = null;

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
      if (decl && depth < decl.depth) decl = null;
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
    if (t.s === ";" && decl) decl = null;
    if (t.s === "=>") {
      const params = paramsBeforeArrow(tokens, i);
      if (tokens[i + 1]?.s === "{") pendingParams = params;
      else {
        const end = skipExpr(tokens, i + 1);
        for (const name of params) shadows.push({ name, from: i, to: end });
      }
    }
    if ((t.s === "const" || t.s === "let" || t.s === "var") && isForHead(tokens, i)) {
      const pat = readPattern(tokens, i + 1);
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
        const end = skipExpr(tokens, j);
        for (const name of pat.names) shadows.push({ name, from: i, to: end });
      }
      i = Math.max(i, j - 1);
      continue;
    }
    const declToken = t.s === "const" || t.s === "let" || t.s === "var";
    const continueDecl = decl !== null && decl.depth === depth && decl.paren === paren && decl.bracket === bracket && t.s === ",";
    if ((declToken && statementStart(tokens, i) && tokens[i + 1] && tokens[i + 1]?.s !== ":") || continueDecl) {
      const pat = readPattern(tokens, declToken ? i + 1 : i + 1);
      for (const name of pat.names) declare(name, i);
      i = Math.max(i, finishPattern(tokens, pat.next) - 1);
      decl = { depth, paren, bracket };
      continue;
    }
    if (t.s === "function") {
      let j = i + 1;
      if (tokens[j]?.s === "*") j++;
      if (tokens[j]?.k === "ident" && (tokens[j + 1]?.s === "(" || tokens[j + 1]?.s === "<")) {
        declare(tokens[j]!.s, frameStarts[frameStarts.length - 1] ?? 0);
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
        pendingParams = params.names;
        i = Math.max(i, params.after - 1);
      }
      continue;
    }
    if (t.s === "class" && tokens[i + 1]?.k === "ident") declare(tokens[i + 1]!.s, i);
    collectCalls(tokens, i, braceStack[braceStack.length - 1] ?? 0, calls);
  }
  closeDeeperThan(-1, tokens.length);
  return { calls, bindings: bindingsFrom(tokens), shadows };
}

type Val =
  | { t: "lit"; v: string | number | boolean | null }
  | { t: "obj"; props: Array<{ key: string; value: Val }>; hasSpread: boolean }
  | { t: "expr" };

export type ConfigRead =
  | { kind: "absent" }
  | { kind: "not-static" }
  | { kind: "parse_failed"; detail: string }
  | { kind: "value"; value: string | number | boolean | null };

function parseValue(tokens: Token[], i: number): { val: Val; next: number } {
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
      j = skipExpr(tokens, j);
      if (tokens[j]?.s === ":") j = parseValue(tokens, j + 1).next;
      continue;
    }
    if (t.k !== "ident" && t.k !== "str" && t.k !== "num") {
      j++;
      continue;
    }
    if ((t.s === "get" || t.s === "set") && tokens[j + 1]?.k === "ident") {
      j += 2;
      if (tokens[j]?.s === "(") j = skipExpr(tokens, j);
      if (tokens[j]?.s === "{") j = skipExpr(tokens, j);
      continue;
    }
    const key = t.s;
    j++;
    if (tokens[j]?.s === "(") {
      j = skipExpr(tokens, j);
      if (tokens[j]?.s === "{") j = skipExpr(tokens, j);
      continue;
    }
    if (tokens[j]?.s === ":") {
      const v = parseValue(tokens, j + 1);
      props.push({ key, value: v.val });
      j = v.next;
      continue;
    }
    props.push({ key, value: { t: "expr" } });
  }
  if (tokens[j]?.s === "}") j++;
  return { val: { t: "obj", props, hasSpread }, next: j };
}

function lookup(obj: Val, path: string[]): "absent" | "not-static" | string | number | boolean | null {
  if (obj.t !== "obj") return "not-static";
  if (obj.hasSpread) return "not-static";
  const [head, ...rest] = path;
  if (head === undefined) return "not-static";
  const prop = obj.props.find((p) => p.key === head);
  if (!prop) return "absent";
  if (rest.length === 0) return prop.value.t === "lit" ? prop.value.v : "not-static";
  if (prop.value.t !== "obj") return prop.value.t === "expr" ? "not-static" : "absent";
  return lookup(prop.value, rest);
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

export function readConfigKey(source: string, key: string): ConfigRead {
  const toked = tokenize(source);
  if (toked.error) return { kind: "parse_failed", detail: toked.error };
  const tokens = toked.tokens;
  const path = key.split(".").filter((s) => s.length > 0);
  let notStatic = false;
  const roots: Val[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) break;
    if (t.k === "ident" && t.s === "mergeConfig" && tokens[i + 1]?.s === "(") notStatic = true;
    if (t.k === "ident" && t.s === "module" && tokens[i + 1]?.s === "." && tokens[i + 2]?.s === "exports") notStatic = true;
    if (t.k === "ident" && t.s === "defineConfig") {
      let j = skipAngles(tokens, i + 1);
      if (tokens[j]?.s === "(") {
        if (tokens[j + 1]?.s === "{") roots.push(parseObject(tokens, j + 1).val);
        else notStatic = true;
      }
    }
    if (t.k === "ident" && t.s === "export" && tokens[i + 1]?.s === "default") {
      const n = tokens[i + 2];
      if (n?.s === "{") roots.push(parseObject(tokens, i + 2).val);
      else if (!(n?.k === "ident" && n.s === "defineConfig")) notStatic = true;
    }
  }
  if (notStatic) return { kind: "not-static" };
  if (roots.length === 0) return { kind: "absent" };
  let saw: string | number | boolean | null | undefined;
  for (const root of roots) {
    const found = lookup(root, path);
    if (found === "not-static") return { kind: "not-static" };
    if (found === "absent") continue;
    if (saw !== undefined && saw !== found) return { kind: "not-static" };
    saw = found;
  }
  if (saw === undefined) return { kind: "absent" };
  return { kind: "value", value: saw };
}
