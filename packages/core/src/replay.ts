// Replays recorded events through the exact live engine. Used for validating
// strategy changes on data the learning step did not see.
import { Engine, type BookKind, type Position } from "./engine.ts";
import type { StrategyParams } from "./config.ts";
import { readRaw } from "./rawio.ts";
import type { PumpEvent } from "./events.ts";

export interface ReplayStats {
  trades: number; failed: number; voided: number; wins: number; winRate: number;
  expectancySol: number; totalPnlSol: number; profitFactor: number; maxDrawdownSol: number;
  avgHoldS: number; avgPnlPct: number; exitReasons: Record<string, number>; events: number; hours: number;
}

export interface ReplayOpts {
  params: StrategyParams;
  from: number; to: number;
  books?: BookKind[];
  /** Measure the rule's edge without capital/concurrency limits (more samples). */
  unlimited?: boolean;
  smart?: Set<string>; blacklist?: Set<string>;
  /** Launches before the window, so the serial-creator filter matches live behaviour. */
  seedCreators?: { creator: string; t: number }[];
  events?: Iterable<PumpEvent>;
  seed?: number;
}

export function summarize(closed: Position[], failed: Position[], events = 0, hours = 0, voided = 0): ReplayStats {
  const all = [...closed].sort((a, b) => (a.exitFillMs ?? 0) - (b.exitFillMs ?? 0));
  let cum = 0, peak = 0, maxDd = 0, gp = 0, gl = 0, wins = 0, hold = 0, pct = 0;
  const reasons: Record<string, number> = {};
  for (const p of all) {
    const v = p.pnlSol ?? 0;
    cum += v; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum);
    if (v > 0) { gp += v; wins++; } else gl -= v;
    hold += p.holdS ?? 0; pct += p.pnlPct ?? 0;
    reasons[p.exitReason ?? "?"] = (reasons[p.exitReason ?? "?"] ?? 0) + 1;
  }
  const failCost = failed.reduce((a, p) => a + (p.pnlSol ?? 0), 0);
  cum += failCost;
  const n = all.length;
  return {
    trades: n, failed: failed.length, voided, wins, winRate: n ? wins / n : 0,
    expectancySol: n ? cum / n : 0, totalPnlSol: cum, profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    maxDrawdownSol: maxDd, avgHoldS: n ? hold / n : 0, avgPnlPct: n ? pct / n : 0,
    exitReasons: reasons, events, hours,
  };
}

export function runReplay(o: ReplayOpts): { stats: ReplayStats; closed: Position[]; failed: Position[] } {
  const books = o.books ?? ["momentum"];
  const closed: Position[] = [], failed: Position[] = [];
  let voided = 0;
  const eng = new Engine({
    params: o.params, version: 0, books, startSol: 1, smart: o.smart, blacklist: o.blacklist, seed: o.seed ?? 7,
    hooks: { onClose: (p) => closed.push({ ...p }), onFail: (p) => failed.push({ ...p }), onVoid: () => { voided++; } },
  });
  if (o.unlimited) for (const b of eng.books.values()) b.unlimited = true;
  for (const c of o.seedCreators ?? []) eng.noteCreate(c.creator, c.t);
  let n = 0, lastEvict = 0;
  for (const e of o.events ?? readRaw(o.from, o.to)) {
    eng.onEvent(e);
    n++;
    if (e.recvMs - lastEvict > 60_000) { eng.evict(e.recvMs); lastEvict = e.recvMs; }
  }
  // End of data is a gap too: positions still open are voided, never filled at stale end-of-window prices.
  eng.advance(Math.max(eng.lastEventMs, o.from) + eng.gapMs + 1);
  return { stats: summarize(closed, failed, n, (o.to - o.from) / 3_600_000, voided), closed, failed };
}
