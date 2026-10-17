// Drawdown-then-breakout study on the Telegram group's called tokens (hourly bars from Codex).
//   npx tsx scripts/research-drawdown.ts
// Part 1: does the depth of the first drop from the initial peak separate eventual runners from dead tokens?
// Part 2: a point-in-time trading rule for "rally -> 50-90% drawdown -> base -> breakout above the first throwback".
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";

type B = { t: number; o: number; h: number; l: number; c: number; v: number; liq: number };
const argv = process.argv.slice(2);
const argOpt = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : undefined; };
const CALLERS = argOpt("callers") ? new Set(argOpt("callers")!.split(",").map((s) => s.trim())) : null;
const OUT = resolve(DATA_DIR, "..", argOpt("out") ?? "research/drawdown-2026-09-30");
mkdirSync(OUT, { recursive: true });
const SOL_USD = JSON.parse(readFileSync(resolve(DATA_DIR, "ohlcv/_solusd.json"), "utf8")).usd;
const POS = 0.1, FIXED = 0.003;
const db = openDb({ readOnly: true });
const calls = (CALLERS
  ? db.prepare(`SELECT mint, MIN(call_ms) first, caller FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL AND caller IN (${[...CALLERS].map(() => "?").join(",")}) GROUP BY mint`).all(...CALLERS)
  : db.prepare(`SELECT mint, MIN(call_ms) first, caller FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL GROUP BY mint`).all()) as { mint: string; first: number; caller: string }[];
const series = new Map<string, B[]>();
for (const c of calls) {
  const f = resolve(DATA_DIR, "ohlcv", c.mint, "codex_h1.json");
  if (!existsSync(f)) continue;
  const bars = (JSON.parse(readFileSync(f, "utf8")).bars as number[][]).map((b) => ({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], liq: b[6] }));
  if (bars.length >= 3) series.set(c.mint, bars);
}
const dataEnd = Math.max(...[...series.values()].map((b) => b[b.length - 1].t));
const pct = (a: number, n: number) => (n ? +(100 * a / n).toFixed(1) : null);

// ------------------------------------------------------------ Part 1: descriptive
interface Shape { mint: string; p1: number; p1T: number; low: number; lowT: number; depth: number; newAth: boolean; offLowMult: number; hoursToAth: number | null }
const shapes: Shape[] = [];
for (const [mint, bars] of series) {
  const launch = bars[0].t;
  // bars start at most 3 days before the first call; tokens older than that are skipped for Part 1
  const first48 = bars.filter((b) => b.t <= launch + 48 * 3_600_000);
  let p1 = 0, p1T = 0;
  for (const b of first48) if (b.h > p1) { p1 = b.h; p1T = b.t; }
  const after = bars.filter((b) => b.t > p1T);
  let low = Infinity, lowT = 0, athT: number | null = null;
  for (const b of after) {
    if (b.h > p1) { athT = b.t; break; }
    if (b.l < low) { low = b.l; lowT = b.t; }
  }
  if (!isFinite(low)) continue;
  const postLow = bars.filter((b) => b.t >= lowT);
  shapes.push({ mint, p1, p1T, low, lowT, depth: 1 - low / p1, newAth: athT !== null, offLowMult: Math.max(...postLow.map((b) => b.h)) / low, hoursToAth: athT ? (athT - p1T) / 3_600_000 : null });
}
const buckets = [[0, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 0.9], [0.9, 0.97], [0.97, 1.01]];
const part1 = buckets.map(([a, b]) => {
  const s = shapes.filter((x) => x.depth >= a && x.depth < b);
  return { depth: `${a * 100}-${Math.min(100, b * 100)}%`, tokens: s.length, madeNewAth: pct(s.filter((x) => x.newAth).length, s.length), ran5xOffLow: pct(s.filter((x) => x.offLowMult >= 5).length, s.length), ran10xOffLow: pct(s.filter((x) => x.offLowMult >= 10).length, s.length) };
});
// Point-in-time view: the moment a token first falls X% from its running high, what happens next?
const pit = [0.5, 0.6, 0.7, 0.8].map((x) => {
  let hits = 0, ath = 0, deeper90 = 0, back2x = 0;
  for (const [, bars] of series) {
    let hi = 0, trigger = -1;
    for (let i = 0; i < bars.length; i++) { hi = Math.max(hi, bars[i].h); if (bars[i].l <= hi * (1 - x)) { trigger = i; break; } }
    if (trigger < 0) continue;
    hits++;
    const px = hi * (1 - x), rest = bars.slice(trigger + 1);
    if (rest.some((b) => b.h > hi)) ath++;
    if (rest.some((b) => b.l <= hi * 0.1)) deeper90++;
    if (rest.some((b) => b.h >= px * 2)) back2x++;
  }
  return { firstDropOf: `${x * 100}%`, tokens: hits, laterNewAth: pct(ath, hits), laterFellBelow90pctDown: pct(deeper90, hits), laterDoubledFromThatPoint: pct(back2x, hits) };
});

// ------------------------------------------------------------ Part 2: point-in-time trading rule
interface Cfg { dMin: number; dMax: number; baseH: number; volX: number; exit: "target" | "half-trail" | "trail"; control?: boolean }
const impact = (sol: number, liqUsd: number) => Math.min(0.3, liqUsd > 0 ? (sol * SOL_USD) / (sol * SOL_USD + liqUsd / 2) : 0.3);
function runToken(mint: string, bars: B[], callMs: number, cfg: Cfg) {
  const fee = mint.endsWith("pump") ? 0.0125 : 0.01;
  let hi = 0, hiT = 0, state: "rally" | "drop" | "dead" = "rally", low = Infinity, lowT = 0, dumpStartIdx = -1, resistance = 0;
  const trades: { entryT: number; pnl: number; mult: number; exits: string }[] = [];
  for (let i = 0; i < bars.length - 1; i++) {
    const b = bars[i];
    if (b.h > hi) { hi = b.h; hiT = b.t; state = "rally"; low = Infinity; dumpStartIdx = -1; resistance = 0; }
    const dd = 1 - b.l / hi;
    if (state === "rally" && dd >= 0.5) { state = "drop"; dumpStartIdx = i; }
    if (state === "drop") {
      if (b.l < low) { low = b.l; lowT = b.t; resistance = Math.max(...bars.slice(dumpStartIdx, i + 1).map((x) => x.h)); }
      if (1 - low / hi > cfg.dMax) state = "dead";
    }
    const depth = 1 - low / hi;
    const inBase = state === "drop" && depth >= cfg.dMin && (b.t - lowT) / 3_600_000 >= cfg.baseH;
    const baseVol = bars.filter((x) => x.t >= lowT && x.t < b.t).map((x) => x.v).sort((a, c) => a - c);
    const medVol = baseVol.length ? baseVol[Math.floor(baseVol.length / 2)] : 0;
    const breakout = cfg.control
      ? b.c > Math.max(...bars.slice(Math.max(0, i - 24), i).map((x) => x.h), 0) && b.v >= cfg.volX * medVol
      : inBase && b.c > resistance && resistance > low && b.v >= cfg.volX * medVol;
    if (!breakout || b.t < callMs) continue;
    // ---- enter at the next bar's open
    const eb = bars[i + 1];
    const tokens = (POS * (1 - fee - impact(POS, eb.liq))) / eb.o;
    const entry = eb.o, stop = cfg.control ? entry * 0.65 : Math.min(low, entry * 0.65), target = hi;
    let left = 1, proceeds = 0, legs = 1, peak = entry, j = i + 1;
    const ex: string[] = [];
    const sell = (px: number, frac: number, bar: B, why: string) => { const g = tokens * frac * px; proceeds += g * (1 - fee - impact(g, bar.liq)); left -= frac; legs++; ex.push(`${why}@${(px / entry).toFixed(1)}x`); };
    for (; j < bars.length && left > 1e-9; j++) {
      const x = bars[j];
      const trailStop = cfg.exit !== "target" && (cfg.exit === "trail" || left < 1) ? peak * 0.6 : 0;
      const s = Math.max(stop, trailStop);
      if (x.l <= s) { sell(Math.min(x.o, s), left, x, "stop"); break; }
      peak = Math.max(peak, x.h);
      if (cfg.exit === "target" && x.h >= target) { sell(Math.max(target, x.o), left, x, "old_high"); break; }
      if (cfg.exit === "half-trail" && left === 1 && x.h >= target) sell(Math.max(target, x.o), 0.5, x, "half_at_old_high");
      if (x.t - eb.t >= 14 * 86_400_000) { sell(x.c, left, x, "14d"); break; }
    }
    if (left > 1e-9) { const lb = bars[bars.length - 1]; sell(lb.c, left, lb, "data_end"); }
    trades.push({ entryT: eb.t, pnl: proceeds - POS - FIXED * legs, mult: proceeds / POS, exits: ex.join(",") });
    break; // one trade per token
  }
  return trades;
}
const FIT_END = Date.parse("2026-09-18T00:00Z"), VAL_END = Date.parse("2026-09-26T00:00Z");
const summarize = (t: { pnl: number; mult: number }[]) => {
  const v = t.map((x) => x.pnl).sort((a, b) => a - b), n = v.length, sum = v.reduce((a, b) => a + b, 0);
  const trim = n > 4 ? v.slice(0, n - 2) : v;
  return { n, meanSol: n ? +(sum / n).toFixed(4) : null, trimmedMeanSol: trim.length ? +(trim.reduce((a, b) => a + b, 0) / trim.length).toFixed(4) : null, totalSol: +sum.toFixed(3),
    withoutBestSol: n ? +(sum - v[n - 1]).toFixed(3) : 0, winRate: pct(v.filter((x) => x > 0).length, n), realized3x: t.filter((x) => x.mult >= 3).length, realized5x: t.filter((x) => x.mult >= 5).length };
};
const cfgs: Cfg[] = [];
for (const dMin of [0.5, 0.6]) for (const dMax of [0.8, 0.9]) for (const baseH of [6, 24]) for (const volX of [1, 2]) for (const exit of ["target", "half-trail", "trail"] as const) cfgs.push({ dMin, dMax, baseH, volX, exit });
for (const exit of ["target", "half-trail", "trail"] as const) cfgs.push({ dMin: 0, dMax: 1, baseH: 0, volX: 2, exit, control: true });
const name = (c: Cfg) => c.control ? `control: any 24h-high breakout on 2x volume, ${c.exit}` : `drop ${c.dMin * 100}-${c.dMax * 100}%, base ${c.baseH}h, vol ${c.volX}x, ${c.exit}`;
const part2 = cfgs.map((cfg) => {
  const all = calls.filter((c) => series.has(c.mint)).flatMap((c) => runToken(c.mint, series.get(c.mint)!, c.first, cfg));
  return { rule: name(cfg), fit: summarize(all.filter((t) => t.entryT < FIT_END)), validation: summarize(all.filter((t) => t.entryT >= FIT_END && t.entryT < VAL_END)), recent: summarize(all.filter((t) => t.entryT >= VAL_END)) };
});
const ranked = [...part2].filter((r) => r.fit.n >= 30).sort((a, b) => (b.fit.trimmedMeanSol ?? -1) - (a.fit.trimmedMeanSol ?? -1));
const result = { generated: new Date().toISOString(), tokens: series.size, dataEnd: new Date(dataEnd).toISOString(), part1, pointInTime: pit, part2: ranked, part2All: part2 };
writeFileSync(resolve(OUT, "results.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ tokens: series.size, part1, pointInTime: pit }, null, 1));
console.log("\nrule (ranked on fit trimmed mean) | fit n / trimmed / total w/o best | validation n / trimmed / total | recent n / trimmed");
for (const r of ranked.slice(0, 12)) console.log(`${r.rule.padEnd(52)} | ${r.fit.n} / ${r.fit.trimmedMeanSol} / ${r.fit.withoutBestSol} | ${r.validation.n} / ${r.validation.trimmedMeanSol} / ${r.validation.totalSol} | ${r.recent.n} / ${r.recent.trimmedMeanSol}`);
for (const r of part2.filter((x) => x.rule.startsWith("control"))) console.log(`${r.rule.padEnd(52)} | ${r.fit.n} / ${r.fit.trimmedMeanSol} | ${r.validation.n} / ${r.validation.trimmedMeanSol} | ${r.recent.n} / ${r.recent.trimmedMeanSol}`);
