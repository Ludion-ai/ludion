#!/usr/bin/env node
// ludion: judges npm dependency updates (preview, comments only). It reads lockfiles and registry metadata as data
// and never runs a dependency's code.
import { judgeCli } from "./security/judge-cli.ts";

const HELP = `ludion: a judge for npm dependency updates (preview, comments only).

  ludion judge --before <dir> --after <dir> --files <changed,files> [--json]
      Judge an npm dependency update between two checkouts of a project: provenance, publisher,
      install scripts, malicious-package records, deprecation, new dependencies and the wait.
      Every changed version counts as production. Build and tests are not run, and no file is changed.
      Exit 0: ready except build; 3: wait; 1: stop or undecidable
      (also when a lookup fails or --files is missing); 2: the inputs could not be read.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "judge") return judgeCli(rest);
  if (command === "sync" || command === "teach") {
    console.error(`ludion ${command} ended on 2026-10-28 with the lesson data it used. Ludion now judges npm dependency updates; run ludion help.`);
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
