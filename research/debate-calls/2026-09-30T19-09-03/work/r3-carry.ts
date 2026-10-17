// Round 3: who carries the fit-positive cell liq>=5000 & r15>=5.58, tp50sl30 @0.2? By caller and by week, fit and validation.
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/r3-carry.ts
import { readFileSync } from "node:fs";
import { stats } from "./r2-slice.ts";

const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T19-09-03/work/r2-table.json", "utf8"));
const SPLIT = Date.parse("2026-09-18"), K = "tp50sl30@0.2";
const sel = rows.filter((r) => r.r15 >= 5.58 && r.liq >= 5000);
const show = (lbl: string, rs: any[]) => {
  const s = stats(rs.map((r) => r.out[K].pnl), rs.map((r) => r.out[K].real));
  console.log(`${lbl.padEnd(30)} n${String(s.n).padStart(4)} trim${s.trim.toFixed(4).padStart(8)} total${(s.mean * s.n).toFixed(3).padStart(8)} woBest${s.woBest.toFixed(2).padStart(7)} win${s.win.toFixed(1).padStart(5)}%`);
};
const wk = (ms: number) => new Date(Math.floor(ms / 604800000) * 604800000).toISOString().slice(0, 10);
for (const fit of [true, false]) {
  const p = sel.filter((r) => (r.callMs < SPLIT) === fit), tag = fit ? "FIT" : "VAL";
  show(`${tag} all`, p);
  show(`${tag} caller_01`, p.filter((r) => r.caller === "caller_01"));
  show(`${tag} excl caller_01`, p.filter((r) => r.caller !== "caller_01"));
  for (const w of [...new Set(p.map((r) => wk(r.callMs)))].sort()) show(`${tag} week ${w}`, p.filter((r) => wk(r.callMs) === w));
}
