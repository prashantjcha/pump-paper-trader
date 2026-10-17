import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DATA_DIR = process.env.PF_DATA_DIR ?? resolve(ROOT, "data");
export const DB_PATH = resolve(DATA_DIR, "pumpfun.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY, creator TEXT, name TEXT, symbol TEXT, uri TEXT,
  create_slot INTEGER, create_ms INTEGER, sol_quote INTEGER, mayhem INTEGER,
  dev_buy_sol REAL DEFAULT 0, same_slot_buyers INTEGER DEFAULT 0,
  complete_ms INTEGER, last_trade_ms INTEGER, trades INTEGER DEFAULT 0, finalized INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tokens_create ON tokens(create_ms);
CREATE INDEX IF NOT EXISTS tokens_creator ON tokens(creator);
CREATE INDEX IF NOT EXISTS tokens_final ON tokens(finalized, last_trade_ms);

CREATE TABLE IF NOT EXISTS trades_raw (
  id INTEGER PRIMARY KEY, mint TEXT, user TEXT, is_buy INTEGER, sol REAL, tokens REAL,
  price REAL, sol_raised REAL, slot INTEGER, recv_ms INTEGER, sig TEXT
);
CREATE INDEX IF NOT EXISTS trades_mint ON trades_raw(mint, recv_ms);
CREATE INDEX IF NOT EXISTS trades_ms ON trades_raw(recv_ms);

CREATE TABLE IF NOT EXISTS token_outcomes (
  mint TEXT PRIMARY KEY, creator TEXT, create_ms INTEGER, first_price REAL, peak_price REAL, peak_mult REAL,
  time_to_peak_s REAL, max_dd_pct REAL, dev_sold_s REAL, outcome TEXT, unique_traders INTEGER,
  volume_sol REAL, peak_sol_raised REAL, graduated INTEGER, lifetime_s REAL, hour_utc INTEGER,
  dev_buy_sol REAL, same_slot_buyers INTEGER, finalized_ms INTEGER
);
CREATE INDEX IF NOT EXISTS outcomes_ms ON token_outcomes(finalized_ms);

CREATE TABLE IF NOT EXISTS books (
  book TEXT PRIMARY KEY, start_sol REAL, cash_sol REAL, realized_sol REAL DEFAULT 0,
  day TEXT, day_start_equity REAL, paused_until_ms INTEGER DEFAULT 0, updated_ms INTEGER
);
CREATE TABLE IF NOT EXISTS equity (ts_ms INTEGER, book TEXT, equity_sol REAL, open_positions INTEGER);
CREATE INDEX IF NOT EXISTS equity_book ON equity(book, ts_ms);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY, book TEXT, mint TEXT, symbol TEXT, status TEXT,
  strategy_version INTEGER, signal TEXT,
  decision_ms INTEGER, entry_fill_ms INTEGER, entry_sol REAL, entry_fixed_sol REAL, tokens REAL, tokens_raw TEXT,
  expected_entry_price REAL, entry_price REAL, entry_slippage_pct REAL,
  exit_decision_ms INTEGER, exit_fill_ms INTEGER, exit_price REAL, exit_expected_price REAL,
  exit_sol_net REAL, exit_fixed_sol REAL, exit_reason TEXT,
  pnl_sol REAL, pnl_pct REAL, hold_s REAL, peak_pnl_pct REAL, min_pnl_pct REAL,
  exit_params_json TEXT, features_json TEXT, exit_features_json TEXT, state_json TEXT
);
CREATE INDEX IF NOT EXISTS positions_book ON positions(book, status, decision_ms);
CREATE INDEX IF NOT EXISTS positions_mint ON positions(mint);

CREATE TABLE IF NOT EXISTS postmortems (
  position_id INTEGER PRIMARY KEY, book TEXT, max_after_1m_pct REAL, max_after_5m_pct REAL, max_after_15m_pct REAL,
  min_after_5m_pct REAL, token_outcome TEXT, tags TEXT, decision_grade TEXT, outcome_grade TEXT, notes TEXT, created_ms INTEGER
);

CREATE TABLE IF NOT EXISTS wallet_positions (
  wallet TEXT, mint TEXT, buy_sol REAL DEFAULT 0, sell_sol REAL DEFAULT 0, tok_bought REAL DEFAULT 0, tok_sold REAL DEFAULT 0,
  n_buys INTEGER DEFAULT 0, n_sells INTEGER DEFAULT 0, first_buy_ms INTEGER, last_trade_ms INTEGER,
  first_buy_age_s REAL, first_buy_sol_raised REAL, sniper INTEGER DEFAULT 0, is_creator INTEGER DEFAULT 0,
  realized_sol REAL, hold_s REAL, closed INTEGER DEFAULT 0,
  PRIMARY KEY (wallet, mint)
);
CREATE INDEX IF NOT EXISTS wp_closed ON wallet_positions(closed, last_trade_ms);
CREATE INDEX IF NOT EXISTS wp_mint ON wallet_positions(mint);

CREATE TABLE IF NOT EXISTS wallet_stats (
  wallet TEXT PRIMARY KEY, tokens_7d INTEGER, pnl_7d REAL, win_rate_7d REAL, volume_7d REAL,
  median_hold_s REAL, avg_entry_age_s REAL, sniper_share REAL, creator_pnl_share REAL, tags TEXT, updated_ms INTEGER
);
CREATE INDEX IF NOT EXISTS ws_pnl ON wallet_stats(pnl_7d);

CREATE TABLE IF NOT EXISTS watchlist (wallet TEXT PRIMARY KEY, score REAL, reason TEXT, added_ms INTEGER, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS manual_signals (
  id INTEGER PRIMARY KEY, mint TEXT, source TEXT, note TEXT, created_ms INTEGER, status TEXT DEFAULT 'pending', position_id INTEGER, detail TEXT
);

CREATE TABLE IF NOT EXISTS strategy_versions (
  version INTEGER PRIMARY KEY, params_json TEXT, status TEXT, parent_version INTEGER, reason TEXT,
  created_ms INTEGER, activated_ms INTEGER, evaluated_ms INTEGER, eval_json TEXT
);
CREATE TABLE IF NOT EXISTS retrospectives (
  id INTEGER PRIMARY KEY, created_ms INTEGER, kind TEXT, model TEXT, n_own_trades INTEGER,
  input_json TEXT, output_json TEXT, learned TEXT, status TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS learning_proposals (
  id INTEGER PRIMARY KEY, retro_id INTEGER, created_ms INTEGER, param TEXT, from_val REAL, to_val REAL,
  hypothesis TEXT, evidence TEXT, expected_effect TEXT, status TEXT, replay_json TEXT, version INTEGER
);
CREATE TABLE IF NOT EXISTS study_snapshots (id INTEGER PRIMARY KEY, created_ms INTEGER, kind TEXT, data_json TEXT);
CREATE INDEX IF NOT EXISTS study_kind ON study_snapshots(kind, created_ms);

CREATE TABLE IF NOT EXISTS metrics (ts_ms INTEGER, key TEXT, value REAL);
CREATE INDEX IF NOT EXISTS metrics_key ON metrics(key, ts_ms);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_ms INTEGER);
CREATE TABLE IF NOT EXISTS logs (ts_ms INTEGER, source TEXT, level TEXT, msg TEXT);
CREATE INDEX IF NOT EXISTS logs_ts ON logs(ts_ms);
`;

const MIGRATIONS = [
  "ALTER TABLE wallet_stats ADD COLUMN avg_hold_s REAL",
  "ALTER TABLE tokens ADD COLUMN socials TEXT",
  "ALTER TABLE token_outcomes ADD COLUMN last_price REAL",
  "ALTER TABLE manual_signals ADD COLUMN book TEXT DEFAULT 'manual'",
  "ALTER TABLE manual_signals ADD COLUMN chat TEXT",
  "ALTER TABLE manual_signals ADD COLUMN msg_id INTEGER",
  "ALTER TABLE manual_signals ADD COLUMN caller TEXT",
  "ALTER TABLE manual_signals ADD COLUMN msg_text TEXT",
  "ALTER TABLE manual_signals ADD COLUMN call_ms INTEGER",
  "ALTER TABLE manual_signals ADD COLUMN call_price REAL",
  "ALTER TABLE manual_signals ADD COLUMN call_sol_raised REAL",
  "ALTER TABLE manual_signals ADD COLUMN max_5m_pct REAL",
  "ALTER TABLE manual_signals ADD COLUMN max_15m_pct REAL",
  "ALTER TABLE manual_signals ADD COLUMN max_60m_pct REAL",
  "ALTER TABLE manual_signals ADD COLUMN min_60m_pct REAL",
  "ALTER TABLE manual_signals ADD COLUMN outcome TEXT",
  "ALTER TABLE manual_signals ADD COLUMN outcome_ms INTEGER",
  "CREATE UNIQUE INDEX IF NOT EXISTS signals_msg ON manual_signals(chat, msg_id, mint)",
  "CREATE INDEX IF NOT EXISTS signals_book ON manual_signals(book, created_ms)",
];

export type DB = DatabaseSync;

export function openDb(opts: { readOnly?: boolean; path?: string } = {}): DB {
  const path = opts.path ?? DB_PATH;
  if (!opts.readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { readOnly: !!opts.readOnly });
  db.exec("PRAGMA busy_timeout = 5000;");
  if (!opts.readOnly) {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    db.exec(SCHEMA);
    for (const m of MIGRATIONS) { try { db.exec(m); } catch { /* column already exists */ } }
  }
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Deletes in small batches so a big prune never holds the write lock for long. */
export function chunkedDelete(db: DB, table: string, where: string, arg: number, chunk = 20_000): number {
  let total = 0;
  for (;;) {
    const n = Number(db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${chunk})`).run(arg).changes);
    total += n;
    if (n < chunk) return total;
  }
}

export function kvGet(db: DB, key: string): string | undefined {
  const r = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value;
}
export function kvSet(db: DB, key: string, value: string) {
  db.prepare("INSERT INTO kv(key,value,updated_ms) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_ms=excluded.updated_ms")
    .run(key, value, Date.now());
}
export function log(db: DB, source: string, level: "info" | "warn" | "error", msg: string) {
  try { db.prepare("INSERT INTO logs VALUES (?,?,?,?)").run(Date.now(), source, level, msg); } catch { /* never fail on logging */ }
  const line = `[${new Date().toISOString()}] ${source} ${level}: ${msg}`;
  level === "error" ? console.error(line) : console.log(line);
}
