// Buy at the call, fixed take-profit / stop grid, plus sizing, fit and validation.
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/tpsl.ts
import { evaluate, type CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const DATA = "research/debate-calls/2026-09-30T19-09-03/data";
const FIT: [number, number] = [0, Date.parse("2026-09-18")];
const VAL: [number, number] = [Date.parse("2026-09-18"), Date.parse("2026-09-26")];
const fmt = (r: ReturnType<typeof evaluate>) =>
  `n${String(r.entries).padStart(4)} tot${r.totalSol.toFixed(2).padStart(7)} trim${(r.trimmedMeanSol ?? 0).toFixed(4).padStart(8)} woBest${r.totalWithoutBestSol.toFixed(2).padStart(7)} win${String(r.winRate).padStart(5)}% c5/10 ${r.captured5x}/${r.captured10x}`;
for (const size of [0.1, 0.2]) for (const tp of [100, 200, 400, 900]) for (const sl of [30, 50, 70, 90]) {
  const s: CallStrategy = { name: `at-call ${size} tp${tp} sl${sl}`, maxWaitMin: 0, shouldEnter: () => true, size: () => size, exit: { family: "fixed", tp, sl } };
  console.log(`${s.name.padEnd(26)} FIT ${fmt(evaluate(s, DATA, ...FIT))} || VAL ${fmt(evaluate(s, DATA, ...VAL))}`);
}
