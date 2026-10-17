// Telegram call listener: reads the configured group with your account (read-only; never sends),
// extracts Solana token addresses, and queues them for the telegram paper book. Also backfills recent
// history as "historical" calls so the analyst can score callers on data already recorded.
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import type { Api } from "telegram";
import { openDb, kvSet, kvGet, log as dblog } from "@pf/core/db";
import { acquireLock } from "@pf/core/lock";
import { extractMints } from "@pf/core/calls";
import { makeClient, loadSession, credentials, findChat, CHAT_ID } from "./common.ts";
import { startTrader } from "./trader.ts";

acquireLock("telegram");
const db = openDb();
const log = (level: "info" | "warn" | "error", msg: string) => dblog(db, "telegram", level, msg);
const BACKFILL = Number(process.env.TG_BACKFILL ?? 500);
const BACKFILL_DAYS = Number(process.env.TG_BACKFILL_DAYS ?? 30);
const LIVE_WINDOW_MS = 120_000; // a message older than this when first seen is recorded as historical, not traded
const health = { ts: 0, state: "starting", chat: CHAT_ID, chatTitle: "", messagesSeen: 0, callsQueued: 0, historical: 0, botMessagesSkipped: 0, liveEvents: 0, lastMessageMs: 0, error: "" };
const beat = () => { health.ts = Date.now(); kvSet(db, "telegram_health", JSON.stringify(health)); };
setInterval(beat, 15_000);
startTrader(db, log); // runs independently of the Telegram connection

const insert = db.prepare(`INSERT OR IGNORE INTO manual_signals(mint,source,note,created_ms,status,book,chat,msg_id,caller,msg_text,call_ms)
  VALUES (?,?,?,?,?,'telegram',?,?,?,?,?)`);

async function handle(msg: Api.Message, live: boolean) {
  health.messagesSeen++;
  const text = msg.message ?? "";
  const mints = extractMints(text).slice(0, 3);
  if (!mints.length) return;
  const callMs = msg.date * 1000;
  health.lastMessageMs = Math.max(health.lastMessageMs, callMs);
  let caller = "unknown";
  try {
    const s: any = await msg.getSender();
    // Info bots (e.g. @Phanes_bot) echo every address a person posts; they are not callers.
    if (s?.bot) { health.botMessagesSkipped++; return; }
    caller = s?.username ? "@" + s.username : [s?.firstName, s?.lastName].filter(Boolean).join(" ") || s?.title || String(msg.senderId ?? "unknown");
  } catch { /* sender lookup is best effort */ }
  const fresh = live && Date.now() - callMs < LIVE_WINDOW_MS;
  for (const mint of mints) {
    const r = insert.run(mint, caller, "", Date.now(), fresh ? "pending" : "historical", CHAT_ID, msg.id, caller, text.slice(0, 400), callMs);
    if (r.changes) {
      if (fresh) { health.callsQueued++; log("info", `call ${mint} by ${caller} queued for the telegram book`); } else health.historical++;
    }
  }
}

async function run() {
  while (!credentials() || !loadSession()) {
    health.state = !credentials() ? "waiting: set TELEGRAM_API_ID/TELEGRAM_API_HASH in .env" : "waiting: run npx tsx apps/telegram/src/login.ts";
    beat();
    await new Promise((r) => setTimeout(r, 30_000));
    process.loadEnvFile?.(".env");
  }
  const client = makeClient(loadSession()!);
  await client.connect();
  if (!(await client.checkAuthorization())) { health.state = "session expired: run the login script again"; beat(); log("error", health.state); return; }
  const chat = await findChat(client);
  if (!chat) { health.state = `group ${CHAT_ID} not found in your chats`; beat(); log("error", health.state); return; }
  health.chatTitle = chat.title ?? "";
  health.state = "backfilling";
  beat();
  // First run pages back BACKFILL_DAYS (once); later restarts only re-read the latest messages.
  const deepKey = `tg_deep_backfill_${CHAT_ID}_${BACKFILL_DAYS}d`;
  const deep = !kvGet(db, deepKey);
  const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000;
  let n = 0;
  for await (const m of client.iterMessages(chat.inputEntity, { limit: deep ? undefined : BACKFILL })) {
    if (deep && (m as Api.Message).date * 1000 < cutoff) break;
    await handle(m as Api.Message, false); n++;
    if (deep && n % 1000 === 0) { health.state = `backfilling (${n} messages)`; beat(); }
  }
  if (deep) kvSet(db, deepKey, new Date().toISOString());
  log("info", `connected to "${health.chatTitle}", backfilled ${n} messages (${health.historical} historical calls)`);
  // Filter by chat id ourselves: GramJS's own `chats` filter throws while resolving peers inside its update loop.
  const chatId = String(chat.id);
  client.addEventHandler((ev: NewMessageEvent) => {
    if (String(ev.message.chatId) !== chatId) return;
    health.liveEvents++; // proves real-time delivery works (the 60 s re-read is only a backstop)
    handle(ev.message, true).catch((e) => log("error", `handle: ${e.message}`));
  }, new NewMessage({}));
  // Safety net for updates missed during reconnects: re-read the latest messages every minute.
  setInterval(async () => {
    try { for await (const m of client.iterMessages(chat.inputEntity, { limit: 30 })) await handle(m as Api.Message, true); }
    catch (e) { health.error = (e as Error).message; }
  }, 60_000);
  health.state = "listening";
  beat();
}

// Errors thrown inside the library's update loop must not kill the listener.
process.on("uncaughtException", (e) => { health.error = e.message; log("error", `uncaught (continuing): ${e.message}`); });
process.on("unhandledRejection", (e) => { health.error = String(e); log("error", `unhandled rejection (continuing): ${String(e)}`); });

run().catch((e) => { health.state = "error"; health.error = (e as Error).message; beat(); log("error", (e as Error).stack ?? String(e)); setTimeout(() => process.exit(1), 1000); });
