// Fetches price history for every token called in the Telegram group (all Solana tokens, bonded or not)
// from GeckoTerminal's free API, caching every response under data/ohlcv/ so the run is resumable.
//   npx tsx scripts/calls-fetch.ts [--max-mints N]
// Per token: its pools; the pump.fun bonding curve (as a pool, via the curve PDA) for pump mints; minute bars
// around each call cluster (-40 min .. +16 h); 15-minute bars out to 72 h after the last call.
import "dotenv/config";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";

// With a paid CoinGecko API key the same on-chain data comes from the Pro API at ~300+ calls/min.
const CG_KEY = process.env.COINGECKO_API_KEY;
const API = CG_KEY ? "https://pro-api.coingecko.com/api/v3/onchain/networks/solana" : "https://api.geckoterminal.com/api/v2/networks/solana";
const HEADERS: Record<string, string> = CG_KEY ? { accept: "application/json", "x-cg-pro-api-key": CG_KEY } : { accept: "application/json" };
const CACHE = resolve(DATA_DIR, "ohlcv");
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const SPACING_MS = CG_KEY ? Number(process.env.COINGECKO_SPACING_MS ?? 220) : 2200; // paid: ~270/min; free: ~27/min
const HORIZON_H = 72;
const args = process.argv.slice(2);
const maxMints = Number(args[args.indexOf("--max-mints") + 1] || 1e9);
mkdirSync(CACHE, { recursive: true });

let last = 0, requests = 0, cached = 0;
async function get(url: string, file: string): Promise<any> {
  if (existsSync(file)) { cached++; return JSON.parse(readFileSync(file, "utf8")); }
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait = last + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    requests++;
    let res: Response;
    try { res = await fetch(url, { headers: HEADERS }); } catch { await new Promise((r) => setTimeout(r, 5000)); continue; }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 30_000 * (attempt + 1))); continue; }
    if (res.status === 404) { writeFileSync(file, "null"); return null; }
    if (!res.ok) { await new Promise((r) => setTimeout(r, 5000)); continue; }
    const j = await res.json();
    writeFileSync(file, JSON.stringify(j));
    return j;
  }
  return null; // give up for now; not cached, retried next run
}

const db = openDb({ readOnly: true });
const mints = db.prepare(`SELECT mint, MIN(call_ms) first, MAX(call_ms) lastCall, GROUP_CONCAT(call_ms) calls FROM manual_signals
  WHERE book='telegram' AND call_ms IS NOT NULL GROUP BY mint ORDER BY first`).all() as { mint: string; first: number; lastCall: number; calls: string }[];
console.log(`${mints.length} unique called tokens via ${CG_KEY ? "CoinGecko Pro API" : "GeckoTerminal free API"}`);

const summary: Record<string, unknown>[] = [];
let done = 0;
for (const m of mints.slice(0, maxMints)) {
  const dir = resolve(CACHE, m.mint);
  mkdirSync(dir, { recursive: true });
  const pools = await get(`${API}/tokens/${m.mint}/pools?page=1`, resolve(dir, "pools.json"));
  const list = (pools?.data ?? []).map((p: any) => ({
    address: p.attributes.address as string, dex: p.relationships?.dex?.data?.id as string, name: p.attributes.name as string,
    reserveUsd: Number(p.attributes.reserve_in_usd ?? 0), created: Date.parse(p.attributes.pool_created_at),
    base: (p.relationships?.base_token?.data?.id ?? "").replace("solana_", ""),
  })).filter((p: any) => p.base === m.mint);
  // pump.fun bonding curve as a pool (bonding phase history).
  let curve: string | null = null;
  // Skip the curve lookup when a post-graduation pool already existed before the first call.
  const graduatedBeforeCall = list.some((p: any) => p.dex !== "pump-fun" && p.created < m.first - 3_600_000);
  if (m.mint.endsWith("pump") && !graduatedBeforeCall) {
    try {
      const pda = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(m.mint).toBuffer()], PUMP)[0].toBase58();
      const info = await get(`${API}/pools/${pda}`, resolve(dir, "curve.json"));
      if (info?.data) curve = pda;
    } catch { /* not a valid key */ }
  }
  const main = list.filter((p: any) => p.dex !== "pump-fun").sort((a: any, b: any) => b.reserveUsd - a.reserveUsd)[0];
  const targets = [curve, main?.address].filter(Boolean) as string[];
  // call clusters for minute windows
  const calls = m.calls.split(",").map(Number).sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const c of calls) if (!clusters.length || c > clusters[clusters.length - 1] + 14 * 3_600_000) clusters.push(c);
  for (const pool of targets) {
    let lastMinuteBar = 0, minuteFull = false;
    for (const c of clusters) {
      const before = Math.floor((c + 16 * 3_600_000) / 1000);
      const j = await get(`${API}/pools/${pool}/ohlcv/minute?aggregate=1&before_timestamp=${before}&limit=1000&currency=usd&token=base`, resolve(dir, `${pool}_m1_${before}.json`));
      const bars = j?.data?.attributes?.ohlcv_list ?? [];
      if (bars.length) lastMinuteBar = Math.max(lastMinuteBar, bars[0][0] * 1000);
      if (bars.length >= 1000) minuteFull = true;
    }
    // Dead token: minute bars stop long before the window ends and the page was not full, so there is nothing later to fetch.
    const windowEnd = m.lastCall + 16 * 3_600_000;
    if (!minuteFull && lastMinuteBar && lastMinuteBar < windowEnd - 6 * 3_600_000 && lastMinuteBar < Date.now() - 6 * 3_600_000) continue;
    const before15 = Math.floor(Math.min(Date.now(), m.lastCall + HORIZON_H * 3_600_000) / 1000);
    await get(`${API}/pools/${pool}/ohlcv/minute?aggregate=15&before_timestamp=${before15}&limit=1000&currency=usd&token=base`, resolve(dir, `${pool}_m15_${before15}.json`));
  }
  const meta = { mint: m.mint, curve, main: main ?? null, pools: list.length, clusters: clusters.length };
  writeFileSync(resolve(dir, "meta.json"), JSON.stringify(meta));
  summary.push(meta);
  done++;
  if (done % 10 === 0) console.log(`${done}/${mints.length} tokens, ${requests} requests, ${cached} cache hits`);
}
writeFileSync(resolve(CACHE, "_summary.json"), JSON.stringify({ at: new Date().toISOString(), tokens: summary.length, requests, cached, summary }, null, 1));
console.log(`done: ${summary.length} tokens, ${requests} requests, ${cached} cache hits`);
