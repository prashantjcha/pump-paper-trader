// Entry x exit grid on the fit window (< 2026-09-18) and validation (2026-09-18 .. 2026-09-26).
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/grid.ts
import { evaluate, type CallCtx, type CallStrategy, type HoldCtx } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const DATA = "research/debate-calls/2026-09-30T19-09-03/data";
const FIT: [number, number] = [0, Date.parse("2026-09-18")];
const VAL: [number, number] = [Date.parse("2026-09-18"), Date.parse("2026-09-26")];

const mcapK = (px: number) => px * 1e6; // price (USD) x 1e9 supply / 1000
type Entry = { name: string; maxWaitMin: number; go: (c: CallCtx) => boolean };
const entries: Entry[] = [
  { name: "at-call", maxWaitMin: 0, go: () => true },
  { name: "t5", maxWaitMin: 6, go: (c) => c.minutesSinceCall >= 5 },
  { name: "t5 mcap15-150K", maxWaitMin: 6, go: (c) => c.minutesSinceCall >= 5 && inBand(c, 15, 150) },
  { name: "t5 mcap15-150K up", maxWaitMin: 6, go: (c) => c.minutesSinceCall >= 5 && inBand(c, 15, 150) && last(c).c >= c.post[0].o },
  { name: "brk30 mcap>15K", maxWaitMin: 30, go: (c) => breakout(c) && mcapK(last(c).c) >= 15 },
];
const last = (c: CallCtx) => c.post[c.post.length - 1];
function inBand(c: CallCtx, lo: number, hi: number) { const m = mcapK(last(c).c); return m >= lo && m <= hi; }
function breakout(c: CallCtx) {
  if (c.post.length < 4) return false;
  const cur = last(c), prior = c.post.slice(0, -1);
  return cur.c > Math.max(...prior.map((b) => b.h)) && cur.v >= 3 * prior.reduce((a, b) => a + b.v, 0) / prior.length;
}

// ladder: sell `f1` of the original at x1, `f2` at x2, trail the rest `trail` from peak once above x1; hard stop sl
function ladder(x1: number, f1: number, x2: number, f2: number, trail: number): (h: HoldCtx) => number {
  return (h) => {
    const m = h.post[h.post.length - 1].c / h.entry, sold = 1 - h.left;
    if (m >= x2 && sold < f1 + f2 - 1e-9) return (f1 + f2 - sold) / h.left;
    if (m >= x1 && sold < f1 - 1e-9) return (f1 - sold) / h.left;
    if (h.peak / h.entry >= x1 && h.post[h.post.length - 1].c < h.peak * (1 - trail)) return 1;
    return 0;
  };
}
type Exit = { name: string; exit: PolicySpec | ((h: HoldCtx) => number); hardStop?: number };
const exits: Exit[] = [
  { name: "hold24h", exit: { family: "time", hMin: 1440, sl: null } },
  { name: "trail arm100 t50 sl50", exit: { family: "trailing", arm: 100, trail: 50, sl: 50 } },
  { name: "scale 100 t50 sl50", exit: { family: "scale-out", x: 100, trail: 50, sl: 50 } },
  { name: "ladder 2x/.4 5x/.3 t50 sl50", exit: ladder(2, 0.4, 5, 0.3, 0.5), hardStop: 0.5 },
  { name: "ladder 2x/.5 5x/.25 t60 sl60", exit: ladder(2, 0.5, 5, 0.25, 0.6), hardStop: 0.6 },
  { name: "ladder 3x/.34 10x/.33 t60 nostop", exit: ladder(3, 0.34, 10, 0.33, 0.6) },
];

const fmt = (r: ReturnType<typeof evaluate>) =>
  `n${String(r.entries).padStart(4)} tot${r.totalSol.toFixed(2).padStart(7)} mean${(r.meanSol ?? 0).toFixed(4).padStart(8)} trim${(r.trimmedMeanSol ?? 0).toFixed(4).padStart(8)} woBest${r.totalWithoutBestSol.toFixed(2).padStart(7)} win${String(r.winRate).padStart(5)}% c5/10 ${r.captured5x}/${r.captured10x}`;
for (const e of entries) for (const x of exits) {
  const s: CallStrategy = { name: `${e.name} | ${x.name}`, maxWaitMin: e.maxWaitMin, shouldEnter: e.go, exit: x.exit, hardStop: x.hardStop };
  const f = evaluate(s, DATA, ...FIT), v = evaluate(s, DATA, ...VAL);
  console.log(`${s.name.padEnd(52)} FIT ${fmt(f)} || VAL ${fmt(v)}`);
}
