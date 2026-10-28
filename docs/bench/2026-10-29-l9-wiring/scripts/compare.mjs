// Compare the fixed and unfixed judgements of each PR as the definitions say: the findings must be equal except that
// each agreeing workspace file leaves the changed-files stop and one info line names them; any other difference is
// printed as it is. Usage: node compare.mjs <out dir>
import { readFileSync } from "node:fs";
const dir = process.argv[2];
for (const n of [161, 162]) {
  const [unfixed, fixed] = ["unfixed", "fixed"].map(s => JSON.parse(readFileSync(`${dir}/pr-${n}.${s}.json`, "utf8")));
  const key = f => JSON.stringify(f);
  const only = (a, b) => a.findings.filter(f => !b.findings.some(g => key(g) === key(f)));
  const touches = j => j.findings.filter(f => f.gate === 4 && f.effect === "stop" && f.message.startsWith("The change also touches"));
  console.log(`== pr-${n}: verdict ${unfixed.verdict} -> ${fixed.verdict}; findings ${unfixed.findings.length} -> ${fixed.findings.length}`);
  console.log(`changed-files stops (false stops counted per file): unfixed ${JSON.stringify(touches(unfixed).map(f => f.message))}, fixed ${JSON.stringify(touches(fixed).map(f => f.message))}`);
  for (const f of only(unfixed, fixed)) console.log(`  only unfixed: ${key(f)}`);
  for (const f of only(fixed, unfixed)) console.log(`  only fixed:   ${key(f)}`);
  const { findings: _a, verdict: _b, ...restU } = unfixed, { findings: _c, verdict: _d, ...restF } = fixed;
  for (const k of new Set([...Object.keys(restU), ...Object.keys(restF)])) {
    if (key(restU[k]) !== key(restF[k])) console.log(`  field ${k} differs: unfixed ${key(restU[k])?.slice(0, 300)} | fixed ${key(restF[k])?.slice(0, 300)}`);
  }
}
