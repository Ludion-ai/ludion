// Each mutation undoes one part of LV3 in /w; the CLI's dependency, judge and candidate-judge tests must fail on every
// one and pass without them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PATCH = "packages/cli/src/security/dependency-patch.ts", NEXT = "packages/cli/src/security/next-fix.ts", FACTS = "packages/cli/src/security/npm-facts.ts";
const ITEM = `if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(k => !["vulns", "next_page_token"].includes(k)) || (item.vulns !== undefined && !Array.isArray(item.vulns))) throw new Error("Invalid OSV batch item; no clean result is available.");`;
const mutations = [
  // Request 1: osvIds checks each batch item as OsvClient.ids does.
  ["osvIds reads any item (the check removed)", FACTS, ITEM, ``],
  ["osvIds reads {vulns: null} as no record", FACTS, ` || (item.vulns !== undefined && !Array.isArray(item.vulns))) throw new Error("Invalid OSV batch item`, `) throw new Error("Invalid OSV batch item`],
  ["osvIds reads an unknown key as no record", FACTS, ` || Object.keys(item).some(k => !["vulns", "next_page_token"].includes(k))`, ``],
  ["osvIds reads a number as no record", FACTS, `if (!item || typeof item !== "object" || Array.isArray(item) ||`, `if (item && typeof item === "object" && !Array.isArray(item) &&`],
  ["osvIds takes an unknown key beside vulns", FACTS, ` || Object.keys(item).some(k => !["vulns", "next_page_token"].includes(k))`, ` || (item.vulns === undefined && Object.keys(item).some(k => !["vulns", "next_page_token"].includes(k)))`],
  ["osvIds takes any pagination token", FACTS, `if (item.next_page_token !== undefined && typeof item.next_page_token !== "string") throw new Error("Invalid OSV pagination token.");`, ``],
  // Request 2: the publisher check on the version that qualifies.
  ["the check never stops", NEXT, `if (check.result === "stop") return`, `if (false) return`],
  ["the provenance repository is not compared", NEXT, ` && a.provenance.repository === b.provenance.repository`, ``],
  ["the provenance workflow is not compared", NEXT, ` && a.provenance.workflow === b.provenance.workflow`, ``],
  ["the publisher is also compared under provenance (stricter than decided)", NEXT, ` && a.provenance.workflow === b.provenance.workflow;`, ` && a.provenance.workflow === b.provenance.workflow && a.publisher === b.publisher;`],
  ["the receipt sentence says the version taken's time", PATCH, `this is the latest publish time among the fix's planned versions, the version taken included.";`, `this is the publish time of the version taken.";`],
  ["provenance naming no repository or workflow matches", NEXT, `!!a.provenance.repository && !!a.provenance.workflow && `, ``],
  ["provenance on one side only goes on to the publisher", NEXT, `if (a.provenance || b.provenance) return { result: "stop"`, `if (false) return { result: "stop"`],
  ["trusted publishing's shared user counts as an account", NEXT, `return f?.present ? releaseIdentity({ ...f, malicious: [], advisories: [] }) : null;`, `return f?.present ? { publisher: f.publisher, provenance: f.provenance } : null;`],
  ["no account matches no account", NEXT, `return a.publisher && a.publisher === b.publisher ?`, `return a.publisher === b.publisher ?`],
  ["a failed read goes on", NEXT, `return { version, smallest: null, candidate: null, result: "stop"`, `return { version, smallest: null, candidate: null, result: "publisher"`],
  ["a smallest no longer listed is compared as if listed", NEXT, `return f?.present ? releaseIdentity(`, `return f ? releaseIdentity(`],
  ["a stop does not stop the fix", PATCH, "if (choice.publisher_check?.result === \"stop\") fix.reason ??= `Gate 2 stops this fix: ${choice.note}`;", ``],
  ["a stopped fix's reason is replaced by the branch check", PATCH, `      if (fix.reason) continue;\n      const branch = branches[index], tip =`, `      const branch = branches[index], tip =`],
];
const test = () => { try { execFileSync("npx", ["vitest", "run", "--project", "node", "packages/cli/test/dependencies.test.ts", "packages/cli/test/judge.test.ts", "packages/cli/test/candidate-judge.test.ts"], { stdio: "pipe" }); return true; } catch { return false; } };
console.log(`baseline passes: ${test()}`);
let caught = 0;
for (const [label, file, from, to] of mutations) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`NOT APPLIED (text not found once): ${label}`); continue; }
  writeFileSync(file, original.replace(from, () => to));
  const passed = test();
  writeFileSync(file, original);
  if (!passed) caught++;
  console.log(`${passed ? "MISSED" : "caught"}: ${label}`);
}
console.log(`${caught} of ${mutations.length} caught`);
console.log(`after restoring, passes: ${test()}`);
