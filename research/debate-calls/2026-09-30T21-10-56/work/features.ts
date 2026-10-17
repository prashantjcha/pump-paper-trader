// Pre-call features per call (only ctx-available data) joined with trade outcomes, bucketed by split.
//   npx tsx research/debate-calls/2026-09-30T21-10-56/work/features.ts
import "./grid.ts";
import { resolve } from "node:path";
import { evaluate, type CallCtx, type CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import { SPLITS } from "./grid.ts";

const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");

export function feats(c: CallCtx) {
  const tr = c.preTrades, call = c.callMs;
  const hr = tr.filter((t) => t.t >= call - 3_600_000);
  const buys = tr.filter((t) => t.side === 1), sells = tr.filter((t) => t.side === -1);
  const bu = buys.reduce((a, t) => a + t.usd, 0), su = sells.reduce((a, t) => a + t.usd, 0);
  const newW = new Set(hr.filter((t) => t.side === 1 && t.walletAgeS != null && t.walletAgeS < 86_400).map((t) => t.maker)).size;
  const hold = new Map<string, number>();
  for (const t of tr) hold.set(t.maker, (hold.get(t.maker) ?? 0) + t.side * t.tokens);
  const pos = [...hold.values()].filter((v) => v > 0).sort((a, b) => b - a);
  const tot = pos.reduce((a, b) => a + b, 0);
  const top5 = tot ? pos.slice(0, 5).reduce((a, b) => a + b, 0) / tot : 0;
  const firstBlock = tr.length ? tr[0].block : 0;
  const launchBuyers = new Set(tr.filter((t) => t.block === firstBlock && t.side === 1).map((t) => t.maker)).size;
  const big = buys.filter((t) => t.usd >= 500).length;
  const ageMin = tr.length ? (call - tr[0].t) / 60_000 : null;
  const makers = new Set(tr.map((t) => t.maker)).size;
  const lastPre = c.pre.length ? c.pre[c.pre.length - 1] : null;
  const f5 = c.flow.filter((b) => b.t >= call - 5 * 60_000);
  const fb5 = f5.reduce((a, b) => a + b.buyVolUsd, 0), fs5 = f5.reduce((a, b) => a + b.sellVolUsd, 0);
  const fl = c.flow.filter((b) => b.buys + b.sells > 0);
  const flowTrades = fl.reduce((a, b) => a + b.buys + b.sells, 0);
  const flowAgeMin = fl.length ? (call - fl[0].t) / 60_000 : 0;
  const preHigh = Math.max(0, ...c.flow.map((b) => b.h));
  const firstPx = fl.length ? fl[0].o : 0;
  return { flowTrades, flowAgeMin, flowBars: fl.length, runup: firstPx > 0 && lastPre ? lastPre.c / firstPx : null, offHigh: preHigh > 0 && lastPre ? lastPre.c / preHigh : null, preBars: c.pre.length,
    n: tr.length, complete: c.preTradesComplete, newW, bs: su > 0 ? bu / su : 99, top5, holders: pos.length, launchBuyers, big, ageMin, makers,
    liq: lastPre?.liq ?? 0, px: lastPre?.c ?? 0, vol5: fb5 + fs5, bs5: fs5 > 0 ? fb5 / fs5 : 99, callerCalls: c.callerStats.calls, callerHit2: c.callerStats.calls ? c.callerStats.hit2x / c.callerStats.calls : null };
}

if (process.argv[1]?.endsWith("features.ts")) {
  const F = new Map<string, ReturnType<typeof feats>>();
  const s: CallStrategy = { name: "all<=400", maxWaitMin: 0, shouldEnter: (c) => { F.set(c.mint, feats(c)); return true; }, exit: { family: "trailing", arm: 200, trail: 40, sl: 50 } };
  const s2: CallStrategy = { ...s, exit: { family: "fixed", tp: 100, sl: 50 } };
  const rows: any[] = [];
  for (const [k, a, b] of SPLITS) {
    const r = evaluate(s, DATA, a, b), r2 = evaluate(s2, DATA, a, b);
    const live = new Map(r2.trades.map((t) => [t.mint, t.pnlSol]));
    for (const t of r.trades) rows.push({ split: k, mint: t.mint, caller: t.caller, callMs: t.callMs, pnl: t.pnlSol, pnlLive: live.get(t.mint), peak: t.peakMult, ...F.get(t.mint) });
  }
  const { writeFileSync } = await import("node:fs");
  writeFileSync(resolve("research/debate-calls/2026-09-30T21-10-56/work/features.json"), JSON.stringify(rows));
  console.log(rows.length);
}
