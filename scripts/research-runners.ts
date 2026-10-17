// Runner study: can launches that will run be identified early enough to trade?
//
//   npx tsx scripts/research-runners.ts [--horizon-s 300] [--split 2026-09-30T12:55Z]
//
// For every standard launch (SOL curve, not Mayhem, creation observed), take feature snapshots
// at 10 s, 30 s and 60 s after creation using only events received before the snapshot. Label
// each snapshot with what a real 0.1 SOL trade entered 600 ms later could have achieved.
// Then (1) describe what separates runners from the rest and (2) train a logistic model on
// earlier data and test it on later data it never saw, trading only its top picks.
// Read-only: never touches the live strategy or database.
import { mkdirSync, writeFileSync } from "node:fs";
import { rawFiles } from "../packages/core/src/rawio.ts";
import type { Features } from "../packages/core/src/tokenState.ts";
import { buildRunnerDataset, trainLogistic, vectorize, auc, RUNNER_FEATURES, type RunnerRow } from "../packages/core/src/runnerModel.ts";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const HORIZON = Number(opt("horizon-s", "300")) * 1000;
const SPLIT = Date.parse(opt("split", "2026-09-30T12:55:00Z"));
const SNAPS = [10, 30, 60];
const LAT = 600, POS = 0.1, FIXED = 0.003; // latency ms, position SOL, priority+tip per leg
const GAP = 30_000;
const OUT = "research/runners-2026-09-30";
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------ dataset (shared with the live runner book)
const POLICIES = [
  { name: "tp25-sl15-180s", tp: 25, sl: 15, hold: 180 }, { name: "tp50-sl15-180s", tp: 50, sl: 15, hold: 180 },
  { name: "tp50-sl25-300s", tp: 50, sl: 25, hold: 300 }, { name: "tp100-sl25-300s", tp: 100, sl: 25, hold: 300 },
  { name: "tp100-sl35-300s", tp: 100, sl: 35, hold: 300 }, { name: "tp35-sl20-120s", tp: 35, sl: 20, hold: 120 },
  { name: "tp25-sl10-60s", tp: 25, sl: 10, hold: 60 },
];
const from = Date.parse("2026-09-30T00:00:00Z"), to = Number(opt("to-ms", String(Date.now())));
const ds = buildRunnerDataset({ from, to, snaps: SNAPS, horizonMs: HORIZON, latencyMs: LAT, positionSol: POS, fixedSol: FIXED, gapMs: GAP, policies: POLICIES });
type Row = RunnerRow & { policyPnlSol: number };
const rows: Row[] = ds.rows.map((r) => ({ ...r, policyPnlSol: r.pol["tp25-sl15-180s"] }));
const events = ds.events, dups = ds.duplicates;
const segEnd = { length: ds.segments };

function logistic(train: Row[], label: (r: Row) => boolean) {
  const fit = trainLogistic(train.map((r) => vectorize(r.f)), train.map(label));
  const score = (r: Row) => { const x = vectorize(r.f); let z = fit.b; for (let j = 0; j < x.length; j++) z += ((x[j] - fit.mu[j]) / fit.sd[j]) * fit.w[j]; return z; };
  return { score, weights: RUNNER_FEATURES.map(([n], j) => ({ feature: n, weight: +fit.w[j].toFixed(3) })).sort((a, c) => Math.abs(c.weight) - Math.abs(a.weight)) };
}

const pct = (x: number) => +(x * 100).toFixed(1);
const summary = (rs: Row[]) => {
  const n = rs.length, pnl = rs.reduce((a, r) => a + r.policyPnlSol, 0);
  return { n, hit25: n ? pct(rs.filter((r) => r.hit25).length / n) : null, hit50: n ? pct(rs.filter((r) => r.hit50).length / n) : null,
    x2: n ? pct(rs.filter((r) => r.x2).length / n) : null, policyWinRate: n ? pct(rs.filter((r) => r.policyPnlSol > 0).length / n) : null,
    policyExpectancySol: n ? +(pnl / n).toFixed(5) : null, policyTotalSol: +pnl.toFixed(4) };
};

// ------------------------------------------------------------ descriptive: runners vs the rest (30 s snapshot)
function describe(rs: Row[]) {
  const runners = rs.filter((r) => r.hit50), rest = rs.filter((r) => !r.hit50);
  const med = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length / 2)].toFixed(3) : null; };
  const keys: [string, (f: Features) => number][] = [
    ["solRaised", (f) => f.solRaised], ["uniqueBuyersW", (f) => f.uniqueBuyersW], ["buysW", (f) => f.buysW], ["sellsW", (f) => f.sellsW],
    ["netInflowW", (f) => f.netInflowW], ["bsRatioW", (f) => f.bsRatioW], ["buys5s", (f) => f.buys5s], ["buyVol10", (f) => f.buyVol10],
    ["devBuySol", (f) => f.devBuySol], ["devHoldPct", (f) => f.devHoldPct], ["sameSlotBuyers", (f) => f.sameSlotBuyers],
    ["top1Pct", (f) => f.top1Pct], ["top10Pct", (f) => f.top10Pct], ["holders", (f) => f.holders], ["peakMult", (f) => f.peakMult],
    ["drawFromPeakPct", (f) => f.drawFromPeakPct], ["creatorPriorLaunches", (f) => f.creatorPriorLaunches], ["lastBuyAgoS", (f) => f.lastBuyAgoS],
  ];
  const lift = (name: string, g: (f: Features) => number) => {
    const all = rs.map((r) => g(r.f)).sort((a, b) => a - b);
    const q = [0.2, 0.4, 0.6, 0.8].map((p) => all[Math.floor(p * (all.length - 1))]);
    const buckets = [0, 1, 2, 3, 4].map((k) => {
      const lo = k === 0 ? -Infinity : q[k - 1], hi = k === 4 ? Infinity : q[k];
      const b = rs.filter((r) => { const v = g(r.f); return v > lo && v <= hi || (k === 0 && v <= hi); });
      return { range: `${k === 0 ? "min" : +lo.toFixed(2)}..${k === 4 ? "max" : +hi.toFixed(2)}`, n: b.length, runnerRate: b.length ? pct(b.filter((r) => r.hit50).length / b.length) : null };
    });
    return { feature: name, buckets };
  };
  return {
    n: rs.length, runners: runners.length, baseRate: pct(runners.length / Math.max(1, rs.length)),
    medians: keys.map(([k, g]) => ({ feature: k, runners: med(runners.map((r) => g(r.f))), rest: med(rest.map((r) => g(r.f))) })),
    quintiles: keys.map(([k, g]) => lift(k, g)),
  };
}

// ------------------------------------------------------------ run
const result: any = {
  generated: new Date().toISOString(), events, duplicatesDropped: dups, segments: segEnd.length,
  coverage: rawFiles(from, to).length + " archive files", split: new Date(SPLIT).toISOString(),
  definitions: {
    entry: `snapshot + ${LAT} ms at recorded reserves, 0.1 SOL, curve fee from events, ${FIXED} SOL fixed per leg`,
    hit25: "net return after all costs reached +25% within the horizon", hit50: "reached +50% net (called a runner below)", x2: "reached +100% net",
    horizonS: HORIZON / 1000, policy: "exit at +25% net, or -15% price from post-fill liquidation value, or 180 s",
  },
  snapshots: {} as any,
};
for (const a of SNAPS) {
  const rs = rows.filter((r) => r.atS === a);
  const train = rs.filter((r) => r.t < SPLIT), test = rs.filter((r) => r.t >= SPLIT);
  const m = logistic(train, (r) => r.hit25);
  const scored = test.map((r) => ({ r, s: m.score(r) })).sort((x, y) => y.s - x.s);
  const top = (fr: number) => summary(scored.slice(0, Math.max(1, Math.round(scored.length * fr))).map((x) => x.r));
  const trainScored = train.map((r) => ({ r, s: m.score(r) })).sort((x, y) => y.s - x.s);
  const trainTop = (fr: number) => summary(trainScored.slice(0, Math.max(1, Math.round(trainScored.length * fr))).map((x) => x.r));
  result.snapshots[`${a}s`] = {
    all: summary(rs), train: summary(train), test: summary(test),
    model: {
      label: "hit25", trainAuc: +auc(train.map((r) => m.score(r)), train.map((r) => r.hit25)).toFixed(3),
      testAuc: +auc(test.map((r) => m.score(r)), test.map((r) => r.hit25)).toFixed(3),
      testTop1pct: top(0.01), testTop5pct: top(0.05), testTop10pct: top(0.1), testTop25pct: top(0.25),
      trainTop5pct: trainTop(0.05), weights: m.weights.slice(0, 12),
    },
    describe: a === 30 ? describe(rs) : undefined,
    activeOnly: (() => {
      const act = (r: Row) => r.f.uniqueBuyersW >= 3 && r.f.lastBuyAgoS < 10;
      const tr = train.filter(act), te = test.filter(act);
      const ma = logistic(tr, (r) => r.hit25);
      return { definition: ">=3 unique buyers in the last 15 s and a buy in the last 10 s", trainN: tr.length, testN: te.length,
        testBaseHit25: te.length ? pct(te.filter((r) => r.hit25).length / te.length) : null,
        testAuc: +auc(te.map((r) => ma.score(r)), te.map((r) => r.hit25)).toFixed(3) };
    })(),
    exitPolicies: (() => {
      const topTrain = trainScored.slice(0, Math.max(1, Math.round(trainScored.length * 0.05))).map((x) => x.r);
      const topTest = scored.slice(0, Math.max(1, Math.round(scored.length * 0.05))).map((x) => x.r);
      const ev = (rs2: Row[], name: string) => ({ n: rs2.length, expectancySol: rs2.length ? +(rs2.reduce((q, r) => q + r.pol[name], 0) / rs2.length).toFixed(5) : null,
        winRate: rs2.length ? pct(rs2.filter((r) => r.pol[name] > 0).length / rs2.length) : null });
      const table = POLICIES.map((P) => ({ policy: P.name, trainTop5: ev(topTrain, P.name), testTop5: ev(topTest, P.name) }));
      const chosen = [...table].sort((x, y) => (y.trainTop5.expectancySol ?? -1) - (x.trainTop5.expectancySol ?? -1))[0];
      return { chosenOnTrain: chosen.policy, chosenTest: chosen.testTop5, table };
    })(),
  };
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ events, dups, segments: segEnd.length, rows: rows.length, byWindow: Object.fromEntries(Object.entries(result.snapshots).map(([k, v]: any) => [k, { all: v.all, test: v.test, auc: [v.model.trainAuc, v.model.testAuc], top5: v.model.testTop5pct, top1: v.model.testTop1pct }])) }, null, 1));
