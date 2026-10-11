import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Replaces fetch with a stub that serves files from test/fixtures, so tests never touch the network.
    setupFiles: ["./test/stub-fetch.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{js,ts}"],
        },
      },
    ],
  },
});
