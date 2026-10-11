// Regrades the saved CI workflows of a Done 1 run with the fixed grader: comments don't count as configuring an
// output file. Usage: node regrade.mjs <out dir>
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const stripYamlComments = (text) => text.split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");

export function gradeWorkflow(text) {
  const yaml = stripYamlComments(text);
  if (/outputFile/i.test(yaml)) return { correct: false, why: "configured an output file" };
  const paths = [...yaml.matchAll(/^\s*path:\s*([\s\S]*?)(?=^\s*[a-z-]+:|^\s*-\s|$(?![\s\S]))/gim)].map((m) => m[1]).join(" ").trim();
  const covers = /\.vitest\/junit\/output\.xml|\.vitest\/junit\/?(\s|$|\*)|\.vitest\/?(\s|$)|\.vitest\/\*\*/.test(paths);
  const hidden = /include-hidden-files:\s*true/.test(yaml);
  if (!covers) return { correct: false, pathRight: false, why: `uploads ${paths.split(/\s+/).join(" ") || "(no path)"}` };
  if (!hidden) return { correct: false, pathRight: true, why: "right path, but without include-hidden-files: true (uploads nothing)" };
  return { correct: true, pathRight: true, why: "right path, with include-hidden-files: true" };
}

const rows = [];
for (const condition of ["before", "after"]) {
  for (let i = 1; i <= 10; i++) {
    const f = join(out, `${condition}-${i}-ci.yml`);
    if (!existsSync(join(out, `${condition}-${i}.jsonl`))) continue;
    const g = existsSync(f) ? gradeWorkflow(readFileSync(f, "utf8")) : { correct: false, pathRight: false, why: "no ci.yml" };
    rows.push({ condition, trial: i, ...g });
    console.log(`${condition} ${i}: ${g.correct ? "CORRECT" : "wrong"}${g.pathRight ? " (path right)" : ""} - ${g.why}`);
  }
}
const n = (c, k) => rows.filter((r) => r.condition === c && r[k]).length;
const total = (c) => rows.filter((r) => r.condition === c).length;
console.log(`strict: before ${n("before", "correct")}/${total("before")}, after ${n("after", "correct")}/${total("after")}; vitest path right: before ${n("before", "pathRight")}/${total("before")}, after ${n("after", "pathRight")}/${total("after")}`);
writeFileSync(join(out, "regraded.json"), JSON.stringify(rows, null, 2) + "\n");
