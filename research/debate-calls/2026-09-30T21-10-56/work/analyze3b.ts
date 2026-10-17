// Round 2: re-run the ctx.pre-dependent quintiles of analyze3.ts with a leak-free anchor (Codex r1 point 5).
// ctx.pre's last bar starts before the call but ends after it, so its close is post-call. Here the anchor is the close
// of the last order-flow minute bar that FINISHED before the call; liquidity likewise. Outcomes are unchanged (entry at call).
//   npx tsx research/debate-calls/2026-09-30T21-10-56/work/analyze3b.ts   (needs features.json from features.ts)
import "./grid.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBars, loadFlow } from "../../../../scripts/lib/callsSim.ts";
const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const m = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const tm = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return m(a.length > 4 ? s.slice(0, -2) : s); };
const cell = (rs: any[]) => `n${String(rs.length).padStart(3)} tm${tm(rs.map((r) => r.pnl)).toFixed(4)} live${tm(rs.map((r) => r.pnlLive)).toFixed(4)}`;
let unfinished = 0;
for (const r of rows) {
  const bars = loadBars(DATA, r.mint)!, flow = loadFlow(DATA, r.mint).filter((b) => b.t + 60_000 <= r.callMs);
  const pre = bars.filter((b) => b.t < r.callMs);
  const lp = pre[pre.length - 1];
  if (lp && lp.t + lp.res * 1000 > r.callMs) unfinished++;
  const last = flow.length ? flow[flow.length - 1] : null;
  const anchor = last?.c ?? null;
  const w = (min: number) => flow.filter((b) => b.t >= r.callMs - min * 60_000);
  const f5 = w(5), f15 = w(15), fl = flow.filter((b) => b.buys + b.sells > 0);
  const hi = Math.max(0, ...flow.map((b) => b.h));
  r.capF = anchor != null ? anchor * 1e9 : null;
  r.liqF = last?.liquidityUsd ?? null;
  r.mom5F = anchor != null && f5.length ? anchor / f5[0].o : null;
  r.mom15F = anchor != null && f15.length ? anchor / f15[0].o : null;
  r.runupF = anchor != null && fl.length && fl[0].o > 0 ? anchor / fl[0].o : null;
  r.offHighF = anchor != null && hi > 0 ? anchor / hi : null;
}
console.log(`calls whose last ctx.pre bar ends after the call: ${unfinished}/${rows.length}`);
const show = (lab: string, pred: (r: any) => boolean) => console.log(lab.padEnd(34), ["fit", "val", "test"].map((k) => cell(rows.filter((r) => r.split === k && pred(r)))).join(" | "));
show("ALL", () => true);
for (const f of ["capF", "liqF", "mom5F", "mom15F", "runupF", "offHighF"]) {
  const v = rows.filter((r) => r.split === "fit" && r[f] != null).map((r) => r[f]).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => v[Math.floor(p * (v.length - 1))]);
  console.log(`\n${f} fit quintile cuts ${cuts.map((c) => +c.toPrecision(3)).join(", ")} (missing anchor: ${rows.filter((r) => r[f] == null).length})`);
  const edges = [-Infinity, ...cuts, Infinity];
  for (let i = 0; i < 5; i++) show(`  Q${i + 1}`, (r) => r[f] != null && r[f] > edges[i] && r[f] <= edges[i + 1]);
}
