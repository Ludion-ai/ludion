// LOLD2: writes the Docker build context `ludion patch` writes for one fix, from a base run.mjs made, so that the real
// Dockerfile can be built as the product builds it. Docker only. Usage: node context.mjs <run.mjs out dir> <id> <dest> <image>
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NPM_FINAL_MANIFEST, resolverDockerfile } from "/vol/app/packages/cli/src/security/dependency-patch.ts";
import { changedManifest } from "/vol/app/packages/cli/src/security/inventory.ts";
import { RESOLVER_FOLDER, RESOLVER_TABLE, resolveOldest, resolverScript, tableFile } from "/vol/app/packages/cli/src/security/oldest.ts";

const [out, id, dest, image] = process.argv.slice(2);
const FLAGS = ["--ignore-scripts", "--no-audit", "--no-fund", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none", "--registry=https://registry.npmjs.org"];
const lold = "/vol/app/docs/bench/lold";
const example = [...JSON.parse(readFileSync(join(lold, "examples.json"), "utf8")).examples, ...JSON.parse(readFileSync(join(lold, "examples.hand.json"), "utf8")).examples].find(e => e.id === id);
const t = JSON.parse(readFileSync(join(lold, "results", `${id}.json`), "utf8")).t;
const base = join(out, "work", id, "base"), plan = [{ name: example.name, from: example.from, to: example.v, advisories: [example.advisory ?? "LOLD-T"] }];
const final = changedManifest(base, "npm", plan), pinned = changedManifest(base, "npm", plan, true);
const table = await resolveOldest({ plan, baseLock: readFileSync(join(base, "package-lock.json"), "utf8"), finalManifest: final, findings: [{ advisory: { id: plan[0].advisories[0], published: t } }] });
mkdirSync(join(dest, "manifests"), { recursive: true });
mkdirSync(join(dest, RESOLVER_FOLDER), { recursive: true });
cpSync(join(base, "package-lock.json"), join(dest, "manifests", "package-lock.json"));
writeFileSync(join(dest, "manifests", "package.json"), pinned);
writeFileSync(join(dest, "manifests", NPM_FINAL_MANIFEST), final);
writeFileSync(join(dest, RESOLVER_FOLDER, "install.cjs"), resolverScript(FLAGS));
writeFileSync(join(dest, RESOLVER_FOLDER, RESOLVER_TABLE), tableFile(table));
writeFileSync(join(dest, "Dockerfile"), resolverDockerfile("npm", image, true, false, plan));
console.log(JSON.stringify({ id, requirements: Object.keys(table.answers).length }));
