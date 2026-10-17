// Caller scorecard: for every Telegram call (live or backfilled), how far did the price move in the
// 5 / 15 / 60 minutes after the message? Uses recorded curve trades only, so calls on tokens outside
// the pump.fun bonding curve, or during recording gaps, are marked no_data.
import { type DB, tx } from "@pf/core/db";

export function scoreCalls(db: DB, now = Date.now(), limit = 2000): number {
  const rows = db.prepare(`SELECT id, mint, call_ms FROM manual_signals
    WHERE book = 'telegram' AND outcome IS NULL AND call_ms IS NOT NULL AND call_ms < ? ORDER BY call_ms LIMIT ?`).all(now - 60 * 60_000, limit) as any[];
  if (!rows.length) return 0;
  const after = db.prepare(`SELECT price, sol_raised, recv_ms FROM trades_raw WHERE mint = ? AND recv_ms BETWEEN ? AND ? ORDER BY recv_ms`);
  const before = db.prepare(`SELECT price, sol_raised FROM trades_raw WHERE mint = ? AND recv_ms BETWEEN ? AND ? ORDER BY recv_ms DESC LIMIT 1`);
  const up = db.prepare(`UPDATE manual_signals SET call_price=?, call_sol_raised=?, max_5m_pct=?, max_15m_pct=?, max_60m_pct=?, min_60m_pct=?, outcome=?, outcome_ms=? WHERE id=?`);
  tx(db, () => {
    for (const r of rows) {
      const pts = after.all(r.mint, r.call_ms, r.call_ms + 60 * 60_000) as { price: number; sol_raised: number | null; recv_ms: number }[];
      const prior = before.get(r.mint, r.call_ms - 10 * 60_000, r.call_ms) as { price: number; sol_raised: number | null } | undefined;
      const entry = prior ?? pts[0];
      if (!entry || !pts.length) { up.run(null, null, null, null, null, null, "no_data", now, r.id); continue; }
      const p0 = entry.price;
      const mx = (ms: number) => { const v = pts.filter((x) => x.recv_ms <= r.call_ms + ms).map((x) => x.price); return v.length ? (Math.max(...v) / p0 - 1) * 100 : null; };
      const m60 = mx(3_600_000);
      const min60 = (Math.min(...pts.map((x) => x.price)) / p0 - 1) * 100;
      const outcome = m60 == null ? "no_data" : m60 >= 100 ? "2x" : m60 >= 50 ? "+50%" : m60 >= 25 ? "+25%" : "miss";
      up.run(p0, entry.sol_raised ?? null, mx(300_000), mx(900_000), m60, min60, outcome, now, r.id);
    }
  });
  return rows.length;
}
