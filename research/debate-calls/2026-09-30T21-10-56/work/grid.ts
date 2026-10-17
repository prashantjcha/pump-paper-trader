// Runs young-token entry with every exit policy in POLICY_GRID (plus a few wide scale-outs) on the three splits.
//   npx tsx research/debate-calls/2026-09-30T21-10-56/work/grid.ts
import { resolve } from "node:path";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
// cache file reads (read-only data) so repeated evaluations are fast
const raw = fs.readFileSync, cache = new Map<string, any>();
(fs as any).readFileSync = (p: any, o?: any) => { const k = String(p) + "|" + String(o); if (!cache.has(k)) cache.set(k, raw(p, o)); return cache.get(k); };
syncBuiltinESMExports();
import { evaluate, type CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import { POLICY_GRID, policyName, type PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");
export const SPLITS: [string, number, number][] = [
  ["fit", 0, Date.parse("2026-09-18T00:00:00Z")],
  ["val", Date.parse("2026-09-18T00:00:00Z"), Date.parse("2026-09-26T00:00:00Z")],
  ["test", Date.parse("2026-09-26T00:00:00Z"), Date.parse("2026-09-29T18:00:00Z")],
];
export function row(s: CallStrategy) {
  return SPLITS.map(([k, a, b]) => {
    const r = evaluate(s, DATA, a, b);
    return { k, n: r.entries, mean: r.meanSol, trim: r.trimmedMeanSol, tot: r.totalSol, woBest: r.totalWithoutBestSol, win: r.winRate, c5: r.captured5x, c10: r.captured10x, ran5: r.tokensThatRan5x };
  });
}
export const fmt = (rs: ReturnType<typeof row>) => rs.map((r) => `${r.k} n${r.n} m${r.mean?.toFixed(4)} tm${r.trim?.toFixed(4)} tot${r.tot.toFixed(2)} woB${r.woBest.toFixed(2)} w${r.win} 5x${r.c5}/10x${r.c10}`).join(" | ");

if (process.argv[1]?.endsWith("grid.ts")) {
  const extra: PolicySpec[] = [
    ...[100, 150, 200].flatMap((x) => [50, 60, 70].flatMap((trail) => [50].map((sl) => ({ family: "scale-out" as const, x, trail, sl })))),
    ...[100, 200, 400].flatMap((arm) => [40, 50, 60].map((trail) => ({ family: "trailing" as const, arm, trail, sl: 50 }))),
  ];
  for (const p of [...POLICY_GRID, ...extra]) {
    const s: CallStrategy = { name: policyName(p), maxWaitMin: 0, shouldEnter: (c) => c.preTrades.length <= 100, exit: p };
    console.log(policyName(p).padEnd(34), fmt(row(s)));
  }
}
