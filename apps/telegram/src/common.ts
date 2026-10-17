import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import { DATA_DIR } from "@pf/core/db";

/** The session string is full access to your Telegram account. It lives only in data/ (gitignored). */
export const SESSION_PATH = resolve(DATA_DIR, "telegram.session");
export const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

export function credentials() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  if (!apiId || !apiHash) return null;
  return { apiId, apiHash };
}

export function loadSession(): string | null {
  return existsSync(SESSION_PATH) ? readFileSync(SESSION_PATH, "utf8").trim() || null : null;
}
export function saveSession(s: string) { writeFileSync(SESSION_PATH, s, { mode: 0o600 }); }

export function makeClient(session: string) {
  const c = credentials();
  if (!c) throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env (create them at https://my.telegram.org > API development tools)");
  const client = new TelegramClient(new StringSession(session), c.apiId, c.apiHash, { connectionRetries: 1_000_000, autoReconnect: true });
  client.setLogLevel(LogLevel.ERROR);
  return client;
}

/** Finds the configured group among your dialogs (the only reliable way to resolve a -100... id). */
export async function findChat(client: TelegramClient) {
  for (const d of await client.getDialogs({ limit: 1000 })) {
    if (String(d.id) === CHAT_ID) return d;
  }
  return null;
}
