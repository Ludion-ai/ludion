import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Starts the test database and seeds it. Needs Docker and takes about 20 seconds.
    setupFiles: ["./test/setup-db.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
        },
      },
      {
        // No `extends: true`, so the root setupFiles (test database) are not inherited.
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
    ],
  },
});
