// Evaluate a call strategy file (see scripts/lib/callsSim.ts for the interface).
//   npx tsx scripts/calls-eval.ts <strategy.ts> [--data <data dir>] [--from 2026-09-01] [--to 2026-09-20] [--trades 20]
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluate } from "./lib/callsSim.ts";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a) => a.endsWith(".ts") || a.endsWith(".js"));
if (!file) { console.error("usage: calls-eval.ts <strategy.ts> [--from ISO] [--to ISO] [--trades N]"); process.exit(1); }
const dataDir = opt("data") ? resolve(opt("data")!) : process.env.PF_DATA_DIR ?? resolve(process.cwd(), "data");
const strategy = (await import(pathToFileURL(resolve(file)).href)).default;
const from = opt("from") ? Date.parse(opt("from")!) : 0;
const to = opt("to") ? Date.parse(opt("to")!) : Date.now();
const r = evaluate(strategy, dataDir, from, to);
const { trades, ...summary } = r;
console.log(JSON.stringify(summary, null, 1));
const n = Number(opt("trades") ?? 10);
if (n > 0) {
  console.log(`\nbest ${n} and worst ${n} trades:`);
  const s = [...trades].sort((a, b) => b.pnlSol - a.pnlSol);
  for (const t of [...s.slice(0, n), ...s.slice(-n)]) console.log(`${new Date(t.callMs).toISOString().slice(0, 16)} ${t.caller.padEnd(16)} ${t.mint.slice(0, 8)} delay ${t.entryDelayMin.toFixed(0)}m pnl ${t.pnlSol.toFixed(4)} realized ${t.realizedMult.toFixed(2)}x peak ${t.peakMult.toFixed(1)}x ${t.exits.join(",")}`);
}
