import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";

/** Exact supported UTF-8 bytes, with BOM retained. Reject changes, links, pipes and excessive input. */
export function boundedText(path: string, maxBytes = 8 * 1024 * 1024): string {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Artifact/context must be a regular file.");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) throw new Error("Artifact/context is too large or not a regular file.");
    const bytes = Buffer.alloc(st.size + 1);
    let used = 0;
    for (;;) {
      const n = readSync(fd, bytes, used, bytes.length - used, null);
      if (!n) break;
      used += n;
      if (used === bytes.length) throw new Error("Artifact/context changed during reading.");
    }
    if (used !== st.size) throw new Error("Artifact/context changed during reading.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, used));
  } finally { closeSync(fd); }
}
