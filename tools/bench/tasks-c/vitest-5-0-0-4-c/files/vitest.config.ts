import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  test: {
    // Adds the toBeCents matcher used across packages.
    setupFiles: [fileURLToPath(new URL("./test/setup.ts", import.meta.url))],
  },
});
