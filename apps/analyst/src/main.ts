// Analyst process: studies the whole market and the bot's own trades, and runs the
// learning loop. Separate from the bot so heavy replays never slow trading down.
import "dotenv/config";
import { openDb, kvSet, log as dblog } from "@pf/core/db";
import { finalizeTokens, updateLedger, updateWalletStats, rebuildWatchlist, fetchSocials } from "./market.ts";
import { runStudies, saveStudies } from "./study.ts";
import { runPostmortems } from "./postmortem.ts";
import { scoreCalls } from "./calls.ts";
import { runRetrospective, forwardEvaluate, lastRetroMs } from "./learning.ts";
import { loadRunnerModel, saveRunnerModel, trainRunnerModel } from "@pf/core/runnerModel";

import { acquireLock } from "@pf/core/lock";
acquireLock("analyst");
const db = openDb();
const log = (level: "info" | "warn" | "error", msg: string) => dblog(db, "analyst", level, msg);
const RETRO_EVERY_H = Number(process.env.RETRO_EVERY_HOURS ?? 6);
const status: Record<string, { lastRun: number; lastResult: string; ms: number }> = {};

function job(name: string, everyMs: number, fn: () => unknown | Promise<unknown>, initialDelayMs = 5000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    const t0 = Date.now();
    try {
      const r = await fn();
      status[name] = { lastRun: t0, lastResult: String(r ?? "ok"), ms: Date.now() - t0 };
    } catch (e) {
      status[name] = { lastRun: t0, lastResult: "error: " + (e as Error).message, ms: Date.now() - t0 };
      log("error", `${name}: ${(e as Error).stack}`);
    } finally {
      running = false;
      kvSet(db, "analyst_status", JSON.stringify(status));
    }
  };
  setTimeout(() => { run(); setInterval(run, everyMs); }, initialDelayMs);
}

job("ledger", 30_000, () => { let n = 0, k; while ((k = updateLedger(db)) > 0) { n += k; if (n > 600_000) break; } return `${n} trades folded`; });
job("finalize", 60_000, () => `${finalizeTokens(db)} tokens finalized`, 15_000);
job("postmortems", 120_000, () => `${runPostmortems(db)} trades reviewed`, 30_000);
job("callScores", 5 * 60_000, () => `${scoreCalls(db)} telegram calls scored`, 45_000);
job("socials", 60_000, async () => `${await fetchSocials(db)} metadata fetched`, 20_000);
job("walletStats", 15 * 60_000, () => `${updateWalletStats(db)} wallets`, 60_000);
job("watchlist", 6 * 3_600_000, () => `${rebuildWatchlist(db)} wallets on watchlist`, 120_000);
job("studies", 30 * 60_000, () => { const now = Date.now(); saveStudies(db, runStudies(db, now - 24 * 3_600_000, now)); return "24h studies saved"; }, 90_000);
job("forwardEval", 30 * 60_000, () => (FROZEN ? "frozen for the forward test" : forwardEvaluate(db) ?? "nothing to evaluate"), 180_000);
// LEARNING_FROZEN=1 pauses strategy changes and model retraining (keeps a forward test clean).
const FROZEN = process.env.LEARNING_FROZEN === "1";
job("runnerModel", 60 * 60_000, () => {
  if (FROZEN) return "frozen for the forward test";
  const cur = loadRunnerModel();
  if (cur && Date.now() - cur.trainedAt < 24 * 3_600_000) return `v${cur.version} is fresh`;
  const m = trainRunnerModel({ from: Date.now() - 48 * 3_600_000, to: Date.now(), version: (cur?.version ?? 0) + 1 });
  if (!m) return "not enough data to retrain";
  saveRunnerModel(m);
  log("info", `runner model v${m.version} trained on ${m.stats.rows} launches (in-sample picks hit +25%: ${m.stats.picksHit25Pct}%)`);
  return `trained v${m.version}`;
}, 300_000);
job("retrospective", 15 * 60_000, async () => {
  if (FROZEN) return "frozen for the forward test";
  if (Date.now() - lastRetroMs(db) < RETRO_EVERY_H * 3_600_000) return "not due";
  return await runRetrospective(db);
}, 240_000);

log("info", `analyst started (retrospective every ${RETRO_EVERY_H}h; Claude ${process.env.ANTHROPIC_API_KEY ? "enabled" : "disabled: no ANTHROPIC_API_KEY, using data proposer"})`);
process.on("uncaughtException", (e) => log("error", `uncaught: ${e.stack}`));
