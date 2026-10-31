// Copied from docs/bench/2026-10-30-lb-design (LNODE: the image receipt names its runtime, and its digests are shown).
// One line per fix of `ludion patch --json`'s output: package, changes, outcome, branch and reason.
import { readFileSync } from "node:fs";
let out;
try { out = JSON.parse(readFileSync(process.argv[2], "utf8")); } catch (error) { console.log(`(no JSON: ${error.message})`); process.exit(0); }
const r = out.receipt;
if (!r) { console.log(`receipt: null (scan status ${out.scan?.status})`); process.exit(0); }
console.log(`receipt ${r.id}: outcome ${r.outcome}, base ${r.base_commit}${r.reason ? `, reason: ${r.reason.slice(0, 300)}` : ""}`);
const fixes = r.fixes ?? [{ package: r.scan.runtime ?? "php", changes: [{ from: r.scan.current.version, to: r.scan.candidate?.version }], outcome: r.outcome, branch: r.branch, commit: r.commit, reason: r.reason, fix_published_at: r.fix_published_at, found_at: r.found_at, applied_at: r.applied_at }];
if (!r.fixes) console.log(`  digests: old ${r.old_digest} new ${r.new_digest}; baseline_passed ${r.baseline_passed} candidate_passed ${r.candidate_passed}; security releases ${(r.scan.security_releases ?? []).map(s => s.version).join(", ")}`);
for (const f of fixes) console.log(`  ${f.package} ${f.changes.map(c => `${c.from} -> ${c.to}`).join(", ")}: ${f.outcome}${f.branch ? ` ${f.branch} ${f.commit}` : ""}${f.judgement ? ` judge=${f.judgement.verdict}` : ""} published=${f.fix_published_at} found=${f.found_at} applied=${f.applied_at}${f.reason ? ` — ${f.reason.slice(0, 300)}` : ""}`);
