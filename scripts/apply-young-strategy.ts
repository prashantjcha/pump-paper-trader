// One-off: apply the young-token strategy (research/runner-features-2026-09-30) to every paper book,
// record it as a new strategy version, and reset the trading books to 1 SOL.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, tx, ROOT } from "../packages/core/src/db.ts";
import { normalizeParams, saveStrategy, clampToBounds } from "../packages/core/src/config.ts";

const db = openDb();
const now = Date.now();
const cur = db.prepare(`SELECT version, params_json FROM strategy_versions WHERE status IN ('active','provisional','confirmed') ORDER BY version DESC LIMIT 1`).get() as any;
const p = normalizeParams(JSON.parse(cur.params_json));
p.entry.maxTradesAtEntry = 100;
Object.assign(p.exit, {
  tpRisingPct: 100, tpFlatPct: 100, tpFallingPct: 100,    // take profit at +100% net
  trailArmPct: 1e9, trailPct: 50,                          // no trailing stop
  slBasePct: 50, slTightPct: 50, noBuyTightenS: 1e9, bsTightenRatio: 0, // stop at -50% price, never tightened
  bigSellSol: 1e9, bigSellSupplyPct: 100, exitOnDevSell: false, exitOnSmartExit: false, // no event exits (not in the study)
  timeStopS: 86_400, maxProgressPct: 99,                   // hold up to 24 h; exit at graduation (curve feed ends)
});
const { params, clamped } = clampToBounds(p);
if (clamped.length) throw new Error("clamped: " + clamped.join(", "));
const reason = "young-token strategy (research/runner-features-2026-09-30): enter only tokens with <= 100 trades, exit +100% / -50%, hold up to 24 h; applied to every book by the user";
const r = db.prepare(`INSERT INTO strategy_versions(params_json,status,parent_version,reason,created_ms,activated_ms) VALUES (?,?,?,?,?,?)`).run(JSON.stringify(params), "active", cur.version, reason, now, now);
const version = Number(r.lastInsertRowid);
saveStrategy(params, version);

// Telegram call trader (all Solana tokens): same rule.
const callPath = resolve(ROOT, "config/call-strategy.json");
const prevCall = existsSync(callPath) ? JSON.parse(readFileSync(callPath, "utf8")) : null;
const callCfg = {
  version: (prevCall?.version ?? 0) + 1, name: "young-token calls",
  positionSol: 0.1, maxOpen: 10, startSol: 1, maxHoldMin: 1440,
  filter: { type: "young", maxTrades: 100 },
  policy: { family: "fixed", tp: 100, sl: 50 },
  notes: "Backtest (1 s entry at +5 s): validation +0.035 SOL per 0.1 SOL trade (72), recent +0.044 (37); 95% CI +0.023 to +0.066. Forward test from " + new Date(now).toISOString(),
};
writeFileSync(callPath, JSON.stringify(callCfg, null, 2) + "\n");

// Reset the trading books (shadow is the learning baseline and stays as is).
const BOOKS = ["momentum", "copy", "manual", "runner", "telegram"];
tx(db, () => {
  const v = db.prepare(`UPDATE positions SET status='void', exit_reason='book_reset', exit_decision_ms=? WHERE status='open' AND book != 'shadow'`).run(now).changes;
  for (const b of BOOKS) {
    db.prepare(`INSERT INTO books(book,start_sol,cash_sol,realized_sol,day,day_start_equity,paused_until_ms,updated_ms) VALUES (?,1,1,0,'',1,0,?)
      ON CONFLICT(book) DO UPDATE SET start_sol=1, cash_sol=1, realized_sol=0, day_start_equity=1, paused_until_ms=0, updated_ms=excluded.updated_ms`).run(b, now);
  }
  db.prepare(`INSERT INTO kv(key,value,updated_ms) VALUES ('book_reset_ms',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ms=excluded.updated_ms`).run(String(now), now);
  db.prepare(`INSERT INTO logs VALUES (?,?,?,?)`).run(now, "bot", "info", `strategy v${version} (young-token) applied to all books; books reset to 1 SOL; ${v} open positions voided`);
  console.log(`strategy v${version}; call strategy v${callCfg.version}; ${v} open positions voided; books reset: ${BOOKS.join(", ")}`);
});
