// Run from the repository root:
// node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r1-experiment.ts
// Only the sealed snapshot is read. All outputs stay next to this script.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPLITS } from "./grid.ts"; // Read-only file caching; does not run Claude's grid.
import { evaluate, type CallCtx, type CallStrategy, type Trade } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";
import claude from "../proposals/claude-r1.ts";

const ROOT = resolve("research/debate-calls/2026-09-30T21-10-56");
const DATA = resolve(ROOT, "data");
const fixed: PolicySpec = { family: "fixed", tp: 100, sl: 50 };
const trail: PolicySpec = { family: "trailing", arm: 200, trail: 40, sl: 50 };
function flow(c: CallCtx) {
  // Use completed PRE-call minutes even when shouldEnter is called again.
  const f = c.flow.filter(b => b.t + 60_000 <= c.callMs);
  const recent = f.filter(b => b.t >= c.callMs - 5 * 60_000);
  return {
    n: f.reduce((a, b) => a + b.buys + b.sells, 0),
    bars: f.length,
    buy: recent.reduce((a, b) => a + b.buyVolUsd, 0),
    sell: recent.reduce((a, b) => a + b.sellVolUsd, 0),
    last: f.at(-1),
  };
}
const entries: [string, number, (c: CallCtx) => boolean][] = [
  ...[100, 300, 1000].map(limit => [`flow-${limit}`, 0, (c: CallCtx) => {
    const f = flow(c); return f.bars > 0 && f.n > 0 && f.n <= limit;
  }] as [string, number, (c: CallCtx) => boolean]),
  ["flow-1000-balanced", 0, c => {
    const f = flow(c); return f.n > 0 && f.n <= 1000 && f.buy > 0 && f.buy <= f.sell;
  }],
  ["consistent-young", 0, c => {
    const f = flow(c);
    return c.preTradesComplete && c.preTrades.length > 0 && c.preTrades.length <= 100 && f.bars > 0 && f.n <= 100;
  }],
  ["momentum-finished", 5, c => {
    const f = flow(c), last = c.post.at(-1);
    return !!f.last && !!last && last.res === 60 && last.t + 60_000 <= c.callMs + 5 * 60_000 && last.c >= f.last.c * 1.3;
  }],
];
export const candidates: CallStrategy[] = entries.flatMap(([name, maxWaitMin, shouldEnter]) =>
  [fixed, trail].map(exit => ({ name: `${name}/${exit.family}`, maxWaitMin, shouldEnter, exit })));
const controls: CallStrategy[] = [
  { name: "live", maxWaitMin: 0, shouldEnter: c => c.preTrades.length <= 100, exit: fixed },
  { name: "young-trail", maxWaitMin: 0, shouldEnter: c => c.preTrades.length <= 100, exit: trail },
  { name: "empty-events", maxWaitMin: 0, shouldEnter: c => c.preTrades.length === 0, exit: fixed },
  { name: "nonempty-young", maxWaitMin: 0, shouldEnter: c => c.preTrades.length > 0 && c.preTrades.length <= 100, exit: fixed },
  claude,
];
const results: any[] = [];
function run(s: CallStrategy, split: typeof SPLITS[number]) {
  const [name, from, to] = split;
  const r = evaluate(s, DATA, from, to);
  results.push({ split: name, ...r });
  const { trades, ...summary } = r;
  console.log(JSON.stringify({ split: name, ...summary }));
  writeFileSync(resolve(ROOT, "work/codex-r1-results.json"), JSON.stringify(results, null, 2));
  return r;
}
// Fit selection is frozen before this script evaluates either later split.
const fit = candidates.map(s => ({ s, r: run(s, SPLITS[0]) }));
const passing = fit.filter(x => x.r.entries >= 30 && (x.r.trimmedMeanSol ?? -Infinity) > 0 && x.r.totalWithoutBestSol > 0)
  .sort((a, b) => b.r.trimmedMeanSol! - a.r.trimmedMeanSol!);
const selected = passing[0]?.s.name ?? "abstain";
writeFileSync(resolve(ROOT, "work/codex-r1-selection.json"), JSON.stringify({
  selected, criterion: "n >= 30, positive fit trimmed mean and total without best; highest fit trimmed mean, else abstain",
  candidateCount: candidates.length, passing: passing.map(x => x.s.name),
  caveat: "Entry hypotheses and two exits were specified after reading Claude's round 1; neither later split is pristine.",
}, null, 2));
console.log("FROZEN SELECTION", selected);
for (const s of candidates) for (const split of SPLITS.slice(1)) run(s, split);
for (const s of controls) for (const split of SPLITS) run(s, split);

function summary(ts: Trade[]) {
  const v = ts.map(t => t.pnlSol).sort((a, b) => a - b), n = v.length;
  const total = v.reduce((a, b) => a + b, 0), trim = n > 4 ? v.slice(0, -2) : v;
  return { n, mean: n ? total / n : null, trim: trim.length ? trim.reduce((a, b) => a + b, 0) / trim.length : null,
    total, withoutBest: total - (v.at(-1) ?? 0), winRate: n ? 100 * v.filter(x => x > 0).length / n : null,
    captured5x: ts.filter(t => t.realizedMult >= 5).length, captured10x: ts.filter(t => t.realizedMult >= 10).length };
}
const concentrations: any[] = [];
for (const r of results.filter(r => ["live", "young-trail"].includes(r.strategy))) {
  for (const group of ["caller", "day"] as const) {
    const key = (t: Trade) => group === "caller" ? t.caller : new Date(t.callMs).toISOString().slice(0, 10);
    const keys = [...new Set<string>(r.trades.map(key))];
    const groups = keys.map(k => ({ key: k, ...summary(r.trades.filter((t: Trade) => key(t) === k)) })).sort((a, b) => b.total - a.total);
    const best = groups[0];
    concentrations.push({ strategy: r.strategy, split: r.split, group, groups,
      excludingBestGroup: best ? { key: best.key, ...summary(r.trades.filter((t: Trade) => key(t) !== best.key)) } : null });
  }
}
const audit: any[] = [];
for (const [split, from, to] of SPLITS) {
  const rows: any[] = [];
  evaluate({ name: "audit", maxWaitMin: 0, shouldEnter(c) {
    if (!c.post.length) {
      const f = flow(c);
      rows.push({ mint: c.mint, events: c.preTrades.length, complete: c.preTradesComplete, flow: f.n,
        unfinishedPre: c.pre.filter(b => b.t + b.res * 1000 > c.callMs).length });
    }
    return false;
  }, exit: fixed }, DATA, from, to);
  const empty = rows.filter(r => r.events === 0), counts = empty.map(r => r.flow).sort((a,b) => a-b);
  audit.push({ split, n: rows.length, emptyN: empty.length,
    emptyComplete: empty.filter(r => r.complete).length,
    emptyDespiteFlowOver100: empty.filter(r => r.flow > 100).length,
    medianFlowForEmpty: counts[Math.floor(counts.length / 2)],
    unfinishedPreCalls: rows.filter(r => r.unfinishedPre > 0).length });
}
writeFileSync(resolve(ROOT, "work/codex-r1-audit.json"), JSON.stringify({ audit, concentrations }, null, 2));
console.log("AUDIT", JSON.stringify(audit));
