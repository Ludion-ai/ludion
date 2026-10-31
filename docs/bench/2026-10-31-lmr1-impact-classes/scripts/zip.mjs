// A minimal reader for OSV's all.zip (Zip64, stored or deflated entries); the image has no unzip.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** Yields [name, text] for every file entry of the zip at path. */
export function* entries(path) {
  const zip = readFileSync(path);
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`${path}: no end of central directory`);
  let count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    if (zip.readUInt32LE(eocd - 20) !== 0x07064b50) throw new Error(`${path}: no Zip64 locator`);
    const z64 = Number(zip.readBigUInt64LE(eocd - 20 + 8));
    if (zip.readUInt32LE(z64) !== 0x06064b50) throw new Error(`${path}: no Zip64 end of central directory`);
    count = Number(zip.readBigUInt64LE(z64 + 32));
    offset = Number(zip.readBigUInt64LE(z64 + 48));
  }
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error(`${path}: bad central directory entry ${i}`);
    const method = zip.readUInt16LE(p + 10);
    let compressed = zip.readUInt32LE(p + 20);
    let size = zip.readUInt32LE(p + 24);
    const nameLength = zip.readUInt16LE(p + 28), extraLength = zip.readUInt16LE(p + 30), commentLength = zip.readUInt16LE(p + 32);
    let local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLength);
    // Zip64 extended information: only the fields whose 32-bit value is 0xFFFFFFFF are present, in this order.
    for (let e = p + 46 + nameLength; e < p + 46 + nameLength + extraLength; ) {
      const id = zip.readUInt16LE(e), length = zip.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let f = e + 4;
        if (size === 0xffffffff) { size = Number(zip.readBigUInt64LE(f)); f += 8; }
        if (compressed === 0xffffffff) { compressed = Number(zip.readBigUInt64LE(f)); f += 8; }
        if (local === 0xffffffff) local = Number(zip.readBigUInt64LE(f));
      }
      e += 4 + length;
    }
    p += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`${path}: bad local header for ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`${path}: ${name} uses compression method ${method}`);
    if (data.length !== size) throw new Error(`${path}: ${name} inflated to ${data.length}, expected ${size}`);
    yield [name, data.toString("utf8")];
  }
}
