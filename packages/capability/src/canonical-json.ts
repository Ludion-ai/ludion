/** Minimal canonical JSON for capability ids.
 *  Object keys are sorted by UTF-16 code unit order. Strings and keys are encoded as-is.
 *  Non-well-formed UTF-16 strings and keys throw. Numbers must be finite safe integers.
 *  Undefined-valued object keys are omitted. Arrays keep order. No whitespace.
 */

function assertWellFormed(s: string, kind: "string" | "key"): void {
  if (!s.isWellFormed()) throw new Error(`canonical JSON ${kind} is not well-formed UTF-16`);
}

function encode(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("canonical JSON numbers must be finite safe integers");
    }
    return String(value);
  }
  if (typeof value === "string") {
    assertWellFormed(value, "string");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) throw new Error("canonical JSON arrays cannot contain holes");
      parts.push(encode(value[i]));
    }
    return `[${parts.join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries: [string, unknown][] = [];
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      if (child === undefined) continue;
      assertWellFormed(key, "key");
      entries.push([key, child]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v)}`).join(",")}}`;
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return encode(value);
}
