// Own-trade post-mortems: grades the decision separately from the outcome and tags
// the mistake, using what the token did in the 15 minutes after we exited.
import { type DB, tx } from "@pf/core/db";

export function runPostmortems(db: DB, now = Date.now(), limit = 500): number {
  const rows = db.prepare(`SELECT p.* FROM positions p LEFT JOIN postmortems m ON m.position_id = p.id
    WHERE p.status = 'closed' AND m.position_id IS NULL AND p.exit_fill_ms < ? AND (p.book != 'shadow' OR p.signal = 'momentum_pass')
    ORDER BY p.exit_fill_ms LIMIT ?`).all(now - 15 * 60_000, limit) as any[];
  if (!rows.length) return 0;
  const path = db.prepare(`SELECT price, recv_ms FROM trades_raw WHERE mint = ? AND recv_ms BETWEEN ? AND ? ORDER BY recv_ms`);
  const outcome = db.prepare(`SELECT outcome FROM token_outcomes WHERE mint = ?`);
  const ins = db.prepare(`INSERT OR REPLACE INTO postmortems(position_id,book,max_after_1m_pct,max_after_5m_pct,max_after_15m_pct,min_after_5m_pct,
    token_outcome,tags,decision_grade,outcome_grade,notes,created_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  tx(db, () => {
    for (const p of rows) {
      const exitP = p.exit_price || p.entry_price;
      const pts = path.all(p.mint, p.exit_fill_ms, p.exit_fill_ms + 15 * 60_000) as { price: number; recv_ms: number }[];
      const within = (ms: number) => pts.filter((x) => x.recv_ms <= p.exit_fill_ms + ms).map((x) => x.price);
      const rel = (v: number | undefined) => (v === undefined || !exitP ? null : (v / exitP - 1) * 100);
      const max1 = rel(maxOf(within(60_000))), max5 = rel(maxOf(within(300_000))), max15 = rel(maxOf(within(900_000)));
      const min5 = rel(minOf(within(300_000)));
      // Best price reachable while we held, vs our entry: did an opportunity exist at all?
      const peakWhileHeld = p.peak_pnl_pct ?? 0;
      const f = JSON.parse(p.features_json ?? "{}");
      const tags: string[] = [];
      const r = p.exit_reason as string;
      if (["take_profit", "trailing_stop", "time_stop"].includes(r) && (max5 ?? 0) >= 30) tags.push("exit_too_early");
      if (r === "time_stop" && (max5 ?? 0) >= 50) tags.push("time_stop_on_runner");
      if (r?.startsWith("stop_loss") && (max5 ?? 0) >= 20) tags.push("stopped_then_recovered");
      if ((min5 ?? 0) <= -30) tags.push("dodged_dump");
      if (r === "dev_sell" && p.pnl_sol < 0) tags.push("dev_dump");
      if (r === "whale_sell" && p.pnl_sol < 0) tags.push("whale_dump");
      if ((p.entry_slippage_pct ?? 0) > 5) tags.push("entry_slippage");
      if (p.pnl_sol < 0 && (f.peakMult ?? 1) >= 3 && (f.drawFromPeakPct ?? 100) < 10) tags.push("late_entry_near_top");
      if (p.pnl_sol < 0 && peakWhileHeld < 3) tags.push("never_worked");
      if (p.pnl_sol < 0 && peakWhileHeld >= 15) tags.push("gave_back_gains");
      const oc = (outcome.get(p.mint) as any)?.outcome ?? null;
      if (oc === "rug" && (f.sameSlotBuyers ?? 0) > 0) tags.push("bundle_rug");
      const decision = peakWhileHeld >= 15 || (max5 ?? 0) >= 20 ? "good" : "bad";
      const outcomeGrade = p.pnl_sol > 0 ? "win" : "loss";
      const notes = decision === "good" && outcomeGrade === "loss" ? "entry had upside: exit rules are the problem"
        : decision === "bad" && outcomeGrade === "win" ? "won without real upside: likely luck"
        : decision === "bad" ? "entry never had upside: entry filters are the problem" : "worked as designed";
      ins.run(p.id, p.book, max1, max5, max15, min5, oc, JSON.stringify(tags), decision, outcomeGrade, notes, now);
    }
  });
  return rows.length;
}

const maxOf = (v: number[]) => (v.length ? Math.max(...v) : undefined);
const minOf = (v: number[]) => (v.length ? Math.min(...v) : undefined);
