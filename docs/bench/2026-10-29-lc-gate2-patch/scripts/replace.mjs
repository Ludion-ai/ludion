import { readFileSync, writeFileSync } from "node:fs";
const [file, from, to] = process.argv.slice(2);
const s = readFileSync(file, "utf8");
if (s.split(from).length !== 2) process.exit(1);
writeFileSync(file, s.replace(from, to));
