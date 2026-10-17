// Per called token: (1) every trade before the first call with wallet data (up to 8,000, newest first) and
// (2) minute bars with order-flow fields from 6 h before to ~19 h after the call. Resumable cache:
//   data/ohlcv/<mint>/codex_events_pre.json   {complete, events: [t, side(+1 buy/-1 sell), maker, usd, tokens, walletAgeS, wash, sandwich, block]}
//   data/ohlcv/<mint>/codex_flow_m1.json      {bars: [t, o, h, l, c, volumeUsd, liqUsd, buys, sells, buyers, sellers, buyVolUsd, sellVolUsd, traders]}
//   npx tsx scripts/calls-fetch-flow.ts
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";

const KEY = process.env.CODEX_API_KEY!;
const MAX_PAGES = 40;
let last = 0, requests = 0, errors = 0;
async function gql(query: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + 250 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now(); requests++;
    try {
      const res = await fetch("https://graph.codex.io/graphql", { method: "POST", headers: { "content-type": "application/json", Authorization: KEY }, body: JSON.stringify({ query }) });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
      const j: any = await res.json();
      if (j.errors) {
        if (/could not find|not found/i.test(JSON.stringify(j.errors))) return null;
        errors++; await new Promise((r) => setTimeout(r, 1500)); continue;
      }
      return j.data;
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  return undefined; // failed; not cached
}

const db = openDb({ readOnly: true });
const calls = db.prepare(`SELECT mint, MIN(call_ms) first FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL GROUP BY mint ORDER BY first`).all() as { mint: string; first: number }[];
// Optional sharding for parallel workers: --shard k/n processes every n-th token starting at k.
const shardArg = process.argv[process.argv.indexOf("--shard") + 1];
const [shardK, shardN] = process.argv.includes("--shard") ? shardArg.split("/").map(Number) : [0, 1];
let i = 0;
for (const c of calls.filter((_, idx) => idx % shardN === shardK)) {
  i++;
  const dir = resolve(DATA_DIR, "ohlcv", c.mint);
  mkdirSync(dir, { recursive: true });
  const callS = Math.floor(c.first / 1000);
  // ---- trade events before the call (newest first)
  const evFile = resolve(dir, "codex_events_pre.json");
  if (!existsSync(evFile)) {
    const events: unknown[][] = [];
    let cursor: string | null = null, pages = 0, ok = true;
    do {
      const d = await gql(`query { getTokenEvents(query: { address: "${c.mint}", networkId: 1399811149, eventDisplayType: [Buy, Sell], timestamp: { from: ${callS - 14 * 86400}, to: ${callS} } }, limit: 200, direction: DESC${cursor ? `, cursor: "${cursor}"` : ""}) {
        items { eventDisplayType timestamp maker blockNumber walletAge labels { sandwich { label } washtrade { label } } data { ... on SwapEventData { priceUsdTotal amountNonLiquidityToken } } } cursor } }`);
      if (d === undefined) { ok = false; break; }
      if (d === null) { ok = false; break; } // "not found" is unknown history, never an empty one (see research/runner-features-2026-09-30/REPORT.md)
      for (const e of d.getTokenEvents.items) events.push([e.timestamp, e.eventDisplayType === "Buy" ? 1 : -1, e.maker, +(e.data?.priceUsdTotal ?? 0), +(e.data?.amountNonLiquidityToken ?? 0), e.walletAge ?? null, e.labels?.washtrade ? 1 : 0, e.labels?.sandwich ? 1 : 0, e.blockNumber]);
      cursor = d.getTokenEvents.cursor; pages++;
    } while (cursor && pages < MAX_PAGES);
    if (ok) writeFileSync(evFile, JSON.stringify({ complete: !cursor, pages, events }));
  }
  // ---- order-flow minute bars
  const flowFile = resolve(dir, "codex_flow_m1.json");
  if (!existsSync(flowFile)) {
    const from = callS - 6 * 3600, to = Math.min(Math.floor(Date.now() / 1000), from + 1499 * 60);
    const d = await gql(`query { getTokenBars(symbol: "${c.mint}:1399811149", from: ${from}, to: ${to}, resolution: "1", currencyCode: USD, removeEmptyBars: true) { t o h l c volume liquidity buys sells buyers sellers buyVolume sellVolume traders } }`);
    if (d !== undefined) {
      const b = d?.getTokenBars;
      const bars = (b?.t ?? []).map((t: number, k: number) => [t, +b.o[k], +b.h[k], +b.l[k], +b.c[k], +(b.volume?.[k] ?? 0), +(b.liquidity?.[k] ?? 0), +(b.buys?.[k] ?? 0), +(b.sells?.[k] ?? 0), +(b.buyers?.[k] ?? 0), +(b.sellers?.[k] ?? 0), +(b.buyVolume?.[k] ?? 0), +(b.sellVolume?.[k] ?? 0), +(b.traders?.[k] ?? 0)]).filter((x: number[]) => x[1] > 0);
      writeFileSync(flowFile, JSON.stringify({ bars }));
    }
  }
  if (i % 50 === 0) console.log(`${i}/${calls.length} tokens, ${requests} requests, ${errors} errors`);
}
console.log(`done: ${calls.length} tokens, ${requests} requests, ${errors} errors`);
