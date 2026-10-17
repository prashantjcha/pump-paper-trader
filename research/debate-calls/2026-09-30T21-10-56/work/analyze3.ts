// Leak-free features (bars, flow, caller history, call time; NO preTrades) on every first call; fit-quintile tables per split.
import "./grid.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBars, loadFlow } from "../../../../scripts/lib/callsSim.ts";
const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const m = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const tm = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return m(a.length > 4 ? s.slice(0, -2) : s); };
const cell = (rs: any[]) => `n${String(rs.length).padStart(3)} tm${tm(rs.map((r) => r.pnl)).toFixed(4)} live${tm(rs.map((r) => r.pnlLive)).toFixed(4)} p3x${(rs.filter((r) => r.peak >= 3).length / Math.max(1, rs.length) * 100).toFixed(0)}%`;
for (const r of rows) {
  const bars = loadBars(DATA, r.mint)!, flow = loadFlow(DATA, r.mint).filter((b) => b.t + 60_000 <= r.callMs);
  const pre = bars.filter((b) => b.t < r.callMs);
  const last = pre[pre.length - 1];
  r.cap = (last ? last.c : bars.find((b) => b.t >= r.callMs)!.o) * 1e9;
  const w = (min: number) => flow.filter((b) => b.t >= r.callMs - min * 60_000);
  const f5 = w(5), f15 = w(15), f60 = w(60);
  r.buyers5 = f5.reduce((a, b) => a + b.buyers, 0); r.buyers15 = f15.reduce((a, b) => a + b.buyers, 0);
  r.trades60 = f60.reduce((a, b) => a + b.buys + b.sells, 0);
  r.vol15 = f15.reduce((a, b) => a + b.volumeUsd, 0);
  const bu = f15.reduce((a, b) => a + b.buyVolUsd, 0), su = f15.reduce((a, b) => a + b.sellVolUsd, 0);
  r.bs15 = su > 0 ? bu / su : 5;
  const p15 = f15.length ? f15[0].o : null; r.mom15 = p15 && last ? last.c / p15 : 1;
  const p5 = f5.length ? f5[0].o : null; r.mom5 = p5 && last ? last.c / p5 : 1;
  r.hour = new Date(r.callMs).getUTCHours();
  r.pump = r.mint.endsWith("pump") ? 1 : 0;
  r.hit5 = r.callerCalls ? (r.callerHit2 ?? 0) : null;
}
writeFileSync(resolve("research/debate-calls/2026-09-30T21-10-56/work/features2.json"), JSON.stringify(rows));
const show = (lab: string, pred: (r: any) => boolean) => console.log(lab.padEnd(36), ["fit", "val", "test"].map((k) => cell(rows.filter((r) => r.split === k && pred(r)))).join(" | "));
show("ALL", () => true);
for (const f of ["cap", "liq", "flowTrades", "flowAgeMin", "trades60", "buyers5", "buyers15", "vol15", "bs15", "mom5", "mom15", "runup", "offHigh", "callerCalls", "callerHit2", "hour", "pump"]) {
  const v = rows.filter((r) => r.split === "fit" && r[f] != null).map((r) => r[f]).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => v[Math.floor(p * (v.length - 1))]);
  console.log(`\n${f} fit quintile cuts ${cuts.map((c) => +c.toPrecision(3)).join(", ")}`);
  const edges = [-Infinity, ...cuts, Infinity];
  for (let i = 0; i < 5; i++) show(`  Q${i + 1} (${+edges[i].toPrecision?.(3) || edges[i]}..${+edges[i + 1].toPrecision?.(3) || edges[i + 1]}]`, (r) => r[f] != null && r[f] > edges[i] && r[f] <= edges[i + 1]);
}
