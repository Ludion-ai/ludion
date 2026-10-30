#!/usr/bin/env node
// ludion: security updates (source preview). Security commands use official PHP metadata, OSV and controlled
// package retrieval; tests run only in Docker.
import { securityCli } from "./security/cli.ts";
import { judgeCli } from "./security/judge-cli.ts";
import { deliverCli } from "./security/deliver.ts";

const HELP = `ludion: security updates for PHP Docker, npm, Composer and Maven (source preview).

  ludion init [--dir <path>] [--ecosystem php|npm|composer|maven]
      Create ludion.security.json. Set your application's real test command.
  ludion scan [--dir <path>] [--ecosystem php|npm|composer|maven|python|go|rust] [--json]
      Detect supported inventories and look up PHP releases / OSV advisories.
      python, go and rust are read-only: known advisories are reported; nothing is planned or applied.
      Exit 1: attention needed; 2: error. An empty result is not a security guarantee.
  ludion patch [--dir <path>] [--apply] [--json]
      Download official images, build and test old/new versions offline, and save a receipt.
      Each fix is validated on its own. An npm fix's candidate also goes through the judge's checks (as in
      ludion judge) after the baseline's tests; a fix that must wait, stops or cannot be judged is not
      tested or applied, and the other fixes go on.
      --apply commits each fix that passes to its own new Git branch; the files and HEAD are not changed.
      Production is not deployed.
  ludion watch [--dir <path>] [--apply] [--interval <seconds>] [--json]
      Repeat patch checks in the foreground (default 900 seconds). Ctrl+C cancels pending apply;
      a Docker step already in progress, or the judge's lookups for an npm candidate (each request up to
      30 seconds, the EPSS list's download up to 120 seconds), may finish before exit.
  ludion judge --before <dir> --after <dir> --files <changed,files> [--json]
      Judge an npm dependency update between two checkouts (preview, comments only): provenance,
      publisher, install scripts, malicious-package records, deprecation, new dependencies and the
      wait. Every changed version counts as production. Build and tests are not run.
      Exit 0: ready except build; 3: wait; 1: stop or undecidable
      (also when a lookup fails or --files is missing); 2: the inputs could not be read.
  ludion deliver pack --dir <path> --result <patch --json output> --out <folder>
  ludion deliver open --dir <path> --artifact <folder> --base <sha> --repo <owner/name> --ref <ref>
                      --api <url> --remote <url> [--json]
      The scheduled workflow's two steps (action.yml, modes patch and pull-request; preview, not
      released). pack writes the receipt and a Git bundle of the applied fixes' branches. open checks
      that artifact as untrusted data, then pushes each fix to its own branch and opens one PR per
      fix, unless a PR from that branch exists (GH_TOKEN). Nothing is merged.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command && ["init", "scan", "patch", "watch"].includes(command)) return securityCli(command, rest);
  if (command === "judge") return judgeCli(rest);
  if (command === "deliver") return deliverCli(rest);
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
