// Fetches token-level price bars for every Telegram call from Codex (codex.io), which indexes new Solana
// tokens including pump.fun bonding curves and aggregates all of a token's pools into one series.
// Cached under data/ohlcv/<mint>/codex_*.json (resumable). Requires CODEX_API_KEY in .env.
//   npx tsx scripts/calls-fetch-codex.ts [--max-mints N]
import "dotenv/config";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";

const KEY = process.env.CODEX_API_KEY;
if (!KEY) { console.error("Set CODEX_API_KEY in .env"); process.exit(1); }
const URL = process.env.CODEX_URL ?? "https://graph.codex.io/graphql";
const SPACING_MS = Number(process.env.CODEX_SPACING_MS ?? 250);
const NETWORK = 1399811149; // Solana
const CACHE = resolve(DATA_DIR, "ohlcv");
const HORIZON_H = 72;
const args = process.argv.slice(2);
const maxMints = Number(args[args.indexOf("--max-mints") + 1] || 1e9);

let last = 0, requests = 0, cached = 0, errors = 0;
async function bars(mint: string, from: number, to: number, resolution: "1" | "15", file: string): Promise<any> {
  if (existsSync(file)) { cached++; return JSON.parse(readFileSync(file, "utf8")); }
  const query = `query { getTokenBars(symbol: "${mint}:${NETWORK}", from: ${Math.floor(from / 1000)}, to: ${Math.floor(to / 1000)}, resolution: "${resolution}", currencyCode: USD, removeEmptyBars: true, removeLeadingNullValues: true) { t o h l c volume liquidity s } }`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    requests++;
    let res: Response;
    try { res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json", Authorization: KEY! }, body: JSON.stringify({ query }) }); }
    catch { await new Promise((r) => setTimeout(r, 3000)); continue; }
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
    const j: any = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) throw new Error(`Codex rejected the API key (${res.status}): ${JSON.stringify(j?.errors ?? j).slice(0, 200)}`);
    if (!res.ok || j?.errors) {
      const msg = JSON.stringify(j?.errors ?? res.status).slice(0, 300);
      if (/not found|could not find|no data|unknown token/i.test(msg)) { writeFileSync(file, JSON.stringify({ bars: [] })); return { bars: [] }; }
      errors++; console.error(`codex error for ${mint}: ${msg}`);
      await new Promise((r) => setTimeout(r, 2000)); continue;
    }
    const b = j?.data?.getTokenBars;
    const out = { bars: (b?.t ?? []).map((t: number, i: number) => [t, Number(b.o[i]), Number(b.h[i]), Number(b.l[i]), Number(b.c[i]), Number(b.volume?.[i] ?? 0), Number(b.liquidity?.[i] ?? 0)]).filter((x: number[]) => x[1] > 0) };
    writeFileSync(file, JSON.stringify(out));
    return out;
  }
  return null;
}

const db = openDb({ readOnly: true });
const mints = db.prepare(`SELECT mint, MIN(call_ms) first, MAX(call_ms) lastCall, GROUP_CONCAT(call_ms) calls FROM manual_signals
  WHERE book='telegram' AND call_ms IS NOT NULL GROUP BY mint ORDER BY first`).all() as { mint: string; first: number; lastCall: number; calls: string }[];
console.log(`${mints.length} unique called tokens via Codex`);
let done = 0;
for (const m of mints.slice(0, maxMints)) {
  const dir = resolve(CACHE, m.mint);
  mkdirSync(dir, { recursive: true });
  const calls = m.calls.split(",").map(Number).sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const c of calls) if (!clusters.length || c > clusters[clusters.length - 1] + 22 * 3_600_000) clusters.push(c);
  for (const c of clusters) {
    const from = c - 60 * 60_000, to = Math.min(Date.now(), from + 1499 * 60_000); // Codex returns at most 1,500 bars (inclusive range)
    await bars(m.mint, from, to, "1", resolve(dir, `codex_m1_${Math.floor(from / 1000)}.json`));
  }
  const to15 = Math.min(Date.now(), m.lastCall + HORIZON_H * 3_600_000);
  const from15 = Math.max(m.first - 6 * 3_600_000, to15 - 1499 * 15 * 60_000);
  await bars(m.mint, from15, to15, "15", resolve(dir, `codex_m15_${Math.floor(to15 / 1000)}.json`));
  writeFileSync(resolve(dir, "codex_meta.json"), JSON.stringify({ mint: m.mint, clusters: clusters.length, at: new Date().toISOString() }));
  done++;
  if (done % 25 === 0) console.log(`${done}/${mints.length} tokens, ${requests} requests, ${cached} cached, ${errors} errors`);
}
console.log(`done: ${done} tokens, ${requests} requests, ${cached} cached, ${errors} errors`);
