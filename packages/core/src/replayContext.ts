// Rebuilds the live bot's creator memory as of a point in time, for replay parity.
import type { DB } from "./db.ts";

export const BLACKLIST_SQL = `SELECT DISTINCT creator v FROM token_outcomes
  WHERE creator IS NOT NULL AND finalized_ms > ? AND finalized_ms < ? AND (dev_sold_s < 60 OR peak_mult < 1.5)`;
export const BLACKLIST_DAYS = 7;

export function replayContext(db: DB, from: number) {
  const seedCreators = (db.prepare(`SELECT creator, create_ms t FROM tokens WHERE create_ms >= ? AND create_ms < ? ORDER BY create_ms`)
    .all(from - 86_400_000, from) as { creator: string; t: number }[]);
  const blacklist = new Set((db.prepare(BLACKLIST_SQL).all(from - BLACKLIST_DAYS * 86_400_000, from) as { v: string }[]).map((r) => r.v));
  return { seedCreators, blacklist };
}
