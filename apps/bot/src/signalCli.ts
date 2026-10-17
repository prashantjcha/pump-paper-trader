// Adds a manual caller signal: npm run signal -- <mint> --source "<caller>" [--note "..."]
import { openDb } from "@pf/core/db";

const args = process.argv.slice(2);
const mint = args.find((a) => !a.startsWith("--"));
const opt = (k: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : undefined; };
if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
  console.error('usage: npm run signal -- <mint> --source "<caller name>" [--note "..."]');
  process.exit(1);
}
const db = openDb();
const r = db.prepare(`INSERT INTO manual_signals(mint,source,note,created_ms) VALUES (?,?,?,?)`).run(mint, opt("source") ?? "manual", opt("note") ?? "", Date.now());
console.log(`signal #${r.lastInsertRowid} queued for ${mint}; the bot picks it up within 2 s and enters on the next trade if safety filters pass`);
