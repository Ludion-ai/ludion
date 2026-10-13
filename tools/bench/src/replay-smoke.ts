// Own CI fixture only. The CLI being invoked reads source data and executes it only in Docker.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedText } from "./bounded-file.ts";

const [recordPath, artifactsPath, resultPath] = process.argv.slice(2);
assert.ok(recordPath && artifactsPath && resultPath, "Supply fixture record, artifact directory and replay output.");
const record = JSON.parse(boundedText(recordPath));
const row = record.rows.find((r: { verdict: string }) => r.verdict === "passed");
assert.match(row.artifact.id, /^[a-f0-9-]{36}$/);
assert.match(row.artifact.sha256, /^[a-f0-9]{64}$/);
const cli = fileURLToPath(new URL("./runtime-tasks-cli.ts", import.meta.url));
execFileSync(process.execPath, [cli, "--artifact", join(resolve(artifactsPath), `${row.artifact.id}.json`), "--sha256", row.artifact.sha256, "--out", resultPath], { stdio: "inherit" });
const replay = JSON.parse(boundedText(resultPath)).rows[0];
assert.equal(replay.verdict, "passed");
assert.equal(replay.artifact_sha256, row.artifact.sha256);
assert.equal(replay.id, row.id);
assert.equal(replay.sync, false);
assert.equal(replay.delivery_sha256, null);
assert.ok(replay.candidate_sha256 && replay.capture_harness_sha && replay.evaluation_harness_sha);
console.log("Saved fixture -> recorded hash -> CLI replay -> Docker acceptance passed; no model benchmark invoked.");
