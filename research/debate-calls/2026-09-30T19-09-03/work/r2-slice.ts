// Slices r2-table.json by call-time features and prints fit / validation metrics per exit.
// Scans every (filter, exit) pair; prints those with trimmed mean > 0 on FIT (n >= 30), plus VAL alongside.
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/r2-slice.ts [filterRegex]
import { readFileSync } from "node:fs";

const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T19-09-03/work/r2-table.json", "utf8"));
const SPLIT = Date.parse("2026-09-18");
export function stats(v: number[], real: number[]) {
  const n = v.length, s = [...v].sort((a, b) => a - b), tot = v.reduce((a, b) => a + b, 0);
  const tr = n > 4 ? s.slice(0, n - 2) : s;
  return { n, mean: n ? tot / n : 0, trim: tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : 0, woBest: n ? tot - s[n - 1] : 0,
    win: n ? v.filter((x) => x > 0).length / n * 100 : 0, c5: real.filter((x) => x >= 5).length, c10: real.filter((x) => x >= 10).length };
}
const f = (s: ReturnType<typeof stats>) =>
  `n${String(s.n).padStart(4)} mean${s.mean.toFixed(4).padStart(8)} trim${s.trim.toFixed(4).padStart(8)} woBest${s.woBest.toFixed(2).padStart(7)} win${s.win.toFixed(1).padStart(5)}% c${s.c5}/${s.c10}`;
const q = (k: string, ps: number[]) => { const v = rows.filter((r) => r.callMs < SPLIT).map((r) => r[k]).sort((a, b) => a - b); return ps.map((p) => v[Math.floor(p * (v.length - 1))]); };
const filters: [string, (r: any) => boolean][] = [["all", () => true]];
for (const k of ["liq", "r5", "r15", "r60", "v5", "v60", "offHigh", "px", "nPre"]) {
  const [a, b, c] = q(k, [0.25, 0.5, 0.75]);
  filters.push([`${k}<${+a.toPrecision(3)}`, (r) => r[k] < a], [`${k}>=${+b.toPrecision(3)}`, (r) => r[k] >= b],
    [`${k}>=${+c.toPrecision(3)}`, (r) => r[k] >= c], [`${k} q25-75`, (r) => r[k] >= a && r[k] < c]);
}
filters.push(["pump", (r) => r.pump], ["notPump", (r) => !r.pump], ["hour0-11", (r) => r.hour < 12], ["hour12-23", (r) => r.hour >= 12],
  ["callerNew(<3)", (r) => r.cCalls < 3], ["caller2x>=40%", (r) => r.cCalls >= 3 && r.c2x / r.cCalls >= 0.4], ["caller5x>=15%", (r) => r.cCalls >= 3 && r.c5x / r.cCalls >= 0.15],
  ["fresh(last bar<=2m)", (r) => r.lastAgeMin <= 2], ["r60>=7", (r) => r.r60 >= 7], ["r60>=7&liq>=q50", (r) => r.r60 >= 7 && r.liq >= q("liq", [0.5])[0]]);
const re = process.argv[2] ? new RegExp(process.argv[2]) : null;
const exits = Object.keys(rows[0].out);
for (const [fn, fl] of filters) {
  if (re && !re.test(fn)) continue;
  for (const x of exits) {
    const sel = rows.filter(fl);
    const part = (fit: boolean) => { const r = sel.filter((r) => (r.callMs < SPLIT) === fit); return stats(r.map((r) => r.out[x].pnl), r.map((r) => r.out[x].real)); };
    const F = part(true), V = part(false);
    if (re || (F.n >= 30 && F.trim > -0.004)) console.log(`${fn.padEnd(22)} ${x.padEnd(22)} FIT ${f(F)} || VAL ${f(V)}`);
  }
}
