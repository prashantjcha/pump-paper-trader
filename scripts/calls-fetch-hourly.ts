// Hourly token bars from Codex for every called token, from 3 days before its first call to now
// (up to 1,500 bars = 62 days per request). Cached as data/ohlcv/<mint>/codex_h1.json.
//   npx tsx scripts/calls-fetch-hourly.ts
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";

const KEY = process.env.CODEX_API_KEY!;
const URL = "https://graph.codex.io/graphql";
const db = openDb({ readOnly: true });
const mints = db.prepare(`SELECT mint, MIN(call_ms) first FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL GROUP BY mint`).all() as { mint: string; first: number }[];
const to = Math.floor(Date.now() / 1000);
let done = 0, fetched = 0, errors = 0, last = 0;
for (const m of mints) {
  const dir = resolve(DATA_DIR, "ohlcv", m.mint);
  const file = resolve(dir, "codex_h1.json");
  done++;
  if (existsSync(file)) continue;
  mkdirSync(dir, { recursive: true });
  const from = Math.max(Math.floor(m.first / 1000) - 3 * 86400, to - 1499 * 3600);
  const query = `query { getTokenBars(symbol: "${m.mint}:1399811149", from: ${from}, to: ${to}, resolution: "60", currencyCode: USD, removeEmptyBars: true, removeLeadingNullValues: true) { t o h l c volume liquidity } }`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 250 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json", Authorization: KEY }, body: JSON.stringify({ query }) });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      const j: any = await res.json();
      if (j.errors && !/could not find|not found/i.test(JSON.stringify(j.errors))) { errors++; await new Promise((r) => setTimeout(r, 1500)); continue; }
      const b = j.data?.getTokenBars;
      const bars = (b?.t ?? []).map((t: number, i: number) => [t, +b.o[i], +b.h[i], +b.l[i], +b.c[i], +(b.volume?.[i] ?? 0), +(b.liquidity?.[i] ?? 0)]).filter((x: number[]) => x[1] > 0);
      writeFileSync(file, JSON.stringify({ bars }));
      fetched++;
      break;
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  if (done % 100 === 0) console.log(`${done}/${mints.length} (${fetched} fetched, ${errors} errors)`);
}
console.log(`done: ${fetched} fetched, ${errors} errors`);
