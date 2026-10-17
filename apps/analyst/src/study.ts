// Behaviour study: what separates the wallets that make money from those that
// lose it, which launches run or rug, what each bot filter costs, and how the
// bot's own trades went. Every cell carries its sample size.
import type { DB } from "@pf/core/db";

type Row = Record<string, any>;
const r4 = (x: number | null | undefined) => (x == null || !isFinite(x) ? null : Math.round(x * 1e4) / 1e4);

function bucketStats(rows: Row[], key: (r: Row) => string, pnl: (r: Row) => number, order?: string[]) {
  const m = new Map<string, number[]>();
  for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(pnl(r)); }
  const keys = order ? order.filter((k) => m.has(k)) : [...m.keys()].sort();
  return keys.map((k) => {
    const v = m.get(k)!;
    const sum = v.reduce((a, b) => a + b, 0);
    return { bucket: k, n: v.length, winRate: r4(v.filter((x) => x > 0).length / v.length), avg: r4(sum / v.length), total: r4(sum) };
  });
}
const bucket = (x: number | null | undefined, edges: number[], labels: string[]) => {
  if (x == null) return "unknown";
  for (let i = 0; i < edges.length; i++) if (x < edges[i]) return labels[i];
  return labels[labels.length - 1];
};

export const AGE_B = { edges: [2, 10, 30, 60, 180, 600], labels: ["<2s", "2-10s", "10-30s", "30-60s", "1-3m", "3-10m", "10m+"] };
export const HOLD_B = { edges: [5, 30, 120, 600, 3600], labels: ["<5s", "5-30s", "30s-2m", "2-10m", "10-60m", "1h+"] };
export const SIZE_B = { edges: [0.1, 0.5, 2], labels: ["<0.1", "0.1-0.5", "0.5-2", "2+"] };
export const RAISED_B = { edges: [2, 5, 10, 25, 50], labels: ["<2", "2-5", "5-10", "10-25", "25-50", "50+"] };

export function marketStudy(db: DB, from: number, to: number) {
  const rows = db.prepare(`SELECT * FROM token_outcomes WHERE create_ms BETWEEN ? AND ?`).all(from, to) as Row[];
  const n = rows.length;
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const rate = (sub: Row[], o: string) => (sub.length ? r4(sub.filter((r) => r.outcome === o).length / sub.length) : null);
  const group = (key: (r: Row) => string, order?: string[]) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    const keys = order ? order.filter((k) => m.has(k)) : [...m.keys()].sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => { const s = m.get(k)!; return { bucket: k, n: s.length, runner: rate(s, "runner"), graduated: rate(s, "graduated"), rug: rate(s, "rug"), medianPeakMult: r4(median(s.map((x) => x.peak_mult))) }; });
  };
  return {
    window: { from, to }, tokens: n,
    outcomes: { runner: count((r) => r.outcome === "runner"), graduated: count((r) => r.outcome === "graduated"), rug: count((r) => r.outcome === "rug"), fizzle: count((r) => r.outcome === "fizzle") },
    graduationRate: n ? r4(count((r) => r.graduated === 1) / n) : null,
    medianLifetimeS: r4(median(rows.map((r) => r.lifetime_s))),
    medianTimeToPeakS: r4(median(rows.map((r) => r.time_to_peak_s))),
    reached1_3x: n ? r4(count((r) => r.peak_mult >= 1.3) / n) : null,
    byHourUtc: group((r) => String(r.hour_utc)),
    byDevBuy: group((r) => bucket(r.dev_buy_sol, [0.01, 0.3, 1, 4], ["none", "<0.3", "0.3-1", "1-4", "4+"]), ["none", "<0.3", "0.3-1", "1-4", "4+"]),
    bySameSlotBuyers: group((r) => bucket(r.same_slot_buyers, [1, 3, 6], ["0", "1-2", "3-5", "6+"]), ["0", "1-2", "3-5", "6+"]),
    byDevSold: group((r) => (r.dev_sold_s == null ? "never" : bucket(r.dev_sold_s, [15, 60, 300], ["<15s", "15-60s", "1-5m", "5m+"])), ["<15s", "15-60s", "1-5m", "5m+", "never"]),
  };
}

export function behaviourStudy(db: DB, from: number, to: number) {
  const rows = db.prepare(`SELECT wallet, buy_sol, realized_sol, hold_s, first_buy_age_s, first_buy_sol_raised, sniper, is_creator
    FROM wallet_positions WHERE closed = 1 AND buy_sol > 0 AND first_buy_ms BETWEEN ? AND ?`).all(from, to) as Row[];
  const pct = (r: Row) => r.realized_sol / r.buy_sol;
  const nonCreator = rows.filter((r) => !r.is_creator);
  // Decile split of wallets by summed PnL in the window (>= 3 tokens).
  const byWallet = new Map<string, Row[]>();
  for (const r of nonCreator) { if (!byWallet.has(r.wallet)) byWallet.set(r.wallet, []); byWallet.get(r.wallet)!.push(r); }
  const ws = [...byWallet.entries()].filter(([, v]) => v.length >= 3).map(([w, v]) => ({ w, v, pnl: v.reduce((a, b) => a + b.realized_sol, 0) }));
  ws.sort((a, b) => b.pnl - a.pnl);
  const d = Math.max(1, Math.floor(ws.length / 10));
  const profile = (group: typeof ws) => {
    const all = group.flatMap((x) => x.v);
    return {
      wallets: group.length, positions: all.length,
      avgPnlSol: r4(group.reduce((a, b) => a + b.pnl, 0) / Math.max(1, group.length)),
      medianEntryAgeS: r4(median(all.map((r) => r.first_buy_age_s))), medianHoldS: r4(median(all.map((r) => r.hold_s))),
      medianSizeSol: r4(median(all.map((r) => r.buy_sol))), medianEntrySolRaised: r4(median(all.map((r) => r.first_buy_sol_raised))),
      sniperShare: r4(all.filter((r) => r.sniper).length / Math.max(1, all.length)),
      winRate: r4(all.filter((r) => r.realized_sol > 0).length / Math.max(1, all.length)),
    };
  };
  return {
    window: { from, to }, positions: rows.length, wallets: byWallet.size,
    marketWinRate: r4(nonCreator.filter((r) => r.realized_sol > 0).length / Math.max(1, nonCreator.length)),
    creatorsPnlSol: r4(rows.filter((r) => r.is_creator).reduce((a, b) => a + b.realized_sol, 0)),
    tradersPnlSol: r4(nonCreator.reduce((a, b) => a + b.realized_sol, 0)),
    byEntryAge: bucketStats(nonCreator, (r) => bucket(r.first_buy_age_s, AGE_B.edges, AGE_B.labels), pct, [...AGE_B.labels, "unknown"]),
    byHold: bucketStats(nonCreator, (r) => bucket(r.hold_s, HOLD_B.edges, HOLD_B.labels), pct, HOLD_B.labels),
    bySize: bucketStats(nonCreator, (r) => bucket(r.buy_sol, SIZE_B.edges, SIZE_B.labels), pct, SIZE_B.labels),
    byEntrySolRaised: bucketStats(nonCreator, (r) => bucket(r.first_buy_sol_raised, RAISED_B.edges, RAISED_B.labels), pct, [...RAISED_B.labels, "unknown"]),
    snipersVsOthers: bucketStats(nonCreator, (r) => (r.sniper ? "create-slot sniper" : "later entry"), pct),
    topDecile: profile(ws.slice(0, d)),
    bottomDecile: profile(ws.slice(-d)),
  };
}

/** Counterfactual attribution: what each momentum filter cost or saved, from the shadow book. */
export function shadowStudy(db: DB, from: number, to: number) {
  const rows = (db.prepare(`SELECT pnl_sol, pnl_pct, peak_pnl_pct, exit_reason, signal, features_json FROM positions
    WHERE book = 'shadow' AND status = 'closed' AND decision_ms BETWEEN ? AND ?`).all(from, to) as Row[])
    .map((r): Row => ({ ...r, f: JSON.parse(r.features_json ?? "{}") }));
  const stats = (s: Row[]) => {
    const n = s.length;
    const sum = s.reduce((a, b) => a + b.pnl_pct, 0);
    return { n, winRate: n ? r4(s.filter((r) => r.pnl_sol > 0).length / n) : null, avgPnlPct: n ? r4(sum / n) : null, avgPeakPnlPct: n ? r4(s.reduce((a, b) => a + b.peak_pnl_pct, 0) / n) : null };
  };
  const filters = new Set<string>();
  for (const r of rows) for (const f of r.f.fails ?? []) filters.add(f);
  const perFilter = [...filters].sort().map((f) => ({
    filter: f,
    failing: stats(rows.filter((r) => (r.f.fails ?? []).includes(f))),
    onlyFailing: stats(rows.filter((r) => r.f.fails?.length === 1 && r.f.fails[0] === f)),
    passing: stats(rows.filter((r) => !(r.f.fails ?? []).includes(f))),
  }));
  const pct = (r: Row) => r.pnl_pct;
  return {
    window: { from, to }, all: stats(rows),
    momentumPass: stats(rows.filter((r) => r.signal === "momentum_pass")),
    perFilter,
    exitReasons: bucketStats(rows, (r) => r.exit_reason, pct),
    byAge: bucketStats(rows, (r) => bucket(r.f.ageS, AGE_B.edges, AGE_B.labels), pct, AGE_B.labels),
    bySolRaised: bucketStats(rows, (r) => bucket(r.f.solRaised, RAISED_B.edges, RAISED_B.labels), pct, RAISED_B.labels),
    byUniqueBuyers: bucketStats(rows, (r) => bucket(r.f.uniqueBuyersW, [4, 8, 15, 30], ["<4", "4-7", "8-14", "15-29", "30+"]), pct, ["<4", "4-7", "8-14", "15-29", "30+"]),
    byBuySellRatio: bucketStats(rows, (r) => bucket(r.f.bsRatioW, [1, 2.5, 5], ["<1", "1-2.5", "2.5-5", "5+"]), pct, ["<1", "1-2.5", "2.5-5", "5+"]),
    byNetInflow: bucketStats(rows, (r) => bucket(r.f.netInflowW, [0, 1, 3, 6], ["<0", "0-1", "1-3", "3-6", "6+"]), pct, ["<0", "0-1", "1-3", "3-6", "6+"]),
    byDevBuy: bucketStats(rows, (r) => bucket(r.f.devBuySol, [0.3, 1, 4], ["<0.3", "0.3-1", "1-4", "4+"]), pct, ["<0.3", "0.3-1", "1-4", "4+"]),
    bySameSlot: bucketStats(rows, (r) => bucket(r.f.sameSlotBuyers, [1, 3, 6], ["0", "1-2", "3-5", "6+"]), pct, ["0", "1-2", "3-5", "6+"]),
    byHourUtc: bucketStats(rows, (r) => String(r.f.hourUtc).padStart(2, "0"), pct),
  };
}

export function ownStudy(db: DB, from: number, to: number) {
  const rows = db.prepare(`SELECT book, status, strategy_version, pnl_sol, pnl_pct, hold_s, exit_reason, entry_slippage_pct FROM positions
    WHERE book != 'shadow' AND status IN ('closed','failed') AND decision_ms BETWEEN ? AND ?`).all(from, to) as Row[];
  const books = [...new Set(rows.map((r) => r.book))];
  const per = (s: Row[]) => {
    const c = s.filter((r) => r.status === "closed");
    const pnl = s.reduce((a, b) => a + (b.pnl_sol ?? 0), 0);
    return {
      closed: c.length, failed: s.length - c.length, pnlSol: r4(pnl),
      winRate: c.length ? r4(c.filter((r) => r.pnl_sol > 0).length / c.length) : null,
      expectancySol: c.length ? r4(pnl / c.length) : null,
      avgHoldS: c.length ? r4(c.reduce((a, b) => a + b.hold_s, 0) / c.length) : null,
      avgEntrySlippagePct: c.length ? r4(c.reduce((a, b) => a + (b.entry_slippage_pct ?? 0), 0) / c.length) : null,
      exitReasons: bucketStats(c, (r) => r.exit_reason, (r) => r.pnl_pct),
    };
  };
  return {
    window: { from, to },
    books: Object.fromEntries(books.map((b) => [b, per(rows.filter((r) => r.book === b))])),
    byVersion: bucketStats(rows.filter((r) => r.book === "momentum" && r.status === "closed"), (r) => "v" + r.strategy_version, (r) => r.pnl_sol),
  };
}

export function mistakesStudy(db: DB, from: number, to: number) {
  const rows = db.prepare(`SELECT tags, decision_grade, outcome_grade FROM postmortems WHERE created_ms BETWEEN ? AND ?`).all(from, to) as Row[];
  const tags: Record<string, number> = {};
  const quad: Record<string, number> = {};
  for (const r of rows) {
    for (const t of JSON.parse(r.tags ?? "[]")) tags[t] = (tags[t] ?? 0) + 1;
    const q = `${r.decision_grade} decision / ${r.outcome_grade}`;
    quad[q] = (quad[q] ?? 0) + 1;
  }
  return { window: { from, to }, reviewed: rows.length, tags, quadrants: quad };
}

export function runStudies(db: DB, from: number, to: number) {
  return {
    market: marketStudy(db, from, to),
    behaviour: behaviourStudy(db, from, to),
    shadow: shadowStudy(db, from, to),
    own: ownStudy(db, from, to),
    mistakes: mistakesStudy(db, from, to),
  };
}

export function saveStudies(db: DB, studies: ReturnType<typeof runStudies>) {
  const ins = db.prepare(`INSERT INTO study_snapshots(created_ms, kind, data_json) VALUES (?,?,?)`);
  const now = Date.now();
  for (const [k, v] of Object.entries(studies)) ins.run(now, k, JSON.stringify(v));
  db.prepare(`DELETE FROM study_snapshots WHERE created_ms < ?`).run(now - 14 * 86_400_000);
}

function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
