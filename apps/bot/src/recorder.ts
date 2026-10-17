// Persists every decoded event: gzip JSONL archive (replay corpus) and batched
// SQLite rows (analyst input). Writes are buffered and flushed every 250 ms.
import { type DB, tx } from "@pf/core/db";
import { RawWriter } from "@pf/core/rawio";
import type { PumpEvent, CreateEv, TradeEv } from "@pf/core/events";
import { price, solRaised } from "@pf/core/curve";

export class Recorder {
  private raw = new RawWriter();
  private creates: CreateEv[] = [];
  private trades: TradeEv[] = [];
  private completes: PumpEvent[] = [];
  private devBuys = new Map<string, { sol: number; sameSlot: Set<string> }>();
  private createInfo = new Map<string, { creator: string; slot: number }>();
  written = 0;

  constructor(private db: DB) {}

  add(e: PumpEvent) {
    this.raw.write(e);
    if (e.kind === "create") {
      this.creates.push(e);
      this.createInfo.set(e.mint, { creator: e.creator || e.user, slot: e.slot });
      if (this.createInfo.size > 50_000) this.createInfo.delete(this.createInfo.keys().next().value!);
    } else if (e.kind === "trade") {
      this.trades.push(e);
      const ci = this.createInfo.get(e.mint);
      if (ci && e.isBuy && e.slot === ci.slot) {
        const d = this.devBuys.get(e.mint) ?? { sol: 0, sameSlot: new Set<string>() };
        if (e.user === ci.creator) d.sol += Number(e.sol) / 1e9; else d.sameSlot.add(e.user);
        this.devBuys.set(e.mint, d);
      }
    } else this.completes.push(e);
  }

  flush() {
    if (!this.creates.length && !this.trades.length && !this.completes.length) return;
    const creates = this.creates, trades = this.trades, completes = this.completes, devBuys = this.devBuys;
    this.creates = []; this.trades = []; this.completes = []; this.devBuys = new Map();
    try {
      this.write(creates, trades, completes, devBuys);
    } catch (e) {
      // Database busy or locked: put the batch back and retry on the next flush instead of losing it.
      this.creates = creates.concat(this.creates);
      this.trades = trades.concat(this.trades);
      this.completes = completes.concat(this.completes);
      for (const [m, d] of devBuys) {
        const cur = this.devBuys.get(m);
        if (cur) { cur.sol += d.sol; for (const u of d.sameSlot) cur.sameSlot.add(u); } else this.devBuys.set(m, d);
      }
      this.failures++;
      if (this.trades.length > 500_000) { this.trades.splice(0, this.trades.length - 500_000); } // hard memory cap
      throw e;
    }
    this.written += creates.length + trades.length + completes.length;
    this.raw.flush();
  }

  failures = 0;

  private write(creates: CreateEv[], trades: TradeEv[], completes: PumpEvent[], devBuys: Map<string, { sol: number; sameSlot: Set<string> }>) {
    tx(this.db, () => {
      const ins = this.db.prepare(`INSERT OR IGNORE INTO tokens(mint,creator,name,symbol,uri,create_slot,create_ms,sol_quote,mayhem,last_trade_ms) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const c of creates) ins.run(c.mint, c.creator || c.user, c.name.slice(0, 64), c.symbol.slice(0, 32), c.uri.slice(0, 256), c.slot, c.recvMs, c.solQuote ? 1 : 0, c.mayhem ? 1 : 0, c.recvMs);
      const tr = this.db.prepare(`INSERT INTO trades_raw(mint,user,is_buy,sol,tokens,price,sol_raised,slot,recv_ms,sig) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      const upd = this.db.prepare(`UPDATE tokens SET last_trade_ms = MAX(COALESCE(last_trade_ms,0), ?), trades = trades + ? WHERE mint = ?`);
      const perMint = new Map<string, { n: number; last: number }>();
      for (const t of trades) {
        tr.run(t.mint, t.user, t.isBuy ? 1 : 0, Number(t.sol) / 1e9, Number(t.tokens) / 1e6, price(t), !t.solQuote || t.mayhem ? null : t.rSol > 0n ? Number(t.rSol) / 1e9 : Math.max(0, solRaised(t.vSol)), t.slot, t.recvMs, t.sig);
        const m = perMint.get(t.mint) ?? { n: 0, last: 0 };
        m.n++; m.last = Math.max(m.last, t.recvMs);
        perMint.set(t.mint, m);
      }
      for (const [mint, m] of perMint) upd.run(m.last, m.n, mint);
      const dev = this.db.prepare(`UPDATE tokens SET dev_buy_sol = dev_buy_sol + ?, same_slot_buyers = same_slot_buyers + ? WHERE mint = ?`);
      for (const [mint, d] of devBuys) dev.run(d.sol, d.sameSlot.size, mint);
      const comp = this.db.prepare(`UPDATE tokens SET complete_ms = ? WHERE mint = ?`);
      for (const c of completes) comp.run(c.recvMs, c.mint);
    });
  }

  close() { this.flush(); this.raw.close(); }
}
