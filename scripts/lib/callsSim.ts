// Call-strategy simulator shared by the evaluator CLI and the Claude-vs-Codex debate referee.
// A strategy sees bars one at a time (never the future): entry and custom-exit decisions are made at a
// bar's close and filled at the NEXT bar's open. Policy exits (stops, trails) act inside bars, stop first.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PolicyState, venueFeePct, type PolicySpec } from "../../packages/core/src/callPolicy.ts";

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; liq: number; res: number }
export interface CallerStats { calls: number; hit2x: number; hit5x: number }
/** One trade before the call (Codex events). walletAgeS: age of the maker's wallet at that trade, in seconds. */
export interface PreTrade { t: number; side: 1 | -1; maker: string; usd: number; tokens: number; walletAgeS: number | null; wash: boolean; sandwich: boolean; block: number }
/** Minute bar with order flow (USD). */
export interface FlowBar { t: number; o: number; h: number; l: number; c: number; volumeUsd: number; liquidityUsd: number; buys: number; sells: number; buyers: number; sellers: number; buyVolUsd: number; sellVolUsd: number; traders: number }
export interface CallCtx {
  mint: string; caller: string; callMs: number;
  /** bars before the call (oldest first, up to ~1 h at 1-minute resolution plus older 15-minute bars) */
  pre: ReadonlyArray<Bar>;
  /** bars from the call up to and including the current bar */
  post: ReadonlyArray<Bar>;
  minutesSinceCall: number;
  /** the caller's record on calls whose 24 h outcome was already known at this call (point-in-time) */
  callerStats: CallerStats;
  /** how many other calls on this token the group made before this one */
  priorCallsOnToken: number;
  /** every trade before the call second (oldest first; up to 8,000, preTradesComplete says whether that is the full history) */
  preTrades: ReadonlyArray<PreTrade>;
  preTradesComplete: boolean;
  /** order-flow minute bars from 6 h before the call, only bars that have finished by the current bar's close */
  flow: ReadonlyArray<FlowBar>;
}
export interface HoldCtx extends CallCtx { entry: number; peak: number; left: number; minutesHeld: number }
export interface CallStrategy {
  name: string;
  description?: string;
  /** stop looking for an entry this many minutes after the call */
  maxWaitMin: number;
  /** decided at the close of each bar after the call; the buy fills at the next bar's open */
  shouldEnter(ctx: CallCtx): boolean;
  /** size in SOL (default 0.1, capped at 0.2) */
  size?(ctx: CallCtx): number;
  /** a shared policy (stop checked inside bars), or a function returning the fraction of the position to sell at the next open */
  exit: PolicySpec | ((ctx: HoldCtx) => number);
  /** optional hard stop checked inside every bar for custom exits (e.g. 0.35 = -35% from entry) */
  hardStop?: number;
}

export const HORIZON_MS = 24 * 3_600_000;
export const FIXED_SOL = 0.003;
export function solUsd(dataDir: string): number {
  const f = resolve(dataDir, "ohlcv/_solusd.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).usd : 120;
}
const impact = (usd: number, liqUsd: number, volUsd: number) =>
  Math.min(0.3, liqUsd > 0 ? usd / (usd + liqUsd / 2) : usd / (usd + 2 * Math.max(0, volUsd)));

export function loadBars(dataDir: string, mint: string): Bar[] | null {
  const dir = resolve(dataDir, "ohlcv", mint);
  if (!existsSync(resolve(dir, "codex_meta.json"))) return null;
  const byT = new Map<number, Bar>();
  for (const f of readdirSync(dir)) {
    const m = f.match(/^codex_m(1|15)_\d+\.json$/);
    if (!m) continue;
    const res = m[1] === "1" ? 60 : 900;
    for (const b of JSON.parse(readFileSync(resolve(dir, f), "utf8")).bars ?? []) {
      const bar: Bar = { t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], liq: b[6] || 0, res };
      const prev = byT.get(bar.t);
      if (!prev || prev.res > res) byT.set(bar.t, bar);
    }
  }
  let bars = [...byT.values()].sort((a, b) => a.t - b.t);
  const mins = bars.filter((b) => b.res === 60);
  if (mins.length) {
    const lo = mins[0].t, hi = mins[mins.length - 1].t;
    bars = bars.filter((b) => b.res === 60 || b.t + b.res * 1000 <= lo || b.t > hi);
  }
  return bars;
}

export function loadPreTrades(dataDir: string, mint: string, callMs: number): { trades: PreTrade[]; complete: boolean } {
  const f = resolve(dataDir, "ohlcv", mint, "codex_events_pre.json");
  if (!existsSync(f)) return { trades: [], complete: false };
  const j = JSON.parse(readFileSync(f, "utf8"));
  const callS = Math.floor(callMs / 1000);
  const trades = (j.events as any[]).filter((e) => e[0] < callS).map((e) => ({ t: e[0] * 1000, side: e[1], maker: e[2], usd: e[3], tokens: e[4], walletAgeS: e[5], wash: !!e[6], sandwich: !!e[7], block: e[8] }) as PreTrade)
    .sort((a, b) => a.t - b.t || a.block - b.block);
  return { trades, complete: !!j.complete };
}
export function loadFlow(dataDir: string, mint: string): FlowBar[] {
  const f = resolve(dataDir, "ohlcv", mint, "codex_flow_m1.json");
  if (!existsSync(f)) return [];
  return (JSON.parse(readFileSync(f, "utf8")).bars as number[][]).map((b) => ({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], volumeUsd: b[5], liquidityUsd: b[6], buys: b[7], sells: b[8], buyers: b[9], sellers: b[10], buyVolUsd: b[11], sellVolUsd: b[12], traders: b[13] }));
}

export interface CallRow { id: number; mint: string; caller: string; callMs: number; priorCallsOnToken: number }
/** First call per token (the book trades a token once), with the group's earlier call count. */
export function loadCalls(dataDir: string, from = 0, to = Infinity): CallRow[] {
  const db = new DatabaseSync(resolve(dataDir, "pumpfun.db"), { readOnly: true });
  const rows = db.prepare(`SELECT id, mint, caller, call_ms FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL ORDER BY call_ms, id`).all() as any[];
  db.close();
  const seen = new Map<string, number>();
  const out: CallRow[] = [];
  for (const r of rows) {
    const n = seen.get(r.mint) ?? 0;
    seen.set(r.mint, n + 1);
    if (n === 0 && r.call_ms >= from && r.call_ms < to) out.push({ id: r.id, mint: r.mint, caller: r.caller, callMs: r.call_ms, priorCallsOnToken: 0 });
  }
  return out;
}

export interface Trade { mint: string; caller: string; callMs: number; entryMs: number; entryDelayMin: number; entryPx: number; sizeSol: number; pnlSol: number; realizedMult: number; peakMult: number; exits: string[] }
export interface EvalResult {
  strategy: string; eligibleCalls: number; entries: number; skippedNoData: number;
  totalSol: number; meanSol: number | null; trimmedMeanSol: number | null; medianSol: number | null; winRate: number | null;
  bestSol: number; totalWithoutBestSol: number; captured5x: number; captured10x: number; tokensThatRan5x: number; tokensThatRan10x: number;
  maxDrawdownSol: number; trades: Trade[];
}

/** Evaluates a strategy over calls, charging venue fees, fixed costs and liquidity-based impact. */
export function evaluate(strategy: CallStrategy, dataDir: string, from: number, to: number, horizonMs = HORIZON_MS): EvalResult {
  const SOL_USD = solUsd(dataDir);
  const calls = loadCalls(dataDir, 0, to);
  const history: { knownMs: number; caller: string; mult: number }[] = [];
  const trades: Trade[] = [];
  let eligible = 0, skipped = 0, ran5 = 0, ran10 = 0;
  for (const call of calls) {
    const bars = loadBars(dataDir, call.mint);
    // outcome of this call becomes known 24 h later (feeds later callers' point-in-time stats)
    let postAll: Bar[] = [];
    if (bars) {
      postAll = bars.filter((b) => b.t >= call.callMs && b.t <= call.callMs + horizonMs);
      const first = postAll[0];
      if (first && first.t <= call.callMs + 10 * 60_000) history.push({ knownMs: call.callMs + horizonMs, caller: call.caller, mult: Math.max(...postAll.map((b) => b.h)) / first.o });
    }
    if (call.callMs < from) continue;
    if (!bars || !postAll.length) { skipped++; continue; }
    eligible++;
    const peakAll = Math.max(...postAll.map((b) => b.h)) / postAll[0].o;
    if (peakAll >= 5) ran5++;
    if (peakAll >= 10) ran10++;
    const known = history.filter((h) => h.caller === call.caller && h.knownMs <= call.callMs);
    const callerStats: CallerStats = { calls: known.length, hit2x: known.filter((h) => h.mult >= 2).length, hit5x: known.filter((h) => h.mult >= 5).length };
    const pre = bars.filter((b) => b.t < call.callMs);
    const pt = loadPreTrades(dataDir, call.mint, call.callMs);
    const flowAll = loadFlow(dataDir, call.mint);
    const flowUntil = (endMs: number) => flowAll.filter((b) => b.t + 60_000 <= endMs);
    const base = { mint: call.mint, caller: call.caller, callMs: call.callMs, pre, callerStats, priorCallsOnToken: call.priorCallsOnToken, preTrades: pt.trades, preTradesComplete: pt.complete, flow: flowUntil(call.callMs) };
    // ---- entry: decide at bar i close, fill at bar i+1 open
    let entryIdx = -1, sizeSol = 0.1;
    // i = -1 is the moment of the call (no post-call bars yet): entering then fills at the first bar's open.
    for (let i = -1; i < postAll.length - 1; i++) {
      const minutes = i < 0 ? 0 : (postAll[i].t - call.callMs) / 60_000;
      if (i >= 0 && minutes > strategy.maxWaitMin) break;
      const ctx: CallCtx = { ...base, post: postAll.slice(0, i + 1), minutesSinceCall: minutes, flow: i < 0 ? base.flow : flowUntil(postAll[i].t + postAll[i].res * 1000) };
      let go = false;
      try { go = strategy.shouldEnter(ctx); } catch { go = false; }
      if (go) { entryIdx = i + 1; sizeSol = Math.min(0.2, Math.max(0.01, strategy.size?.(ctx) ?? 0.1)); break; }
    }
    if (entryIdx < 0) continue;
    const eb = postAll[entryIdx];
    const posUsd = sizeSol * SOL_USD;
    const fee = venueFeePct(call.mint.endsWith("pump") ? "pump-fun" : "other") / 100;
    const tokens = (sizeSol * (1 - fee - impact(posUsd, eb.liq, eb.v))) / eb.o;
    const entry = eb.o;
    let left = 1, proceeds = 0, legs = 1, peak = entry;
    const exits: string[] = [];
    const sell = (px: number, frac: number, bar: Bar, why: string) => {
      const gross = tokens * frac * px;
      proceeds += gross * (1 - fee - impact(gross * SOL_USD, bar.liq, bar.v));
      legs++; left -= frac; exits.push(`${why}@${(px / entry).toFixed(2)}x`);
    };
    const path = postAll.slice(entryIdx);
    if (typeof strategy.exit !== "function") {
      const st = new PolicyState(strategy.exit, entry, eb.t);
      for (const b of path) {
        for (const f of st.onBar(b)) sell(f.px, Math.min(f.frac, left), b, f.reason);
        peak = Math.max(peak, b.h);
        if (st.done) break;
      }
      if (left > 1e-9) { const lb = path[path.length - 1]; sell(lb.c, left, lb, "horizon"); }
    } else {
      const fn = strategy.exit;
      let pendingFrac = 0;
      for (let k = 0; k < path.length && left > 1e-9; k++) {
        const b = path[k];
        if (pendingFrac > 0) { sell(b.o, Math.min(pendingFrac, left), b, "signal"); pendingFrac = 0; if (left <= 1e-9) break; }
        if (strategy.hardStop && b.l <= entry * (1 - strategy.hardStop)) { sell(Math.min(b.o, entry * (1 - strategy.hardStop)), left, b, "hard_stop"); break; }
        peak = Math.max(peak, b.h);
        const ctx: HoldCtx = { ...base, post: postAll.slice(0, entryIdx + k + 1), minutesSinceCall: (b.t - call.callMs) / 60_000, entry, peak, left, minutesHeld: (b.t - eb.t) / 60_000, flow: flowUntil(b.t + b.res * 1000) };
        let frac = 0;
        try { frac = Math.max(0, Math.min(1, fn(ctx))); } catch { frac = 0; }
        pendingFrac = frac * left;
      }
      if (left > 1e-9) { const lb = path[path.length - 1]; sell(lb.c, left, lb, "horizon"); }
    }
    const pnl = proceeds - sizeSol - FIXED_SOL * legs;
    trades.push({ mint: call.mint, caller: call.caller, callMs: call.callMs, entryMs: eb.t, entryDelayMin: (eb.t - call.callMs) / 60_000, entryPx: entry, sizeSol,
      pnlSol: pnl, realizedMult: (proceeds / sizeSol), peakMult: peak / entry, exits });
  }
  const v = trades.map((t) => t.pnlSol), n = v.length, sorted = [...v].sort((a, b) => a - b), total = v.reduce((a, b) => a + b, 0);
  const trimmed = n > 4 ? sorted.slice(0, n - 2) : sorted;
  let cum = 0, pk = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.entryMs - b.entryMs)) { cum += t.pnlSol; pk = Math.max(pk, cum); dd = Math.max(dd, pk - cum); }
  return {
    strategy: strategy.name, eligibleCalls: eligible, entries: n, skippedNoData: skipped,
    totalSol: +total.toFixed(4), meanSol: n ? +(total / n).toFixed(5) : null, trimmedMeanSol: trimmed.length ? +(trimmed.reduce((a, b) => a + b, 0) / trimmed.length).toFixed(5) : null,
    medianSol: n ? +sorted[Math.floor(n / 2)].toFixed(5) : null, winRate: n ? +(v.filter((x) => x > 0).length / n * 100).toFixed(1) : null,
    bestSol: n ? +sorted[n - 1].toFixed(4) : 0, totalWithoutBestSol: n ? +(total - sorted[n - 1]).toFixed(4) : 0,
    captured5x: trades.filter((t) => t.realizedMult >= 5).length, captured10x: trades.filter((t) => t.realizedMult >= 10).length,
    tokensThatRan5x: ran5, tokensThatRan10x: ran10, maxDrawdownSol: +dd.toFixed(4), trades,
  };
}
