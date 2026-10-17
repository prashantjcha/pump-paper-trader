// Pure entry/exit rules. No I/O: the same functions drive live paper trading,
// replay and shadow trades.
import type { EntryParams, ExitParams } from "./config.ts";
import type { Features, TokenState } from "./tokenState.ts";
import type { TradeEv } from "./events.ts";
import { TOTAL_SUPPLY } from "./curve.ts";

export interface EntryCheck { ok: boolean; fails: string[] }

/** Safety filters applied to every book (momentum, copy, manual, shadow). */
export function safetyFails(s: TokenState, f: Features, p: EntryParams, blacklist: Set<string>): string[] {
  const fails: string[] = [];
  if (!s.solQuote) fails.push("non_sol_quote");
  if (s.complete) fails.push("complete");
  if (s.mayhem) fails.push("mayhem");
  if (f.devHoldPct > p.devHoldMaxPct) fails.push("dev_hold");
  if (f.sameSlotBuyers > p.maxSameSlotBuyers) fails.push("bundle");
  if (f.top1Pct > p.top1MaxPct) fails.push("top1");
  if (f.top10Pct > p.top10MaxPct) fails.push("top10");
  if (p.blacklistCreators && blacklist.has(s.creator)) fails.push("creator_blacklist");
  if (f.creatorPriorLaunches > p.maxCreatorPriorLaunches) fails.push("serial_creator");
  if (s.devSold) fails.push("dev_sold");
  return fails;
}

/** Momentum entry: every filter must pass. Returns the list of failing filters (used for shadow attribution). */
export function momentumEntry(s: TokenState, f: Features, p: EntryParams, blacklist: Set<string>): EntryCheck {
  const fails = safetyFails(s, f, p, blacklist);
  if (!s.known) fails.push("unknown_age");
  if (f.ageS < p.minAgeS) fails.push("too_young");
  if (f.ageS > p.maxAgeS) fails.push("too_old");
  if (f.solRaised < p.minSolRaised) fails.push("sol_raised_low");
  if (f.solRaised > p.maxSolRaised) fails.push("sol_raised_high");
  if (f.devBuySol < p.devBuyMin) fails.push("dev_buy_small");
  if (f.devBuySol > p.devBuyMax) fails.push("dev_buy_large");
  if (f.uniqueBuyersW < p.minUniqueBuyers) fails.push("few_buyers");
  if (f.bsRatioW < p.minBuySellRatio) fails.push("bs_ratio");
  if (f.netInflowW < p.minNetInflowSol) fails.push("inflow");
  if (f.buys5s < p.minBuysLast5s) fails.push("velocity");
  return { ok: fails.length === 0, fails };
}

export type ExitReason =
  | "dev_sell" | "whale_sell" | "smart_exit" | "near_graduation" | "graduated"
  | "stop_loss" | "stop_loss_tight" | "take_profit" | "trailing_stop" | "time_stop" | "kill_switch" | "stale";

export interface ExitContext {
  /** Net PnL after all costs (take profit, trailing). */
  pnlPct: number; peakPnlPct: number;
  /** Price risk: liquidation value vs liquidation value right after the fill (stops). Fees cannot trigger it. */
  riskPct: number;
  holdS: number; fillMs: number; tokensHeld: number;
  copiedWallet?: string;
}

export function takeProfitFor(f: Features, p: ExitParams): { tp: number; regime: "rising" | "flat" | "falling" } {
  if (f.buyVol10 > f.buyVolPrev10 * 1.2 && f.buyVol10 > 0) return { tp: p.tpRisingPct, regime: "rising" };
  if (f.buyVol10 < f.buyVolPrev10 * 0.8) return { tp: p.tpFallingPct, regime: "falling" };
  return { tp: p.tpFlatPct, regime: "flat" };
}

export function stopLossFor(f: Features, p: ExitParams): { sl: number; tight: boolean } {
  const tight = f.lastBuyAgoS >= p.noBuyTightenS || f.bsRatio10 < p.bsTightenRatio;
  return { sl: tight ? p.slTightPct : p.slBasePct, tight };
}

/**
 * Exit decision. `ev` is the trade that triggered evaluation (undefined on timer ticks).
 * Event-driven triggers (dev/whale/smart sells) only fire on sells after our fill.
 */
export function exitDecision(
  s: TokenState, f: Features, p: ExitParams, c: ExitContext, ev: TradeEv | undefined, smart: Set<string>,
): ExitReason | null {
  if (ev && !ev.isBuy && ev.recvMs > c.fillMs) {
    if (p.exitOnDevSell && ev.user === s.creator) return "dev_sell";
    const sol = Number(ev.sol) / 1e9;
    const pctSupply = (Number(ev.tokens) / Number(TOTAL_SUPPLY)) * 100;
    if (sol >= p.bigSellSol || pctSupply >= p.bigSellSupplyPct) return "whale_sell";
    if (p.exitOnSmartExit && (smart.has(ev.user) || ev.user === c.copiedWallet) && !s.holders.has(ev.user)) return "smart_exit";
  }
  if (s.complete) return "graduated";
  if (f.progress >= p.maxProgressPct) return "near_graduation";
  const { sl, tight } = stopLossFor(f, p);
  if (c.riskPct <= -sl) return tight ? "stop_loss_tight" : "stop_loss";
  const { tp } = takeProfitFor(f, p);
  if (c.pnlPct >= tp) return "take_profit";
  if (c.peakPnlPct >= p.trailArmPct) {
    const fromPeak = (1 - (1 + c.pnlPct / 100) / (1 + c.peakPnlPct / 100)) * 100;
    if (fromPeak >= p.trailPct) return "trailing_stop";
  }
  if (c.holdS >= p.timeStopS) return "time_stop";
  return null;
}
