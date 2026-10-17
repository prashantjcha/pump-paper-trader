// Round 3: does Codex's gross-positive 15-min run-up filter (r15 >= 5.58, fit Q75) become net-positive once the
// fixed 0.006 SOL round trip is diluted by size 0.2, restricted to liquid tokens where impact stays small?
// Reads work/r2-table.json (referee P&L per call at 0.1 and 0.2 SOL for 7 exits).
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/r3-size.ts
import { readFileSync } from "node:fs";
import { stats } from "./r2-slice.ts";

const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T19-09-03/work/r2-table.json", "utf8"));
const SPLIT = Date.parse("2026-09-18");
const f = (s: ReturnType<typeof stats>) =>
  `n${String(s.n).padStart(4)} trim${s.trim.toFixed(4).padStart(8)} woBest${s.woBest.toFixed(2).padStart(7)} win${s.win.toFixed(1).padStart(5)}%`;
for (const liqMin of [0, 5000, 10000, 20000, 40000]) for (const r15 of [4, 5.58, 8]) for (const x of ["tp50sl30", "tp100sl30"]) for (const size of ["0.1", "0.2"]) {
  const sel = rows.filter((r) => r.r15 >= r15 && r.liq >= liqMin);
  const part = (fit: boolean) => { const r = sel.filter((r) => (r.callMs < SPLIT) === fit); return stats(r.map((r) => r.out[`${x}@${size}`].pnl), r.map((r) => r.out[`${x}@${size}`].real)); };
  console.log(`liq>=${String(liqMin).padEnd(6)} r15>=${String(r15).padEnd(5)} ${x.padEnd(10)}@${size} FIT ${f(part(true))} || VAL ${f(part(false))}`);
}
