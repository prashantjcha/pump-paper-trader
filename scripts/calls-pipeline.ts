// Fetch price history for every call, then backtest and deploy the training-selected strategy to the
// forward paper test. Resumable: the fetch caches every response, so rerunning continues where it stopped.
//   npx tsx scripts/calls-pipeline.ts
import "dotenv/config";
import { spawnSync } from "node:child_process";

const tsx = ["node_modules/tsx/dist/cli.mjs"];
const run = (script: string, ...args: string[]) => {
  console.log(`\n=== ${script} ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [...tsx, script, ...args], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`${script} exited with ${r.status}`); process.exit(r.status ?? 1); }
};
// Codex (token-level bars, fast) when a key is set; otherwise GeckoTerminal (free, rate limited).
run(process.env.CODEX_API_KEY ? "scripts/calls-fetch-codex.ts" : "scripts/calls-fetch.ts");
run("scripts/calls-backtest.ts", "--deploy");
console.log("pipeline done");
