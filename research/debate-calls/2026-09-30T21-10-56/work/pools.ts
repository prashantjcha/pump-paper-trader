// Direct check: for events-empty calls, was every pool with pre-call trading a curve (pump-fun etc.) and the top (AMM) pool created after the call?
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const c: Record<string, number> = {};
const inc = (k: string) => (c[k] = (c[k] ?? 0) + 1);
for (const r of rows) {
  const g = r.n === 0 ? "empty" : r.n <= 100 ? "1-100" : ">100";
  const f = resolve(DATA, "ohlcv", r.mint, "pools.json");
  if (!existsSync(f)) { inc(`${g}: no pools.json`); continue; }
  const pools = (JSON.parse(readFileSync(f, "utf8")).data ?? []).map((p: any) => ({ dex: p.relationships?.dex?.data?.id, created: Date.parse(p.attributes.pool_created_at), res: +p.attributes.reserve_in_usd }));
  if (!pools.length) { inc(`${g}: pools.json empty`); continue; }
  const top = [...pools].sort((a: any, b: any) => b.res - a.res)[0];
  inc(`${g}: top pool ${top.created > r.callMs ? "created AFTER call" : "existed before call"}`);
  inc(`${g}: any AMM (non-curve) pool before call = ${pools.some((p: any) => !/pump-fun|launchlab|bonk|curve|moonshot|believe|boop/i.test(p.dex) && p.created <= r.callMs)}`);
}
console.log(Object.entries(c).sort().map(([k, v]) => `${k}: ${v}`).join("\n"));
const db = new DatabaseSync(resolve(DATA, "pumpfun.db"), { readOnly: true });
console.log("\nmanual_signals columns:", (db.prepare("PRAGMA table_info(manual_signals)").all() as any[]).map((x) => x.name).join(", "));
