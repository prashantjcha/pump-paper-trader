// Whole-market study inputs: token lifecycle outcomes and a per-wallet ledger of
// who made and lost money on every launch, rebuilt from the recorded trade stream.
import { type DB, tx, kvGet, kvSet, chunkedDelete } from "@pf/core/db";

const SELL_FEE = 0.9875; // proceeds after the 1.25% curve fee when marking leftover tokens

/** Finalizes tokens that went idle (10 min) or graduated; closes their wallet positions. */
export function finalizeTokens(db: DB, now = Date.now(), limit = 3000): number {
  const rows = db.prepare(`SELECT mint, creator, create_ms, complete_ms, dev_buy_sol, same_slot_buyers FROM tokens
    WHERE finalized = 0 AND ((last_trade_ms < ?) OR (complete_ms IS NOT NULL AND complete_ms < ?)) LIMIT ?`)
    .all(now - 600_000, now - 120_000, limit) as any[];
  if (!rows.length) return 0;
  const trades = db.prepare(`SELECT user, is_buy, sol, tokens, price, sol_raised, recv_ms FROM trades_raw WHERE mint = ? ORDER BY recv_ms, id`);
  const ins = db.prepare(`INSERT OR REPLACE INTO token_outcomes(mint,creator,create_ms,first_price,peak_price,peak_mult,time_to_peak_s,max_dd_pct,
    dev_sold_s,outcome,unique_traders,volume_sol,peak_sol_raised,graduated,lifetime_s,hour_utc,dev_buy_sol,same_slot_buyers,finalized_ms,last_price)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const mark = db.prepare(`UPDATE tokens SET finalized = 1 WHERE mint = ?`);
  const closeWallets = db.prepare(`UPDATE wallet_positions SET closed = 1,
      realized_sol = sell_sol + MAX(tok_bought - tok_sold, 0) * ? - buy_sol,
      hold_s = (last_trade_ms - first_buy_ms) / 1000.0
    WHERE mint = ? AND closed = 0 AND buy_sol > 0`);
  tx(db, () => {
    for (const t of rows) {
      const tr = trades.all(t.mint) as any[];
      mark.run(t.mint);
      if (!tr.length) continue;
      const first = tr[0].price;
      let peak = first, peakMs = tr[0].recv_ms, maxDd = 0, runPeak = first, devSold: number | null = null, vol = 0, peakRaised = 0;
      const traders = new Set<string>();
      for (const x of tr) {
        if (x.price > peak) { peak = x.price; peakMs = x.recv_ms; }
        runPeak = Math.max(runPeak, x.price);
        maxDd = Math.max(maxDd, 1 - x.price / runPeak);
        if (!x.is_buy && x.user === t.creator && devSold === null) devSold = x.recv_ms;
        vol += x.sol; peakRaised = Math.max(peakRaised, x.sol_raised);
        traders.add(x.user);
      }
      const start = t.create_ms ?? tr[0].recv_ms;
      const last = tr[tr.length - 1];
      const peakMult = first > 0 ? peak / first : 1;
      const devSoldS = devSold !== null ? (devSold - start) / 1000 : null;
      let outcome = "fizzle";
      if (t.complete_ms) outcome = "graduated";
      else if (peakMult >= 2) outcome = "runner";
      else if (devSoldS !== null && devSoldS <= 300 && maxDd >= 0.5) outcome = "rug";
      ins.run(t.mint, t.creator, start, first, peak, peakMult, (peakMs - start) / 1000, maxDd * 100, devSoldS, outcome,
        traders.size, vol, peakRaised, t.complete_ms ? 1 : 0, (last.recv_ms - start) / 1000, new Date(start).getUTCHours(),
        t.dev_buy_sol, t.same_slot_buyers, now, last.price);
      closeWallets.run(last.price * SELL_FEE, t.mint);
    }
  });
  return rows.length;
}

/** Folds new trades into per-(wallet, mint) positions. Incremental via a cursor. */
export function updateLedger(db: DB, batch = 60_000): number {
  const cursor = Number(kvGet(db, "ledger_cursor") ?? 0);
  const rows = db.prepare(`SELECT id, mint, user, is_buy, sol, tokens, sol_raised, slot, recv_ms FROM trades_raw WHERE id > ? ORDER BY id LIMIT ?`).all(cursor, batch) as any[];
  if (!rows.length) return 0;
  const tokInfo = db.prepare(`SELECT creator, create_ms, create_slot FROM tokens WHERE mint = ?`);
  const cache = new Map<string, { creator: string; create_ms: number; create_slot: number } | null>();
  type Agg = { buy: number; sell: number; tb: number; ts: number; nb: number; ns: number; first?: number; last: number; age?: number; raised?: number; sniper: number; creator: number };
  const agg = new Map<string, Agg>();
  for (const r of rows) {
    let info = cache.get(r.mint);
    if (info === undefined) { info = ((tokInfo.get(r.mint) as any) ?? null) as { creator: string; create_ms: number; create_slot: number } | null; cache.set(r.mint, info); }
    const k = r.user + "|" + r.mint;
    let a = agg.get(k);
    if (!a) { a = { buy: 0, sell: 0, tb: 0, ts: 0, nb: 0, ns: 0, last: 0, sniper: 0, creator: info && info.creator === r.user ? 1 : 0 }; agg.set(k, a); }
    if (r.is_buy) {
      a.buy += r.sol; a.tb += r.tokens; a.nb++;
      if (a.first === undefined) {
        a.first = r.recv_ms; a.raised = r.sol_raised;
        if (info?.create_ms) a.age = (r.recv_ms - info.create_ms) / 1000;
        if (info && r.slot === info.create_slot && !a.creator) a.sniper = 1;
      }
    } else { a.sell += r.sol; a.ts += r.tokens; a.ns++; }
    a.last = Math.max(a.last, r.recv_ms);
  }
  const up = db.prepare(`INSERT INTO wallet_positions(wallet,mint,buy_sol,sell_sol,tok_bought,tok_sold,n_buys,n_sells,first_buy_ms,last_trade_ms,first_buy_age_s,first_buy_sol_raised,sniper,is_creator)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(wallet,mint) DO UPDATE SET buy_sol=buy_sol+excluded.buy_sol, sell_sol=sell_sol+excluded.sell_sol,
      tok_bought=tok_bought+excluded.tok_bought, tok_sold=tok_sold+excluded.tok_sold, n_buys=n_buys+excluded.n_buys, n_sells=n_sells+excluded.n_sells,
      first_buy_ms=COALESCE(first_buy_ms, excluded.first_buy_ms), last_trade_ms=MAX(last_trade_ms, excluded.last_trade_ms),
      first_buy_age_s=COALESCE(first_buy_age_s, excluded.first_buy_age_s), first_buy_sol_raised=COALESCE(first_buy_sol_raised, excluded.first_buy_sol_raised),
      sniper=MAX(sniper, excluded.sniper), is_creator=MAX(is_creator, excluded.is_creator)`);
  tx(db, () => {
    for (const [k, a] of agg) {
      const [wallet, mint] = k.split("|");
      up.run(wallet, mint, a.buy, a.sell, a.tb, a.ts, a.nb, a.ns, a.first ?? null, a.last, a.age ?? null, a.raised ?? null, a.sniper, a.creator);
    }
    kvSet(db, "ledger_cursor", String(rows[rows.length - 1].id));
  });
  return rows.length;
}

/** Recomputes 7-day wallet statistics and behavioural tags. */
export function updateWalletStats(db: DB, now = Date.now()): number {
  const since = now - 7 * 86_400_000;
  const rows = db.prepare(`SELECT wallet, COUNT(*) tokens, SUM(realized_sol) pnl, AVG(realized_sol > 0) win, SUM(buy_sol) vol,
      AVG(hold_s) hold, AVG(first_buy_age_s) age, AVG(sniper) sniper,
      SUM(CASE WHEN is_creator = 1 THEN realized_sol ELSE 0 END) creator_pnl
    FROM wallet_positions WHERE closed = 1 AND buy_sol > 0 AND last_trade_ms > ?
    GROUP BY wallet HAVING COUNT(*) >= 3`).all(since) as any[];
  const up = db.prepare(`INSERT INTO wallet_stats(wallet,tokens_7d,pnl_7d,win_rate_7d,volume_7d,avg_hold_s,avg_entry_age_s,sniper_share,creator_pnl_share,tags,updated_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET tokens_7d=excluded.tokens_7d, pnl_7d=excluded.pnl_7d, win_rate_7d=excluded.win_rate_7d,
    volume_7d=excluded.volume_7d, avg_hold_s=excluded.avg_hold_s, avg_entry_age_s=excluded.avg_entry_age_s, sniper_share=excluded.sniper_share,
    creator_pnl_share=excluded.creator_pnl_share, tags=excluded.tags, updated_ms=excluded.updated_ms`);
  tx(db, () => {
    db.prepare(`DELETE FROM wallet_stats WHERE updated_ms < ?`).run(now - 86_400_000);
    for (const r of rows) {
      const creatorShare = r.pnl > 0 ? Math.max(0, r.creator_pnl) / r.pnl : 0;
      const tags: string[] = [];
      if (r.sniper >= 0.5) tags.push("sniper");
      if (creatorShare >= 0.3) tags.push("creator_profits");
      if (r.win > 0.65 && r.tokens >= 20) tags.push("too_good");
      if ((r.hold ?? 0) < 5) tags.push("hft_bot");
      if (r.pnl < -1) tags.push("big_loser");
      if (isSmart(r, creatorShare)) tags.push("smart");
      up.run(r.wallet, r.tokens, r.pnl, r.win, r.vol, r.hold, r.age, r.sniper, creatorShare, tags.join(","), now);
    }
  });
  chunkedDelete(db, "wallet_positions", "last_trade_ms < ?", now - 30 * 86_400_000);
  chunkedDelete(db, "token_outcomes", "finalized_ms < ?", now - 30 * 86_400_000);
  return rows.length;
}

/** Copy-trade candidate criteria (research: 40–65% win rate, >65% is a manipulation flag). */
function isSmart(r: any, creatorShare: number) {
  return r.tokens >= 20 && r.win >= 0.4 && r.win <= 0.65 && (r.hold ?? 0) >= 30 && creatorShare < 0.1 && r.sniper < 0.3 && r.pnl > 0;
}

export function rebuildWatchlist(db: DB, max = 50): number {
  const now = Date.now();
  const rows = db.prepare(`SELECT wallet, pnl_7d, win_rate_7d, tokens_7d, avg_hold_s FROM wallet_stats WHERE tags LIKE '%smart%' ORDER BY pnl_7d DESC LIMIT ?`).all(max) as any[];
  tx(db, () => {
    db.prepare(`UPDATE watchlist SET active = 0`).run();
    const up = db.prepare(`INSERT INTO watchlist(wallet,score,reason,added_ms,active) VALUES (?,?,?,?,1)
      ON CONFLICT(wallet) DO UPDATE SET score=excluded.score, reason=excluded.reason, active=1`);
    for (const r of rows) up.run(r.wallet, r.pnl_7d, `7d pnl ${r.pnl_7d.toFixed(2)} SOL, win ${(r.win_rate_7d * 100).toFixed(0)}% over ${r.tokens_7d} tokens, avg hold ${Math.round(r.avg_hold_s)}s`, now);
  });
  return rows.length;
}

/** Lazily fetches token metadata (socials) for tokens the bot evaluated. */
export async function fetchSocials(db: DB, max = 20): Promise<number> {
  const rows = db.prepare(`SELECT DISTINCT t.mint, t.uri FROM tokens t JOIN positions p ON p.mint = t.mint
    WHERE t.socials IS NULL AND t.uri LIKE 'http%' ORDER BY p.decision_ms DESC LIMIT ?`).all(max) as any[];
  let n = 0;
  await Promise.all(rows.map(async (r) => {
    let socials: Record<string, boolean> = { error: true };
    try {
      const res = await fetch(r.uri, { signal: AbortSignal.timeout(5000) });
      const j: any = await res.json();
      socials = { twitter: !!j.twitter, telegram: !!j.telegram, website: !!j.website };
      n++;
    } catch { /* keep error marker so we don't retry forever */ }
    db.prepare(`UPDATE tokens SET socials = ? WHERE mint = ?`).run(JSON.stringify(socials), r.mint);
  }));
  return n;
}
