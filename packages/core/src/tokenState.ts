// Per-mint in-memory state rebuilt purely from the event stream. Shared by the
// live bot, the replay engine and shadow trading, so all three see identical features.
import type { CreateEv, TradeEv, PumpEvent } from "./events.ts";
import { price, progressPct, solRaised, mcapSol, TOTAL_SUPPLY, type Reserves } from "./curve.ts";

export interface MiniTrade { t: number; isBuy: boolean; sol: number; tokens: number; user: string; slot: number; price: number }

export class TokenState {
  mint: string;
  creator = "";
  symbol = "";
  name = "";
  uri = "";
  createMs = 0;
  createSlot = 0;
  known = false; // true when we saw the CreateEvent (otherwise age is unknown)
  solQuote = true;
  complete = false;
  mayhem = false; // Mayhem Mode: protocol agent trades with different virtual params; not traded in v1
  reserves: Reserves = { vSol: 0n, vTok: 0n, rTok: 0n };
  rSol = 0n;
  lastSlot = 0; // highest slot applied to reserves; older arrivals must not rewind the curve
  staleUpdates = 0; // real SOL in the curve: exact SOL raised, independent of the curve's virtual starting reserves
  holders = new Map<string, number>(); // whole tokens
  trades: MiniTrade[] = []; // rolling window (see TRADE_WINDOW_MS)
  tradeCount = 0;
  uniqueTraders = new Set<string>();
  devBuySol = 0;
  devSold = false;
  devSoldMs = 0;
  sameSlotBuyers = new Set<string>();
  lastBuyMs = 0;
  lastTradeMs = 0;
  firstPrice = 0;
  peakPrice = 0;
  volumeSol = 0;
  lastSell: MiniTrade | null = null;
  creatorPriorLaunches = 0; // other tokens this creator launched in the prior 24h (set by the engine)
  feeBps = 125; // protocol + creator, updated from each TradeEvent

  constructor(mint: string) { this.mint = mint; }

  static readonly TRADE_WINDOW_MS = 120_000;

  onCreate(e: CreateEv) {
    if (e.slot > this.lastSlot) this.lastSlot = e.slot;
    this.known = true;
    this.creator = e.creator || e.user;
    this.symbol = e.symbol; this.name = e.name; this.uri = e.uri;
    this.createMs = e.recvMs; this.createSlot = e.slot;
    this.solQuote = e.solQuote;
    if (e.mayhem) this.mayhem = true;
    if (this.reserves.vTok === 0n) this.reserves = { vSol: e.vSol, vTok: e.vTok, rTok: e.rTok };
    this.firstPrice = price(this.reserves);
    this.peakPrice = this.firstPrice;
  }

  onTrade(e: TradeEv) {
    const sol = Number(e.sol) / 1e9;
    const tokens = Number(e.tokens) / 1e6;
    // Two feeds race, so an older trade can arrive after a newer one. Keep its volume and
    // holder effects, but never let it rewind reserves (price) to an earlier state.
    const stale = e.slot < this.lastSlot;
    if (stale) this.staleUpdates++;
    else { this.reserves = { vSol: e.vSol, vTok: e.vTok, rTok: e.rTok }; this.rSol = e.rSol; this.lastSlot = e.slot; }
    if (e.feeBps + e.creatorFeeBps > 0) this.feeBps = e.feeBps + e.creatorFeeBps;
    if (!e.solQuote) this.solQuote = false;
    if (e.mayhem) this.mayhem = true;
    const p = price(this.reserves);
    if (!this.firstPrice) this.firstPrice = p;
    if (p > this.peakPrice) this.peakPrice = p;
    const t: MiniTrade = { t: e.recvMs, isBuy: e.isBuy, sol, tokens, user: e.user, slot: e.slot, price: p };
    this.trades.push(t);
    this.tradeCount++;
    this.volumeSol += sol;
    this.uniqueTraders.add(e.user);
    this.lastTradeMs = e.recvMs;
    if (!this.creator && e.creator) this.creator = e.creator;
    const held = (this.holders.get(e.user) ?? 0) + (e.isBuy ? tokens : -tokens);
    if (held > 0.5) this.holders.set(e.user, held); else this.holders.delete(e.user);
    const isDev = e.user === this.creator;
    if (e.isBuy) {
      this.lastBuyMs = e.recvMs;
      if (isDev && this.known && e.slot === this.createSlot) this.devBuySol += sol;
      else if (this.known && e.slot === this.createSlot) this.sameSlotBuyers.add(e.user);
    } else {
      this.lastSell = t;
      if (isDev && !this.devSold) { this.devSold = true; this.devSoldMs = e.recvMs; }
    }
    // trim rolling window
    const cutoff = e.recvMs - TokenState.TRADE_WINDOW_MS;
    let i = 0;
    while (i < this.trades.length && this.trades[i].t < cutoff) i++;
    if (i > 0) this.trades.splice(0, i);
  }

  get price() { return price(this.reserves); }
}

export interface Features {
  ageS: number; known: boolean; solRaised: number; progress: number; mcapSol: number; price: number;
  buysW: number; sellsW: number; uniqueBuyersW: number; netInflowW: number; bsRatioW: number;
  buys5s: number; buyVol10: number; buyVolPrev10: number; netFlow10: number; bsRatio10: number;
  lastBuyAgoS: number; devBuySol: number; devHoldPct: number; devSold: boolean; sameSlotBuyers: number;
  top1Pct: number; top10Pct: number; holders: number; tradeCount: number; uniqueTraders: number;
  solPerTrade: number; volumeSol: number; peakMult: number; drawFromPeakPct: number; hourUtc: number;
  smartBuyers: number; creatorPriorLaunches: number;
}

export function features(s: TokenState, now: number, windowS = 15, smart?: Set<string>): Features {
  const wStart = now - windowS * 1000;
  let buysW = 0, sellsW = 0, inW = 0, outW = 0, buys5 = 0, bv10 = 0, bvPrev = 0, sv10 = 0, b10 = 0, s10 = 0;
  const buyers = new Set<string>();
  let smartBuyers = 0;
  const smartSeen = new Set<string>();
  for (const t of s.trades) {
    const age = now - t.t;
    if (t.t >= wStart) {
      if (t.isBuy) { buysW++; inW += t.sol; buyers.add(t.user); } else { sellsW++; outW += t.sol; }
    }
    if (t.isBuy && age <= 5000) buys5++;
    if (age <= 10_000) { if (t.isBuy) { bv10 += t.sol; b10++; } else { sv10 += t.sol; s10++; } }
    else if (age <= 20_000 && t.isBuy) bvPrev += t.sol;
    if (smart && t.isBuy && smart.has(t.user) && !smartSeen.has(t.user)) { smartSeen.add(t.user); smartBuyers++; }
  }
  const supply = Number(TOTAL_SUPPLY) / 1e6;
  let top: number[] = [];
  let devHold = 0;
  for (const [w, amt] of s.holders) {
    if (w === s.creator) { devHold = amt; continue; }
    top.push(amt);
  }
  top.sort((a, b) => b - a);
  top = top.slice(0, 10);
  const p = s.price;
  return {
    ageS: s.known ? (now - s.createMs) / 1000 : -1,
    known: s.known,
    solRaised: s.rSol > 0n ? Number(s.rSol) / 1e9 : Math.max(0, solRaised(s.reserves.vSol)),
    progress: progressPct(s.reserves.rTok),
    mcapSol: mcapSol(s.reserves),
    price: p,
    buysW, sellsW,
    uniqueBuyersW: buyers.size,
    netInflowW: inW - outW,
    bsRatioW: sellsW === 0 ? buysW : buysW / sellsW,
    buys5s: buys5,
    buyVol10: bv10, buyVolPrev10: bvPrev, netFlow10: bv10 - sv10,
    bsRatio10: s10 === 0 ? b10 : b10 / s10,
    lastBuyAgoS: s.lastBuyMs ? (now - s.lastBuyMs) / 1000 : 999,
    devBuySol: s.devBuySol,
    devHoldPct: (devHold / supply) * 100,
    devSold: s.devSold,
    sameSlotBuyers: s.sameSlotBuyers.size,
    top1Pct: ((top[0] ?? 0) / supply) * 100,
    top10Pct: (top.reduce((a, b) => a + b, 0) / supply) * 100,
    holders: s.holders.size,
    tradeCount: s.tradeCount,
    uniqueTraders: s.uniqueTraders.size,
    solPerTrade: s.tradeCount ? (s.rSol > 0n ? Number(s.rSol) / 1e9 : Math.max(0, solRaised(s.reserves.vSol))) / s.tradeCount : 0,
    volumeSol: s.volumeSol,
    peakMult: s.firstPrice ? s.peakPrice / s.firstPrice : 1,
    drawFromPeakPct: s.peakPrice ? (1 - p / s.peakPrice) * 100 : 0,
    hourUtc: new Date(now).getUTCHours(),
    smartBuyers,
    creatorPriorLaunches: s.creatorPriorLaunches,
  };
}

/** Tracks all live mints and evicts idle ones. */
export class Tracker {
  tokens = new Map<string, TokenState>();
  constructor(public idleMs = 10 * 60_000) {}

  apply(e: PumpEvent): TokenState {
    let s = this.tokens.get(e.mint);
    if (!s) { s = new TokenState(e.mint); this.tokens.set(e.mint, s); }
    if (e.kind === "create") s.onCreate(e);
    else if (e.kind === "trade") s.onTrade(e);
    else s.complete = true;
    return s;
  }

  get(mint: string) { return this.tokens.get(mint); }

  evict(now: number, keep: (mint: string) => boolean = () => false): string[] {
    const out: string[] = [];
    for (const [m, s] of this.tokens) {
      const last = Math.max(s.lastTradeMs, s.createMs);
      if ((now - last > this.idleMs || (s.complete && now - last > 60_000)) && !keep(m)) { this.tokens.delete(m); out.push(m); }
    }
    return out;
  }
}
