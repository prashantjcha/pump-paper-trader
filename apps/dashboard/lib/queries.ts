// All dashboard reads. Each view returns plain JSON for the client pages.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { all, one, kv, dbSizeMb, KILL_PATH, DATA_DIR } from "./db";

const DAY = 86_400_000;
/** Books were reset to 1 SOL at this time; book stats and equity start here. Shadow is unaffected. */
const resetMs = () => Number(kv("book_reset_ms") ?? 0);
const BOOKS = ["momentum", "copy", "manual", "runner", "telegram"];

function bookKpis(book: string, since = 0) {
  if (book !== "shadow") since = Math.max(since, resetMs());
  const rows = all<any>(`SELECT pnl_sol, pnl_pct, hold_s, exit_fill_ms, status, exit_reason, entry_slippage_pct FROM positions
    WHERE book = ? AND status IN ('closed','failed') AND decision_ms >= ? ORDER BY COALESCE(exit_fill_ms, entry_fill_ms, decision_ms)`, book, since);
  const closed = rows.filter((r) => r.status === "closed");
  let cum = 0, peak = 0, maxDd = 0, gp = 0, gl = 0;
  for (const r of rows) { cum += r.pnl_sol ?? 0; peak = Math.max(peak, cum); maxDd = Math.max(maxDd, peak - cum); if (r.pnl_sol > 0) gp += r.pnl_sol; else gl -= r.pnl_sol ?? 0; }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return {
    book, trades: closed.length, failed: rows.length - closed.length, pnlSol: cum,
    winRate: closed.length ? closed.filter((r) => r.pnl_sol > 0).length / closed.length : null,
    expectancySol: closed.length ? cum / closed.length : null,
    profitFactor: gl > 0 ? gp / gl : null, maxDrawdownSol: maxDd,
    avgHoldS: closed.length ? closed.reduce((a, r) => a + r.hold_s, 0) / closed.length : null,
    avgWinPct: avg(closed.filter((r) => r.pnl_sol > 0).map((r) => r.pnl_pct)),
    avgLossPct: avg(closed.filter((r) => r.pnl_sol <= 0).map((r) => r.pnl_pct)),
    tradesToday: closed.filter((r) => r.exit_fill_ms >= today.getTime()).length,
    avgSlippagePct: avg(closed.map((r) => r.entry_slippage_pct)),
  };
}
const avg = (v: (number | null)[]) => { const x = v.filter((n): n is number => n != null); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };

export function overview() {
  const health = kv("bot_health");
  const books = all<any>(`SELECT * FROM books WHERE book != 'shadow'`);
  const equity = all<any>(`SELECT ts_ms, book, equity_sol FROM equity WHERE ts_ms > ? ORDER BY ts_ms`, Math.max(Date.now() - 7 * DAY, resetMs()));
  const open = all<any>(`SELECT id, book, mint, symbol, signal, entry_fill_ms, entry_sol, entry_price, pnl_pct, peak_pnl_pct, min_pnl_pct, exit_params_json, strategy_version
    FROM positions WHERE status = 'open' AND book != 'shadow' ORDER BY entry_fill_ms DESC`).map((p) => {
    const e = JSON.parse(p.exit_params_json ?? "{}");
    return { ...p, exit_params_json: undefined, tpRange: [e.tpFallingPct, e.tpRisingPct], sl: e.slBasePct, timeStopS: e.timeStopS };
  });
  const recent = all<any>(`SELECT id, book, symbol, mint, exit_reason, pnl_sol, pnl_pct, hold_s, exit_fill_ms FROM positions
    WHERE status = 'closed' AND book != 'shadow' AND decision_ms >= ? ORDER BY exit_fill_ms DESC LIMIT 12`, resetMs());
  const shadow = bookKpis("shadow", Date.now() - DAY);
  return {
    now: Date.now(), resetMs: resetMs() || null, health, killed: existsSync(/*turbopackIgnore: true*/ KILL_PATH),
    books: BOOKS.map((b) => ({ ...(books.find((x) => x.book === b) ?? { book: b, cash_sol: 1, start_sol: 1 }), equityNow: b === "telegram" ? kv("calls_trader_health")?.equity ?? null : health?.books?.[b]?.equity ?? null, open: b === "telegram" ? kv("calls_trader_health")?.open ?? 0 : health?.books?.[b]?.open ?? 0, paused: health?.books?.[b]?.paused ?? false, kpis: bookKpis(b), kpis24h: bookKpis(b, Date.now() - DAY) })),
    equity, open, recent, shadow,
    strategy: one<any>(`SELECT version, status, reason, activated_ms FROM strategy_versions WHERE status IN ('active','provisional','confirmed') ORDER BY version DESC LIMIT 1`),
  };
}

export function trades(book: string, limit = 400) {
  const rows = all<any>(`SELECT p.id, p.book, p.mint, p.symbol, p.status, p.signal, p.strategy_version, p.decision_ms, p.entry_fill_ms, p.exit_fill_ms,
      p.entry_sol, p.entry_price, p.exit_price, p.entry_slippage_pct, p.exit_reason, p.pnl_sol, p.pnl_pct, p.hold_s, p.peak_pnl_pct, p.min_pnl_pct,
      m.tags, m.decision_grade, m.outcome_grade, m.max_after_5m_pct
    FROM positions p LEFT JOIN postmortems m ON m.position_id = p.id
    WHERE p.book = ? AND p.status IN ('closed','failed','open','void') ORDER BY p.decision_ms DESC LIMIT ?`, book, limit);
  const byReason = all<any>(`SELECT exit_reason reason, COUNT(*) n, SUM(pnl_sol) pnl, AVG(pnl_pct) avg_pct FROM positions
    WHERE book = ? AND status IN ('closed','failed') GROUP BY exit_reason ORDER BY n DESC`, book);
  return { book, rows, byReason, kpis: bookKpis(book) };
}

export function tradeDetail(id: number) {
  const p = one<any>(`SELECT * FROM positions WHERE id = ?`, id);
  if (!p) return null;
  const from = (p.decision_ms ?? 0) - 120_000;
  const to = (p.exit_fill_ms ?? Date.now()) + 15 * 60_000;
  const path = all<any>(`SELECT recv_ms t, price, is_buy, sol FROM trades_raw WHERE mint = ? AND recv_ms BETWEEN ? AND ? ORDER BY recv_ms LIMIT 5000`, p.mint, from, to);
  const pm = one<any>(`SELECT * FROM postmortems WHERE position_id = ?`, id);
  const token = one<any>(`SELECT t.name, t.symbol, t.creator, t.create_ms, t.socials, o.outcome, o.peak_mult FROM tokens t LEFT JOIN token_outcomes o ON o.mint = t.mint WHERE t.mint = ?`, p.mint);
  return {
    position: { ...p, features: JSON.parse(p.features_json ?? "{}"), exitFeatures: JSON.parse(p.exit_features_json ?? "{}"), exitParams: JSON.parse(p.exit_params_json ?? "{}"), features_json: undefined, exit_features_json: undefined, exit_params_json: undefined, state_json: undefined },
    path, postmortem: pm ? { ...pm, tags: JSON.parse(pm.tags ?? "[]") } : null, token,
  };
}

const latestStudy = (kind: string) => {
  const r = one<any>(`SELECT created_ms, data_json FROM study_snapshots WHERE kind = ? ORDER BY created_ms DESC LIMIT 1`, kind);
  return r ? { createdMs: r.created_ms, ...JSON.parse(r.data_json) } : null;
};

export function market() {
  const perHour = all<any>(`SELECT (create_ms / 3600000) * 3600000 hour, COUNT(*) launches, SUM(mayhem) mayhem FROM tokens WHERE create_ms > ? GROUP BY 1 ORDER BY 1`, Date.now() - 2 * DAY);
  const outcomes24 = all<any>(`SELECT outcome, COUNT(*) n FROM token_outcomes WHERE create_ms > ? GROUP BY outcome`, Date.now() - DAY);
  const runners = all<any>(`SELECT o.mint, t.symbol, o.outcome, o.peak_mult, o.time_to_peak_s, o.peak_sol_raised, o.unique_traders, o.volume_sol, o.dev_buy_sol, o.same_slot_buyers, o.create_ms
    FROM token_outcomes o LEFT JOIN tokens t ON t.mint = o.mint WHERE o.create_ms > ? ORDER BY o.peak_mult DESC LIMIT 25`, Date.now() - DAY);
  return { perHour, outcomes24, runners, market: latestStudy("market"), behaviour: latestStudy("behaviour"), shadow: latestStudy("shadow") };
}

export function wallets() {
  const top = all<any>(`SELECT * FROM wallet_stats ORDER BY pnl_7d DESC LIMIT 60`);
  const bottom = all<any>(`SELECT * FROM wallet_stats ORDER BY pnl_7d ASC LIMIT 20`);
  const watch = all<any>(`SELECT w.*, s.tokens_7d, s.win_rate_7d, s.pnl_7d, s.tags FROM watchlist w LEFT JOIN wallet_stats s ON s.wallet = w.wallet WHERE w.active = 1 ORDER BY w.score DESC`);
  const counts = one<any>(`SELECT COUNT(*) wallets, SUM(pnl_7d > 0) profitable, SUM(tags LIKE '%sniper%') snipers, SUM(tags LIKE '%hft_bot%') bots, SUM(tags LIKE '%smart%') smart FROM wallet_stats`);
  return { top, bottom, watch, counts };
}

export function walletDetail(wallet: string) {
  return {
    stats: one<any>(`SELECT * FROM wallet_stats WHERE wallet = ?`, wallet),
    positions: all<any>(`SELECT w.*, t.symbol FROM wallet_positions w LEFT JOIN tokens t ON t.mint = w.mint WHERE w.wallet = ? ORDER BY w.first_buy_ms DESC LIMIT 200`, wallet),
  };
}

export function learning() {
  const versions = all<any>(`SELECT version, status, parent_version, reason, created_ms, activated_ms, evaluated_ms, eval_json, params_json FROM strategy_versions ORDER BY version DESC LIMIT 30`)
    .map((v) => ({ ...v, eval: v.eval_json ? JSON.parse(v.eval_json) : null, params: JSON.parse(v.params_json), eval_json: undefined, params_json: undefined }));
  const retros = all<any>(`SELECT id, created_ms, kind, model, n_own_trades, learned, status, error, output_json FROM retrospectives ORDER BY id DESC LIMIT 20`)
    .map((r) => ({ ...r, output: r.output_json ? JSON.parse(r.output_json) : null, output_json: undefined }));
  const proposals = all<any>(`SELECT * FROM learning_proposals ORDER BY id DESC LIMIT 60`).map((p) => ({ ...p, replay: p.replay_json ? JSON.parse(p.replay_json) : null, replay_json: undefined }));
  let bounds: any = null;
  const bp = resolve(DATA_DIR, "../config/bounds.json");
  if (existsSync(/*turbopackIgnore: true*/ bp)) bounds = JSON.parse(readFileSync(/*turbopackIgnore: true*/ bp, "utf8"));
  return { versions, retros, proposals, shadow: latestStudy("shadow"), mistakes: latestStudy("mistakes"), own: latestStudy("own"), behaviour: latestStudy("behaviour"), bounds };
}

export function calls() {
  const scored = `outcome IS NOT NULL AND outcome != 'no_data'`;
  // A caller repeating the same token counts once: their first call.
  const first = `id IN (SELECT MIN(id) FROM manual_signals WHERE book='telegram' GROUP BY caller, mint)`;
  const callers = all<any>(`SELECT caller, COUNT(*) calls, SUM(${scored}) scored,
      SUM(outcome IN ('+25%','+50%','2x')) hit25, SUM(outcome IN ('+50%','2x')) hit50, SUM(outcome = '2x') hit100,
      AVG(CASE WHEN ${scored} THEN max_15m_pct END) avg_max15, AVG(CASE WHEN ${scored} THEN min_60m_pct END) avg_min60,
      SUM(status='entered') traded, MAX(call_ms) last_call
    FROM manual_signals WHERE book='telegram' AND ${first} GROUP BY caller ORDER BY calls DESC`);
  const trades = all<any>(`SELECT s.caller, COUNT(p.id) n, SUM(p.pnl_sol > 0) wins, SUM(p.pnl_sol) pnl FROM manual_signals s
    JOIN positions p ON p.id = s.position_id WHERE s.book='telegram' AND p.status='closed' AND p.decision_ms >= ? GROUP BY s.caller`, resetMs());
  const byCaller = new Map(trades.map((t) => [t.caller, t]));
  return {
    health: kv("telegram_health"),
    trader: kv("calls_trader_health"),
    totals: one<any>(`SELECT COUNT(*) calls, SUM(status='historical') historical, SUM(status IN ('pending','watching','entered','rejected','expired')) live,
      SUM(outcome IS NOT NULL AND outcome != 'no_data') scored, SUM(outcome = 'no_data') no_data,
      SUM(outcome IN ('+25%','+50%','2x')) hit25, SUM(outcome = '2x') hit100 FROM manual_signals WHERE book='telegram' AND ${first}`),
    callers: callers.map((c) => ({ ...c, paper: byCaller.get(c.caller) ?? null })),
    recent: all<any>(`SELECT s.id, s.mint, s.caller, s.status, s.detail, s.call_ms, s.msg_text, s.outcome, s.max_5m_pct, s.max_15m_pct, s.max_60m_pct, s.min_60m_pct,
        p.pnl_sol, p.pnl_pct, p.exit_reason FROM manual_signals s LEFT JOIN positions p ON p.id = s.position_id
      WHERE s.book='telegram' ORDER BY s.call_ms DESC LIMIT 150`),
  };
}

export function system() {
  const since = Date.now() - 6 * 3_600_000;
  const series = (key: string) => all<any>(`SELECT ts_ms t, value v FROM metrics WHERE key = ? AND ts_ms > ? ORDER BY ts_ms`, key, since);
  return {
    now: Date.now(), health: kv("bot_health"), analyst: kv("analyst_status"), killed: existsSync(/*turbopackIgnore: true*/ KILL_PATH), dbSizeMb: dbSizeMb(),
    eventsPerSec: series("events_per_s"), lag: series("feed_lag_s"), tracked: series("tracked_tokens"),
    logs: all<any>(`SELECT ts_ms, source, level, msg FROM logs ORDER BY ts_ms DESC LIMIT 150`),
    counts: one<any>(`SELECT (SELECT COUNT(*) FROM tokens) tokens, (SELECT COUNT(*) FROM trades_raw) trades, (SELECT COUNT(*) FROM token_outcomes) outcomes, (SELECT COUNT(*) FROM wallet_positions) walletPositions, (SELECT COUNT(*) FROM positions WHERE book='shadow') shadow`),
    signals: all<any>(`SELECT * FROM manual_signals ORDER BY id DESC LIMIT 20`),
  };
}
