// 1-second token bars from Codex around each call: from 60 s before to ~24 min after (1,500 bars max per query).
// Cached as data/ohlcv/<mint>/codex_s1_<from>.json.   npx tsx scripts/calls-fetch-seconds.ts
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";

const KEY = process.env.CODEX_API_KEY!;
const db = openDb({ readOnly: true });
const calls = db.prepare(`SELECT mint, MIN(call_ms) first FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL GROUP BY mint`).all() as { mint: string; first: number }[];
let last = 0, fetched = 0, cached = 0, errors = 0, i = 0;
for (const c of calls) {
  i++;
  const from = Math.floor(c.first / 1000) - 60, to = from + 1499;
  const dir = resolve(DATA_DIR, "ohlcv", c.mint), file = resolve(dir, `codex_s1_${from}.json`);
  if (existsSync(file)) { cached++; continue; }
  mkdirSync(dir, { recursive: true });
  const query = `query { getTokenBars(symbol: "${c.mint}:1399811149", from: ${from}, to: ${to}, resolution: "1S", currencyCode: USD, removeEmptyBars: true) { t o h l c volume } }`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 250 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch("https://graph.codex.io/graphql", { method: "POST", headers: { "content-type": "application/json", Authorization: KEY }, body: JSON.stringify({ query }) });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      const j: any = await res.json();
      if (j.errors && !/could not find|not found/i.test(JSON.stringify(j.errors))) { errors++; await new Promise((r) => setTimeout(r, 1500)); continue; }
      const b = j.data?.getTokenBars;
      const bars = (b?.t ?? []).map((t: number, k: number) => [t, +b.o[k], +b.h[k], +b.l[k], +b.c[k], +(b.volume?.[k] ?? 0)]).filter((x: number[]) => x[1] > 0);
      writeFileSync(file, JSON.stringify({ bars }));
      fetched++;
      break;
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  if (i % 100 === 0) console.log(`${i}/${calls.length} (${fetched} fetched, ${cached} cached, ${errors} errors)`);
}
console.log(`done: ${fetched} fetched, ${cached} cached, ${errors} errors`);
