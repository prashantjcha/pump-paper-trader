// Early-runner model: scores a launch a few seconds after creation and predicts whether a
// 0.1 SOL entry can reach +25% after all costs. Shared by research, training and the live bot
// so features are computed identically everywhere.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./db.ts";
import type { ExitParams } from "./config.ts";
import { Tracker, features, type Features } from "./tokenState.ts";
import { buyQuote, sellQuote, solToLamports, type Reserves } from "./curve.ts";
import { readRaw } from "./rawio.ts";
import type { PumpEvent } from "./events.ts";

export const RUNNER_MODEL_PATH = process.env.PF_RUNNER_MODEL_PATH ?? resolve(ROOT, "config/runner-model.json");

export const RUNNER_FEATURES: [string, (f: Features) => number][] = [
  ["log_solRaised", (f) => Math.log1p(Math.max(0, f.solRaised))],
  ["log_buysW", (f) => Math.log1p(f.buysW)], ["log_sellsW", (f) => Math.log1p(f.sellsW)],
  ["log_uniqueBuyersW", (f) => Math.log1p(f.uniqueBuyersW)],
  ["netInflowW", (f) => Math.sign(f.netInflowW) * Math.log1p(Math.abs(f.netInflowW))],
  ["log_bsRatioW", (f) => Math.log1p(f.bsRatioW)], ["log_buys5s", (f) => Math.log1p(f.buys5s)],
  ["log_buyVol10", (f) => Math.log1p(f.buyVol10)], ["log_buyVolPrev10", (f) => Math.log1p(f.buyVolPrev10)],
  ["netFlow10", (f) => Math.sign(f.netFlow10) * Math.log1p(Math.abs(f.netFlow10))],
  ["log_lastBuyAgoS", (f) => Math.log1p(Math.min(f.lastBuyAgoS, 120))],
  ["log_devBuySol", (f) => Math.log1p(f.devBuySol)], ["devHoldPct", (f) => f.devHoldPct], ["devSold", (f) => (f.devSold ? 1 : 0)],
  ["sameSlotBuyers", (f) => Math.min(f.sameSlotBuyers, 10)], ["top1Pct", (f) => f.top1Pct], ["top10Pct", (f) => f.top10Pct],
  ["log_holders", (f) => Math.log1p(f.holders)], ["log_tradeCount", (f) => Math.log1p(f.tradeCount)],
  ["log_uniqueTraders", (f) => Math.log1p(f.uniqueTraders)], ["solPerTrade", (f) => Math.min(f.solPerTrade, 2)],
  ["log_peakMult", (f) => Math.log(Math.max(1, f.peakMult))], ["drawFromPeakPct", (f) => f.drawFromPeakPct],
  ["creatorPriorLaunches", (f) => Math.min(f.creatorPriorLaunches, 10)],
  ["hour_sin", (f) => Math.sin((2 * Math.PI * f.hourUtc) / 24)], ["hour_cos", (f) => Math.cos((2 * Math.PI * f.hourUtc) / 24)],
];

export interface RunnerModel {
  version: number;
  trainedAt: number; trainFrom: number; trainTo: number;
  snapshotS: number; windowS: number; label: string;
  features: string[]; mu: number[]; sd: number[]; w: number[]; b: number;
  /** Buy when score >= threshold (the training-score quantile below). */
  threshold: number; thresholdQuantile: number;
  exit: ExitParams;
  stats: Record<string, unknown>;
}

/** Exit rule chosen on training data in research/runners-2026-09-30: +50% net TP, -15% price stop, 180 s. */
export function runnerExit(): ExitParams {
  return {
    tpRisingPct: 50, tpFlatPct: 50, tpFallingPct: 50,
    trailArmPct: 1e9, trailPct: 100,                 // no trailing stop
    slBasePct: 15, slTightPct: 15, noBuyTightenS: 1e9, bsTightenRatio: 0, // no tightening
    bigSellSol: 1e9, bigSellSupplyPct: 100, timeStopS: 180, maxProgressPct: 95,
    exitOnDevSell: false, exitOnSmartExit: false,
  };
}

export const vectorize = (f: Features) => RUNNER_FEATURES.map(([, g]) => g(f));

export function scoreRunner(m: RunnerModel, f: Features): number {
  const x = vectorize(f);
  let z = m.b;
  for (let j = 0; j < x.length; j++) z += ((x[j] - m.mu[j]) / m.sd[j]) * m.w[j];
  return z;
}

export function loadRunnerModel(path = RUNNER_MODEL_PATH): RunnerModel | null {
  if (!existsSync(path)) return null;
  try {
    const m = JSON.parse(readFileSync(path, "utf8")) as RunnerModel;
    if (m.features.join() !== RUNNER_FEATURES.map(([n]) => n).join()) return null; // stale feature set
    return m;
  } catch { return null; }
}

export function saveRunnerModel(m: RunnerModel, path = RUNNER_MODEL_PATH) {
  writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
  const hist = resolve(ROOT, "config/runner-models");
  mkdirSync(hist, { recursive: true });
  writeFileSync(resolve(hist, `v${m.version}.json`), JSON.stringify(m, null, 2) + "\n");
}

/** Class-balanced L2 logistic regression by batch gradient descent on standardized inputs. */
export function trainLogistic(X: number[][], y: boolean[], iters = 800, lr = 0.1, l2 = 0.01) {
  const k = X[0].length;
  const mu = Array.from({ length: k }, (_, j) => X.reduce((a, x) => a + x[j], 0) / X.length);
  const sd = Array.from({ length: k }, (_, j) => Math.sqrt(X.reduce((a, x) => a + (x[j] - mu[j]) ** 2, 0) / X.length) || 1);
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]) / sd[j]));
  const pos = y.filter(Boolean).length;
  const wPos = pos ? y.length / (2 * pos) : 1, wNeg = y.length / (2 * Math.max(1, y.length - pos));
  const w = new Array(k).fill(0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(k).fill(0);
    let gb = 0;
    for (let i = 0; i < Z.length; i++) {
      let z = b;
      for (let j = 0; j < k; j++) z += Z[i][j] * w[j];
      const err = (1 / (1 + Math.exp(-z)) - (y[i] ? 1 : 0)) * (y[i] ? wPos : wNeg);
      for (let j = 0; j < k; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < k; j++) w[j] -= lr * (gw[j] / Z.length + l2 * w[j]);
    b -= (lr * gb) / Z.length;
  }
  return { mu, sd, w, b };
}

export function auc(scores: number[], y: boolean[]) {
  const idx = scores.map((s, i) => [s, y[i]] as const).sort((a, b) => a[0] - b[0]);
  let rank = 0, sumPos = 0, nPos = 0;
  for (const [, l] of idx) { rank++; if (l) { sumPos += rank; nPos++; } }
  const nNeg = idx.length - nPos;
  return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : NaN;
}

// ------------------------------------------------------------------ dataset from the raw archive

export interface RunnerRow { mint: string; atS: number; t: number; seg: number; f: Features; hit25: boolean; hit50: boolean; x2: boolean; maxNetPct: number; pol: Record<string, number> }
export interface ExitPolicy { name: string; tp: number; sl: number; hold: number }

/**
 * Streams the archive, takes point-in-time feature snapshots `snaps` seconds after each standard
 * launch, and labels each with what a 0.1 SOL entry `latencyMs` later could achieve within the horizon.
 * Recording gaps start a new segment; samples whose horizon crosses a gap are dropped.
 */
export function buildRunnerDataset(o: {
  from: number; to: number; snaps: number[]; horizonMs?: number; latencyMs?: number; positionSol?: number; fixedSol?: number;
  gapMs?: number; policies?: ExitPolicy[]; events?: Iterable<PumpEvent>;
}): { rows: RunnerRow[]; events: number; duplicates: number; segments: number } {
  const HORIZON = o.horizonMs ?? 300_000, LAT = o.latencyMs ?? 600, POS = o.positionSol ?? 0.1, FIXED = o.fixedSol ?? 0.003, GAP = o.gapMs ?? 30_000;
  const policies = o.policies ?? [];
  type Pt = { t: number; r: Reserves; fee: number };
  const paths = new Map<string, Pt[]>();
  const snapsOut: { mint: string; atS: number; t: number; f: Features; seg: number }[] = [];
  const segEnd: number[] = [];
  let tracker = new Tracker(15 * 60_000);
  const creatorHist = new Map<string, number[]>();
  const due: { t: number; mint: string; atS: number }[] = [];
  const seen = new Set<string>();
  let prevT = 0, seg = 0, events = 0, dups = 0;

  for (const e of o.events ?? readRaw(o.from, o.to)) {
    const key = `${e.sig}|${e.kind}|${e.mint}|${e.kind === "trade" ? `${e.user}|${e.tokens}|${e.isBuy}` : ""}`;
    if (seen.has(key)) { dups++; continue; }
    seen.add(key);
    if (seen.size > 2_000_000) seen.clear();
    if (prevT && e.recvMs - prevT > GAP) { segEnd[seg] = prevT; seg++; tracker = new Tracker(15 * 60_000); due.length = 0; }
    prevT = e.recvMs;
    events++;
    while (due.length && due[0].t <= e.recvMs) {
      const d = due.shift()!;
      const s = tracker.get(d.mint);
      if (!s || s.complete || !s.solQuote || s.mayhem) continue;
      snapsOut.push({ mint: d.mint, atS: d.atS, t: d.t, f: features(s, d.t, 15), seg });
    }
    const s = tracker.apply(e);
    if (e.kind === "create") {
      const h = (creatorHist.get(s.creator) ?? []).filter((x) => x > e.recvMs - 86_400_000);
      s.creatorPriorLaunches = h.length;
      h.push(e.recvMs); creatorHist.set(s.creator, h);
      if (e.solQuote && !e.mayhem) { for (const a of o.snaps) due.push({ t: e.recvMs + a * 1000, mint: e.mint, atS: a }); due.sort((a, b) => a.t - b.t); }
    }
    if (e.kind === "trade" && s.known && e.solQuote && !e.mayhem) {
      let p = paths.get(e.mint);
      if (!p) { p = []; paths.set(e.mint, p); }
      p.push({ t: e.recvMs, r: { ...s.reserves }, fee: s.feeBps });
    }
  }
  segEnd[seg] = prevT;

  const rows: RunnerRow[] = [];
  for (const sn of snapsOut) {
    const p = paths.get(sn.mint);
    if (!p) continue;
    const entryT = sn.t + LAT;
    if (entryT + HORIZON > segEnd[sn.seg]) continue;
    let i = 0;
    while (i + 1 < p.length && p[i + 1].t <= entryT) i++;
    if (p[i].t > entryT) continue;
    const r0 = p[i].r;
    const q = buyQuote(r0, solToLamports(POS), p[i].fee);
    if (q.tokens === 0n) continue;
    const cost = POS + FIXED;
    const liq = (r: Reserves, fee: number) => {
      const rr = { vSol: r.vSol + q.net, vTok: r.vTok - q.tokens, rTok: r.rTok - q.tokens };
      return rr.vTok > 0n ? Number(sellQuote(rr, q.tokens, fee).net) / 1e9 - FIXED : 0;
    };
    const base = liq(r0, p[i].fee);
    let maxNet = -100;
    const pol: Record<string, number> = {};
    for (let j = i; j < p.length && p[j].t <= entryT + HORIZON; j++) {
      const v = liq(p[j].r, p[j].fee);
      const net = (v / cost - 1) * 100;
      if (net > maxNet) maxNet = net;
      for (const P of policies) {
        if (pol[P.name] !== undefined) continue;
        if (net >= P.tp || v / base - 1 <= -P.sl / 100 || p[j].t - entryT >= P.hold * 1000) pol[P.name] = v - cost;
      }
    }
    for (const P of policies) if (pol[P.name] === undefined) {
      const last = p.filter((x) => x.t <= entryT + P.hold * 1000).at(-1)!;
      pol[P.name] = liq(last.r, last.fee) - cost;
    }
    rows.push({ ...sn, hit25: maxNet >= 25, hit50: maxNet >= 50, x2: maxNet >= 100, maxNetPct: maxNet, pol });
  }
  return { rows, events, duplicates: dups, segments: segEnd.length };
}

/** Trains a model on [from, to) and returns it (not saved). Returns null when there is too little data. */
export function trainRunnerModel(o: { from: number; to: number; version: number; snapshotS?: number; quantile?: number; minRows?: number; minPositives?: number }): RunnerModel | null {
  const snapshotS = o.snapshotS ?? 10, quantile = o.quantile ?? 0.95;
  const policy: ExitPolicy = { name: "live", tp: 50, sl: 15, hold: 180 };
  const ds = buildRunnerDataset({ from: o.from, to: o.to, snaps: [snapshotS], policies: [policy] });
  const rows = ds.rows;
  const positives = rows.filter((r) => r.hit25).length;
  if (rows.length < (o.minRows ?? 1000) || positives < (o.minPositives ?? 50)) return null;
  const X = rows.map((r) => vectorize(r.f));
  const y = rows.map((r) => r.hit25);
  const fit = trainLogistic(X, y);
  const model: RunnerModel = {
    version: o.version, trainedAt: Date.now(), trainFrom: rows[0].t, trainTo: rows[rows.length - 1].t,
    snapshotS, windowS: 15, label: "hit25: +25% net of all costs within 5 min of a 600 ms-delayed 0.1 SOL entry",
    features: RUNNER_FEATURES.map(([n]) => n), ...fit, threshold: 0, thresholdQuantile: quantile, exit: runnerExit(), stats: {},
  };
  const scores = rows.map((r) => scoreRunner(model, r.f));
  const sorted = [...scores].sort((a, b) => a - b);
  model.threshold = sorted[Math.floor(quantile * (sorted.length - 1))];
  const picked = rows.filter((_, i) => scores[i] >= model.threshold);
  model.stats = {
    rows: rows.length, positives, baseHit25Pct: +(100 * positives / rows.length).toFixed(1), trainAuc: +auc(scores, y).toFixed(3),
    picks: picked.length, picksHit25Pct: picked.length ? +(100 * picked.filter((r) => r.hit25).length / picked.length).toFixed(1) : null,
    picksExpectancySolInSample: picked.length ? +(picked.reduce((a, r) => a + r.pol.live, 0) / picked.length).toFixed(5) : null,
    note: "In-sample numbers. The live runner book measures this model only on data after trainTo.",
    events: ds.events, segments: ds.segments,
  };
  return model;
}
