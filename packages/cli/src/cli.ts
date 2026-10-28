#!/usr/bin/env node
// ludion: security updates (source preview). Security commands use official PHP metadata, OSV and controlled
// package retrieval; tests run only in Docker.
import { securityCli } from "./security/cli.ts";
import { judgeCli } from "./security/judge-cli.ts";

const HELP = `ludion: security updates for PHP Docker, npm, Composer and Maven (source preview).

  ludion init [--dir <path>] [--ecosystem php|npm|composer|maven]
      Create ludion.security.json. Set your application's real test command.
  ludion scan [--dir <path>] [--ecosystem php|npm|composer|maven|python|go|rust] [--json]
      Detect supported inventories and look up PHP releases / OSV advisories.
      python, go and rust are read-only: known advisories are reported; nothing is planned or applied.
      Exit 1: attention needed; 2: error. An empty result is not a security guarantee.
  ludion patch [--dir <path>] [--apply] [--json]
      Download official images, build and test old/new versions offline, and save a receipt.
      --apply updates only source dependency files after validation. Production is not deployed.
  ludion watch [--dir <path>] [--apply] [--interval <seconds>] [--json]
      Repeat patch checks in the foreground (default 900 seconds). Ctrl+C cancels pending apply;
      a Docker step already in progress may finish before exit.
  ludion judge --before <dir> --after <dir> --files <changed,files> [--json]
      Judge an npm dependency update between two checkouts (preview, comments only): provenance,
      publisher, install scripts, malicious-package records, deprecation, new dependencies and the
      wait. Build and tests are not run. Exit 0: ready except build; 3: wait; 1: stop or undecidable
      (also when a lookup fails or --files is missing); 2: the inputs could not be read.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command && ["init", "scan", "patch", "watch"].includes(command)) return securityCli(command, rest);
  if (command === "judge") return judgeCli(rest);
  if (command === "sync" || command === "teach") {
    console.error(`ludion ${command} ended on 2026-10-28 with the lesson data it used. Ludion is now a security-update tool; run ludion help.`);
    return 2;
  }
  console.log(HELP);
  return command === undefined || command === "help" || command === "--help" ? 0 : 2;
}

// exitCode, never process.exit(): exiting while fetch's sockets are still closing trips a libuv assertion on
// Windows (exit code 9 after a successful run).
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: Error) => {
    console.error(`ludion: ${err.message}`);
    process.exitCode = 2;
  },
);
