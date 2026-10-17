// Persists engine activity: positions (with full feature snapshots), books, equity.
import type { DB } from "@pf/core/db";
import type { Engine, Position, BookState, BookKind } from "@pf/core/engine";
import type { Reserves } from "@pf/core/curve";

const j = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

export class Journal {
  constructor(private db: DB) {}

  onOpen(p: Position) {
    const r = this.db.prepare(`INSERT INTO positions(book,mint,symbol,status,strategy_version,signal,decision_ms,entry_fill_ms,entry_sol,entry_fixed_sol,
      tokens,tokens_raw,expected_entry_price,entry_price,entry_slippage_pct,peak_pnl_pct,min_pnl_pct,exit_params_json,features_json,state_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      p.book, p.mint, p.symbol, "open", p.version, p.signal, p.decisionMs, p.fillMs, p.entrySol, p.entryFixedSol,
      Number(p.tokensRaw) / 1e6, p.tokensRaw.toString(), p.expectedPrice, p.entryPrice, p.entrySlippagePct, 0, 0,
      j(p.exitParams), j(p.features), j({ netLamports: p.netLamports, entryLiqSol: p.entryLiqSol, copiedWallet: p.copiedWallet, manualId: p.manualId }),
    );
    p.dbId = Number(r.lastInsertRowid);
  }

  onVoid(p: Position) {
    if (!p.dbId) return; // pending entries were never persisted
    this.db.prepare("UPDATE positions SET status='void', exit_reason=?, exit_decision_ms=?, pnl_sol=NULL WHERE id=?").run(p.exitReason ?? "data_gap", p.exitDecisionMs ?? Date.now(), p.dbId);
  }

  onFail(p: Position) {
    const r = this.db.prepare(`INSERT INTO positions(book,mint,symbol,status,strategy_version,signal,decision_ms,entry_fill_ms,entry_sol,entry_fixed_sol,
      expected_entry_price,entry_price,entry_slippage_pct,exit_reason,pnl_sol,pnl_pct,features_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      p.book, p.mint, p.symbol, "failed", p.version, p.signal, p.decisionMs, p.fillMs, p.entrySol, p.entryFixedSol,
      p.expectedPrice, p.entryPrice, p.entrySlippagePct, p.exitReason ?? "failed", p.pnlSol ?? 0, p.pnlPct ?? 0, j(p.features),
    );
    p.dbId = Number(r.lastInsertRowid);
  }

  onClose(p: Position) {
    if (!p.dbId) this.onOpen(p);
    this.db.prepare(`UPDATE positions SET status='closed', exit_decision_ms=?, exit_fill_ms=?, exit_price=?, exit_expected_price=?, exit_sol_net=?,
      exit_fixed_sol=?, exit_reason=?, pnl_sol=?, pnl_pct=?, hold_s=?, peak_pnl_pct=?, min_pnl_pct=?, exit_features_json=? WHERE id=?`).run(
      p.exitDecisionMs ?? null, p.exitFillMs ?? null, p.exitPrice ?? null, p.exitExpectedPrice ?? null, p.exitSolNet ?? null,
      p.exitFixedSol ?? null, p.exitReason ?? null, p.pnlSol ?? null, p.pnlPct ?? null, p.holdS ?? null, p.peakPnlPct, p.minPnlPct,
      j(p.exitFeatures ?? {}), p.dbId!,
    );
  }

  onBook(b: BookState) {
    this.db.prepare(`INSERT INTO books(book,start_sol,cash_sol,realized_sol,day,day_start_equity,paused_until_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(book) DO UPDATE SET cash_sol=excluded.cash_sol, realized_sol=excluded.realized_sol, day=excluded.day,
      day_start_equity=excluded.day_start_equity, paused_until_ms=excluded.paused_until_ms, updated_ms=excluded.updated_ms`).run(
      b.id, b.startSol, b.cashSol, b.realizedSol, b.day, b.dayStartEquity, b.pausedUntilMs, Date.now(),
    );
  }

  onManual(id: number, status: string, detail: string, enginePosId: number | undefined, eng: Engine) {
    const pos = enginePosId ? eng.positions.get(enginePosId) : undefined;
    this.db.prepare(`UPDATE manual_signals SET status=?, detail=?, position_id=COALESCE(?, position_id) WHERE id=?`).run(status, detail, pos?.dbId ?? null, id);
  }

  /** Periodic snapshot of open positions (live PnL + reserves for restart recovery) and equity. */
  snapshot(eng: Engine, withEquity: boolean) {
    const now = Date.now();
    const upd = this.db.prepare(`UPDATE positions SET peak_pnl_pct=?, min_pnl_pct=?, pnl_pct=?, state_json=? WHERE id=?`);
    for (const p of eng.positions.values()) {
      if (p.status !== "open" || !p.dbId) continue;
      const s = eng.tracker.get(p.mint);
      const reserves: Reserves | undefined = s?.reserves;
      upd.run(p.peakPnlPct, p.minPnlPct, p.lastPnlPct, j({ netLamports: p.netLamports, entryLiqSol: p.entryLiqSol, copiedWallet: p.copiedWallet, manualId: p.manualId, reserves, lastUpdate: now }), p.dbId);
    }
    if (withEquity) {
      const ins = this.db.prepare(`INSERT INTO equity(ts_ms,book,equity_sol,open_positions) VALUES (?,?,?,?)`);
      for (const b of eng.books.values()) if (!b.unlimited) ins.run(now, b.id, eng.equity(b.id), eng.openCount(b.id));
    }
  }

  /** Loads books and open positions saved before a restart. */
  restore(eng: Engine) {
    for (const b of this.db.prepare(`SELECT * FROM books`).all() as any[]) {
      eng.restoreBook({ id: b.book as BookKind, cashSol: b.cash_sol, realizedSol: b.realized_sol, day: b.day, dayStartEquity: b.day_start_equity, pausedUntilMs: b.paused_until_ms, startSol: b.start_sol });
    }
    let n = 0;
    for (const r of this.db.prepare(`SELECT * FROM positions WHERE status='open'`).all() as any[]) {
      if (!eng.books.has(r.book)) continue;
      const st = JSON.parse(r.state_json ?? "{}");
      const reserves = st.reserves ? { vSol: BigInt(st.reserves.vSol), vTok: BigInt(st.reserves.vTok), rTok: BigInt(st.reserves.rTok) } : undefined;
      eng.restorePosition({
        id: 0, dbId: r.id, book: r.book, mint: r.mint, symbol: r.symbol, status: "open", signal: r.signal, version: r.strategy_version,
        decisionMs: r.decision_ms, expectedPrice: r.expected_entry_price, entrySol: r.entry_sol, entryFixedSol: r.entry_fixed_sol,
        fillMs: r.entry_fill_ms, entryPrice: r.entry_price, entrySlippagePct: r.entry_slippage_pct,
        tokensRaw: BigInt(r.tokens_raw), netLamports: BigInt(st.netLamports ?? "0"),
        // Older rows predate the stored baseline: approximate with the measured flat round-trip floor (about 8.2%).
        entryLiqSol: st.entryLiqSol ?? (r.entry_sol + r.entry_fixed_sol) * 0.918,
        exitParams: JSON.parse(r.exit_params_json), features: JSON.parse(r.features_json ?? "{}"),
        peakPnlPct: r.peak_pnl_pct ?? 0, minPnlPct: r.min_pnl_pct ?? 0, lastPnlPct: r.pnl_pct ?? 0,
        copiedWallet: st.copiedWallet, manualId: st.manualId,
      }, reserves);
      n++;
    }
    return n;
  }
}
