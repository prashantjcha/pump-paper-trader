// "Shallow first drop" study: tokens whose first drop from the initial 48 h peak stayed under 50%.
//   npx tsx scripts/research-shallow.ts [--callers @a,@b] [--out research/shallow-2026-09-30]
// A. What shallow tokens look like at the call and in the hours after it, vs everything else.
// B. A point-in-time rule: K hours after the call, buy only if the token is still within X% of its running high,
//    then ride it with a trailing stop. Fit before 18 Sep, validate 18-26 Sep, recent after 26 Sep.
// C. Caller check: were the chosen callers already better than the rest in the fit period alone?
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";

type B = { t: number; o: number; h: number; l: number; c: number; v: number; liq: number };
const argv = process.argv.slice(2);
const argOpt = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : undefined; };
const CALLERS = argOpt("callers") ? new Set(argOpt("callers")!.split(",").map((s) => s.trim())) : null;
const OUT = resolve(DATA_DIR, "..", argOpt("out") ?? "research/shallow-2026-09-30");
mkdirSync(OUT, { recursive: true });
const SOL_USD = JSON.parse(readFileSync(resolve(DATA_DIR, "ohlcv/_solusd.json"), "utf8")).usd;
const POS = 0.1, FIXED = 0.003, H = 3_600_000;
const FIT_END = Date.parse("2026-09-18T00:00Z"), VAL_END = Date.parse("2026-09-26T00:00Z");
const db = openDb({ readOnly: true });
const allFirst = db.prepare(`SELECT mint, MIN(call_ms) first FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL GROUP BY mint`).all() as { mint: string; first: number }[];
const rows = db.prepare(`SELECT mint, caller, call_ms FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL ORDER BY call_ms`).all() as { mint: string; caller: string; call_ms: number }[];
// universe: the first call on each token by an included caller
const seen = new Set<string>();
const calls = rows.filter((r) => (!CALLERS || CALLERS.has(r.caller)) && !seen.has(r.mint) && (seen.add(r.mint), true));
const load = (mint: string): B[] | null => {
  const f = resolve(DATA_DIR, "ohlcv", mint, "codex_h1.json");
  if (!existsSync(f)) return null;
  return (JSON.parse(readFileSync(f, "utf8")).bars as number[][]).map((b) => ({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], liq: b[6] }));
};
const med = (v: number[]) => { const s = v.filter((x) => isFinite(x)).sort((a, b) => a - b); return s.length ? +s[Math.floor(s.length / 2)].toPrecision(3) : null; };
const pct = (a: number, n: number) => (n ? +(100 * a / n).toFixed(1) : null);

// ------------------------------------------------------------ A. shallow vs rest
interface Tok { mint: string; caller: string; callMs: number; bars: B[]; shallow: boolean; firstDrop: number; feats: Record<string, number> }
const toks: Tok[] = [];
for (const c of calls) {
  const bars = load(c.mint);
  if (!bars || bars.length < 3) continue;
  const launch = bars[0].t;
  let p1 = 0, p1T = 0;
  for (const b of bars) if (b.t <= launch + 48 * H && b.h > p1) { p1 = b.h; p1T = b.t; }
  let low = Infinity;
  for (const b of bars) { if (b.t <= p1T) continue; if (b.h > p1) break; low = Math.min(low, b.l); }
  const firstDrop = isFinite(low) ? 1 - low / p1 : 0;
  const at = (ms: number) => { let x: B | null = null; for (const b of bars) { if (b.t > ms) break; x = b; } return x; };
  const runHigh = (ms: number) => Math.max(0, ...bars.filter((b) => b.t <= ms).map((b) => b.h));
  const callBar = at(c.call_ms) ?? bars[0];
  const pxCall = callBar.c;
  const f: Record<string, number> = {
    ageAtCallH: (c.call_ms - launch) / H,
    mcapAtCallUsd: pxCall * 1e9,
    liqAtCallUsd: callBar.liq,
    vol24hBeforeUsd: bars.filter((b) => b.t > c.call_ms - 24 * H && b.t <= c.call_ms).reduce((a, b) => a + b.v, 0),
    runupBeforeCall: pxCall / Math.min(...bars.filter((b) => b.t > c.call_ms - 24 * H && b.t <= c.call_ms).map((b) => b.l), pxCall),
    ddFromHighAtCall: 1 - pxCall / runHigh(c.call_ms),
  };
  for (const k of [1, 6]) {
    const b = at(c.call_ms + k * H);
    if (b) { f[`retSinceCall_${k}h`] = b.c / pxCall; f[`ddFromHigh_${k}h`] = 1 - b.c / runHigh(c.call_ms + k * H); }
  }
  toks.push({ mint: c.mint, caller: c.caller, callMs: c.call_ms, bars, shallow: firstDrop < 0.5, firstDrop, feats: f });
}
const featNames = [...new Set(toks.flatMap((t) => Object.keys(t.feats)))];
const partA = {
  tokens: toks.length, shallow: toks.filter((t) => t.shallow).length,
  shallowPct: pct(toks.filter((t) => t.shallow).length, toks.length),
  medians: featNames.map((k) => ({ feature: k, shallow: med(toks.filter((t) => t.shallow).map((t) => t.feats[k])), rest: med(toks.filter((t) => !t.shallow).map((t) => t.feats[k])) })),
  byCaller: [...new Set(toks.map((t) => t.caller))].map((c) => { const s = toks.filter((t) => t.caller === c); return { caller: c, tokens: s.length, shallowPct: pct(s.filter((t) => t.shallow).length, s.length) }; }).sort((a, b) => b.tokens - a.tokens),
};

// ------------------------------------------------------------ B. point-in-time "still holding up" rule
interface Cfg { k: number; maxDd: number; aboveCall: boolean; exit: "trail40" | "trail50" | "half2x-trail50" }
const impact = (sol: number, liq: number) => Math.min(0.3, liq > 0 ? (sol * SOL_USD) / (sol * SOL_USD + liq / 2) : 0.3);
function trade(t: Tok, cfg: Cfg) {
  const fee = t.mint.endsWith("pump") ? 0.0125 : 0.01;
  const check = t.callMs + cfg.k * H;
  const idx = t.bars.findIndex((b) => b.t + H > check && b.t <= check); // bar containing the checkpoint
  const ci = idx >= 0 ? idx : t.bars.findIndex((b) => b.t > check) - 1;
  if (ci < 0 || ci + 1 >= t.bars.length) return null;
  const hi = Math.max(...t.bars.slice(0, ci + 1).map((b) => b.h));
  const cb = t.bars[ci];
  const callPx = (t.bars.filter((b) => b.t <= t.callMs).at(-1) ?? t.bars[0]).c;
  if (1 - cb.c / hi > cfg.maxDd) return null;
  if (cfg.aboveCall && cb.c < callPx) return null;
  const eb = t.bars[ci + 1];
  const tokens = (POS * (1 - fee - impact(POS, eb.liq))) / eb.o, entry = eb.o;
  let left = 1, proceeds = 0, legs = 1, peak = entry;
  const trail = cfg.exit === "trail40" ? 0.4 : 0.5, hard = cfg.exit === "trail40" ? 0.35 : 0.4;
  const sell = (px: number, frac: number, b: B) => { const g = tokens * frac * px; proceeds += g * (1 - fee - impact(g, b.liq)); left -= frac; legs++; };
  for (let j = ci + 1; j < t.bars.length && left > 1e-9; j++) {
    const b = t.bars[j];
    const stop = Math.max(entry * (1 - hard), peak * (1 - trail));
    if (b.l <= stop) { sell(Math.min(b.o, stop), left, b); break; }
    peak = Math.max(peak, b.h);
    if (cfg.exit === "half2x-trail50" && left === 1 && b.h >= entry * 2) sell(Math.max(entry * 2, b.o), 0.5, b);
    if (b.t - eb.t >= 7 * 24 * H) { sell(b.c, left, b); break; }
  }
  if (left > 1e-9) { const lb = t.bars[t.bars.length - 1]; sell(lb.c, left, lb); }
  return { entryT: eb.t, pnl: proceeds - POS - FIXED * legs, mult: proceeds / POS, shallow: t.shallow };
}
const summarize = (tr: { pnl: number; mult: number; shallow: boolean }[]) => {
  const v = tr.map((x) => x.pnl).sort((a, b) => a - b), n = v.length, sum = v.reduce((a, b) => a + b, 0);
  const trim = n > 4 ? v.slice(0, n - 2) : v;
  return { n, meanSol: n ? +(sum / n).toFixed(4) : null, trimmedMeanSol: trim.length ? +(trim.reduce((a, b) => a + b, 0) / trim.length).toFixed(4) : null,
    totalSol: +sum.toFixed(3), withoutBestSol: n ? +(sum - v[n - 1]).toFixed(3) : 0, winRate: pct(v.filter((x) => x > 0).length, n),
    realized3x: tr.filter((x) => x.mult >= 3).length, realized5x: tr.filter((x) => x.mult >= 5).length, pickedShallowPct: pct(tr.filter((x) => x.shallow).length, n) };
};
const cfgs: Cfg[] = [];
for (const k of [1, 3, 6, 12]) for (const maxDd of [0.3, 0.4, 0.5]) for (const aboveCall of [false, true]) for (const exit of ["trail40", "trail50", "half2x-trail50"] as const) cfgs.push({ k, maxDd, aboveCall, exit });
const partB = cfgs.map((cfg) => {
  const tr = toks.map((t) => trade(t, cfg)).filter((x): x is NonNullable<typeof x> => !!x);
  return { rule: `${cfg.k}h after call, within ${cfg.maxDd * 100}% of high${cfg.aboveCall ? ", above call price" : ""}, ${cfg.exit}`,
    fit: summarize(tr.filter((x) => x.entryT < FIT_END)), validation: summarize(tr.filter((x) => x.entryT >= FIT_END && x.entryT < VAL_END)), recent: summarize(tr.filter((x) => x.entryT >= VAL_END)) };
});
const ranked = partB.filter((r) => r.fit.n >= 30).sort((a, b) => (b.fit.trimmedMeanSol ?? -1) - (a.fit.trimmedMeanSol ?? -1));
// baseline: buy every token at the 1 h checkpoint regardless of drawdown, same exits
const baseline = (["trail40", "trail50", "half2x-trail50"] as const).map((exit) => {
  const tr = toks.map((t) => trade(t, { k: 1, maxDd: 1, aboveCall: false, exit })).filter((x): x is NonNullable<typeof x> => !!x);
  return { rule: `baseline: every call, 1h after, ${exit}`, fit: summarize(tr.filter((x) => x.entryT < FIT_END)), validation: summarize(tr.filter((x) => x.entryT >= FIT_END && x.entryT < VAL_END)), recent: summarize(tr.filter((x) => x.entryT >= VAL_END)) };
});

// ------------------------------------------------------------ C. callers: fit period vs later (24 h max multiple from the call)
const mult24 = (t: Tok) => { const cp = (t.bars.filter((b) => b.t <= t.callMs).at(-1) ?? t.bars[0]).c; return Math.max(...t.bars.filter((b) => b.t > t.callMs && b.t <= t.callMs + 24 * H).map((b) => b.h), cp) / cp; };
const partC = [...new Set(toks.map((t) => t.caller))].map((c) => {
  const s = toks.filter((t) => t.caller === c), fit = s.filter((t) => t.callMs < FIT_END), later = s.filter((t) => t.callMs >= FIT_END);
  const r = (x: Tok[], m: number) => pct(x.filter((t) => mult24(t) >= m).length, x.length);
  return { caller: c, fitCalls: fit.length, fit2x: r(fit, 2), fit5x: r(fit, 5), laterCalls: later.length, later2x: r(later, 2), later5x: r(later, 5) };
}).sort((a, b) => b.fitCalls + b.laterCalls - a.fitCalls - a.laterCalls);

// ------------------------------------------------------------ D. segment by what is known at the call (age, liquidity, drawdown)
// Entry at the first hourly bar after the call. Age is capped by the data window (bars start 3 days before the first call).
const segs: { name: string; test: (t: Tok) => boolean }[] = [
  { name: "age < 6h", test: (t) => t.feats.ageAtCallH < 6 },
  { name: "age 6-48h", test: (t) => t.feats.ageAtCallH >= 6 && t.feats.ageAtCallH < 48 },
  { name: "age >= 48h", test: (t) => t.feats.ageAtCallH >= 48 },
  { name: "liquidity < $5k", test: (t) => t.feats.liqAtCallUsd < 5000 },
  { name: "liquidity $5k-20k", test: (t) => t.feats.liqAtCallUsd >= 5000 && t.feats.liqAtCallUsd < 20000 },
  { name: "liquidity >= $20k", test: (t) => t.feats.liqAtCallUsd >= 20000 },
  { name: "age >= 24h and liquidity >= $10k", test: (t) => t.feats.ageAtCallH >= 24 && t.feats.liqAtCallUsd >= 10000 },
  { name: "down < 40% from high at call", test: (t) => t.feats.ddFromHighAtCall < 0.4 },
  { name: "down >= 70% from high at call", test: (t) => t.feats.ddFromHighAtCall >= 0.7 },
];
const partD = segs.map((sg) => {
  const sel = toks.filter(sg.test);
  const res: Record<string, unknown> = { segment: sg.name, tokens: sel.length, shallowPct: pct(sel.filter((t) => t.shallow).length, sel.length),
    reached2x24h: pct(sel.filter((t) => mult24(t) >= 2).length, sel.length), reached5x24h: pct(sel.filter((t) => mult24(t) >= 5).length, sel.length) };
  for (const exit of ["trail40", "half2x-trail50"] as const) {
    const tr = sel.map((t) => trade(t, { k: 0, maxDd: 1, aboveCall: false, exit })).filter((x): x is NonNullable<typeof x> => !!x);
    res[exit] = { fit: summarize(tr.filter((x) => x.entryT < FIT_END)), validation: summarize(tr.filter((x) => x.entryT >= FIT_END && x.entryT < VAL_END)), recent: summarize(tr.filter((x) => x.entryT >= VAL_END)) };
  }
  return res;
});

const out = { generated: new Date().toISOString(), universe: CALLERS ? [...CALLERS] : "all callers", partA, partB: ranked, partBAll: partB, baseline, partC, partD };
writeFileSync(resolve(OUT, "results.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ universe: out.universe, tokens: partA.tokens, shallow: partA.shallow, shallowPct: partA.shallowPct }, null, 0));
console.log("\nA. medians (shallow vs rest):"); for (const m of partA.medians) console.log(`  ${m.feature.padEnd(20)} ${String(m.shallow).padStart(10)} ${String(m.rest).padStart(10)}`);
console.log("\nB. top rules by fit trimmed mean (n>=30) | fit n/trim/w-o-best | val n/trim/total | recent n/trim | 3x/5x all | shallow% picked");
for (const r of ranked.slice(0, 10)) console.log(`  ${r.rule.padEnd(62)} | ${r.fit.n}/${r.fit.trimmedMeanSol}/${r.fit.withoutBestSol} | ${r.validation.n}/${r.validation.trimmedMeanSol}/${r.validation.totalSol} | ${r.recent.n}/${r.recent.trimmedMeanSol} | ${r.fit.realized3x + r.validation.realized3x + r.recent.realized3x}/${r.fit.realized5x + r.validation.realized5x + r.recent.realized5x} | ${r.fit.pickedShallowPct}`);
for (const r of baseline) console.log(`  ${r.rule.padEnd(62)} | ${r.fit.n}/${r.fit.trimmedMeanSol}/${r.fit.withoutBestSol} | ${r.validation.n}/${r.validation.trimmedMeanSol}/${r.validation.totalSol} | ${r.recent.n}/${r.recent.trimmedMeanSol}`);
const posVal = partB.filter((r) => r.validation.n >= 20 && (r.validation.trimmedMeanSol ?? -1) > 0).length;
console.log(`\n  rules positive on validation (trimmed, n>=20): ${posVal} of ${partB.length}`);
console.log("\nC. callers (24h from call): fit n / 2x% / 5x%  ->  later n / 2x% / 5x%");
for (const c of partC.slice(0, 12)) console.log(`  ${c.caller.padEnd(16)} ${c.fitCalls}/${c.fit2x}/${c.fit5x}  ->  ${c.laterCalls}/${c.later2x}/${c.later5x}`);

console.log("\nD. segments at the call (buy at the first hourly bar after the call) | tokens | shallow% | 2x/5x in 24h | trail40 fit n/trim, val n/trim, recent n/trim | half2x fit/val/recent trim");
for (const d of partD as any[]) console.log(`  ${d.segment.padEnd(34)} ${String(d.tokens).padStart(4)} ${String(d.shallowPct).padStart(5)} ${d.reached2x24h}/${d.reached5x24h} | ${d.trail40.fit.n}/${d.trail40.fit.trimmedMeanSol}, ${d.trail40.validation.n}/${d.trail40.validation.trimmedMeanSol}, ${d.trail40.recent.n}/${d.trail40.recent.trimmedMeanSol} | ${d["half2x-trail50"].fit.trimmedMeanSol}/${d["half2x-trail50"].validation.trimmedMeanSol}/${d["half2x-trail50"].recent.trimmedMeanSol}`);
