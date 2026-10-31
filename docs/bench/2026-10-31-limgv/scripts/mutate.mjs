// LIMGV's mutations, each one text replaced exactly once in one file (split/join). Run only in Docker (mutate.sh).
// node mutate.mjs list | node mutate.mjs file <id> | node mutate.mjs apply <id> <root> (exit 1 when the text is not found exactly once).
import { readFileSync, writeFileSync } from "node:fs";
const P = "packages/cli/src/security/php.ts", N = "packages/cli/src/security/node.ts", D = "packages/cli/src/security/deliver.ts";
const E = "packages/cli/src/security/exposure.ts", T = "packages/cli/src/security/patch.ts";
const M = {
  // The newest security release again, not the line's newest release (LPHPV's and LNODE's item 5's rule).
  M1: [P, "const top = releases[0]!;", "const top = releases.find(r => r.security && compare(r.version, current.version) > 0) ?? releases[0]!;"],
  // A move with no newer security release is stopped (only security moves).
  M2: [P, "if (compare(top.version, current.version) <= 0) return", "if (compare(top.version, current.version) <= 0 || !fixes.length) return"],
  // No wait for a move with no newer security release.
  M3: [P, "if (now.getTime() < Date.parse(wait.wait_until)) return", "if (false) return"],
  // The wait counted from the start of the release's day (72 hours, not 72 after the day ends).
  M4: [P, "published.getTime() + 96 * HOUR", "published.getTime() + 72 * HOUR"],
  // A move with a security release between waits too.
  M5: [P, "  if (!fixes.length) {\n    const published", "  if (true) {\n    const published"],
  // No Docker Hub check of the candidate's tag.
  M6: [P, "if (await dockerHubTag(repository, tag, fetchFn) === null) {", "if (false) {"],
  // Docker Hub's 404 read as a tag that exists.
  M7: [P, "if (res.status === 404) return null;", "if (res.status === 404) return `sha256:${\"0\".repeat(64)}`;"],
  // A list with no release as new as the Dockerfile's no longer stops.
  M8: [P, "if (compare(current.version, top.version) > 0) {", "if (false) {"],
  // R237's R5: php.net's order trusted (parseReleases does not sort).
  M9: [P, "  return releases.sort((a, b) => compare(b.version, a.version));", "  return releases;"],
  // nodejs.org's order trusted (parseNodeReleases does not sort).
  M10: [N, "  return releases.sort((a, b) => compare(b.version, a.version));", "  return releases;"],
  // R237's R10: string comparison in the security releases' filter.
  M11: [P, "releases.filter(r => r.security && compare(r.version, current.version) > 0)", "releases.filter(r => r.security && r.version > current.version)"],
  // String comparison in the newest-release check.
  M12: [P, "if (compare(top.version, current.version) <= 0) return", "if (top.version <= current.version) return"],
  // An unreadable release day gives "no update" instead of stopping.
  M13: [P, "if (!published) throw new Error(", "if (!published) return { status: \"no_newer_security_release\", candidate: null, security_releases: fixes }; else if (false) throw new Error("],
  // The move is no longer kept out of exposure time: the "Not counted" reading removed.
  M14: [E, "return scan.candidate && !scan.security_releases.length", "return false && scan.candidate && !scan.security_releases.length"],
  // The move gets an exposure-time start (into the median).
  M15: [E, "? { at: null, note: `Not counted", "? { at: scan.checked_at, note: `Not counted"],
  // patch.ts works during the wait.
  M16: [T, "if (!scan.candidate || scan.status !== \"update_available\")", "if (!scan.candidate)"],
  // The commit paragraph always lists security releases (the word "security release" for the move).
  M17: [P, "=> releases.length\n  ? `Official", "=> true\n  ? `Official"],
  // The PR job requires a security release again.
  M18: [D, "list(scan.security_releases, 0, 100,", "list(scan.security_releases, 1, 100,"],
  // The PR job does not check that the move waited.
  M19: [D, "if (Date.parse(fix.applied_at) < Date.parse(waited)) refuse(", "if (false) refuse("],
  // The PR job lets the move carry a fix_published_at.
  M20: [D, "if (fix.fix_published_at !== null) refuse(", "if (false) refuse("],
  // waited_until never set (the PR body then reads as a security fix).
  M21: [D, "fix.waited_until = waited;", "void waited;"],
  // The PR body's opening says a security fix was found.
  M22: [D, "    newest\n      ? `Ludion's validation job moved", "    false\n      ? `Ludion's validation job moved"],
  // The PR body's Advisories row names a security release.
  M23: [D, ": newest ? \"none (a move to the line's newest release)\"", ": false ? \"none (a move to the line's newest release)\""],
  // The PR body's Fix published row names the first newer security release.
  M24: [D, "    newest\n      ? \"| Fix published | none", "    false\n      ? \"| Fix published | none"],
  // The PR body's judge line says "no wait".
  M25: [D, "      : newest\n        ? `- ${IMAGES", "      : false\n        ? `- ${IMAGES"],
};
const [cmd, id, root] = process.argv.slice(2);
if (cmd === "list") console.log(Object.keys(M).join(" "));
else if (cmd === "file") console.log(M[id][0]);
else {
  const [file, from, to] = M[id], path = `${root}/${file}`, text = readFileSync(path, "utf8"), parts = text.split(from);
  if (parts.length !== 2) process.exit(1);
  writeFileSync(path, parts.join(to));
}
