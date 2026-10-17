// Run from repo root with node --experimental-transform-types <this file>.
// Twelve declared candidates, fit-only selection frozen before later splits.
// grid.ts installs only a read cache; evaluate and PolicyState stay unchanged.
import { SPLITS } from "./grid.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, type CallCtx, type CallStrategy, type Trade } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";
import claude from "../proposals/claude-r2.ts";
import live from "../../examples/young-token.ts";

const ROOT = resolve("research/debate-calls/2026-09-30T21-10-56"), DATA = resolve(ROOT, "data");
const output = (file: string, obj: unknown) => writeFileSync(resolve(ROOT, "work", file), JSON.stringify(obj, null, 2));
function pre(c: CallCtx) { return c.flow.filter(b => b.t + 60_000 <= c.callMs); }
function count(c: CallCtx) { return pre(c).reduce((s, b) => s + b.buys + b.sells, 0); }
function confirm(c: CallCtx, breakout: boolean): boolean {
  const b = c.post.at(-1), before = pre(c), anchor = before.at(-1);
  if (!b || b.res !== 60 || !anchor || anchor.c <= 0) return false;
  const end = b.t + 60_000;
  if (end < c.callMs + 5 * 60_000 || end > c.callMs + 15 * 60_000) return false;
  const recent = c.flow.filter(f => f.t >= c.callMs && f.t >= end - 5 * 60_000 && f.t + 60_000 <= end);
  if (recent.length < 4) return false;
  const buys = recent.reduce((s, f) => s + f.buyVolUsd, 0), sells = recent.reduce((s, f) => s + f.sellVolUsd, 0);
  const highs = before.filter(f => f.t >= c.callMs - 15 * 60_000).map(f => f.h);
  const threshold = breakout ? Math.max(anchor.c, ...highs) : anchor.c;
  return buys > sells && b.c > threshold;
}
const entries: [string, number, (c: CallCtx) => boolean][] = [
  ["flow300", 0, c => c.post.length === 0 && count(c) > 0 && count(c) <= 300],
  ["flow1000-confirm", 15, c => count(c) > 0 && count(c) <= 1000 && confirm(c, false)],
  ["breakout-confirm", 15, c => confirm(c, true)],
];
const exits: [string, PolicySpec][] = [
  ["trail40", { family: "trailing", arm: 200, trail: 40, sl: 50 }],
  ["trail60", { family: "trailing", arm: 200, trail: 60, sl: 50 }],
  ["scale-half", { family: "scale-out", x: 100, trail: 60, sl: 50 }],
  ["stop25", { family: "trailing", arm: 200, trail: 40, sl: 25 }],
];
export const candidates: CallStrategy[] = entries.flatMap(([name, maxWaitMin, shouldEnter]) =>
  exits.map(([label, exit]) => ({ name: `${name}/${label}`, maxWaitMin, shouldEnter, exit })));
const controls: CallStrategy[] = [claude, live,
  { name: "all/trail40", maxWaitMin: 0, shouldEnter: () => true, exit: exits[0][1] },
];
const results: any[] = [];
function run(s: CallStrategy, [split, from, to]: typeof SPLITS[number]) {
  const r = evaluate(s, DATA, from, to);
  results.push({ split, ...r });
  output("codex-r2-results.json", results);
  const { trades, ...summary } = r;
  console.log(JSON.stringify({ split, ...summary }));
  return r;
}
const fit = candidates.map(s => ({ s, r: run(s, SPLITS[0]) }));
const passing = fit.filter(x => x.r.entries >= 30 && (x.r.trimmedMeanSol ?? -Infinity) > 0 && x.r.totalWithoutBestSol > 0)
  .sort((a, b) => b.r.trimmedMeanSol! - a.r.trimmedMeanSol!);
const selection = {
  selected: passing[0]?.s.name ?? "abstain", candidateCount: candidates.length,
  criterion: "n >= 30, positive fit trimmed mean and total without best; maximize fit trimmed mean, otherwise abstain",
  passing: passing.map(x => x.s.name),
  caveat: "Exploratory round 2 informed by previous rounds. Later splits already partly seen. No thresholds retuned after this run.",
};
output("codex-r2-selection.json", selection);
console.log("FROZEN SELECTION", JSON.stringify(selection));
for (const s of candidates) for (const split of SPLITS.slice(1)) run(s, split);
for (const s of controls) for (const split of SPLITS) run(s, split);

function summarize(ts: Trade[]) {
  const v = ts.map(t => t.pnlSol).sort((a, b) => a - b), n = v.length, total = v.reduce((a, b) => a + b, 0);
  const trimmed = n > 4 ? v.slice(0, -2) : v;
  return { n, mean: n ? total / n : null, trimmed: trimmed.length ? trimmed.reduce((a, b) => a + b, 0) / trimmed.length : null,
    total, withoutBest: total - (v.at(-1) ?? 0), winRate: n ? 100 * v.filter(x => x > 0).length / n : null,
    captured5x: ts.filter(t => t.realizedMult >= 5).length, captured10x: ts.filter(t => t.realizedMult >= 10).length };
}
const stress: any[] = [];
for (const r of results) {
  const ts = r.trades as Trade[];
  const exclusions = ["caller", "day"].map(kind => {
    const key = (t: Trade) => kind === "caller" ? t.caller : new Date(t.callMs).toISOString().slice(0, 10);
    const groups = [...new Set(ts.map(key))].map(k => ({ key: k, ...summarize(ts.filter(t => key(t) === k)) })).sort((a, b) => b.total - a.total);
    return { kind, groups, excludingBest: groups.length ? { key: groups[0].key, ...summarize(ts.filter(t => key(t) !== groups[0].key)) } : null };
  });
  stress.push({ strategy: r.strategy, split: r.split, exclusions, bestTrades: [...ts].sort((a,b) => b.pnlSol - a.pnlSol).slice(0, 3) });
}
output("codex-r2-stress.json", stress);
