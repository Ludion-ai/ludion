// Generates capability.schema.json and receipt.schema.json from the zod source.
// Run: npm run gen:capability-schema. A unit test fails if a committed file is stale.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CapabilityRecord, Receipt } from "../src/schema.ts";

export function capabilitySchemaJson(): string {
  return `${JSON.stringify(z.toJSONSchema(CapabilityRecord), null, 2)}\n`;
}

export function receiptSchemaJson(): string {
  return `${JSON.stringify(z.toJSONSchema(Receipt), null, 2)}\n`;
}

if (import.meta.main) {
  const dir = fileURLToPath(new URL("..", import.meta.url));
  writeFileSync(join(dir, "capability.schema.json"), capabilitySchemaJson());
  writeFileSync(join(dir, "receipt.schema.json"), receiptSchemaJson());
  console.log(`Wrote ${join(dir, "capability.schema.json")} and receipt.schema.json`);
}
