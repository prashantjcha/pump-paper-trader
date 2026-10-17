// Call-time filters (last pre-call bar) x a few exits, fit and validation.
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/filters.ts
import { evaluate, type CallCtx, type CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const DATA = "research/debate-calls/2026-09-30T19-09-03/data";
const FIT: [number, number] = [0, Date.parse("2026-09-18")];
const VAL: [number, number] = [Date.parse("2026-09-18"), Date.parse("2026-09-26")];
const fmt = (r: ReturnType<typeof evaluate>) =>
  `n${String(r.entries).padStart(4)} tot${r.totalSol.toFixed(2).padStart(7)} mean${(r.meanSol ?? 0).toFixed(4).padStart(8)} trim${(r.trimmedMeanSol ?? 0).toFixed(4).padStart(8)} woBest${r.totalWithoutBestSol.toFixed(2).padStart(7)} win${String(r.winRate).padStart(5)}% c5/10 ${r.captured5x}/${r.captured10x}`;
const lastPre = (c: CallCtx) => c.pre[c.pre.length - 1];
const filters: [string, (c: CallCtx) => boolean][] = [
  ["all", () => true],
  ["liq>=15K", (c) => (lastPre(c)?.liq ?? 0) >= 15_000],
  ["liq>=30K", (c) => (lastPre(c)?.liq ?? 0) >= 30_000],
  ["mcap15-100K", (c) => { const m = (lastPre(c)?.c ?? 0) * 1e6; return m >= 15 && m <= 100; }],
  ["mcap>=100K", (c) => (lastPre(c)?.c ?? 0) * 1e6 >= 100],
  ["mcap<15K", (c) => (lastPre(c)?.c ?? 0) * 1e6 < 15],
];
const exits: [string, PolicySpec][] = [
  ["tp100 sl30", { family: "fixed", tp: 100, sl: 30 }],
  ["tp900 sl30", { family: "fixed", tp: 900, sl: 30 }],
  ["trail arm100 t50 sl50", { family: "trailing", arm: 100, trail: 50, sl: 50 }],
  ["hold24h", { family: "time", hMin: 1440, sl: null }],
];
for (const [fn, f] of filters) for (const [xn, x] of exits) {
  const s: CallStrategy = { name: `${fn} | ${xn}`, maxWaitMin: 0, shouldEnter: f, exit: x };
  console.log(`${s.name.padEnd(34)} FIT ${fmt(evaluate(s, DATA, ...FIT))} || VAL ${fmt(evaluate(s, DATA, ...VAL))}`);
}
