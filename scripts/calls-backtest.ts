// Backtest of the Telegram group's calls over all Solana tokens (bonded or not), using GeckoTerminal bars
// cached by scripts/calls-fetch.ts. Searches pre-registered exit-policy families and entry filters on a
// training period, then scores the chosen combination once on a later test period (two splits).
//   npx tsx scripts/calls-backtest.ts
//
// Honesty rules (see research/calls-2026-09-30/REPORT.md):
// - Entry at the open of the first bar starting at or after the message time (never earlier).
// - Within a bar the stop is checked before the target (stop wins ties); gaps fill at the bar open.
// - Fees by venue, 0.003 SOL fixed per leg, price impact from bar volume; skip entries into near-empty bars.
// - Calls with no price data anywhere are reported, and also counted as -100% in a stress line.
// - Caller statistics used as features are computed only from that caller's earlier calls.
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, DATA_DIR } from "../packages/core/src/db.ts";
import { trainLogistic, auc } from "../packages/core/src/runnerModel.ts";
import { PolicyState, POLICY_GRID, policyName, venueFeePct, type PolicySpec } from "../packages/core/src/callPolicy.ts";

const CACHE = resolve(DATA_DIR, "ohlcv");
const argv = process.argv.slice(2);
const argOpt = (k: string) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : undefined; };
/** Optional universe: only calls by these callers (comma-separated, with @). */
const CALLERS = argOpt("callers") ? new Set(argOpt("callers")!.split(",").map((s) => s.trim())) : null;
const OUT = resolve(DATA_DIR, "..", argOpt("out") ?? "research/calls-2026-09-30");
mkdirSync(OUT, { recursive: true });
const POS_SOL = 0.1, FIXED_SOL = 0.003, HORIZON_MS = 72 * 3_600_000, ENTRY_WINDOW_MS = 10 * 60_000;
const SOL_USD = Number(process.env.SOL_USD ?? 0) || await solPrice();
const POS_USD = POS_SOL * SOL_USD;

async function solPrice(): Promise<number> {
  const f = resolve(CACHE, "_solusd.json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).usd;
  // DexScreener (separate rate limit from the GeckoTerminal fetch): the deepest SOL/USD-stable pair.
  const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112");
  const pairs = ((await r.json()) as any[]).filter((p) => ["USDC", "USDT"].includes(p.quoteToken?.symbol)).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const usd = Number(pairs[0]?.priceUsd);
  if (!usd) throw new Error("could not read the SOL price; set SOL_USD");
  writeFileSync(f, JSON.stringify({ usd, at: new Date().toISOString() }));
  return usd;
}

// ------------------------------------------------------------------ bars
interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; res: number; venue: string; liq?: number }
const feeFor = venueFeePct;

/** Codex token-level bars (all pools aggregated; includes pool liquidity). Preferred when present. */
function loadCodex(mint: string): { bars: Bar[]; firstBarMs: number | null; hasCurve: boolean } | null {
  const dir = resolve(CACHE, mint);
  if (!existsSync(resolve(dir, "codex_meta.json"))) return null;
  const byT = new Map<number, Bar>();
  // Token-level bars do not say which pool traded; pump.fun mints pay ~1-1.25% on the curve and PumpSwap.
  const venue = mint.endsWith("pump") ? "pump-fun" : "other";
  for (const f of readdirSync(dir)) {
    const m = f.match(/^codex_m(1|15)_\d+\.json$/);
    if (!m) continue;
    const res = m[1] === "1" ? 60 : 900;
    for (const b of JSON.parse(readFileSync(resolve(dir, f), "utf8")).bars ?? []) {
      const t = b[0] * 1000;
      const bar: Bar = { t, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], liq: b[6] || undefined, res, venue };
      const prev = byT.get(t);
      if (!prev || prev.res > res) byT.set(t, bar);
    }
  }
  let bars = [...byT.values()].sort((a, b) => a.t - b.t);
  const minuteTimes = bars.filter((b) => b.res === 60).map((b) => b.t);
  if (minuteTimes.length) {
    const lo = minuteTimes[0], hi = minuteTimes[minuteTimes.length - 1];
    bars = bars.filter((b) => b.res === 60 || b.t + b.res * 1000 <= lo || b.t > hi);
  }
  return { bars, firstBarMs: bars.length ? bars[0].t : null, hasCurve: mint.endsWith("pump") };
}

function loadSeries(mint: string): { bars: Bar[]; firstBarMs: number | null; hasCurve: boolean } | null {
  const codex = loadCodex(mint);
  if (codex) return codex;
  const dir = resolve(CACHE, mint);
  if (!existsSync(resolve(dir, "meta.json"))) return null;
  const meta = JSON.parse(readFileSync(resolve(dir, "meta.json"), "utf8"));
  const pools: { addr: string; venue: string; from: number }[] = [];
  if (meta.curve) pools.push({ addr: meta.curve, venue: "pump-fun", from: 0 });
  if (meta.main) pools.push({ addr: meta.main.address, venue: meta.main.dex, from: meta.curve ? meta.main.created : 0 });
  const byT = new Map<number, Bar>();
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(.+)_m(1|15)_\d+\.json$/);
    if (!m) continue;
    const pool = pools.find((p) => p.addr === m[1]);
    if (!pool) continue;
    const j = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
    const res = m[2] === "1" ? 60 : 900;
    for (const b of j?.data?.attributes?.ohlcv_list ?? []) {
      const t = b[0] * 1000;
      // Stitch: bonding curve until the main pool exists, then the main pool. Prefer minute bars.
      if (meta.curve && pool.venue === "pump-fun" && meta.main && t >= meta.main.created) continue;
      if (meta.curve && pool.venue !== "pump-fun" && t < meta.main.created) continue;
      const bar: Bar = { t, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], res, venue: pool.venue };
      const prev = byT.get(t);
      if (!prev || (prev.res > res)) byT.set(t, bar);
    }
  }
  let bars = [...byT.values()].sort((a, b) => a.t - b.t);
  // Drop 15-minute bars that overlap minute coverage.
  const minuteTimes = bars.filter((b) => b.res === 60).map((b) => b.t);
  if (minuteTimes.length) {
    const lo = minuteTimes[0], hi = minuteTimes[minuteTimes.length - 1];
    bars = bars.filter((b) => b.res === 60 || b.t + b.res * 1000 <= lo || b.t > hi);
  }
  return { bars, firstBarMs: bars.length ? bars[0].t : null, hasCurve: !!meta.curve };
}

// ------------------------------------------------------------------ policies (shared with the live call trader)
type Policy = { name: string; family: string; spec: PolicySpec; run: (path: Bar[], entry: number, entryMs: number) => { exitPx: number; frac: number; atMs: number; bar: Bar }[] };
const POLICIES: Policy[] = POLICY_GRID.map((spec) => ({
  name: policyName(spec), family: spec.family, spec,
  run: (path, entry, entryMs) => {
    const st = new PolicyState(spec, entry, entryMs);
    const out: { exitPx: number; frac: number; atMs: number; bar: Bar }[] = [];
    for (const b of path) {
      for (const f of st.onBar(b)) out.push({ exitPx: f.px, frac: f.frac, atMs: f.t, bar: b });
      if (st.done) return out;
    }
    const lb = path[path.length - 1];
    for (const f of st.close(lb)) out.push({ exitPx: f.px, frac: f.frac, atMs: f.t, bar: lb });
    return out;
  },
}));

// ------------------------------------------------------------------ calls and simulation
const db = openDb({ readOnly: true });
const allCalls = (db.prepare(`SELECT id, mint, caller, call_ms FROM manual_signals WHERE book='telegram' AND call_ms IS NOT NULL ORDER BY call_ms, id`).all() as { id: number; mint: string; caller: string; call_ms: number }[])
  .filter((c) => !CALLERS || CALLERS.has(c.caller));
// The book trades a token once: the group's first call on it.
const seenMint = new Set<string>();
const calls = allCalls.filter((c) => (seenMint.has(c.mint) ? false : (seenMint.add(c.mint), true)));
const cutoffMs = Date.now() - HORIZON_MS; // calls newer than this lack a full horizon
const impact = (usd: number, volUsd: number, liqUsd?: number) => Math.min(0.3, liqUsd && liqUsd > 0 ? usd / (usd + liqUsd / 2) : usd / (usd + 2 * Math.max(0, volUsd)));

interface Sample {
  id: number; mint: string; caller: string; callMs: number; status: "ok" | "no_data" | "no_entry" | "thin" | "not_fetched";
  entryMs?: number; entryPx?: number; entryBar?: Bar; path?: Bar[]; maxMult?: number; feats?: number[]; groupRateAtCall?: number;
}
// Point-in-time caller stats (label = reached 2x), filled in chronological order below.
const callerHist = new Map<string, { n: number; hits: number }>();
const samples: Sample[] = [];
let groupN = 0, groupHits = 0;
// Outcomes become known only after the horizon; they enter caller/group history at that time (no leakage).
const pending: { knownMs: number; caller: string; hit: boolean }[] = [];
function flushPending(now: number) {
  pending.sort((a, b) => a.knownMs - b.knownMs);
  while (pending.length && pending[0].knownMs <= now) {
    const p = pending.shift()!;
    const h = callerHist.get(p.caller) ?? { n: 0, hits: 0 };
    h.n++; if (p.hit) h.hits++;
    callerHist.set(p.caller, h);
    groupN++; if (p.hit) groupHits++;
  }
}
for (const c of calls) {
  if (c.call_ms > cutoffMs) continue;
  flushPending(c.call_ms);
  const s = loadSeries(c.mint);
  const base: Sample = { id: c.id, mint: c.mint, caller: c.caller, callMs: c.call_ms, status: "no_data" };
  if (!s) { samples.push({ ...base, status: "not_fetched" }); continue; }
  if (!s.bars.length) { samples.push(base); continue; }
  const i = s.bars.findIndex((b) => b.t >= c.call_ms);
  if (i < 0 || s.bars[i].t > c.call_ms + ENTRY_WINDOW_MS) { samples.push({ ...base, status: "no_entry" }); continue; }
  const eb = s.bars[i];
  if (eb.v < 3 * POS_USD && !(eb.liq && eb.liq > 20 * POS_USD)) { samples.push({ ...base, status: "thin" }); continue; }
  const path = s.bars.slice(i).filter((b) => b.t <= eb.t + HORIZON_MS);
  const maxMult = Math.max(...path.map((b) => b.h)) / eb.o;
  // features known at call time
  const pre = s.bars.slice(0, i);
  const pxAt = (ms: number) => { const b = [...pre].reverse().find((x) => x.t <= c.call_ms - ms); return b ? b.c : pre[0]?.o ?? eb.o; };
  const vol = (ms: number) => pre.filter((b) => b.t >= c.call_ms - ms).reduce((a, b) => a + b.v, 0);
  const ch = callerHist.get(c.caller) ?? { n: 0, hits: 0 };
  const groupRate = groupN ? groupHits / groupN : 0.2;
  const feats = [
    Math.log1p(Math.max(0, (c.call_ms - (s.firstBarMs ?? c.call_ms)) / 3_600_000)), // token age h
    Math.log10(Math.max(1, eb.o * 1e9)),                                              // mcap proxy (1B supply)
    eb.venue === "pump-fun" ? 1 : 0,                                                  // still on the bonding curve
    Math.log(eb.o / pxAt(5 * 60_000)), Math.log(eb.o / pxAt(60 * 60_000)), Math.log(eb.o / pxAt(6 * 3_600_000)),
    Math.log1p(vol(15 * 60_000)), Math.log1p(vol(60 * 60_000)),
    Math.sin((2 * Math.PI * new Date(c.call_ms).getUTCHours()) / 24), Math.cos((2 * Math.PI * new Date(c.call_ms).getUTCHours()) / 24),
    Math.log1p(ch.n), (ch.hits + 5 * groupRate) / (ch.n + 5),                         // caller history, smoothed, point-in-time
  ];
  samples.push({ ...base, status: "ok", entryMs: eb.t, entryPx: eb.o, entryBar: eb, path, maxMult, feats, groupRateAtCall: groupRate });
  pending.push({ knownMs: eb.t + HORIZON_MS, caller: c.caller, hit: maxMult >= 2 });
}
const FEATURE_NAMES = ["log_age_h", "log10_mcap_usd", "on_curve", "ret_5m", "ret_1h", "ret_6h", "log_vol_15m", "log_vol_1h", "hour_sin", "hour_cos", "log_caller_prior_calls", "caller_prior_2x_rate"];

function simulate(s: Sample, p: Policy) {
  const e = s.entryPx!, eb = s.entryBar!;
  const entryCostPct = feeFor(eb.venue) / 100 + impact(POS_USD, eb.v, eb.liq);
  const tokens = (POS_SOL * (1 - entryCostPct)) / e; // SOL-denominated notional; price moves apply proportionally
  let proceeds = 0, legs = 1;
  for (const f of p.run(s.path!, e, s.entryMs!)) {
    const px = f.exitPx, frac = f.frac;
    const gross = tokens * frac * px;
    proceeds += gross * (1 - feeFor(f.bar.venue) / 100 - impact(POS_USD * frac * (px / e), f.bar.v, f.bar.liq));
    legs++;
  }
  const pnl = proceeds - POS_SOL - FIXED_SOL * legs;
  return pnl;
}

// ------------------------------------------------------------------ selection, splits, reporting
type Filter = { name: string; pick: (train: Sample[]) => (s: Sample) => boolean };
const FILTERS: Filter[] = [
  { name: "all calls", pick: () => () => true },
  ...[0.5, 0.7].map((q) => ({ name: `model top ${Math.round((1 - q) * 100)}%`, pick: (train: Sample[]) => {
    const fit = trainLogistic(train.map((s) => s.feats!), train.map((s) => s.maxMult! >= 2));
    const score = (s: Sample) => s.feats!.reduce((a, v, j) => a + ((v - fit.mu[j]) / fit.sd[j]) * fit.w[j], fit.b);
    const th = train.map(score).sort((a, b) => a - b)[Math.floor(q * (train.length - 1))];
    return (s: Sample) => score(s) >= th;
  } })),
  { name: "proven callers (>=5 prior calls, 2x rate >= group)", pick: () => (s) => s.feats![10] >= Math.log1p(5) && s.feats![11] >= s.groupRateAtCall! },
];

const stats = (v: number[]) => {
  const n = v.length, sum = v.reduce((a, b) => a + b, 0), sorted = [...v].sort((a, b) => a - b);
  const best = n ? sorted[n - 1] : 0;
  const boot: number[] = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 1000 && n; k++) { let s2 = 0; for (let i = 0; i < n; i++) s2 += v[Math.floor(rnd() * n)]; boot.push(s2 / n); }
  boot.sort((a, b) => a - b);
  const trimmed = n > 4 ? sorted.slice(0, n - 2) : sorted; // drop the two best trades: no single lottery ticket decides
  return { n, totalSol: +sum.toFixed(4), meanSol: n ? +(sum / n).toFixed(5) : null, trimmedMeanSol: trimmed.length ? +(trimmed.reduce((a, b) => a + b, 0) / trimmed.length).toFixed(5) : null, winRate: n ? +(v.filter((x) => x > 0).length / n * 100).toFixed(1) : null,
    medianSol: n ? +sorted[Math.floor(n / 2)].toFixed(5) : null, bestSol: +best.toFixed(4), totalWithoutBestSol: +(sum - best).toFixed(4),
    meanCI95: n ? [+boot[25].toFixed(5), +boot[974].toFixed(5)] : null };
};

function constrained(sel: Sample[], p: Policy, maxOpen = 10) {
  const open: number[] = []; const pnl: number[] = []; let skipped = 0;
  for (const s of sel) {
    for (let i = open.length - 1; i >= 0; i--) if (open[i] <= s.callMs) open.splice(i, 1);
    if (open.length >= maxOpen) { skipped++; continue; }
    const fills = p.run(s.path!, s.entryPx!, s.entryMs!);
    open.push(fills[fills.length - 1].atMs);
    pnl.push(simulate(s, p));
  }
  return { ...stats(pnl), skippedFull: skipped };
}

const ok = samples.filter((s) => s.status === "ok");
const t0 = Math.min(...samples.map((s) => s.callMs)), t1 = Math.max(...samples.map((s) => s.callMs));
const at = (f: number) => t0 + (t1 - t0) * f;
const splits = [
  { name: "A: train first 50%, test next 25%", train: [t0, at(0.5)], test: [at(0.5), at(0.75)] },
  { name: "B: train first 75%, test last 25%", train: [t0, at(0.75)], test: [at(0.75), t1 + 1] },
];
const inRange = (s: Sample, r: number[]) => s.callMs >= r[0] && s.callMs < r[1];

let deployPick: { row: any; testScore: any } | null = null;
const DEPLOYABLE = new Set(["all calls", "proven callers (>=5 prior calls, 2x rate >= group)"]);
const result: any = {
  generated: new Date().toISOString(), solUsd: SOL_USD, positionSol: POS_SOL, horizonHours: HORIZON_MS / 3_600_000,
  coverage: {
    firstCalls: calls.length, withFullHorizon: samples.length,
    ok: ok.length, noData: samples.filter((s) => s.status === "no_data").length, notFetched: samples.filter((s) => s.status === "not_fetched").length,
    noEntry: samples.filter((s) => s.status === "no_entry").length, thin: samples.filter((s) => s.status === "thin").length,
    from: new Date(t0).toISOString(), to: new Date(t1).toISOString(),
  },
  outcomeDistribution: (() => {
    const m = ok.map((s) => s.maxMult!);
    const f = (x: number) => +(m.filter((v) => v >= x).length / Math.max(1, m.length) * 100).toFixed(1);
    return { reached1_5x: f(1.5), reached2x: f(2), reached5x: f(5), reached10x: f(10), reached100x: f(100), medianMaxMult: +[...m].sort((a, b) => a - b)[Math.floor(m.length / 2)]?.toFixed(2) };
  })(),
  perCaller: [...new Set(ok.map((s) => s.caller))].map((c) => {
    const mine = samples.filter((s) => s.caller === c), o = mine.filter((s) => s.status === "ok");
    return { caller: c, calls: mine.length, withData: o.length, reached2xPct: o.length ? +(o.filter((s) => s.maxMult! >= 2).length / o.length * 100).toFixed(1) : null,
      reached5xPct: o.length ? +(o.filter((s) => s.maxMult! >= 5).length / o.length * 100).toFixed(1) : null };
  }).sort((a, b) => b.calls - a.calls),
  splits: [] as any[],
};

for (const sp of splits) {
  const train = ok.filter((s) => inRange(s, sp.train)), test = ok.filter((s) => inRange(s, sp.test));
  const table: any[] = [];
  for (const f of FILTERS) {
    let pick: (s: Sample) => boolean;
    try { pick = f.pick(train); } catch { continue; }
    const tr = train.filter(pick);
    for (const p of POLICIES) {
      const v = tr.map((s) => simulate(s, p));
      table.push({ filter: f.name, policy: p.name, family: p.family, ...stats(v), _f: f, _p: p, _pick: pick });
    }
  }
  // Selection criterion (changed after the first run, which picked outlier-driven policies): trimmed mean.
  const eligible = table.filter((r) => r.n >= 30).sort((a, b) => b.trimmedMeanSol - a.trimmedMeanSol);
  const chosen = eligible[0];
  const bestPerFamily = [...new Set(table.map((r) => r.family))].map((fam) => eligible.find((r) => r.family === fam)).filter(Boolean);
  const scoreOnTest = (r: any) => {
    const sel = test.filter(r._pick);
    const pnl = sel.map((s) => simulate(s, r._p));
    // stress: calls with no data at all, if selected by "all calls", counted as a total loss
    const nd = r.filter === "all calls" ? samples.filter((s) => s.status === "no_data" && inRange(s, sp.test)).length : 0;
    return { ...stats(pnl), noDataAsTotalLoss: stats([...pnl, ...Array(nd).fill(-(POS_SOL + FIXED_SOL))]), constrained1Sol: constrained(sel, r._p) };
  };
  const strip = (r: any) => { const { _f, _p, _pick, ...rest } = r; return rest; };
  if (sp.name.startsWith("B")) {
    const d = eligible.find((r) => DEPLOYABLE.has(r.filter));
    if (d) deployPick = { row: d, testScore: scoreOnTest(d) };
  }
  const allCallsBaseline = table.filter((r) => r.filter === "all calls").sort((a, b) => b.meanSol - a.meanSol)[0];
  result.splits.push({
    name: sp.name, trainCalls: train.length, testCalls: test.length,
    trainRange: sp.train.map((x) => new Date(x).toISOString()), testRange: sp.test.map((x) => new Date(x).toISOString()),
    chosenOnTrain: chosen ? strip(chosen) : null,
    chosenOnTest: chosen ? scoreOnTest(chosen) : null,
    bestPerFamilyTrain: bestPerFamily.map(strip),
    bestPerFamilyTest: bestPerFamily.map((r: any) => ({ filter: r.filter, policy: r.policy, test: scoreOnTest(r) })),
    bestAllCallsPolicyTest: allCallsBaseline ? { policy: allCallsBaseline.policy, train: strip(allCallsBaseline), test: scoreOnTest(allCallsBaseline) } : null,
    top10Train: eligible.slice(0, 10).map(strip),
    // Diagnostic only (never used for selection): every combination's test result.
    testMatrix: table.map((r) => { const t = test.filter(r._pick).map((s2) => simulate(s2, r._p)); const st = stats(t); return { filter: r.filter, policy: r.policy, trainMean: r.meanSol, trainTrimmed: r.trimmedMeanSol, testN: st.n, testMean: st.meanSol, testTrimmed: st.trimmedMeanSol, testTotal: st.totalSol }; }),
  });
}
// Model weights on the full sample (descriptive only)
if (ok.length > 50) {
  const fit = trainLogistic(ok.map((s) => s.feats!), ok.map((s) => s.maxMult! >= 2));
  const score = (s: Sample) => s.feats!.reduce((a, v, j) => a + ((v - fit.mu[j]) / fit.sd[j]) * fit.w[j], fit.b);
  result.modelAllData = { label: "reached 2x from entry within 72 h", inSampleAuc: +auc(ok.map(score), ok.map((s) => s.maxMult! >= 2)).toFixed(3),
    weights: FEATURE_NAMES.map((n, j) => ({ feature: n, weight: +fit.w[j].toFixed(3) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)) };
}
writeFileSync(resolve(OUT, "results.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ coverage: result.coverage, outcomes: result.outcomeDistribution, splits: result.splits.map((s: any) => ({ name: s.name, trainN: s.trainCalls, testN: s.testCalls, chosen: s.chosenOnTrain && { filter: s.chosenOnTrain.filter, policy: s.chosenOnTrain.policy, trainMean: s.chosenOnTrain.meanSol }, test: s.chosenOnTest && { n: s.chosenOnTest.n, mean: s.chosenOnTest.meanSol, total: s.chosenOnTest.totalSol, withoutBest: s.chosenOnTest.totalWithoutBestSol, ci: s.chosenOnTest.meanCI95 } })) }, null, 1));

// ------------------------------------------------------------------ deploy for the forward test
if (process.argv.includes("--deploy") && deployPick) {
  const path = resolve(DATA_DIR, "../config/call-strategy.json");
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  flushPending(Infinity);
  const allow = [...callerHist.entries()].filter(([, h]) => h.n >= 5 && h.hits / h.n >= (groupN ? groupHits / groupN : 0)).map(([c]) => c);
  const r = deployPick.row;
  const cfg = {
    version: (prev?.version ?? 0) + 1,
    name: `backtest ${new Date().toISOString().slice(0, 10)}`,
    positionSol: POS_SOL, maxOpen: 10, startSol: 1,
    policy: r._p.spec,
    filter: r.filter === "all calls" ? { type: "all" } : { type: "callers", allow },
    notes: `Chosen on split B training (${r.n} trades, mean ${r.meanSol} SOL/trade); split B test: ${deployPick.testScore.n} trades, mean ${deployPick.testScore.meanSol} SOL/trade, total ${deployPick.testScore.totalSol} SOL. Auto-deployed for the forward paper test; review research/calls-2026-09-30.`,
  };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`deployed ${path}: v${cfg.version} ${r.filter} / ${r.policy}`);
}
