// CLI: npm run replay -- --from 2026-09-30T00:00Z --to 2026-09-30T06:00Z [--latency 600] [--strategy path] [--unlimited] [--sweep]
import { loadStrategy, STRATEGY_PATH } from "@pf/core/config";
import { runReplay } from "@pf/core/replay";
import { replayContext } from "@pf/core/replayContext";
import { openDb } from "@pf/core/db";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k: string) => args.includes("--" + k);

const to = opt("to") ? Date.parse(opt("to")!) : Date.now();
const from = opt("from") ? Date.parse(opt("from")!) : to - Number(opt("hours") ?? 1) * 3_600_000;
const params = loadStrategy(opt("strategy") ?? STRATEGY_PATH);

const ctx = replayContext(openDb({ readOnly: true }), from);
const latencies = flag("sweep") ? [0, 300, 600, 1500] : [Number(opt("latency") ?? params.exec.latencyMs)];
console.log(`replay ${new Date(from).toISOString()} -> ${new Date(to).toISOString()} ${flag("unlimited") ? "(unlimited capital)" : "(1 SOL book)"}`);
for (const L of latencies) {
  const p = structuredClone(params);
  p.exec.latencyMs = L;
  const t0 = Date.now();
  const { stats } = runReplay({ params: p, from, to, unlimited: flag("unlimited"), ...ctx });
  console.log(JSON.stringify({ latencyMs: L, ...stats, runMs: Date.now() - t0 }, (_k, v) => (typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v)));
}
