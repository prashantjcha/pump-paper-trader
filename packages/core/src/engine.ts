// The trading engine: event stream -> token state -> rules -> paper fills.
// Deterministic given the same events, params and rng seed, so the live bot and
// the replay engine produce identical decisions.
import type { PumpEvent, TradeEv } from "./events.ts";
import type { StrategyParams, ExitParams } from "./config.ts";
import { Tracker, TokenState, features, type Features } from "./tokenState.ts";
import { momentumEntry, safetyFails, exitDecision, takeProfitFor, stopLossFor, type ExitReason } from "./strategy.ts";
import { buyQuote, sellQuote, price, solToLamports, type Reserves } from "./curve.ts";
import { scoreRunner, type RunnerModel } from "./runnerModel.ts";

export type BookKind = "momentum" | "copy" | "manual" | "shadow" | "runner" | "telegram";
export interface BookState {
  id: BookKind; startSol: number; cashSol: number; realizedSol: number;
  unlimited: boolean; day: string; dayStartEquity: number; pausedUntilMs: number;
}

export interface Position {
  id: number; // engine-local id; the journal maps it to a DB row
  dbId?: number;
  book: BookKind; mint: string; symbol: string;
  status: "pending" | "open" | "closing" | "closed" | "failed" | "void";
  signal: string; version: number;
  decisionMs: number; expectedPrice: number;
  entrySol: number; entryFixedSol: number;
  fillMs: number; entryPrice: number; entrySlippagePct: number;
  tokensRaw: bigint; netLamports: bigint;
  /** Liquidation value (after exit costs) right after the fill: the zero point for stop-losses. */
  entryLiqSol: number;
  exitAttempts?: number; exitFailCostSol?: number;
  exitParams: ExitParams; features: Record<string, unknown>;
  peakPnlPct: number; minPnlPct: number; lastPnlPct: number;
  exitDecisionMs?: number; exitReason?: ExitReason | "slippage_fail" | "not_landed" | "data_gap";
  exitExpectedPrice?: number; exitFeatures?: Record<string, unknown>;
  exitFillMs?: number; exitPrice?: number; exitSolNet?: number; exitFixedSol?: number;
  pnlSol?: number; pnlPct?: number; holdS?: number;
  copiedWallet?: string; manualId?: number;
}

export interface EngineHooks {
  onOpen?(p: Position): void;
  onClose?(p: Position): void;
  onFail?(p: Position): void;
  /** Position voided by a data gap: no fill is simulated across missing data; it is excluded from results. */
  onVoid?(p: Position): void;
  onBook?(b: BookState): void;
  onManual?(id: number, status: string, detail: string, positionId?: number): void;
}

export interface EngineOpts {
  params: StrategyParams; version: number;
  books: BookKind[]; startSol?: number;
  smart?: Set<string>; blacklist?: Set<string>;
  hooks?: EngineHooks; seed?: number;
  /** Shadow book trigger: minimal activity to evaluate a launch counterfactually. */
  shadowMaxAgeS?: number;
  /** Silence longer than this (feed outage, PC sleep, archive hole) voids open positions. */
  gapMs?: number;
  /** Early-runner model for the runner book (scores each launch N seconds after creation). */
  runnerModel?: RunnerModel | null;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Engine {
  tracker = new Tracker();
  params: StrategyParams;
  version: number;
  books = new Map<BookKind, BookState>();
  positions = new Map<number, Position>();
  byMint = new Map<string, Set<number>>();
  smart: Set<string>;
  blacklist: Set<string>;
  hooks: EngineHooks;
  killed = false;
  now = 0;
  private nextId = 1;
  private rng: () => number;
  private shadowSeen = new Set<string>();
  /** One trade per mint per book: no re-entry after an exit (no chasing). */
  private traded = new Set<string>();
  private manual = new Map<number, { mint: string; source: string; createdMs: number; book: BookKind }>();
  private lastSweep = 0;
  /** creator -> create timestamps (24h), for the serial-launcher filter. */
  creatorHistory = new Map<string, number[]>();
  shadowMaxAgeS: number;
  gapMs: number;
  lastEventMs = 0;
  voided = 0;
  runnerModel: RunnerModel | null;
  private runnerDue: { t: number; mint: string }[] = [];
  runnerScored = 0;

  constructor(o: EngineOpts) {
    this.params = o.params;
    this.version = o.version;
    this.smart = o.smart ?? new Set();
    this.blacklist = new Set(o.blacklist ?? []); // own copy: the engine adds dumping creators as it runs
    this.hooks = o.hooks ?? {};
    this.rng = mulberry32(o.seed ?? 42);
    this.shadowMaxAgeS = o.shadowMaxAgeS ?? 180;
    this.gapMs = o.gapMs ?? 30_000;
    this.runnerModel = o.runnerModel ?? null;
    for (const id of o.books) {
      const start = o.startSol ?? 1;
      this.books.set(id, { id, startSol: start, cashSol: start, realizedSol: 0, unlimited: id === "shadow", day: "", dayStartEquity: start, pausedUntilMs: 0 });
    }
  }

  /** Records a launch; returns how many other launches this creator made in the prior 24h. */
  noteCreate(creator: string, t: number): number {
    if (!creator) return 0;
    const cutoff = t - 86_400_000;
    const h = (this.creatorHistory.get(creator) ?? []).filter((x) => x >= cutoff && x < t);
    const prior = h.length;
    h.push(t);
    this.creatorHistory.set(creator, h);
    return prior;
  }

  setParams(p: StrategyParams, version: number) { this.params = p; this.version = version; }

  /** Restores a persisted book / open position (after a restart). */
  restoreBook(b: Partial<BookState> & { id: BookKind }) { const cur = this.books.get(b.id); if (cur) Object.assign(cur, b); }
  restorePosition(p: Position, reserves?: Reserves) {
    p.id = this.nextId++;
    this.positions.set(p.id, p);
    this.index(p);
    this.traded.add(p.book + ":" + p.mint);
    if (reserves) {
      let s = this.tracker.get(p.mint);
      if (!s) { s = new TokenState(p.mint); s.symbol = p.symbol; this.tracker.tokens.set(p.mint, s); }
      s.reserves = reserves;
      s.lastTradeMs = Date.now();
    }
  }

  addManualSignal(id: number, mint: string, source: string, now: number, book: BookKind = "manual") {
    this.manual.set(id, { mint, source, createdMs: now, book: this.books.has(book) ? book : "manual" });
  }

  private index(p: Position) {
    let set = this.byMint.get(p.mint);
    if (!set) { set = new Set(); this.byMint.set(p.mint, set); }
    set.add(p.id);
  }
  private unindex(p: Position) {
    const set = this.byMint.get(p.mint);
    set?.delete(p.id);
    if (set && set.size === 0) this.byMint.delete(p.mint);
  }

  openCount(book: BookKind) {
    let n = 0;
    for (const p of this.positions.values()) if (p.book === book && (p.status === "open" || p.status === "pending" || p.status === "closing")) n++;
    return n;
  }
  holding(book: BookKind, mint: string) {
    if (this.traded.has(book + ":" + mint)) return true;
    for (const id of this.byMint.get(mint) ?? []) { const p = this.positions.get(id)!; if (p.book === book) return true; }
    return false;
  }

  /** Liquidation value (SOL, after curve fee and exit fixed costs) of a position at given reserves. */
  markValue(p: Position, s: TokenState): number {
    if (s.reserves.vTok === 0n) return 0;
    // Add our own footprint: in reality our buy moved the curve and our sell would move it back.
    const r: Reserves = { vSol: s.reserves.vSol + p.netLamports, vTok: s.reserves.vTok - p.tokensRaw, rTok: s.reserves.rTok - p.tokensRaw };
    if (r.vTok <= 0n) return 0;
    const q = sellQuote(r, p.tokensRaw, s.feeBps);
    const ex = this.params.exec;
    return Number(q.net) / 1e9 - (ex.priorityFeeSol + ex.tipSol);
  }
  markPnlPct(p: Position, s: TokenState) {
    const cost = p.entrySol + p.entryFixedSol;
    return ((this.markValue(p, s) - cost) / cost) * 100;
  }

  equity(book: BookKind): number {
    const b = this.books.get(book)!;
    let v = b.cashSol;
    for (const p of this.positions.values()) {
      if (p.book !== book) continue;
      if (p.status === "pending") v += p.entrySol + p.entryFixedSol;
      else if (p.status === "open" || p.status === "closing") {
        const s = this.tracker.get(p.mint);
        v += s ? Math.max(0, this.markValue(p, s)) : p.entrySol;
      }
    }
    return v;
  }

  // ---------------------------------------------------------------- event loop

  onEvent(e: PumpEvent) {
    this.advance(e.recvMs);
    this.lastEventMs = Math.max(this.lastEventMs, e.recvMs);
    const s = this.tracker.apply(e);
    if (e.kind === "create") {
      s.creatorPriorLaunches = this.noteCreate(s.creator, e.recvMs);
      if (this.runnerModel && this.books.has("runner") && e.solQuote && !e.mayhem) this.runnerDue.push({ t: e.recvMs + this.runnerModel.snapshotS * 1000, mint: e.mint });
      return;
    }
    const ids = this.byMint.get(e.mint);
    const ev = e.kind === "trade" ? e : undefined;
    if (ids && ids.size) {
      const f = features(s, e.recvMs, this.params.entry.windowS, this.smart);
      for (const id of [...ids]) this.checkExit(this.positions.get(id)!, s, f, ev);
    }
    if (!ev || !s.solQuote) return;
    this.considerEntries(s, ev);
  }

  /** Moves the clock: resolves fills that are due and runs timer-based exits. */
  advance(now: number) {
    if (now < this.now) now = this.now;
    this.now = now;
    if (this.lastEventMs && now - this.lastEventMs > this.gapMs) this.voidAll("data_gap");
    this.processRunnerDue(now);
    this.resolveDue(now);
    if (now - this.lastSweep >= 250) {
      this.lastSweep = now;
      for (const p of [...this.positions.values()]) {
        if (p.status !== "open") continue;
        const s = this.tracker.get(p.mint);
        if (!s) continue;
        if (this.killed && p.book !== "shadow") { this.decideExit(p, s, "kill_switch", features(s, now, this.params.entry.windowS)); continue; }
        this.checkExit(p, s, features(s, now, this.params.entry.windowS, this.smart), undefined);
      }
      this.expireManual(now);
      this.rollDays(now);
      this.resolveDue(now);
    }
  }

  private resolveDue(now: number) {
    const L = this.params.exec.latencyMs;
    for (const p of [...this.positions.values()]) {
      if (p.status === "pending" && p.decisionMs + L <= now) this.fillEntry(p, p.decisionMs + L);
      else if (p.status === "closing" && (p.exitDecisionMs ?? 0) + L <= now) this.fillExit(p, (p.exitDecisionMs ?? 0) + L);
    }
  }

  /** Scores launches that just reached the model's snapshot age; buys the ones above the threshold. */
  private processRunnerDue(now: number) {
    const m = this.runnerModel;
    if (!m) { this.runnerDue.length = 0; return; }
    let i = 0;
    for (; i < this.runnerDue.length && this.runnerDue[i].t <= now; i++) {
      const d = this.runnerDue[i];
      const s = this.tracker.get(d.mint);
      if (!s || s.complete || !s.solQuote || s.mayhem) continue;
      const f = features(s, d.t, m.windowS);
      const score = scoreRunner(m, f);
      this.runnerScored++;
      if (score < m.threshold || !this.young(s) || !this.canOpen("runner", s.mint)) continue;
      this.decideEntry("runner", s, f, `runner:v${m.version}`, { runnerScore: score });
    }
    if (i) this.runnerDue.splice(0, i);
  }

  /** Removes every unsettled position without a simulated fill: nothing is known about prices during a gap. */
  voidAll(reason: "data_gap") {
    this.runnerDue.length = 0; // snapshots scheduled before the gap would read stale state
    for (const p of [...this.positions.values()]) {
      if (p.status !== "pending" && p.status !== "open" && p.status !== "closing") continue;
      const b = this.books.get(p.book)!;
      if (!b.unlimited) b.cashSol += p.entrySol + p.entryFixedSol;
      p.status = "void"; p.exitReason = reason; p.exitDecisionMs = this.now;
      this.positions.delete(p.id); this.unindex(p);
      this.voided++;
      this.hooks.onVoid?.(p); this.hooks.onBook?.(b);
    }
  }

  private rollDays(now: number) {
    const day = utcDay(now);
    for (const b of this.books.values()) {
      if (b.day !== day) { b.day = day; b.dayStartEquity = this.equity(b.id); if (b.pausedUntilMs && b.pausedUntilMs <= now) b.pausedUntilMs = 0; this.hooks.onBook?.(b); }
    }
  }

  /** Young-token filter shared by every book: only tokens we saw launch, with few trades so far. */
  private young(s: TokenState): boolean {
    const max = this.params.entry.maxTradesAtEntry;
    return !max || (s.known && s.tradeCount <= max);
  }

  private canOpen(book: BookKind, mint: string): boolean {
    const b = this.books.get(book);
    if (!b) return false;
    if (this.killed && book !== "shadow") return false;
    if (this.holding(book, mint)) return false;
    if (b.unlimited) return true;
    if (this.params.risk.dailyLossEnabled && b.pausedUntilMs > this.now) return false;
    const r = this.params.risk;
    if (this.openCount(book) >= r.maxOpen) return false;
    const ex = this.params.exec;
    return b.cashSol >= r.positionSol + ex.priorityFeeSol + ex.tipSol;
  }

  private considerEntries(s: TokenState, ev: TradeEv) {
    const now = ev.recvMs;
    const P = this.params.entry;
    let f: Features | undefined;
    const feat = () => (f ??= features(s, now, P.windowS, this.smart));

    // Shadow book: every launch with minimal activity, evaluated once, to learn what the filters cost.
    if (this.books.has("shadow") && s.known && !s.mayhem && !this.shadowSeen.has(s.mint)) {
      const ff = feat();
      if (ff.ageS >= P.minAgeS && ff.ageS <= this.shadowMaxAgeS && ff.buys5s >= 3 && !s.complete) {
        this.shadowSeen.add(s.mint);
        const chk = momentumEntry(s, ff, P, this.blacklist);
        this.decideEntry("shadow", s, ff, chk.ok ? "momentum_pass" : "shadow", { fails: chk.fails });
      }
    }

    if (this.books.has("momentum") && this.young(s) && this.canOpen("momentum", s.mint)) {
      const ff = feat();
      const chk = momentumEntry(s, ff, P, this.blacklist);
      if (chk.ok) this.decideEntry("momentum", s, ff, "momentum", {});
    }

    if (this.books.has("copy") && ev.isBuy && this.smart.has(ev.user) && this.young(s) && this.canOpen("copy", s.mint)) {
      const ff = feat();
      const fails = safetyFails(s, ff, P, this.blacklist);
      if (s.known && ff.ageS > 1800) fails.push("too_old");
      if (fails.length === 0) this.decideEntry("copy", s, ff, "copy:" + ev.user.slice(0, 6), { copiedWallet: ev.user });
    }

    if (this.manual.size) {
      for (const [id, m] of this.manual) {
        if (m.mint !== s.mint) continue;
        const ff = feat();
        const fails = safetyFails(s, ff, P, this.blacklist);
        // The telegram book measures the callers themselves, so only untradeable tokens are refused;
        // the manual book keeps the full safety filters. Failed filters are recorded either way.
        const blocking = m.book === "telegram" ? fails.filter((f) => f === "non_sol_quote" || f === "complete" || f === "mayhem") : fails;
        if (!this.young(s)) blocking.push(`not young (${s.known ? s.tradeCount + " trades" : "launch not seen"})`);
        if (blocking.length) { this.manual.delete(id); this.hooks.onManual?.(id, "rejected", blocking.join(",")); continue; }
        if (!this.canOpen(m.book, s.mint)) { this.manual.delete(id); this.hooks.onManual?.(id, "rejected", this.holding(m.book, s.mint) ? "already traded" : "book limits"); continue; }
        this.manual.delete(id);
        const p = this.decideEntry(m.book, s, ff, `${m.book === "telegram" ? "tg" : "manual"}:${m.source}`, { manualId: id, fails });
        this.hooks.onManual?.(id, "entered", fails.length ? `filters failed (not blocking): ${fails.join(",")}` : "", p.id);
      }
    }
  }

  private expireManual(now: number) {
    for (const [id, m] of this.manual) {
      if (now - m.createdMs > 10 * 60_000) { this.manual.delete(id); this.hooks.onManual?.(id, "expired", "no trades seen within 10 min"); }
    }
  }

  private decideEntry(book: BookKind, s: TokenState, f: Features, signal: string, extra: { fails?: string[]; copiedWallet?: string; manualId?: number; exitOverride?: ExitParams; runnerScore?: number }): Position {
    const r = this.params.risk, ex = this.params.exec;
    const p: Position = {
      id: this.nextId++, book, mint: s.mint, symbol: s.symbol, status: "pending", signal, version: this.version,
      decisionMs: this.now, expectedPrice: s.price,
      entrySol: r.positionSol, entryFixedSol: ex.priorityFeeSol + ex.tipSol,
      fillMs: 0, entryPrice: 0, entrySlippagePct: 0, tokensRaw: 0n, netLamports: 0n, entryLiqSol: 0,
      exitParams: structuredClone(extra.exitOverride ?? this.params.exit),
      features: { ...f, fails: extra.fails, creator: s.creator, runnerScore: extra.runnerScore },
      peakPnlPct: 0, minPnlPct: 0, lastPnlPct: 0,
      copiedWallet: extra.copiedWallet, manualId: extra.manualId,
    };
    const b = this.books.get(book)!;
    if (!b.unlimited) b.cashSol -= p.entrySol + p.entryFixedSol; // reserve funds
    this.traded.add(book + ":" + s.mint);
    this.positions.set(p.id, p);
    this.index(p);
    return p;
  }

  private fillEntry(p: Position, at: number) {
    const s = this.tracker.get(p.mint);
    const ex = this.params.exec;
    const b = this.books.get(p.book)!;
    const fail = (reason: "slippage_fail" | "not_landed", fillPrice: number) => {
      p.status = "failed"; p.exitReason = reason; p.fillMs = at; p.entryPrice = fillPrice;
      p.entrySlippagePct = p.expectedPrice ? (fillPrice / p.expectedPrice - 1) * 100 : 0;
      // A failed tx still pays the priority fee (no Jito tip when it doesn't land).
      p.pnlSol = -ex.priorityFeeSol; p.pnlPct = (p.pnlSol / p.entrySol) * 100;
      if (!b.unlimited) b.cashSol += p.entrySol + p.entryFixedSol - ex.priorityFeeSol;
      b.realizedSol += p.pnlSol;
      this.positions.delete(p.id); this.unindex(p);
      this.hooks.onFail?.(p); this.hooks.onBook?.(b);
    };
    if (!s || s.reserves.vTok === 0n || s.complete) return fail("not_landed", 0);
    const q = buyQuote(s.reserves, solToLamports(p.entrySol), s.feeBps);
    const fillPrice = Number(q.net) / 1e9 / (Number(q.tokens) / 1e6);
    const spotAtFill = price(s.reserves);
    const slip = p.expectedPrice ? (spotAtFill / p.expectedPrice - 1) * 100 : 0;
    if (slip > ex.maxEntrySlippagePct) return fail("slippage_fail", fillPrice);
    if (this.rng() > ex.landProbability) return fail("not_landed", fillPrice);
    p.status = "open"; p.fillMs = at; p.tokensRaw = q.tokens; p.netLamports = q.net;
    p.entryPrice = fillPrice; p.entrySlippagePct = slip;
    p.entryLiqSol = this.markValue(p, s);
    p.peakPnlPct = p.minPnlPct = p.lastPnlPct = this.markPnlPct(p, s);
    this.hooks.onOpen?.(p);
  }

  private checkExit(p: Position, s: TokenState, f: Features, ev: TradeEv | undefined) {
    if (p.status !== "open") return;
    const value = this.markValue(p, s);
    const cost = p.entrySol + p.entryFixedSol;
    const pnl = ((value - cost) / cost) * 100;
    const risk = p.entryLiqSol > 0 ? (value / p.entryLiqSol - 1) * 100 : pnl;
    p.lastPnlPct = pnl;
    if (pnl > p.peakPnlPct) p.peakPnlPct = pnl;
    if (pnl < p.minPnlPct) p.minPnlPct = pnl;
    const reason = exitDecision(s, f, p.exitParams, {
      pnlPct: pnl, peakPnlPct: p.peakPnlPct, riskPct: risk, holdS: (this.now - p.fillMs) / 1000, fillMs: p.fillMs,
      tokensHeld: Number(p.tokensRaw) / 1e6, copiedWallet: p.copiedWallet,
    }, ev, this.smart);
    if (reason) this.decideExit(p, s, reason, f);
  }

  private decideExit(p: Position, s: TokenState, reason: ExitReason, f: Features) {
    p.status = "closing";
    p.exitDecisionMs = this.now;
    p.exitReason = reason;
    p.exitExpectedPrice = s.price;
    const tp = takeProfitFor(f, p.exitParams), sl = stopLossFor(f, p.exitParams);
    // A creator seen dumping is blacklisted immediately, not after the token goes quiet.
    if (reason === "dev_sell" && s.creator) this.blacklist.add(s.creator);
    p.exitFeatures = { ...f, pnlAtDecision: p.lastPnlPct, riskAtDecision: p.entryLiqSol > 0 ? (this.markValue(p, s) / p.entryLiqSol - 1) * 100 : null, tpRegime: tp.regime, tpTarget: tp.tp, slActive: sl.sl };
    // Graduated curves stop trading: fill immediately at the last known reserves.
    if (reason === "graduated") this.fillExit(p, this.now, true);
  }

  private fillExit(p: Position, at: number, noFail = false) {
    const s = this.tracker.get(p.mint);
    const b = this.books.get(p.book)!;
    // Exit transactions can fail under congestion: pay the priority fee and retry one latency later
    // at whatever the price is then. Capped at 5 retries.
    if (!noFail && (p.exitAttempts ?? 0) < 5 && this.rng() < this.params.exec.exitFailProbability) {
      p.exitAttempts = (p.exitAttempts ?? 0) + 1;
      p.exitFailCostSol = (p.exitFailCostSol ?? 0) + this.params.exec.priorityFeeSol;
      p.exitDecisionMs = at;
      return;
    }
    const value = s ? Math.max(0, this.markValue(p, s)) : 0;
    const ex = this.params.exec;
    p.status = "closed";
    p.exitFillMs = at;
    p.exitFixedSol = ex.priorityFeeSol + ex.tipSol;
    p.exitSolNet = value + p.exitFixedSol; // proceeds before fixed costs
    p.exitPrice = p.tokensRaw > 0n ? (p.exitSolNet) / (Number(p.tokensRaw) / 1e6) : 0;
    const cost = p.entrySol + p.entryFixedSol + (p.exitFailCostSol ?? 0);
    p.pnlSol = value - cost;
    p.pnlPct = (p.pnlSol / cost) * 100;
    p.holdS = (at - p.fillMs) / 1000;
    if (!b.unlimited) b.cashSol += value - (p.exitFailCostSol ?? 0);
    b.realizedSol += p.pnlSol;
    this.positions.delete(p.id); this.unindex(p);
    // Daily loss limit.
    if (this.params.risk.dailyLossEnabled && !b.unlimited && b.dayStartEquity > 0) {
      const dayLoss = (b.dayStartEquity - this.equity(b.id)) / b.dayStartEquity * 100;
      if (dayLoss >= this.params.risk.dailyLossPct) {
        const d = new Date(at); d.setUTCHours(24, 0, 0, 0);
        b.pausedUntilMs = d.getTime();
      }
    }
    this.hooks.onClose?.(p);
    this.hooks.onBook?.(b);
  }

  /** Mints the engine must keep in memory (open positions). */
  isActive(mint: string) { return this.byMint.has(mint); }
  evict(now: number) {
    const out = this.tracker.evict(now, (m) => this.isActive(m));
    if (this.creatorHistory.size > 200_000) {
      const cutoff = now - 86_400_000;
      for (const [c, h] of this.creatorHistory) if (h[h.length - 1] < cutoff) this.creatorHistory.delete(c);
    }
    for (const m of out) {
      this.shadowSeen.delete(m);
      for (const b of this.books.keys()) this.traded.delete(b + ":" + m);
    }
    return out;
  }
}
