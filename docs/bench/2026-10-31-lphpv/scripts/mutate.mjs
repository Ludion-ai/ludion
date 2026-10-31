// Mutations of scanPhp's choice of candidate (packages/cli/src/security/php.ts), each one text replaced once (split/join).
// node mutate.mjs list | node mutate.mjs apply <id> <file> (exit 1 when the text is not found exactly once).
import { readFileSync, writeFileSync } from "node:fs";

const M = {
  // The behaviour before LPHPV: the branch's newest release, security or not.
  P1: ["const fixed = fixes[0];", "const fixed = fixes.length ? releases[0] : undefined;"],
  // The smallest newer security release, not the newest.
  P2: ["const fixed = fixes[0];", "const fixed = fixes.at(-1);"],
  // The newest newer release of any kind, when a security release exists.
  P3: ["const fixed = fixes[0];", "const fixed = fixes.length ? releases.find(r => compare(r.version, current.version) > 0) : undefined;"],
  // The security tag no longer counts.
  P4: ["releases.filter(r => r.security && compare(r.version, current.version) > 0)", "releases.filter(r => compare(r.version, current.version) > 0)"],
  // A release at the Dockerfile's version counts as newer.
  P5: ["releases.filter(r => r.security && compare(r.version, current.version) > 0)", "releases.filter(r => r.security && compare(r.version, current.version) >= 0)"],
  // The candidate's tag keeps the version but drops the flavor.
  P6: ["reference: `php:${fixed.version}${current.flavor}`", "reference: `php:${fixed.version}`"],
};

const [cmd, id, file] = process.argv.slice(2);
if (cmd === "list") console.log(Object.keys(M).join(" "));
else {
  const [from, to] = M[id], text = readFileSync(file, "utf8"), parts = text.split(from);
  if (parts.length !== 2) process.exit(1);
  writeFileSync(file, parts.join(to));
}
