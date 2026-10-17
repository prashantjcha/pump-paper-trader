// What do runners have in common at the moment of the call? Wallet, holder and order-flow features, built only
// from data before the call, tested for consistency across periods, then turned into entry filters and exits.
//   npx tsx scripts/research-runner-features.ts [--callers @a,@b] [--out research/runner-features-2026-09-30]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";
import { trainLogistic, auc } from "../packages/core/src/runnerModel.ts";
import { POLICY_GRID, policyName, type PolicySpec } from "../packages/core/src/callPolicy.ts";
import { evaluate, loadBars, type CallStrategy, type HoldCtx } from "./lib/callsSim.ts";

const argv = process.argv.slice(2);
const argOpt = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : undefined; };
const CALLERS = argOpt("callers") ? new Set(argOpt("callers")!.split(",").map((s) => s.trim())) : null;
const OUT = resolve(DATA_DIR, "..", argOpt("out") ?? "research/runner-features-2026-09-30");
mkdirSync(OUT, { recursive: true });
const H = 3_600_000, M = 60_000;
const FIT_END = Date.parse("2026-09-18T00:00Z"), VAL_END = Date.parse("2026-09-26T00:00Z"), DATA_END = Date.parse("2026-09-29T18:00Z");

const db = openDb({ readOnly: true });
const rows = db.prepare(`SELECT mint, caller, call_ms, msg_text FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL ORDER BY call_ms`).all() as { mint: string; caller: string; call_ms: number; msg_text: string }[];
const firstCall = new Map<string, (typeof rows)[number]>();
for (const r of rows) if (!firstCall.has(r.mint)) firstCall.set(r.mint, r);
const universe = [...firstCall.values()].filter((r) => r.call_ms <= DATA_END && (!CALLERS || CALLERS.has(r.caller)));

type Ev = [number, number, string, number, number, number | null, number, number, number];
interface Sample { mint: string; caller: string; callMs: number; y5: boolean; y3: boolean; dead: boolean; f: Record<string, number>; complete: boolean }
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const samples: Sample[] = [];
const callerHist = new Map<string, { n: number; hits: number; known: number[] }>();
const pending: { t: number; caller: string; hit: boolean }[] = [];
let skipped = 0;

for (const c of universe) {
  const dir = resolve(DATA_DIR, "ohlcv", c.mint);
  const evF = resolve(dir, "codex_events_pre.json"), flF = resolve(dir, "codex_flow_m1.json");
  const bars = loadBars(DATA_DIR, c.mint);
  if (!existsSync(evF) || !existsSync(flF) || !bars) { skipped++; continue; }
  const ev = JSON.parse(readFileSync(evF, "utf8")) as { complete: boolean; events: Ev[] };
  const flow = (JSON.parse(readFileSync(flF, "utf8")).bars as number[][]);
  // ---- label: from the first 1-minute bar at/after the call, within 24 h
  const post = bars.filter((b) => b.t >= c.call_ms && b.t <= c.call_ms + 24 * H);
  if (!post.length || post[0].t > c.call_ms + 10 * M) { skipped++; continue; }
  const p0 = post[0].o, maxM = Math.max(...post.map((b) => b.h)) / p0;
  const at6h = [...post].reverse().find((b) => b.t <= c.call_ms + 6 * H);
  // caller history known at this call
  pending.sort((a, b) => a.t - b.t);
  while (pending.length && pending[0].t <= c.call_ms) { const p = pending.shift()!; const h = callerHist.get(p.caller) ?? { n: 0, hits: 0, known: [] }; h.n++; if (p.hit) h.hits++; callerHist.set(p.caller, h); }
  pending.push({ t: c.call_ms + 24 * H, caller: c.caller, hit: maxM >= 3 });
  const ch = callerHist.get(c.caller) ?? { n: 0, hits: 0, known: [] };

  // ---- wallet / holder features from trades before the call (oldest first)
  // Only trades strictly before the call second (the fetch window was inclusive of it).
  const E = ev.events.filter((e) => e[0] < Math.floor(c.call_ms / 1000)).sort((a, b) => a[0] - b[0] || a[8] - b[8]);
  const f: Record<string, number> = {};
  const callS = c.call_ms / 1000;
  const bal = new Map<string, number>(), firstSeen = new Map<string, number>();
  let buyUsd = 0, sellUsd = 0, washUsd = 0, sandUsd = 0, big500 = 0, big2k = 0, bigNet = 0;
  for (const e of E) {
    const [t, side, maker, usd, tok, , wash, sand] = e;
    bal.set(maker, (bal.get(maker) ?? 0) + side * tok);
    if (!firstSeen.has(maker)) firstSeen.set(maker, t);
    if (side > 0) buyUsd += usd; else sellUsd += usd;
    if (wash) washUsd += usd; if (sand) sandUsd += usd;
    if (usd >= 500) { big500++; bigNet += side * usd; }
    if (usd >= 2000) big2k++;
  }
  const holders = [...bal.values()].filter((v) => v > 0).sort((a, b) => b - a);
  const held = holders.reduce((a, b) => a + b, 0) || 1;
  const share = (k: number) => holders.slice(0, k).reduce((a, b) => a + b, 0) / held;
  const t0 = E.length ? E[0][0] : callS;
  const earlyMakers = new Set(E.filter((e) => e[0] <= t0 + 60 && e[1] > 0).map((e) => e[2]));
  const earlyHeld = [...earlyMakers].reduce((a, m) => a + Math.max(0, bal.get(m) ?? 0), 0);
  const firstBlock = E.length ? E[0][8] : 0;
  const win = (s: number) => E.filter((e) => e[0] > callS - s);
  const buyersIn = (s: number) => new Set(win(s).filter((e) => e[1] > 0).map((e) => e[2])).size;
  const flowUsd = (s: number, side: number) => win(s).filter((e) => e[1] === side).reduce((a, e) => a + e[3], 0);
  const buyerAges = [...new Set(win(3600).filter((e) => e[1] > 0 && e[5] != null).map((e) => `${e[2]}|${e[5]}`))].map((k) => Number(k.split("|")[1]));
  Object.assign(f, {
    log_trades: Math.log1p(E.length), log_holders: Math.log1p(holders.length), log_unique_traders: Math.log1p(firstSeen.size),
    top1_share: share(1), top5_share: share(5), top10_share: share(10),
    hhi: holders.reduce((a, v) => a + (v / held) ** 2, 0),
    buy_sell_usd_ratio_all: Math.log((buyUsd + 1) / (sellUsd + 1)),
    wash_share: (washUsd) / (buyUsd + sellUsd + 1), sandwich_share: sandUsd / (buyUsd + sellUsd + 1),
    log_big500_trades: Math.log1p(big500), log_big2k_trades: Math.log1p(big2k), big_net_flow: Math.sign(bigNet) * Math.log1p(Math.abs(bigNet)),
    early_buyers_held_share: earlyHeld / held, log_first_block_buyers: Math.log1p(new Set(E.filter((e) => e[8] === firstBlock && e[1] > 0).map((e) => e[2])).size),
    log_buyers_5m: Math.log1p(buyersIn(300)), log_buyers_60m: Math.log1p(buyersIn(3600)),
    flow_ratio_5m: Math.log((flowUsd(300, 1) + 1) / (flowUsd(300, -1) + 1)), flow_ratio_60m: Math.log((flowUsd(3600, 1) + 1) / (flowUsd(3600, -1) + 1)),
    log_avg_buy_usd_60m: Math.log1p(flowUsd(3600, 1) / Math.max(1, win(3600).filter((e) => e[1] > 0).length)),
    fresh_wallet_share_60m: buyerAges.length ? buyerAges.filter((a) => a < 86400).length / buyerAges.length : 0.5,
    log_median_wallet_age_days: buyerAges.length ? Math.log1p(med(buyerAges) / 86400) : 0,
    log_age_h: Math.log1p(Math.max(0, callS - t0) / 3600), history_complete: ev.complete ? 1 : 0,
  });
  // ---- order-flow bar features before the call
  // Only minute bars that ENDED before the call: the bar containing the call includes post-call trades (leak fixed in run 2).
  const pre = flow.filter((b) => b[0] * 1000 + 60_000 <= c.call_ms);
  const pxAgo = (m: number) => { const b = [...pre].reverse().find((x) => x[0] * 1000 <= c.call_ms - m * M); return b ? b[4] : pre[0]?.[1] ?? p0; };
  const sum = (m: number, k: number) => pre.filter((b) => b[0] * 1000 > c.call_ms - m * M).reduce((a, b) => a + b[k], 0);
  const last = pre[pre.length - 1];
  const rets = pre.slice(-60).map((b, i, a) => (i ? Math.log(b[4] / a[i - 1][4]) : 0)).slice(1);
  Object.assign(f, {
    ret_5m: Math.log(p0 / pxAgo(5)), ret_15m: Math.log(p0 / pxAgo(15)), ret_60m: Math.log(p0 / pxAgo(60)),
    log_vol_15m: Math.log1p(sum(15, 5)), log_vol_60m: Math.log1p(sum(60, 5)),
    log_buyers_bars_15m: Math.log1p(sum(15, 9)), bar_buy_sell_ratio_15m: Math.log((sum(15, 11) + 1) / (sum(15, 12) + 1)),
    log_liquidity: Math.log1p(last?.[6] ?? 0), log_mcap: Math.log10(Math.max(1, p0 * 1e9)),
    volatility_60m: rets.length > 2 ? Math.sqrt(rets.reduce((a, r) => a + r * r, 0) / rets.length) : 0,
    caller_prior_calls: Math.log1p(ch.n), caller_prior_3x_rate: (ch.hits + 1) / (ch.n + 5),
    hour_sin: Math.sin((2 * Math.PI * new Date(c.call_ms).getUTCHours()) / 24), hour_cos: Math.cos((2 * Math.PI * new Date(c.call_ms).getUTCHours()) / 24),
  });
  for (const k of Object.keys(f)) if (!isFinite(f[k])) f[k] = 0;
  samples.push({ mint: c.mint, caller: c.caller, callMs: c.call_ms, y5: maxM >= 5, y3: maxM >= 3, dead: !!at6h && at6h.c / p0 < 0.3, f, complete: ev.complete });
}
const FEATS = Object.keys(samples[0].f);
const fit = samples.filter((s) => s.callMs < FIT_END), val = samples.filter((s) => s.callMs >= FIT_END && s.callMs < VAL_END), rec = samples.filter((s) => s.callMs >= VAL_END);
const rate = (s: Sample[], k: "y3" | "y5") => (s.length ? s.filter((x) => x[k]).length / s.length : NaN);

// ---- 1. univariate: quintiles set on fit, runner rates in fit and validation
const uni = FEATS.map((k) => {
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => { const v = fit.map((s) => s.f[k]).sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; });
  const qOf = (x: number) => cuts.filter((c) => x > c).length;
  const by = (set: Sample[]) => [0, 1, 2, 3, 4].map((q) => { const s = set.filter((x) => qOf(x.f[k]) === q); return { n: s.length, r3: +(100 * rate(s, "y3")).toFixed(1), r5: +(100 * rate(s, "y5")).toFixed(1) }; });
  const bf = by(fit), bv = by(val);
  const liftF = bf[4].r3 / Math.max(0.1, bf[0].r3), liftV = bv[4].r3 / Math.max(0.1, bv[0].r3);
  const consistent = (liftF >= 1.5 && liftV >= 1.5) || (liftF <= 1 / 1.5 && liftV <= 1 / 1.5);
  return { feature: k, fitQuintiles3x: bf.map((b) => b.r3), valQuintiles3x: bv.map((b) => b.r3), fitLiftTopVsBottom: +liftF.toFixed(2), valLiftTopVsBottom: +liftV.toFixed(2), consistent, cuts };
}).sort((a, b) => Math.abs(Math.log(b.valLiftTopVsBottom)) - Math.abs(Math.log(a.valLiftTopVsBottom)));

// ---- 2. model (label: 3x within 24 h), trained on fit
const X = (s: Sample) => FEATS.map((k) => s.f[k]);
const lr = trainLogistic(fit.map(X), fit.map((s) => s.y3));
const score = (s: Sample) => X(s).reduce((a, v, j) => a + ((v - lr.mu[j]) / lr.sd[j]) * lr.w[j], lr.b);
const model = { label: "reached 3x within 24 h", fitAuc: +auc(fit.map(score), fit.map((s) => s.y3)).toFixed(3), valAuc: +auc(val.map(score), val.map((s) => s.y3)).toFixed(3), recentAuc: +auc(rec.map(score), rec.map((s) => s.y3)).toFixed(3),
  weights: FEATS.map((k, j) => ({ feature: k, weight: +lr.w[j].toFixed(3) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 12) };

// ---- 3. entry filters x exits, chosen on fit, scored on validation and recent (same simulator as the debate)
const byMint = new Map(samples.map((s) => [s.mint, s]));
const fitScores = fit.map(score).sort((a, b) => a - b);
const consistentFeats = uni.filter((u) => u.consistent).slice(0, 3);
type Filter = { name: string; ok: (s: Sample) => boolean };
const filters: Filter[] = [
  { name: "all calls", ok: () => true },
  ...[0.7, 0.8, 0.9].map((q) => ({ name: `model top ${Math.round((1 - q) * 100)}%`, ok: (s: Sample) => score(s) >= fitScores[Math.floor(q * (fitScores.length - 1))] })),
  ...consistentFeats.map((u) => ({ name: `${u.feature} in its best fit quintile`, ok: (s: Sample) => (u.fitLiftTopVsBottom >= 1 ? s.f[u.feature] > u.cuts[3] : s.f[u.feature] <= u.cuts[0]) })),
];
if (consistentFeats.length >= 2) {
  const [a, b] = consistentFeats;
  const good = (u: typeof a, s: Sample) => (u.fitLiftTopVsBottom >= 1 ? s.f[u.feature] > u.cuts[2] : s.f[u.feature] <= u.cuts[1]);
  filters.push({ name: `${a.feature} and ${b.feature} both in their better half`, ok: (s) => good(a, s) && good(b, s) });
}
// Exits: the shared policy grid plus order-flow exits (sell when 5-minute sell volume overtakes buy volume after a gain).
const flowCache = new Map<string, number[][]>();
const flowOf = (mint: string) => { if (!flowCache.has(mint)) flowCache.set(mint, JSON.parse(readFileSync(resolve(DATA_DIR, "ohlcv", mint, "codex_flow_m1.json"), "utf8")).bars); return flowCache.get(mint)!; };
const flowExit = (minGain: number, ratio: number) => (ctx: HoldCtx) => {
  const now = ctx.post[ctx.post.length - 1].t;
  const w = flowOf(ctx.mint).filter((b) => b[0] * 1000 > now - 5 * M && b[0] * 1000 <= now);
  const bv = w.reduce((a, b) => a + b[11], 0), sv = w.reduce((a, b) => a + b[12], 0);
  const cur = ctx.post[ctx.post.length - 1].c;
  return cur >= ctx.entry * (1 + minGain) && sv > ratio * bv ? 1 : 0;
};
const exits: { name: string; exit: PolicySpec | ((c: HoldCtx) => number); hardStop?: number }[] = [
  ...POLICY_GRID.filter((p) => p.family !== "time" || p.hMin <= 1440).map((p) => ({ name: policyName(p), exit: p })),
  ...[0.3, 1].flatMap((g) => [1.5, 3].map((r) => ({ name: `flow exit: up ${g * 100}%+ and 5m sell vol > ${r}x buy vol, stop -35%`, exit: flowExit(g, r), hardStop: 0.35 }))),
];
const table: any[] = [];
for (const flt of filters) for (const ex of exits) {
  const strat: CallStrategy = { name: `${flt.name} | ${ex.name}`, maxWaitMin: 0, shouldEnter: (ctx) => { const s = byMint.get(ctx.mint); return !!s && flt.ok(s); }, exit: ex.exit, hardStop: ex.hardStop };
  const f = evaluate(strat, DATA_DIR, 0, FIT_END);
  if (f.entries < 30) continue;
  table.push({ filter: flt.name, exit: ex.name, strat, fit: { ...f, trades: undefined } });
}
table.sort((a, b) => (b.fit.trimmedMeanSol ?? -1) - (a.fit.trimmedMeanSol ?? -1));
const top = table.slice(0, 15).map((r) => {
  const v = evaluate(r.strat, DATA_DIR, FIT_END, VAL_END), t = evaluate(r.strat, DATA_DIR, VAL_END, DATA_END);
  const pick = (x: any) => ({ n: x.entries, mean: x.meanSol, trimmed: x.trimmedMeanSol, total: x.totalSol, withoutBest: x.totalWithoutBestSol, win: x.winRate, c5x: x.captured5x });
  return { filter: r.filter, exit: r.exit, fit: pick(r.fit), validation: pick(v), recent: pick(t) };
});

const out = { generated: new Date().toISOString(), universe: CALLERS ? [...CALLERS] : "all callers", samples: samples.length, skipped,
  baseRates: { fit3x: +(100 * rate(fit, "y3")).toFixed(1), val3x: +(100 * rate(val, "y3")).toFixed(1), fit5x: +(100 * rate(fit, "y5")).toFixed(1), val5x: +(100 * rate(val, "y5")).toFixed(1), fitN: fit.length, valN: val.length, recentN: rec.length },
  runnerVsRest: FEATS.map((k) => ({ feature: k, runners3x: +med(samples.filter((s) => s.y3).map((s) => s.f[k])).toFixed(3), rest: +med(samples.filter((s) => !s.y3).map((s) => s.f[k])).toFixed(3) })),
  univariate: uni, model, strategies: top, strategiesEvaluatedOnFit: table.length };
// Per-call scores from the fit-trained model (for robustness checks in research-runner-check.ts).
writeFileSync(resolve(OUT, "scores.json"), JSON.stringify({ thresholds: { top10: fitScores[Math.floor(0.9 * (fitScores.length - 1))], top20: fitScores[Math.floor(0.8 * (fitScores.length - 1))], top30: fitScores[Math.floor(0.7 * (fitScores.length - 1))] },
  calls: samples.map((s) => ({ mint: s.mint, caller: s.caller, callMs: s.callMs, score: score(s), y3: s.y3, y5: s.y5, trades: Math.round(Math.expm1(s.f.log_trades)), ageH: Math.expm1(s.f.log_age_h), complete: s.complete, liq: Math.expm1(s.f.log_liquidity) })) }));
writeFileSync(resolve(OUT, "results.json"), JSON.stringify(out, (k, v) => (k === "strat" ? undefined : v), 1));
console.log(JSON.stringify({ samples: out.samples, skipped, baseRates: out.baseRates }, null, 0));
console.log("\nfeatures ranked by validation lift (3x rate, top vs bottom fit-quintile) | fit quintiles | val quintiles | consistent");
for (const u of uni.slice(0, 16)) console.log(`  ${u.feature.padEnd(26)} fit ${String(u.fitLiftTopVsBottom).padStart(5)} val ${String(u.valLiftTopVsBottom).padStart(5)} | ${u.fitQuintiles3x.join(" ")} | ${u.valQuintiles3x.join(" ")} | ${u.consistent ? "YES" : ""}`);
console.log(`\nmodel AUC fit ${model.fitAuc} validation ${model.valAuc} recent ${model.recentAuc}; top weights: ${model.weights.slice(0, 6).map((w) => w.feature + " " + w.weight).join(", ")}`);
console.log("\nstrategies (top 15 on fit trimmed mean): fit n/trim | validation n/trim/total/w-o-best | recent n/trim/total");
for (const s of top) console.log(`  ${(s.filter + " | " + s.exit).slice(0, 88).padEnd(88)} ${s.fit.n}/${s.fit.trimmed} | ${s.validation.n}/${s.validation.trimmed}/${s.validation.total}/${s.validation.withoutBest} | ${s.recent.n}/${s.recent.trimmed}/${s.recent.total}`);
