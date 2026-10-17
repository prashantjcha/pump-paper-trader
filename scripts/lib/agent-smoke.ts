// Checks that both agent CLIs can run the evaluator when launched from a process manager.
import { spawnSync } from "node:child_process";
import { cleanEnv } from "./agentEnv.ts";
const cmd = "npx tsx scripts/calls-eval.ts research/debate-calls/examples/baseline-trail.ts --data data --to 2026-09-03 --trades 0";
const ask = `Run exactly this command and reply with only the value of eligibleCalls from its output: ${cmd}`;
const opts = { cwd: process.cwd(), env: cleanEnv(), encoding: "utf8" as const, timeout: 600_000, shell: true };
const c = spawnSync("claude", ["-p", JSON.stringify(ask), "--permission-mode", "acceptEdits", "--allowedTools", JSON.stringify("Bash(npx tsx:*) Bash(npx:*) Bash(node:*) PowerShell(npx tsx:*) PowerShell(node:*) Read"), "--output-format", "text"], opts);
console.log("claude:", c.status, (c.stdout ?? "").trim().slice(-200));
const x = spawnSync("codex", ["exec", "-s", "workspace-write", "--skip-git-repo-check", "-C", JSON.stringify(process.cwd()), "-o", "data/codex-smoke.txt", JSON.stringify(ask)], opts);
console.log("codex:", x.status, (spawnSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('data/codex-smoke.txt','utf8'))"], { encoding: "utf8" }).stdout ?? "").trim().slice(-200));
