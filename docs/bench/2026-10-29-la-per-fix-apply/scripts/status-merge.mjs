// Resolves a conflict in one line of a record by starting from main's text and reapplying the lane's own changes, then
// proves it: taking the lane's changes back out must give main's line exactly. Never start from the lane's text.
// Usage: node status-merge.mjs <base line file> <lane line file> <main line file> <replacement pairs JSON> > merged-line
// The pairs are [[text in base and main, the lane's text for it], ...]; each must occur exactly once.
import { readFileSync } from "node:fs";

const [baseFile, laneFile, mainFile, pairsFile] = process.argv.slice(2);
const read = f => readFileSync(f, "utf8").replace(/\r?\n$/, "");
const base = read(baseFile), lane = read(laneFile), main = read(mainFile);
const pairs = JSON.parse(readFileSync(pairsFile, "utf8"));
const once = (text, part, where) => { if (text.split(part).length !== 2) throw new Error(`not exactly once in ${where}: ${part.slice(0, 80)}`); };
let merged = main;
for (const [from, to] of pairs) {
  once(base, from, "base"); once(main, from, "main"); once(lane, to, "lane");
  merged = merged.replace(from, to);
}
// The lane's changes alone must turn base into lane, and taking them out of the result must give main back.
let laneCheck = base, back = merged;
for (const [from, to] of pairs) laneCheck = laneCheck.replace(from, to);
for (const [from, to] of [...pairs].reverse()) back = back.replace(to, from);
if (laneCheck !== lane) throw new Error("the pairs do not turn base into the lane's line: a lane change is missing");
if (back !== main) throw new Error("taking the lane's changes out does not give main's line: main's text was lost");
process.stdout.write(`${merged}\n`);
