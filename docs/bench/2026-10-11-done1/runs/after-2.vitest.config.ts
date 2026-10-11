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
        // Don't inherit the root options, so the database setup file doesn't run.
        extends: false,
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
    ],
  },
});
