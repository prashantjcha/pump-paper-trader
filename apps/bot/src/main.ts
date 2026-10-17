// Live paper-trading bot: feed -> decoder -> recorder + engine -> journal.
// Paper mode only: this process holds no keys and never signs transactions.
import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, kvSet, log as dblog, DATA_DIR, chunkedDelete } from "@pf/core/db";
import { decodeLogs } from "@pf/core/events";
import { Engine, type BookKind } from "@pf/core/engine";
import { loadStrategy, saveStrategy, strategyFileVersion, STRATEGY_PATH } from "@pf/core/config";
import { pruneRaw } from "@pf/core/rawio";
import { BLACKLIST_SQL, BLACKLIST_DAYS } from "@pf/core/replayContext";
import { loadRunnerModel } from "@pf/core/runnerModel";
import { Feed, defaultEndpoints } from "./feed.ts";
import { Recorder } from "./recorder.ts";
import { Journal } from "./journal.ts";

import { acquireLock } from "@pf/core/lock";
acquireLock("bot");
const db = openDb();
const log = (level: "info" | "warn" | "error", msg: string) => dblog(db, "bot", level, msg);
const KILL = resolve(DATA_DIR, "KILL");
// The telegram book is traded by apps/telegram/src/trader.ts (all Solana tokens), not by the curve engine.
const BOOKS: BookKind[] = ["momentum", "copy", "manual", "shadow", "runner"];
const RAW_DB_DAYS = Number(process.env.RAW_DB_DAYS ?? 3);
const RAW_ARCHIVE_DAYS = Number(process.env.RAW_ARCHIVE_DAYS ?? 14);

// ---- strategy version bootstrap
function ensureStrategy(): { version: number } {
  const row = db.prepare(`SELECT version, params_json FROM strategy_versions WHERE status IN ('active','provisional','confirmed') ORDER BY version DESC LIMIT 1`).get() as any;
  if (row) {
    if (strategyFileVersion() !== row.version) saveStrategy(JSON.parse(row.params_json), row.version);
    return { version: row.version };
  }
  const params = loadStrategy();
  const r = db.prepare(`INSERT INTO strategy_versions(params_json,status,reason,created_ms,activated_ms) VALUES (?,?,?,?,?)`)
    .run(JSON.stringify(params), "active", "initial v1 parameters", Date.now(), Date.now());
  const version = Number(r.lastInsertRowid);
  saveStrategy(params, version);
  return { version };
}
let { version } = ensureStrategy();

const loadSet = (sql: string, ...args: number[]) => new Set((db.prepare(sql).all(...args) as { v: string }[]).map((r) => r.v));
const loadBlacklist = () => loadSet(BLACKLIST_SQL, Date.now() - BLACKLIST_DAYS * 86_400_000, Date.now() + 60_000);
const smartSql = `SELECT wallet v FROM watchlist WHERE active = 1`;


const journal = new Journal(db);
const engine = new Engine({
  params: loadStrategy(), version, books: BOOKS, startSol: 1,
  smart: loadSet(smartSql), blacklist: loadBlacklist(),
  seed: Date.now() & 0xffffffff,
  runnerModel: loadRunnerModel(),
  hooks: {
    onOpen: (p) => { journal.onOpen(p); if (p.book !== "shadow") log("info", `OPEN ${p.book} ${p.symbol} ${p.mint} @${p.entryPrice.toExponential(3)} slip ${p.entrySlippagePct.toFixed(1)}%`); },
    onFail: (p) => { journal.onFail(p); if (p.book !== "shadow") log("info", `FAIL ${p.book} ${p.symbol} ${p.exitReason}`); },
    onClose: (p) => { journal.onClose(p); if (p.book !== "shadow") log("info", `CLOSE ${p.book} ${p.symbol} ${p.exitReason} pnl ${p.pnlSol!.toFixed(4)} SOL (${p.pnlPct!.toFixed(1)}%) hold ${p.holdS!.toFixed(0)}s`); },
    onVoid: (p) => { journal.onVoid(p); if (p.book !== "shadow") log("warn", `VOID ${p.book} ${p.symbol}: data gap, no fill simulated`); },
    onBook: (b) => journal.onBook(b),
    onManual: (id, status, detail, pid) => journal.onManual(id, status, detail, pid, engine),
  },
});
for (const r of db.prepare(`SELECT creator, create_ms FROM tokens WHERE create_ms > ? ORDER BY create_ms`).all(Date.now() - 86_400_000) as any[]) engine.noteCreate(r.creator, r.create_ms);
const restored = journal.restore(engine);
if (!engine.params.risk.dailyLossEnabled) for (const b of engine.books.values()) b.pausedUntilMs = 0; // clears any pause saved earlier
for (const b of engine.books.values()) journal.onBook(b);
log("info", `started: strategy v${version}, restored ${restored} open positions, watchlist ${engine.smart.size}, blacklist ${engine.blacklist.size}`);

// ---- feed -> decode -> record + trade
const recorder = new Recorder(db);
let events = 0, truncated = 0, lagSum = 0, lagN = 0;
const feed = new Feed(defaultEndpoints(), (n) => {
  if (n.err) return; // failed txs carry no state change
  const { events: evs, truncated: t } = decodeLogs(n.logs, { slot: n.slot, sig: n.signature, recvMs: n.recvMs });
  if (t) truncated++;
  for (const e of evs) {
    events++;
    if (e.kind === "trade" && e.chainTs) { lagSum += n.recvMs / 1000 - e.chainTs; lagN++; }
    recorder.add(e);
    try { engine.onEvent(e); } catch (err) { log("error", `engine: ${(err as Error).stack}`); }
  }
}, log);
feed.start();

// ---- timers
const every = (ms: number, fn: () => void) => setInterval(() => { try { fn(); } catch (e) { log("error", (e as Error).stack ?? String(e)); } }, ms);

every(100, () => engine.advance(Date.now()));
every(250, () => recorder.flush());
every(1000, () => {
  const k = existsSync(KILL);
  if (k !== engine.killed) { engine.killed = k; log("warn", k ? "KILL switch engaged: closing positions, no new entries" : "KILL switch released"); }
});
every(2000, () => {
  for (const r of db.prepare(`SELECT id, mint, source, book FROM manual_signals WHERE status='pending' AND COALESCE(book,'manual')='manual'`).all() as any[]) {
    engine.addManualSignal(r.id, r.mint, r.source, Date.now(), (r.book ?? "manual") as BookKind);
    db.prepare(`UPDATE manual_signals SET status='watching' WHERE id=?`).run(r.id);
  }
});
let snaps = 0;
every(5000, () => {
  journal.snapshot(engine, ++snaps % 12 === 0); // equity once a minute
  const rm = loadRunnerModel();
  if ((rm?.version ?? 0) !== (engine.runnerModel?.version ?? 0)) {
    engine.runnerModel = rm;
    log("info", rm ? `runner model v${rm.version} loaded (trained to ${new Date(rm.trainTo).toISOString()}, threshold ${rm.threshold.toFixed(3)})` : "runner model removed");
  }
  const v = strategyFileVersion();
  if (v && v !== version) {
    engine.setParams(loadStrategy(), v);
    log("info", `strategy hot-reloaded v${version} -> v${v} (applies to new entries; open positions keep their exit params)`);
    version = v;
  }
});
let lastEvents = 0, lastTs = Date.now();
every(10_000, () => {
  const now = Date.now();
  const rate = (events - lastEvents) / ((now - lastTs) / 1000);
  lastEvents = events; lastTs = now;
  const health = {
    ts: now, eventsPerSec: rate, totalEvents: events, truncated, recorded: recorder.written,
    lagS: lagN ? lagSum / lagN : null, trackedTokens: engine.tracker.tokens.size, killed: engine.killed,
    runnerModel: engine.runnerModel ? { version: engine.runnerModel.version, trainTo: engine.runnerModel.trainTo, scored: engine.runnerScored } : null,
    feed: feed.stats, strategyVersion: version,
    books: Object.fromEntries([...engine.books.values()].map((b) => [b.id, { cash: b.cashSol, equity: engine.equity(b.id), open: engine.openCount(b.id), paused: b.pausedUntilMs > now }])),
  };
  lagSum = 0; lagN = 0;
  kvSet(db, "bot_health", JSON.stringify(health));
  const m = db.prepare(`INSERT INTO metrics(ts_ms,key,value) VALUES (?,?,?)`);
  m.run(now, "events_per_s", rate);
  if (health.lagS !== null) m.run(now, "feed_lag_s", health.lagS);
  m.run(now, "tracked_tokens", engine.tracker.tokens.size);
});
every(60_000, () => {
  engine.smart = loadSet(smartSql);
  for (const c of loadBlacklist()) engine.blacklist.add(c);
  engine.evict(Date.now());
});
every(3_600_000, () => {
  const cutoff = Date.now() - RAW_DB_DAYS * 86_400_000;
  chunkedDelete(db, "trades_raw", "recv_ms < ?", cutoff);
  chunkedDelete(db, "metrics", "ts_ms < ?", Date.now() - 14 * 86_400_000);
  chunkedDelete(db, "logs", "ts_ms < ?", Date.now() - 14 * 86_400_000);
  pruneRaw(RAW_ARCHIVE_DAYS);
});

const shutdown = () => {
  log("info", "shutting down");
  feed.stop();
  recorder.close();
  journal.snapshot(engine, true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("uncaughtException", (e) => log("error", `uncaught: ${e.stack}`));
log("info", `strategy file ${STRATEGY_PATH}; kill switch file ${KILL}`);
