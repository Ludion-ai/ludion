// Runner-owned vitest config. The runner always passes this file with --config and --root.
// It imports nothing, so nothing is resolved from the recipient tree.
// No setupFiles, no globalSetup, no plugins, no projects, and no workspace.
// A recipient vitest.config, vite.config, or vitest workspace is therefore not loaded.
export default {
  test: {
    allowOnly: false,
    passWithNoTests: false,
  },
};
