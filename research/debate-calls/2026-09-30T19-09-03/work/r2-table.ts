// Round 2: enter every call (at the call), record call-time features from COMPLETED pre-call bars only
// (b.t + b.res <= callMs, fixing the lookahead Codex found), and the referee P&L for several exits at 0.1 and 0.2 SOL.
// Writes work/r2-table.json for slicing in r2-slice.ts.
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/r2-table.ts
import { writeFileSync } from "node:fs";
import { evaluate, type CallCtx, type CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const DATA = "research/debate-calls/2026-09-30T19-09-03/data";
const END = Date.parse("2026-09-26");
export const done = (c: CallCtx) => c.pre.filter((b) => b.t + b.res * 1000 <= c.callMs);
export function features(c: CallCtx) {
  const pre = done(c), last = pre[pre.length - 1];
  const win = (min: number) => pre.filter((b) => b.t >= c.callMs - min * 60_000);
  const ret = (min: number) => { const h = win(min); return h.length >= 2 ? h[h.length - 1].c / h[0].o : 0; };
  const vol = (min: number) => win(min).reduce((a, b) => a + b.v, 0);
  const h60 = win(60);
  const hi60 = h60.length ? Math.max(...h60.map((b) => b.h)) : 0;
  return {
    mint: c.mint, caller: c.caller, callMs: c.callMs,
    liq: last?.liq ?? 0, px: last?.c ?? 0, lastAgeMin: last ? (c.callMs - last.t) / 60_000 : 1e9,
    r5: ret(5), r15: ret(15), r60: ret(60), v5: vol(5), v60: vol(60),
    offHigh: hi60 && last ? last.c / hi60 : 0, nPre: pre.length, hour: new Date(c.callMs).getUTCHours(),
    cCalls: c.callerStats.calls, c2x: c.callerStats.hit2x, c5x: c.callerStats.hit5x,
    pump: c.mint.endsWith("pump"),
  };
}
const exits: [string, PolicySpec][] = [
  ["tp50sl30", { family: "fixed", tp: 50, sl: 30 }],
  ["tp30sl20", { family: "fixed", tp: 30, sl: 20 }],
  ["tp100sl30", { family: "fixed", tp: 100, sl: 30 }],
  ["tp20sl20", { family: "fixed", tp: 20, sl: 20 }],
  ["tp1100sl90", { family: "fixed", tp: 1100, sl: 90 }],
  ["run30/3m t50 sl20", { family: "hold-runner", x: 30, tMin: 3, trail: 50, sl: 20 }],
  ["trail arm50 t30 sl30", { family: "trailing", arm: 50, trail: 30, sl: 30 }],
];
const feat = new Map<string, ReturnType<typeof features>>();
const pnl: Record<string, Record<string, { pnl: number; real: number }>> = {};
for (const size of [0.1, 0.2]) for (const [xn, x] of exits) {
  const key = `${xn}@${size}`;
  const s: CallStrategy = { name: key, maxWaitMin: 0, size: () => size, exit: x,
    shouldEnter: (c) => { if (!feat.has(c.mint)) feat.set(c.mint, features(c)); return true; } };
  const r = evaluate(s, DATA, 0, END);
  pnl[key] = Object.fromEntries(r.trades.map((t) => [t.mint, { pnl: t.pnlSol, real: t.realizedMult }]));
  console.log(key, r.entries, r.trimmedMeanSol);
}
const rows = [...feat.values()].filter((f) => pnl["tp50sl30@0.1"][f.mint]).map((f) => ({
  ...f, out: Object.fromEntries(Object.entries(pnl).map(([k, m]) => [k, m[f.mint]])),
}));
writeFileSync("research/debate-calls/2026-09-30T19-09-03/work/r2-table.json", JSON.stringify(rows));
console.log("rows", rows.length);
