// Speed test: does buying 1-2 s after a Telegram call (instead of ~60 s) make the calls profitable?
//   npx tsx scripts/research-speed.ts [--callers @a,@b] [--out research/speed-2026-09-30]
// 1-second Codex bars from 60 s before to ~24 min after each call, then 1-minute bars to 24 h.
// Entry: open of the first 1-second bar at or after call + D seconds (D = 1, 2, 5, 10, 30, 60).
// For each delay the exit rule is chosen on the fit period (trimmed mean) and scored on validation and recent periods.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";
import { PolicyState, policyName, type PolicySpec } from "../packages/core/src/callPolicy.ts";

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number; liq?: number };
const argv = process.argv.slice(2);
const argOpt = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : undefined; };
const CALLERS = argOpt("callers") ? new Set(argOpt("callers")!.split(",").map((s) => s.trim())) : null;
const OUT = resolve(DATA_DIR, "..", argOpt("out") ?? "research/speed-2026-09-30");
mkdirSync(OUT, { recursive: true });
const SOL_USD = JSON.parse(readFileSync(resolve(DATA_DIR, "ohlcv/_solusd.json"), "utf8")).usd;
const POS = 0.1, FIXED = 0.003, HORIZON = 24 * 3_600_000;
const FIT_END = Date.parse("2026-09-18T00:00Z"), VAL_END = Date.parse("2026-09-26T00:00Z"), DATA_END = Date.parse("2026-09-29T18:00Z");
const DELAYS = [1, 2, 5, 10, 30, 60];

const db = openDb({ readOnly: true });
const rows = db.prepare(`SELECT mint, caller, call_ms FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL ORDER BY call_ms`).all() as { mint: string; caller: string; call_ms: number }[];
const seen = new Set<string>();
const firstEver = new Map<string, number>();
for (const r of rows) if (!firstEver.has(r.mint)) firstEver.set(r.mint, r.call_ms);
// The 1-second window was fetched around each token's first call in the group, so use that call.
const calls = rows.filter((r) => r.call_ms === firstEver.get(r.mint) && (!CALLERS || CALLERS.has(r.caller)) && !seen.has(r.mint) && (seen.add(r.mint), true) && r.call_ms <= DATA_END);

function load(mint: string, callMs: number) {
  const dir = resolve(DATA_DIR, "ohlcv", mint);
  if (!existsSync(dir)) return null;
  let secs: Bar[] = [], mins: Bar[] = [];
  for (const f of readdirSync(dir)) {
    if (f.startsWith("codex_s1_")) secs.push(...(JSON.parse(readFileSync(resolve(dir, f), "utf8")).bars as number[][]).map((b) => ({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })));
    if (f.startsWith("codex_m1_")) mins.push(...(JSON.parse(readFileSync(resolve(dir, f), "utf8")).bars as number[][]).map((b) => ({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], liq: b[6] })));
  }
  secs.sort((a, b) => a.t - b.t); mins.sort((a, b) => a.t - b.t);
  if (!secs.length) return null;
  const secEnd = Math.floor(callMs / 1000) * 1000 - 60_000 + 1500 * 1000;
  return { secs, mins, secEnd };
}
const liqAt = (mins: Bar[], t: number) => { let x = 0; for (const b of mins) { if (b.t > t) break; if (b.liq) x = b.liq; } return x; };
const impact = (usd: number, liq: number) => Math.min(0.3, liq > 0 ? usd / (usd + liq / 2) : 0.3);

const POLICIES: PolicySpec[] = [
  ...[20, 30, 50, 100].flatMap((tp) => [15, 25].map((sl) => ({ family: "fixed" as const, tp, sl }))),
  ...[0.5, 1, 2, 5, 15].flatMap((hMin) => [15, 25, null].map((sl) => ({ family: "time" as const, hMin, sl }))),
  ...[0, 20].flatMap((arm) => [15, 25].map((trail) => ({ family: "trailing" as const, arm, trail, sl: 25 }))),
];

interface Sim { callMs: number; caller: string; pnl: number; mult: number }
const results = new Map<string, Sim[]>(); // key `${delay}|${policy}`
const pathStats: Record<number, number[][]> = {}; // horizon -> ratios, for delay 1
const HORIZ_S = [5, 10, 30, 60, 120, 300, 900];
let usable = 0, noEntry = 0;
const preMove: number[] = [];
for (const c of calls) {
  const d = load(c.mint, c.call_ms);
  if (!d) continue;
  const fee = c.mint.endsWith("pump") ? 0.0125 : 0.01;
  const first = d.secs.find((b) => b.t >= c.call_ms);
  const before = [...d.secs].reverse().find((b) => b.t <= c.call_ms - 30_000);
  if (first && before) preMove.push(first.o / before.c);
  let any = false;
  for (const D of DELAYS) {
    const target = c.call_ms + D * 1000;
    const ei = d.secs.findIndex((b) => b.t >= target);
    if (ei < 0 || d.secs[ei].t > target + 120_000) continue;
    any = true;
    const eb = d.secs[ei], entry = eb.o;
    const path: Bar[] = [...d.secs.slice(ei), ...d.mins.filter((b) => b.t >= d.secEnd && b.t <= c.call_ms + HORIZON)];
    if (D === 1) for (const h of HORIZ_S) {
      const p = [...d.secs].reverse().find((b) => b.t <= eb.t + h * 1000);
      (pathStats[h] ??= []).push([p ? p.c / entry : NaN, Math.max(entry, ...d.secs.filter((b) => b.t >= eb.t && b.t <= eb.t + h * 1000).map((b) => b.h)) / entry]);
    }
    const liq = liqAt(d.mins, eb.t);
    const tokens = (POS * (1 - fee - impact(POS * SOL_USD, liq))) / entry;
    for (const spec of POLICIES) {
      const st = new PolicyState(spec, entry, eb.t);
      let proceeds = 0, legs = 1;
      const sell = (px: number, frac: number, t: number) => { const g = tokens * frac * px; proceeds += g * (1 - fee - impact(g * SOL_USD, liqAt(d.mins, t))); legs++; };
      for (const b of path) { for (const f of st.onBar(b)) sell(f.px, f.frac, b.t); if (st.done) break; }
      if (!st.done) { const lb = path[path.length - 1]; for (const f of st.close(lb)) sell(f.px, f.frac, lb.t); }
      const key = `${D}|${policyName(spec)}`;
      (results.get(key) ?? results.set(key, []).get(key)!).push({ callMs: c.call_ms, caller: c.caller, pnl: proceeds - POS - FIXED * legs, mult: proceeds / POS });
    }
  }
  if (any) usable++; else noEntry++;
}

const summarize = (v0: Sim[]) => {
  const v = v0.map((x) => x.pnl).sort((a, b) => a - b), n = v.length, sum = v.reduce((a, b) => a + b, 0);
  const trim = n > 4 ? v.slice(0, n - 2) : v;
  return { n, meanSol: n ? +(sum / n).toFixed(4) : null, trimmedMeanSol: trim.length ? +(trim.reduce((a, b) => a + b, 0) / trim.length).toFixed(4) : null,
    totalSol: +sum.toFixed(3), withoutBestSol: n ? +(sum - v[n - 1]).toFixed(3) : 0, winRate: n ? +(100 * v.filter((x) => x > 0).length / n).toFixed(1) : null };
};
const q = (xs: number[], p: number) => { const s = xs.filter((x) => isFinite(x)).sort((a, b) => a - b); return s.length ? +s[Math.floor(p * (s.length - 1))].toFixed(3) : null; };
const byDelay = DELAYS.map((D) => {
  const table = POLICIES.map((spec) => {
    const all = results.get(`${D}|${policyName(spec)}`) ?? [];
    return { policy: policyName(spec), fit: summarize(all.filter((x) => x.callMs < FIT_END)), validation: summarize(all.filter((x) => x.callMs >= FIT_END && x.callMs < VAL_END)), recent: summarize(all.filter((x) => x.callMs >= VAL_END)) };
  });
  const chosen = table.filter((r) => r.fit.n >= 30).sort((a, b) => (b.fit.trimmedMeanSol ?? -1) - (a.fit.trimmedMeanSol ?? -1))[0];
  const bestValHindsight = [...table].filter((r) => r.validation.n >= 30).sort((a, b) => (b.validation.trimmedMeanSol ?? -1) - (a.validation.trimmedMeanSol ?? -1))[0];
  return { delaySeconds: D, chosenOnFit: chosen, bestOnValidationHindsight: bestValHindsight, positiveOnValidation: table.filter((r) => r.validation.n >= 30 && (r.validation.trimmedMeanSol ?? -1) > 0).length, table };
});
const out = {
  generated: new Date().toISOString(), universe: CALLERS ? [...CALLERS] : "all callers", calls: calls.length, usable, noEntry,
  priceBeforeCall: { note: "first trade after the call vs the price 30 s before it", median: q(preMove, 0.5), p75: q(preMove, 0.75), shareUp: +(100 * preMove.filter((x) => x > 1).length / preMove.length).toFixed(1) },
  pathAfterEntryAt1s: HORIZ_S.map((h) => ({ seconds: h, medianPriceVsEntry: q(pathStats[h].map((x) => x[0]), 0.5), p75: q(pathStats[h].map((x) => x[0]), 0.75), medianBestSoFar: q(pathStats[h].map((x) => x[1]), 0.5), shareAboveEntry: +(100 * pathStats[h].filter((x) => x[0] > 1).length / pathStats[h].length).toFixed(1) })),
  byDelay,
};
writeFileSync(resolve(OUT, "results.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ universe: out.universe, calls: out.calls, usable, noEntry, priceBeforeCall: out.priceBeforeCall }, null, 0));
console.log("\nprice after a 1 s entry (median, p75, median best-so-far, share above entry):");
for (const p of out.pathAfterEntryAt1s) console.log(`  +${String(p.seconds).padStart(4)}s  ${p.medianPriceVsEntry}  ${p.p75}  best ${p.medianBestSoFar}  above ${p.shareAboveEntry}%`);
console.log("\ndelay | exit chosen on fit | fit n/trimmed | validation n/trimmed/total | recent n/trimmed | positive on validation | best on validation (hindsight)");
for (const d of byDelay) { const c = d.chosenOnFit, h = d.bestOnValidationHindsight; console.log(`  ${String(d.delaySeconds).padStart(2)}s | ${c.policy.padEnd(22)} | ${c.fit.n}/${c.fit.trimmedMeanSol} | ${c.validation.n}/${c.validation.trimmedMeanSol}/${c.validation.totalSol} | ${c.recent.n}/${c.recent.trimmedMeanSol} | ${d.positiveOnValidation}/${d.table.length} | ${h?.policy} ${h?.validation.trimmedMeanSol}`); }
