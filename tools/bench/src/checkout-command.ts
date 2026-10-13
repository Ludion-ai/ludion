// A deliberately small script subset. Parse text as argv; never run a shell or honor npm lifecycle hooks.
export function checkoutArgs(command: string): string[] {
  if (typeof command !== "string" || command.length > 2048 || /[\u0000-\u001f\u007f`]|\$[A-Za-z_({]/.test(command)) throw new Error("Unsupported checkout command.");
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && /["\\$]/.test(command[i + 1] ?? "")) token += command[++i];
      else token += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (/\s/.test(c)) { if (token) { tokens.push(token); token = ""; } }
    else if (c === "\\") { if (++i >= command.length) throw new Error("Incomplete command escape."); token += command[i]; }
    else if (/[;&|<>]/.test(c)) throw new Error("Shell operators are unsupported.");
    else token += c;
  }
  if (quote) throw new Error("Unclosed command quote.");
  if (token) tokens.push(token);
  if (tokens[0] !== "vitest" || tokens[1] !== "run") throw new Error("Use one vitest run invocation.");
  let filters = 0;
  let paths = 0;
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "src/cart.test.js") paths++;
    else if (token === "-t" || token === "--testNamePattern") { if (!tokens[++i]) throw new Error("Missing test name filter."); filters++; }
    else if (token.startsWith("--testNamePattern=") && token.length > "--testNamePattern=".length) filters++;
    else throw new Error("Unsupported checkout argument.");
  }
  if (filters !== 1 || paths > 1) throw new Error("Use one test name filter and at most the cart test path.");
  return tokens.slice(1);
}
