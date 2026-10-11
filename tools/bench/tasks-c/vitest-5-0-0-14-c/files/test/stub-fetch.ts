import { readFile } from "node:fs/promises";
import { vi } from "vitest";

// https://api.frankfurter.dev/v1/latest?base=USD -> test/fixtures/latest.json
vi.stubGlobal("fetch", async (input: string | URL) => {
  const url = new URL(String(input));
  const name = url.pathname.split("/").pop();
  const body = await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
  return new Response(body, { headers: { "content-type": "application/json" } });
});
