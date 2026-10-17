// One-time interactive login. Run it yourself in a terminal (it asks for the code Telegram sends you):
//   npx tsx apps/telegram/src/login.ts
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { makeClient, saveSession, findChat, credentials, CHAT_ID, SESSION_PATH } from "./common.ts";

if (!credentials()) {
  console.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in D:\\pumpfun\\.env first (https://my.telegram.org > API development tools).");
  process.exit(1);
}
if (!stdin.isTTY) {
  console.error("This login needs to read the code Telegram texts you, so it must run in a normal terminal window.");
  console.error("Open PowerShell or Windows Terminal (not the Claude Code ! prompt) and run:");
  console.error("  cd D:\\pumpfun");
  console.error("  npx tsx apps/telegram/src/login.ts");
  process.exit(1);
}
const rl = createInterface({ input: stdin, output: stdout });
let failures = 0;
const client = makeClient("");
await client.start({
  phoneNumber: async () => (await rl.question("Phone number with country code (e.g. +14155550123): ")).trim(),
  phoneCode: async () => (await rl.question("Login code Telegram just sent you: ")).trim(),
  password: async (hint) => (await rl.question(`Two-step verification password${hint ? ` (hint: ${hint})` : ""}: `)).trim(),
  // Stop after a few failures instead of retrying forever (wrong code, flood wait, bad credentials).
  onError: async (e) => { console.error("login error:", e.message); return ++failures >= 3; },
});
saveSession(String(client.session.save()));
const me = await client.getMe();
console.log(`Logged in as ${(me as any).username ?? (me as any).firstName}. Session saved to ${SESSION_PATH} (keep it private).`);
const chat = await findChat(client);
console.log(chat ? `Found group ${CHAT_ID}: "${chat.title}". The listener (pf-telegram) will start reading it within 30 s.` : `Could not find group ${CHAT_ID} among your chats. Check TELEGRAM_CHAT_ID.`);
rl.close();
await client.disconnect();
process.exit(0);
