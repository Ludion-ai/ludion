// Each mutation undoes one part of LI in /w; the judge's and the dependencies' tests must fail on every one and pass without them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const JUDGE = "packages/cli/src/security/judge.ts", CAP = "packages/cli/src/security/time-cap.ts", NEXT = "packages/cli/src/security/next-fix.ts", FACTS = "packages/cli/src/security/npm-facts.ts";
const mutations = [
  ["gate 2: ids that differ do not stop (SlugFest passes)", JUDGE, `if (ids === "differ") add(`, `if (false) add(`],
  ["gate 2: an id on one side only does not stop", JUDGE, `else if (ids === "one") add(`, `else if (false) add(`],
  ["gate 2: no note when neither records an id", JUDGE, `else if (ids === "none") add(`, `else if (false) add(`],
  ["gate 2: the event is not checked", JUDGE, `    if (event) add({`, `    if (false) add({`],
  ["gate 2: the event of the version replaced is checked instead", JUDGE, `const event = next.provenance && eventProblem(next.provenance);`, `const event = prev?.provenance && eventProblem(prev.provenance);`],
  ["same release: the id is not compared", CAP, `["same", "none"].includes(repositoryIds(a, b))`, `true`],
  ["same release: an id on one side only passes", CAP, `["same", "none"].includes(repositoryIds(a, b))`, `["same", "none", "one"].includes(repositoryIds(a, b))`],
  ["same release: the event is not checked", CAP, ` && !eventProblem(a) && !eventProblem(b)`, ``],
  ["same release: the fix's event is not checked", CAP, ` && !eventProblem(a) && !eventProblem(b)`, ` && !eventProblem(b)`],
  ["same release: by_id is always true", CAP, `by_id: repositoryIds(own.provenance!, identity.provenance!) === "same"`, `by_id: true`],
  ["same release: the line does not say it was not compared by ID", CAP, `s.by_id === false ?`, `false ?`],
  ["eventProblem: any event may publish", CAP, `return PUBLISH_EVENTS.includes(event) ? null :`, `return true ? null :`],
  ["eventProblem: an id without an event passes", CAP, `(p.repository_id ?? null) === null ? null :`, `true ? null :`],
  ["PUBLISH_EVENTS takes pull_request_target", CAP, `["push", "release", "workflow_dispatch"]`, `["push", "release", "workflow_dispatch", "pull_request_target"]`],
  ["repositoryIds reads an id on one side as none", CAP, `x === null || y === null ? "one"`, `x === null || y === null ? "none"`],
  ["provenanceFrom: v1's id is not read", FACTS, `github?.repository_id ?? environment?.GITHUB_REPOSITORY_ID`, `environment?.GITHUB_REPOSITORY_ID`],
  ["provenanceFrom: v0.2's id is not read", FACTS, `github?.repository_id ?? environment?.GITHUB_REPOSITORY_ID`, `github?.repository_id`],
  ["provenanceFrom: v1's event is not read", FACTS, `github?.event_name ?? environment?.GITHUB_EVENT_NAME`, `environment?.GITHUB_EVENT_NAME`],
  ["provenanceFrom: v0.2's event is not read", FACTS, `github?.event_name ?? environment?.GITHUB_EVENT_NAME`, `github?.event_name`],
  ["provenanceFrom: a value of the wrong form is accepted", FACTS, `typeof value !== "string" || !form.test(value)`, `typeof value !== "string"`],
  ["provenanceFrom: a value that is not text is accepted", FACTS, `typeof value !== "string" || !form.test(value)`, `!form.test(value)`],
  ["provenanceFrom: GitHub parameters that are not an object are accepted", FACTS, `(typeof part !== "object" || Array.isArray(part))) throw`, `false) throw`],
  ["next fix: the event is not checked", NEXT, `    if (event) return { result: "stop"`, `    if (false) return { result: "stop"`],
  ["next fix: the smallest's event is not checked", NEXT, `const event = eventProblem(a.provenance) ?`, `const event = false ?`],
  ["next fix: ids that differ do not stop", NEXT, `if (ids === "differ") return`, `if (false) return`],
  ["next fix: an id on one side only does not stop", NEXT, `if (ids === "one") return`, `if (false) return`],
  ["next fix: the detail does not say it was not compared by ID", NEXT, `detail: ids === "same" ?`, `detail: true ?`],
];
const test = () => { try { execFileSync("npx", ["vitest", "run", "--project", "node", "packages/cli/test/judge.test.ts", "packages/cli/test/dependencies.test.ts"], { stdio: "pipe" }); return true; } catch { return false; } };
console.log(`baseline passes: ${test()}`);
let caught = 0;
for (const [label, file, from, to] of mutations) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`NOT APPLIED (text not found once): ${label}`); continue; }
  writeFileSync(file, original.split(from).join(to));
  const passed = test();
  writeFileSync(file, original);
  if (!passed) caught++;
  console.log(`${passed ? "MISSED" : "caught"}: ${label}`);
}
console.log(`${caught} of ${mutations.length} caught`);
console.log(`after restoring, passes: ${test()}`);
