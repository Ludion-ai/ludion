// Runs the real cases with Node.js alone, and no test runner: where Docker's socket is, only Ludion's own code runs
// (CLAUDE.md, "counts as the host"). For C4's VM, or CI, not a PC. Prints one JSON line per case. Usage: node gate3-docker-run.ts <examples> <case>...
// The acquisition policy and project.ts's snapshot need packages, and the example is our own, so they are stand-ins here:
// gate3-docker.test.ts has the real ones.
import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { runContainer, runDockerImageCommand } from "../../sandbox/src/docker.ts";
import { caseProblems, runCase, type CaseName } from "./gate3-cases.ts";

const ALPINE = "alpine@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a";
const BOX_MEMORY_MB = 512;
const available = () => Number(/^Mem:(?:\s+\d+){5}\s+(\d+)/m.exec(spawnSync("docker", ["run", "--rm", ALPINE, "free", "-m"], { encoding: "utf8" }).stdout ?? "")?.[1]);

const [examples, ...names] = process.argv.slice(2);
let failed = 0;
for (const name of names as CaseName[]) {
  const memory: number[] = [];
  const result = await runCase(name, examples!, {
    policy: () => {},
    snapshot: (root, destination) => cpSync(root, destination, { recursive: true, filter: from => !/[\\/](?:node_modules|\.git|\.next|\.env(?:\..*)?)$/.test(from) }),
    keepLogs: !!process.env.LUDION_GATE3_LOGS,
    // For the measurement of one case from nothing: the machine's build cache would hide the acquisition.
    command: (args, timeoutMs) => runDockerImageCommand(process.env.LUDION_GATE3_NO_CACHE && args[0] === "build" ? ["build", "--no-cache", ...args.slice(1)] : args, timeoutMs),
    box: async (container, image, command, timeoutMs) => {
      // Not started without room for it, as the lanes on this machine are asked to wait.
      for (;;) {
        const mb = available();
        memory.push(mb);
        if (mb >= BOX_MEMORY_MB * 1.25) break;
        await delay(300_000);
      }
      return runContainer(container, image, command, timeoutMs, "npm");
    },
  });
  const problems = caseProblems(name, result);
  if (problems.length) failed++;
  console.log(JSON.stringify({ case: name, problems, memory_available_mb_before_each_box: memory, result }));
}
process.exit(failed ? 1 : 0);
