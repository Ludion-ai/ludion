// LIMGV's mutations, each one text replaced exactly once in one file (split/join).
// node mutate.mjs list | node mutate.mjs apply <id> <root> (exit 1 when the text is not found exactly once).
import { readFileSync, writeFileSync } from "node:fs";
const P = "packages/cli/src/security/php.ts", N = "packages/cli/src/security/node.ts", D = "packages/cli/src/security/deliver.ts";
const M = {
  // The newest security release again, not the line's newest release (the rule of LPHPV and LNODE's item 5).
  M1: [P, "newest: compare(top.version, current.version) > 0 ? top : null", "newest: releases.find(r => r.security && compare(r.version, current.version) > 0) ?? null"],
  // Case 1.2 removed: move only when a newer security release exists.
  M2: [P, "newest: compare(top.version, current.version) > 0 ? top : null", "newest: releases.some(r => r.security && compare(r.version, current.version) > 0) ? top : null"],
  // No stop when the list has no release as new as the Dockerfile's.
  M3: [P, "if (compare(current.version, top.version) > 0) {", "if (false) {"],
  // R5: php.net's order trusted (parseReleases does not sort).
  M4: [P, "return releases.sort((a, b) => compare(b.version, a.version));", "return releases;"],
  // nodejs.org's order trusted (parseNodeReleases does not sort).
  M5: [N, "return releases.sort((a, b) => compare(b.version, a.version));", "return releases;"],
  // R7: any tag counts as security.
  M6: [P, "security: item.tags.includes(\"security\")", "security: item.tags.length > 0"],
  // R10: string comparison in the security releases' filter.
  M7: [P, "releases.filter(r => r.security && compare(r.version, current.version) > 0)", "releases.filter(r => r.security && r.version > current.version)"],
  // String comparison in the newest-release check.
  M8: [P, "newest: compare(top.version, current.version) > 0 ? top : null", "newest: top.version > current.version ? top : null"],
  // String comparison in the missing-list stop.
  M9: [P, "if (compare(current.version, top.version) > 0) {", "if (current.version > top.version) {"],
  // Node.js alone back to its newest security release.
  M10: [N, "const { fixes, newest } = newestRelease(releases, current, `Node.js ${current.branch}`);", "const { fixes } = newestRelease(releases, current, `Node.js ${current.branch}`), newest = fixes[0] ?? null;"],
  // The commit paragraph always lists security releases.
  M11: [P, "=> releases.length\n  ? `Official", "=> true\n  ? `Official"],
  // The PR job requires a security release again.
  M12: [D, "list(scan.security_releases, 0, 100,", "list(scan.security_releases, 1, 100,"],
  // rebuild_only never set.
  M13: [D, "...(releases.length ? {} : { rebuild_only: true as const }),", "...({}),"],
  // The PR body's opening ignores rebuild_only.
  M14: [D, "    fix.rebuild_only\n      ? `Ludion's", "    false\n      ? `Ludion's"],
  // The PR body's Advisories row ignores rebuild_only.
  M15: [D, ": fix.rebuild_only ? \"none:", ": false ? \"none:"],
};
const [cmd, id, root] = process.argv.slice(2);
if (cmd === "list") console.log(Object.keys(M).join(" "));
else if (cmd === "file") console.log(M[id][0]);
else {
  const [file, from, to] = M[id], path = `${root}/${file}`, text = readFileSync(path, "utf8"), parts = text.split(from);
  if (parts.length !== 2) process.exit(1);
  writeFileSync(path, parts.join(to));
}
