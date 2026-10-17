// Feature splits on the dumped features.json: fit-median cut, mean pnl above/below per split.
//   npx tsx research/debate-calls/2026-09-30T21-10-56/work/analyze.ts
import { readFileSync } from "node:fs";
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const m = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const tm = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return m(a.length > 4 ? s.slice(0, -2) : s); };
const cell = (rs: any[]) => `n${String(rs.length).padStart(3)} tm${tm(rs.map((r) => r.pnl)).toFixed(4)} live${tm(rs.map((r) => r.pnlLive)).toFixed(4)} p3x${(rs.filter((r) => r.peak >= 3).length / rs.length * 100).toFixed(0)}%`;

console.log("pre-trade count bins");
for (const [lo, hi] of [[0, 20], [21, 50], [51, 100], [101, 200], [201, 400]])
  console.log(`${lo}-${hi}`.padEnd(8), ["fit", "val", "test"].map((k) => cell(rows.filter((r) => r.split === k && r.n >= lo && r.n <= hi))).join(" | "));

const young = rows.filter((r) => r.n <= 100);
for (const f of ["newW", "bs", "top5", "holders", "launchBuyers", "big", "ageMin", "makers", "liq", "vol5", "bs5", "callerCalls", "callerHit2"]) {
  const fit = young.filter((r) => r.split === "fit" && r[f] != null).map((r) => r[f]).sort((a, b) => a - b);
  const med = fit[Math.floor(fit.length / 2)];
  console.log(`\n${f} cut ${med}`);
  for (const [lab, pred] of [["<=", (v: number) => v <= med], [">", (v: number) => v > med]] as const)
    console.log(`  ${lab}`, ["fit", "val", "test"].map((k) => cell(young.filter((r) => r.split === k && r[f] != null && pred(r[f])))).join(" | "));
}
