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
        // Inline projects inherit the root config by default; opt out so the
        // root setupFiles (database setup) does not run for unit tests.
        extends: false,
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
    ],
  },
});
