// Live paper trader for Telegram calls on any Solana token (bonding curve or bonded), priced from DexScreener.
// Uses the exit policy chosen by scripts/calls-backtest.ts (config/call-strategy.json) through the same
// PolicyState code as the backtest, and the same cost model: venue fee per side, 0.003 SOL fixed per leg,
// price impact from the pool's SOL reserve. Owns the "telegram" book; the curve engine no longer trades it.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type DB, ROOT, kvSet, tx } from "@pf/core/db";
import { PolicyState, venueFeePct, policyName, type PolicySpec } from "@pf/core/callPolicy";

export const CALL_STRATEGY_PATH = resolve(ROOT, "config/call-strategy.json");
interface CallStrategy { version: number; name: string; positionSol: number; maxOpen: number; startSol: number; policy: PolicySpec; maxHoldMin?: number;
  filter: { type: "all" } | { type: "callers"; allow: string[] } | { type: "young"; maxTrades: number }; notes?: string }
interface Pair { price: number; dex: string; pair: string; quoteReserve: number; liqUsd: number }
interface Open { id: number; mint: string; caller: string; tokens: number; state: PolicyState; proceeds: number; legs: number; lastPrice: number; lastSeen: number; venue: string; quoteReserve: number }

const FIXED_SOL = 0.003;
const POLL_MS = 4000;
const NO_MARKET_CLOSE_MS = 30 * 60_000;
const impact = (sol: number, reserveSol: number) => Math.min(0.3, reserveSol > 0 ? sol / (reserveSol + sol) : 0.3);

function loadStrategy(): CallStrategy | null {
  if (!existsSync(CALL_STRATEGY_PATH)) return null;
  try { return JSON.parse(readFileSync(CALL_STRATEGY_PATH, "utf8")); } catch { return null; }
}

async function prices(mints: string[]): Promise<Map<string, Pair>> {
  const out = new Map<string, Pair>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      for (const p of (await r.json()) as any[]) {
        const mint = p.baseToken?.address;
        if (!chunk.includes(mint) || p.quoteToken?.symbol !== "SOL" || !p.priceNative) continue;
        const cand: Pair = { price: Number(p.priceNative), dex: p.dexId, pair: p.pairAddress, quoteReserve: Number(p.liquidity?.quote ?? 0), liqUsd: Number(p.liquidity?.usd ?? 0) };
        const cur = out.get(mint);
        if (!cur || cand.liqUsd > cur.liqUsd) out.set(mint, cand);
      }
    } catch { /* transient: try next poll */ }
  }
  return out;
}

/** Price for pump.fun tokens still on the bonding curve, from the bot's own real-time trade record (no indexer lag). */
function curvePrice(db: DB, mint: string): Pair | null {
  if (!mint.endsWith("pump")) return null;
  const t = db.prepare(`SELECT complete_ms FROM tokens WHERE mint = ?`).get(mint) as any;
  if (t?.complete_ms) return null;
  const r = db.prepare(`SELECT price, sol_raised, recv_ms FROM trades_raw WHERE mint = ? ORDER BY recv_ms DESC LIMIT 1`).get(mint) as any;
  if (!r || !r.price || Date.now() - r.recv_ms > 10 * 60_000) return null;
  return { price: r.price, dex: "pumpfun", pair: "bonding-curve", quoteReserve: 30 + (r.sol_raised ?? 0), liqUsd: 0 };
}

/** Trades the token had before the call: the bot's own count when it saw the launch, else Codex (at most 101 fetched). */
async function tradesBeforeCall(db: DB, mint: string, callMs: number): Promise<number | null> {
  const t = db.prepare(`SELECT create_ms FROM tokens WHERE mint = ?`).get(mint) as any;
  if (t?.create_ms && t.create_ms <= callMs) {
    return (db.prepare(`SELECT COUNT(*) n FROM trades_raw WHERE mint = ? AND recv_ms < ?`).get(mint, callMs) as any).n;
  }
  const key = process.env.CODEX_API_KEY;
  if (!key) return null;
  try {
    const q = `query { getTokenEvents(query: { address: "${mint}", networkId: 1399811149, eventDisplayType: [Buy, Sell], timestamp: { from: ${Math.floor(callMs / 1000) - 14 * 86400}, to: ${Math.floor(callMs / 1000) - 1} } }, limit: 101, direction: DESC) { items { timestamp } } }`;
    const r = await fetch("https://graph.codex.io/graphql", { method: "POST", headers: { "content-type": "application/json", Authorization: key }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    // "Not found" is NOT zero trades: Codex fails this query for some tokens (it returned empty history for tokens that
    // later graduated), so an unknown count must never pass the young-token filter.
    if (j.errors) return null;
    return j.data.getTokenEvents.items.length;
  } catch { return null; }
}

export function startTrader(db: DB, log: (level: "info" | "warn" | "error", msg: string) => void) {
  const open = new Map<number, Open>();
  const health = { ts: 0, strategy: null as string | null, version: 0, open: 0, cash: 0, equity: 0, polls: 0, lastError: "" };
  let book = db.prepare(`SELECT * FROM books WHERE book='telegram'`).get() as any;
  const s0 = loadStrategy();
  if (!book) {
    db.prepare(`INSERT INTO books(book,start_sol,cash_sol,realized_sol,day,day_start_equity,paused_until_ms,updated_ms) VALUES ('telegram',?,?,0,'',?,0,?)`).run(s0?.startSol ?? 1, s0?.startSol ?? 1, s0?.startSol ?? 1, Date.now());
    book = db.prepare(`SELECT * FROM books WHERE book='telegram'`).get();
  }
  let cash: number = book.cash_sol;
  // Restore open positions after a restart.
  for (const r of db.prepare(`SELECT * FROM positions WHERE book='telegram' AND status='open' AND signal LIKE 'call:%'`).all() as any[]) {
    const st = JSON.parse(r.state_json);
    const state = new PolicyState(st.spec, r.entry_price, r.entry_fill_ms);
    Object.assign(state, { peak: st.peak, left: st.left, armed: st.armed, runner: st.runner });
    open.set(r.id, { id: r.id, mint: r.mint, caller: st.caller, tokens: st.tokens, state, proceeds: st.proceeds, legs: st.legs, lastPrice: st.lastPrice, lastSeen: Date.now(), venue: st.venue, quoteReserve: st.quoteReserve });
  }
  const saveBook = () => db.prepare(`UPDATE books SET cash_sol=?, updated_ms=? WHERE book='telegram'`).run(cash, Date.now());
  const persist = (o: Open) => db.prepare(`UPDATE positions SET state_json=?, peak_pnl_pct=?, pnl_pct=? WHERE id=?`).run(
    JSON.stringify({ spec: o.state.spec, peak: o.state.peak, left: o.state.left, armed: o.state.armed, runner: o.state.runner, tokens: o.tokens, proceeds: o.proceeds, legs: o.legs, lastPrice: o.lastPrice, venue: o.venue, quoteReserve: o.quoteReserve, caller: o.caller }),
    (o.state.peak / o.state.entry - 1) * 100, (o.lastPrice / o.state.entry - 1) * 100, o.id);

  const sell = (o: Open, px: number, frac: number, reason: string, now: number) => {
    const gross = o.tokens * frac * px;
    const net = gross * (1 - venueFeePct(o.venue) / 100 - impact(gross, o.quoteReserve));
    o.proceeds += net; o.legs++;
    cash += net - FIXED_SOL;
    if (o.state.done) {
      const s = loadStrategy();
      const pos = s?.positionSol ?? 0.1;
      const pnl = o.proceeds - pos - FIXED_SOL * o.legs;
      db.prepare(`UPDATE positions SET status='closed', exit_fill_ms=?, exit_decision_ms=?, exit_price=?, exit_sol_net=?, exit_reason=?, pnl_sol=?, pnl_pct=?, hold_s=?, exit_fixed_sol=? WHERE id=?`)
        .run(now, now, px, o.proceeds, reason, pnl, (pnl / (pos + FIXED_SOL)) * 100, (now - o.state.entryMs) / 1000, FIXED_SOL * (o.legs - 1), o.id);
      open.delete(o.id);
      log("info", `CALL CLOSE ${o.mint.slice(0, 6)} (${o.caller}) ${reason} pnl ${pnl.toFixed(4)} SOL`);
    } else persist(o);
    saveBook();
  };

  const tick = async () => {
    const strat = loadStrategy();
    health.strategy = strat ? `${strat.name} · ${policyName(strat.policy)}` : "waiting for config/call-strategy.json from the backtest";
    health.version = strat?.version ?? 0;
    const now = Date.now();
    const pending = strat ? db.prepare(`SELECT id, mint, caller, call_ms FROM manual_signals WHERE book='telegram' AND status='pending' ORDER BY call_ms`).all() as any[] : [];
    const mints = [...new Set([...pending.map((p) => p.mint), ...[...open.values()].map((o) => o.mint)])];
    if (!mints.length) return;
    const px = await prices(mints);
    for (const m of mints) { const c = curvePrice(db, m); if (c) px.set(m, c); } // own curve data beats indexers for tokens still on the curve
    health.polls++;
    // exits first (frees capacity)
    for (const o of [...open.values()]) {
      const p = px.get(o.mint);
      if (!p) {
        if (now - o.lastSeen > NO_MARKET_CLOSE_MS) { o.state.done = true; sell(o, 0, o.state.left, "no_market", now); }
        continue;
      }
      o.lastPrice = p.price; o.lastSeen = now; o.venue = p.dex; o.quoteReserve = p.quoteReserve;
      if (strat?.maxHoldMin && now - o.state.entryMs >= strat.maxHoldMin * 60_000) { o.state.done = true; sell(o, p.price, o.state.left, "max_hold", now); continue; }
      const fills = o.state.onBar({ t: now, o: p.price, h: p.price, l: p.price, c: p.price });
      for (const f of fills) sell(o, f.px, f.frac, f.reason, now);
      if (!fills.length) persist(o);
    }
    if (!strat) return;
    const traded = new Set((db.prepare(`SELECT DISTINCT mint FROM positions WHERE book='telegram' AND signal LIKE 'call:%'`).all() as any[]).map((r) => r.mint));
    for (const sig of pending) {
      const setStatus = (status: string, detail: string, pid?: number) => db.prepare(`UPDATE manual_signals SET status=?, detail=?, position_id=COALESCE(?, position_id) WHERE id=?`).run(status, detail, pid ?? null, sig.id);
      if (traded.has(sig.mint)) { setStatus("rejected", "token already traded by this book"); continue; }
      if (strat.filter.type === "callers" && !strat.filter.allow.includes(sig.caller)) { setStatus("rejected", "caller not selected by the strategy"); continue; }
      if (strat.filter.type === "young") {
        const n = await tradesBeforeCall(db, sig.mint, sig.call_ms);
        if (n === null) { if (now - sig.call_ms > 2 * 60_000) setStatus("rejected", "could not count pre-call trades"); continue; }
        if (n > strat.filter.maxTrades) { setStatus("rejected", `not young: ${n}${n >= 101 ? "+" : ""} trades before the call`); continue; }
      }
      const p = px.get(sig.mint);
      if (!p) { if (now - sig.call_ms > 10 * 60_000) setStatus("expired", "no SOL market found on DexScreener within 10 min"); continue; }
      if (open.size >= strat.maxOpen) { setStatus("rejected", `book full (${strat.maxOpen} open)`); continue; }
      if (cash < strat.positionSol + FIXED_SOL) { setStatus("rejected", "not enough cash"); continue; }
      const cost = venueFeePct(p.dex) / 100 + impact(strat.positionSol, p.quoteReserve);
      const tokens = (strat.positionSol * (1 - cost)) / p.price;
      cash -= strat.positionSol + FIXED_SOL;
      const r = db.prepare(`INSERT INTO positions(book,mint,symbol,status,strategy_version,signal,decision_ms,entry_fill_ms,entry_sol,entry_fixed_sol,tokens,expected_entry_price,entry_price,entry_slippage_pct,exit_params_json,features_json,state_json)
        VALUES ('telegram',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sig.mint, "", "open", strat.version, `call:${sig.caller}`, now, now, strat.positionSol, FIXED_SOL, tokens, p.price, p.price, cost * 100,
        JSON.stringify(strat.policy), JSON.stringify({ dex: p.dex, pair: p.pair, liqUsd: p.liqUsd, quoteReserveSol: p.quoteReserve, caller: sig.caller, callDelayS: (now - sig.call_ms) / 1000 }), "{}");
      const id = Number(r.lastInsertRowid);
      const o: Open = { id, mint: sig.mint, caller: sig.caller, tokens, state: new PolicyState(strat.policy, p.price, now), proceeds: 0, legs: 1, lastPrice: p.price, lastSeen: now, venue: p.dex, quoteReserve: p.quoteReserve };
      open.set(id, o); persist(o); saveBook(); traded.add(sig.mint);
      setStatus("entered", `${p.dex} liq $${Math.round(p.liqUsd)} cost ${(cost * 100).toFixed(1)}%`, id);
      log("info", `CALL OPEN ${sig.mint.slice(0, 6)} (${sig.caller}) on ${p.dex} at ${p.price.toExponential(3)} SOL, ${((now - sig.call_ms) / 1000).toFixed(0)}s after the call`);
    }
  };

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { health.lastError = (e as Error).message; log("error", `trader: ${(e as Error).stack}`); }
    finally { busy = false; }
  }, POLL_MS);
  setInterval(() => {
    let eq = cash;
    for (const o of open.values()) eq += o.tokens * o.state.left * o.lastPrice * (1 - venueFeePct(o.venue) / 100);
    Object.assign(health, { ts: Date.now(), open: open.size, cash, equity: eq });
    kvSet(db, "calls_trader_health", JSON.stringify(health));
  }, 15_000);
  setInterval(() => {
    let eq = cash;
    for (const o of open.values()) eq += o.tokens * o.state.left * o.lastPrice * (1 - venueFeePct(o.venue) / 100);
    db.prepare(`INSERT INTO equity(ts_ms,book,equity_sol,open_positions) VALUES (?,?,?,?)`).run(Date.now(), "telegram", eq, open.size);
  }, 60_000);
  void tx;
}
