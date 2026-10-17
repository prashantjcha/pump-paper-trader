import { describe, it, expect } from "vitest";
import { Engine, type Position } from "../src/engine.ts";
import { DEFAULT_PARAMS, type StrategyParams } from "../src/config.ts";
import {
  buyQuote, sellQuote, applyBuy, applySell,
  INITIAL_REAL_TOKENS, INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, type Reserves,
} from "../src/curve.ts";
import type { CreateEv, TradeEv, PumpEvent } from "../src/events.ts";
import { RUNNER_FEATURES, runnerExit, type RunnerModel } from "../src/runnerModel.ts";

const MINT = "MintAAA";
const DEV = "DevWallet";

/** Synthetic market that applies real curve math and emits pump-shaped events. */
class Sim {
  r: Reserves = { vSol: INITIAL_VIRTUAL_SOL, vTok: INITIAL_VIRTUAL_TOKENS, rTok: INITIAL_REAL_TOKENS };
  t = 1_000_000;
  slot = 100;
  evs: PumpEvent[] = [];
  held = new Map<string, bigint>();

  create(devSol = 1) {
    const e: CreateEv = {
      kind: "create", slot: this.slot, sig: "c", recvMs: this.t, mint: MINT, bondingCurve: "bc", creator: DEV, user: DEV,
      name: "T", symbol: "T", uri: "", chainTs: 0, vTok: this.r.vTok, vSol: this.r.vSol, rTok: this.r.rTok, supply: 0n,
      solQuote: true, mayhem: false,
    };
    this.evs.push(e);
    this.buy(DEV, devSol, 0);
  }
  buy(user: string, sol: number, dtMs = 400) {
    this.t += dtMs;
    if (dtMs) this.slot++;
    const q = buyQuote(this.r, BigInt(Math.round(sol * 1e9)), 125);
    this.r = applyBuy(this.r, q.net, q.tokens);
    this.held.set(user, (this.held.get(user) ?? 0n) + q.tokens);
    this.push(user, true, q.net, q.tokens);
  }
  sell(user: string, frac = 1, dtMs = 400) {
    this.t += dtMs;
    this.slot++;
    const tok = ((this.held.get(user) ?? 0n) * BigInt(Math.round(frac * 1000))) / 1000n;
    const q = sellQuote(this.r, tok, 125);
    this.r = applySell(this.r, tok, q.gross);
    this.held.set(user, (this.held.get(user) ?? 0n) - tok);
    this.push(user, false, q.gross, tok);
  }
  idle(ms: number) { this.t += ms; }
  private push(user: string, isBuy: boolean, sol: bigint, tokens: bigint) {
    const e: TradeEv = {
      kind: "trade", slot: this.slot, sig: "s" + this.evs.length, recvMs: this.t, mint: MINT, user, isBuy, sol, tokens,
      chainTs: 0, vSol: this.r.vSol, vTok: this.r.vTok, rSol: 0n, rTok: this.r.rTok, feeBps: 95, creatorFeeBps: 30,
      creator: DEV, ix: isBuy ? "buy" : "sell", solQuote: true, mayhem: false,
    };
    this.evs.push(e);
  }
}

function params(over: (p: StrategyParams) => void = () => {}) {
  const p = structuredClone(DEFAULT_PARAMS);
  p.entry.blacklistCreators = false;
  p.exec.exitFailProbability = 0; // deterministic exits unless a test opts in
  over(p);
  return p;
}

/** Background market: trades on an unrelated mint every second, so silence on our token is not a data gap. */
function heartbeat(from: number, to: number): TradeEv[] {
  const out: TradeEv[] = [];
  for (let t = from + 1000, i = 0; t <= to; t += 1000, i++) {
    out.push({
      kind: "trade", slot: 10_000_000 + i, sig: "hb" + i, recvMs: t, mint: "OtherMint", user: "hb", isBuy: true, sol: 1_000_000n, tokens: 1_000_000n,
      chainTs: 0, vSol: INITIAL_VIRTUAL_SOL, vTok: INITIAL_VIRTUAL_TOKENS, rSol: 0n, rTok: INITIAL_REAL_TOKENS, feeBps: 95, creatorFeeBps: 30,
      creator: "x", ix: "buy", solQuote: true, mayhem: false,
    });
  }
  return out;
}

function merged(sim: Sim, tailMs = 200_000): PumpEvent[] {
  return [...sim.evs, ...heartbeat(sim.evs[0].recvMs, sim.t + tailMs)].sort((a, b) => a.recvMs - b.recvMs);
}

function run(sim: Sim, p: StrategyParams) {
  const closed: Position[] = [];
  const failed: Position[] = [];
  const eng = new Engine({
    params: p, version: 1, books: ["momentum"],
    hooks: { onClose: (x) => closed.push({ ...x }), onFail: (x) => failed.push({ ...x }) },
  });
  for (const e of merged(sim)) eng.onEvent(e);
  return { eng, closed, failed };
}

/** 12 distinct buyers over ~6 s: passes the default momentum filters. */
function pumping(sim: Sim, n = 12, sol = 0.3) {
  for (let i = 0; i < n; i++) sim.buy("b" + i, sol, 500);
}

describe("engine", () => {
  it("enters on momentum and takes profit as buying continues", () => {
    const s = new Sim(); s.create(); pumping(s);
    for (let i = 0; i < 30; i++) s.buy("late" + i, 0.5, 300);
    const { closed } = run(s, params());
    expect(closed.length).toBe(1);
    expect(closed[0].exitReason).toBe("take_profit");
    expect(closed[0].pnlPct!).toBeGreaterThan(15);
    expect(closed[0].fillMs - closed[0].decisionMs).toBe(600);
  });

  it("exits when the dev sells", () => {
    const s = new Sim(); s.create(); pumping(s);
    s.buy("x", 0.2, 1000);
    s.sell(DEV, 1, 1000);
    const { closed } = run(s, params());
    expect(closed[0].exitReason).toBe("dev_sell");
    expect(closed[0].pnlSol!).toBeLessThan(0);
  });

  it("stop loss fires when holders dump", () => {
    const s = new Sim(); s.create(); pumping(s);
    s.idle(1000);
    // All 12 early buyers exit: a real price drop of well over 10% from our fill.
    for (let i = 0; i < 12; i++) s.sell("b" + i, 1, 300);
    const { closed } = run(s, params());
    expect(closed[0].exitReason).toMatch(/stop_loss|whale_sell/);
  });

  it("a stalled token is closed by a stop or the time stop", () => {
    const s = new Sim(); s.create(); pumping(s);
    const { closed } = run(s, params());
    expect(closed.length).toBe(1);
    expect(closed[0].exitReason).toMatch(/time_stop|stop_loss/);
  });

  it("entry fails when price runs past slippage tolerance during latency", () => {
    const s = new Sim(); s.create(); pumping(s);
    s.buy("whale", 12, 100); // lands inside the 600 ms latency window
    // Entry triggers exactly at the last pump buy (13 unique buyers incl. dev).
    const { failed, closed } = run(s, params((p) => { p.exec.maxEntrySlippagePct = 5; p.entry.minUniqueBuyers = 13; }));
    expect(closed.length).toBe(0);
    expect(failed[0].exitReason).toBe("slippage_fail");
    expect(failed[0].pnlSol).toBeCloseTo(-0.001, 6);
  });

  it("bundled launches are filtered", () => {
    const s = new Sim(); s.create();
    for (let i = 0; i < 4; i++) s.buy("bundle" + i, 0.5, 0); // same slot as create
    pumping(s);
    const { closed, failed } = run(s, params());
    expect(closed.length + failed.length).toBe(0);
  });

  it("is deterministic", () => {
    const s = new Sim(); s.create(); pumping(s);
    for (let i = 0; i < 30; i++) s.buy("late" + i, 0.5, 300);
    const a = run(s, params()).closed.map((p) => p.pnlSol);
    const b = run(s, params()).closed.map((p) => p.pnlSol);
    expect(a).toEqual(b);
  });

  it("book cash reconciles after a closed trade", () => {
    const s = new Sim(); s.create(); pumping(s);
    for (let i = 0; i < 30; i++) s.buy("late" + i, 0.5, 300);
    const { eng, closed } = run(s, params());
    expect(eng.books.get("momentum")!.cashSol).toBeCloseTo(1 + closed[0].pnlSol!, 9);
  });

  it("higher latency never improves the fill on a rising curve", () => {
    const s = new Sim(); s.create(); pumping(s);
    for (let i = 0; i < 30; i++) s.buy("late" + i, 0.5, 300);
    const fast = run(s, params((p) => { p.exec.latencyMs = 0; })).closed[0];
    const slow = run(s, params((p) => { p.exec.latencyMs = 1500; })).closed[0];
    expect(slow.entryPrice).toBeGreaterThanOrEqual(fast.entryPrice);
  });
});

describe("creator filters", () => {
  it("skips a serial launcher's relaunch", () => {
    const s = new Sim(); s.create(); pumping(s);
    const eng = new Engine({ params: params(), version: 1, books: ["momentum"] });
    eng.noteCreate(DEV, s.t - 3_600_000); // same creator launched an hour earlier
    eng.noteCreate(DEV, s.t - 1_800_000);
    for (const e of s.evs) eng.onEvent(e);
    expect(eng.openCount("momentum")).toBe(0);
  });
  it("blacklists a creator the moment they dump on an open position", () => {
    const s = new Sim(); s.create(); pumping(s); s.buy("x", 0.2, 1000); s.sell(DEV, 1, 1000);
    const p = params(); p.entry.blacklistCreators = true;
    const eng = new Engine({ params: p, version: 1, books: ["momentum"] });
    for (const e of s.evs) eng.onEvent(e);
    expect(eng.blacklist.has(DEV)).toBe(true);
  });
});

describe("engine fixes from the Codex review", () => {
  it("fees alone never trigger a stop: a flat token with steady buying is not stopped out", () => {
    const s = new Sim(); s.create(); pumping(s);
    // tiny buys keep the stall condition off without moving price materially
    for (let i = 0; i < 40; i++) s.buy("tiny" + i, 0.001, 2000);
    const { closed } = run(s, params());
    expect(closed.length).toBe(1);
    expect(closed[0].exitReason).toBe("time_stop");
  });

  it("an out-of-order older trade does not rewind the price", () => {
    const s = new Sim(); s.create(); pumping(s);
    const eng = new Engine({ params: params(), version: 1, books: [] });
    for (const e of s.evs) eng.onEvent(e);
    const tok = eng.tracker.get(MINT)!;
    const before = tok.price;
    const old = s.evs[3] as TradeEv; // an early, lower-priced trade delivered late
    eng.onEvent({ ...old, recvMs: s.t + 10, sig: "late" });
    expect(tok.price).toBe(before);
    expect(tok.staleUpdates).toBe(1);
  });

  it("a data gap voids open positions instead of filling at stale prices", () => {
    const s = new Sim(); s.create(); pumping(s);
    const voided: Position[] = [], closed: Position[] = [];
    const eng = new Engine({ params: params(), version: 1, books: ["momentum"], hooks: { onVoid: (p) => voided.push({ ...p }), onClose: (p) => closed.push({ ...p }) } });
    for (const e of s.evs) eng.onEvent(e);
    eng.advance(s.t + 1000); // entry fills
    expect(eng.openCount("momentum")).toBe(1);
    eng.advance(s.t + 5 * 60_000); // PC slept / both feeds down
    expect(voided.length).toBe(1);
    expect(closed.length).toBe(0);
    expect(eng.books.get("momentum")!.cashSol).toBeCloseTo(1, 9);
  });

  it("failed exits pay the priority fee and retry later", () => {
    const s = new Sim(); s.create(); pumping(s);
    for (let i = 0; i < 30; i++) s.buy("late" + i, 0.5, 300);
    const always = run(s, params((p) => { p.exec.exitFailProbability = 0.5; })).closed[0];
    expect(always).toBeDefined();
    const never = run(s, params()).closed[0];
    if ((always.exitAttempts ?? 0) > 0) {
      expect(always.exitFailCostSol).toBeCloseTo(0.001 * always.exitAttempts!, 9);
      expect(always.exitFillMs!).toBeGreaterThan(never.exitFillMs!);
    }
  });
});

describe("daily loss limit", () => {
  function losingDay(enabled: boolean) {
    const s = new Sim(); s.create(); pumping(s);
    s.idle(1000);
    for (let i = 0; i < 12; i++) s.sell("b" + i, 1, 300);
    const p = params((x) => { x.risk.dailyLossEnabled = enabled; x.risk.dailyLossPct = 1; });
    return run(s, p).eng.books.get("momentum")!;
  }
  it("is off by default for paper trading", () => {
    expect(DEFAULT_PARAMS.risk.dailyLossEnabled).toBe(false);
    expect(losingDay(false).pausedUntilMs).toBe(0);
  });
  it("still pauses the book when enabled", () => {
    expect(losingDay(true).pausedUntilMs).toBeGreaterThan(0);
  });
});

describe("runner book", () => {
  const model = (threshold: number): RunnerModel => ({
    version: 7, trainedAt: 0, trainFrom: 0, trainTo: 0, snapshotS: 10, windowS: 15, label: "test",
    features: RUNNER_FEATURES.map(([n]) => n), mu: RUNNER_FEATURES.map(() => 0), sd: RUNNER_FEATURES.map(() => 1),
    w: RUNNER_FEATURES.map(([n]) => (n === "log_holders" ? 1 : 0)), b: 0, threshold, thresholdQuantile: 0.95, exit: runnerExit(), stats: {},
  });
  function go(threshold: number) {
    const s = new Sim(); s.create(); pumping(s);
    for (let i = 0; i < 80; i++) s.buy("late" + i, 0.5, 300); // enough follow-through to clear +50% net
    const opened: Position[] = [], closed: Position[] = [];
    const eng = new Engine({ params: params(), version: 1, books: ["runner"], runnerModel: model(threshold),
      hooks: { onOpen: (p) => opened.push({ ...p }), onClose: (p) => closed.push({ ...p }) } });
    for (const e of merged(s)) eng.onEvent(e);
    return { opened, closed, t0: s.evs[0].recvMs };
  }
  it("scores each launch at 10 s and buys when the score clears the threshold", () => {
    const { opened, closed, t0 } = go(0);
    expect(opened.length).toBe(1);
    expect(opened[0].signal).toBe("runner:v7");
    expect(opened[0].decisionMs - t0).toBeGreaterThanOrEqual(10_000);
    expect(opened[0].decisionMs - t0).toBeLessThan(11_000);
    expect(opened[0].exitParams).toEqual(DEFAULT_PARAMS.exit); // the book uses the strategy's exits
    expect(closed[0].exitReason).toBe("take_profit");
  });
  it("skips launches below the threshold", () => {
    expect(go(1e9).opened.length).toBe(0);
  });
});

describe("telegram book", () => {
  it("trades a called token even when momentum filters fail, and records the failures", () => {
    const s = new Sim(); s.create();
    for (let i = 0; i < 4; i++) s.buy("bundle" + i, 0.5, 0); // bundled: blocks momentum and manual
    pumping(s);
    const opened: Position[] = [], notes: string[] = [];
    const eng = new Engine({ params: params(), version: 1, books: ["telegram", "manual"],
      hooks: { onOpen: (p) => opened.push({ ...p }), onFail: (p) => opened.push({ ...p }), onManual: (_id, status, detail) => notes.push(`${status}:${detail}`) } });
    const all = merged(s, 5_000);
    const k = 6; // create, dev buy and the four bundled buys: the calls arrive after these
    for (const e of all.slice(0, k)) eng.onEvent(e);
    eng.addManualSignal(1, MINT, "@caller", all[k].recvMs, "telegram");
    eng.addManualSignal(2, MINT, "me", all[k].recvMs, "manual");
    for (const e of all.slice(k)) eng.onEvent(e);
    expect(opened.map((p) => p.book)).toEqual(["telegram"]);
    expect(opened[0].signal).toBe("tg:@caller");
    expect(notes.some((n) => n.startsWith("entered:") && n.includes("bundle"))).toBe(true);
    expect(notes.some((n) => n.startsWith("rejected:") && n.includes("bundle"))).toBe(true);
  });
});

describe("young-token filter", () => {
  it("blocks entries once a token has more trades than the limit", () => {
    const s = new Sim(); s.create(); pumping(s);
    for (let i = 0; i < 30; i++) s.buy("late" + i, 0.5, 300);
    const run1 = (max: number) => {
      const eng = new Engine({ params: params((p) => { p.entry.maxTradesAtEntry = max; }), version: 1, books: ["momentum"] });
      for (const e of merged(s)) eng.onEvent(e);
      return (eng.books.get("momentum")!.realizedSol !== 0) || eng.openCount("momentum") > 0;
    };
    expect(run1(0)).toBe(true);   // off: momentum enters as before
    expect(run1(100)).toBe(true); // the entry happens around trade 8, well under 100
    expect(run1(5)).toBe(false);  // too few trades allowed: no entry
  });
});
