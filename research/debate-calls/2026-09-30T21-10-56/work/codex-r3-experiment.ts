// Reproduce from repo root: node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r3-experiment.ts
// Uses the unchanged referee, with grid.ts's read cache only. All input is sealed.
import { SPLITS } from './grid.ts';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluate, type CallCtx, type HoldCtx, type CallStrategy, type Trade } from '../../../../scripts/lib/callsSim.ts';
import previous from '../proposals/codex-r2.ts';
import claude from '../proposals/claude-r3.ts';
import live from '../../examples/young-token.ts';

const ROOT = resolve('research/debate-calls/2026-09-30T21-10-56');
const DATA = resolve(ROOT, 'data');
const save = (name: string, value: unknown) => writeFileSync(resolve(ROOT, 'work', name), JSON.stringify(value, null, 2));
const finished = (c: CallCtx) => c.flow.filter(b => b.t + 60_000 <= c.callMs);
const count = (c: CallCtx) => finished(c).reduce((s, b) => s + b.buys + b.sells, 0);

function summarize(trades: Trade[]) {
  const v = trades.map(t => t.pnlSol).sort((a,b) => a-b), n = v.length;
  const total = v.reduce((a,b) => a+b, 0), trim = n > 4 ? v.slice(0,-2) : v;
  return { n, total, mean: n ? total/n : null, trimmed: trim.length ? trim.reduce((a,b) => a+b,0)/trim.length : null,
    withoutBest: total-(v.at(-1) ?? 0), winRate: n ? 100*v.filter(x => x>0).length/n : null,
    captured5x: trades.filter(t => t.realizedMult>=5).length, captured10x: trades.filter(t => t.realizedMult>=10).length };
}
function concentration(trades: Trade[]) {
  return ['caller','day'].map(kind => {
    const key = (t: Trade) => kind === 'caller' ? t.caller : new Date(t.callMs).toISOString().slice(0,10);
    const groups = [...new Set(trades.map(key))].map(k => ({ key:k, ...summarize(trades.filter(t => key(t)===k)) })).sort((a,b) => b.total-a.total);
    return { kind, groups, excludingBest: groups.length ? { key: groups[0].key, ...summarize(trades.filter(t => key(t)!==groups[0].key)) } : null };
  });
}
// Eight declared candidates: two existing activity caps x four exit modes.
// Fixed parameters, no search over caller/day identities. A next-open exit is
// deliberately used so a completed-bar signal cannot fill inside the same bar.
const modes = ['close-trail','timeout5','timeout15','sell-pressure'] as const;
type Mode = typeof modes[number];
function exit(mode: Mode, c: HoldCtx): number {
  const b = c.post.at(-1);
  if (!b) return 0;
  const end = b.t + b.res*1000;
  const entryMs = c.post[c.post.length-1].t-c.minutesHeld*60_000;
  if (c.peak >= 3*c.entry && b.c <= 0.6*c.peak) return 1;
  const deadline = mode === 'timeout5' ? 5 : mode === 'timeout15' ? 15 : null;
  if (deadline !== null && end-entryMs >= deadline*60_000 && c.peak < 1.3*c.entry) return 1;
  if (mode === 'sell-pressure' && end-entryMs >= 5*60_000 && b.c < c.entry) {
    const recent = c.flow.filter(f => f.t >= Math.max(entryMs,end-5*60_000) && f.t+60_000 <= end);
    if (recent.length >= 4 && recent.reduce((s,f) => s+f.sellVolUsd-f.buyVolUsd,0)>0) return 1;
  }
  return 0;
}
const candidates: CallStrategy[] = [300,1000].flatMap(cap => modes.map(mode => ({
  name: `flow${cap}/${mode}`, maxWaitMin: 0,
  shouldEnter(c: CallCtx) { const n=count(c); return c.post.length===0 && n>0 && n<=cap; },
  hardStop: 0.25, exit: (c: HoldCtx) => exit(mode,c),
})));
save('codex-r3-declaration.json', {
  candidates: candidates.map(s => s.name),
  criterion: 'Fit only: n>=30, positive trimmed and total without best; also n>=30 and positive trimmed after removing the highest-P&L caller AND after removing highest-P&L UTC day. Rank survivors by fit trimmed. Otherwise abstain.',
  parameters: { caps:[300,1000], hardStop:0.25, armMultiple:3, trailingFraction:0.4, timeoutMinutes:[5,15], requiredEarlyPeak:1.3, pressureWindowMinutes:5, minimumFlowBars:4 },
  caveat: 'Exploratory final round informed by earlier rounds; validation/test already seen. No new claim of pristine validation. Stronger fit concentration gate is declared before this run.',
});
const results: any[] = [];
function run(s: CallStrategy, split: typeof SPLITS[number]) {
  const [name,from,to]=split, r=evaluate(s,DATA,from,to);
  const stress=concentration(r.trades);
  results.push({ split:name, ...r, stress });
  save('codex-r3-results.json',results);
  const {trades,...summary}=r;
  console.log(JSON.stringify({split:name,...summary}));
  return {s,r,stress};
}
const fit=candidates.map(s => run(s,SPLITS[0]));
const basic=fit.filter(x => x.r.entries>=30 && (x.r.trimmedMeanSol ?? -Infinity)>0 && x.r.totalWithoutBestSol>0);
const robust=basic.filter(x => x.stress.every(g => g.excludingBest && g.excludingBest.n>=30 && (g.excludingBest.trimmed ?? -Infinity)>0))
  .sort((a,b) => b.r.trimmedMeanSol!-a.r.trimmedMeanSol!);
const selection={ selected:robust[0]?.s.name ?? 'abstain', basicPassing:basic.map(x => x.s.name), robustPassing:robust.map(x => x.s.name) };
save('codex-r3-selection.json',selection);
console.log('FROZEN SELECTION',JSON.stringify(selection));
for (const s of candidates) for (const split of SPLITS.slice(1)) run(s,split);
const controls: CallStrategy[] = [previous,claude,live,
  { name:'flow0-100/fixed',maxWaitMin:0,shouldEnter:c => c.post.length===0 && count(c)<=100,exit:{family:'fixed',tp:100,sl:50}},
];
for (const s of controls) for (const split of SPLITS) run(s,split);

// Quantify why completed recent flow is a proxy, not a lifetime launch count.
const audit: any[]=[];
for (const [split,from,to] of SPLITS) {
  const rows: any[]=[];
  evaluate({name:'audit',maxWaitMin:0,shouldEnter(c) {
    if(c.post.length) return false;
    const pre=finished(c), n=count(c);
    const old=c.pre.filter(b => b.t+b.res*1000<=c.callMs-6*3_600_000 && b.v>0);
    const last=pre.at(-1);
    rows.push({mint:c.mint,callMs:c.callMs,flowTrades:n,flowBars:pre.length,events:c.preTrades.length,complete:c.preTradesComplete,
      oldActiveBars:old.length, lastFlowEnd:last ? last.t+60_000 : null,
      unfinishedPre:c.pre.filter(b => b.t+b.res*1000>c.callMs).length});
    return false;
  },exit:{family:'fixed',tp:100,sl:50}},DATA,from,to);
  const low=rows.filter(r => r.flowTrades<=100), event=rows.filter(r => r.events<=100);
  audit.push({split,n:rows.length,flowLow:low.length,eventLow:event.length,
    overlap:low.filter(r => r.events<=100).length,
    flowLowEventsOver100:low.filter(r => r.events>100).length,
    flowLowOldBars:low.filter(r => r.oldActiveBars>0).length,
    allOldBars:rows.filter(r => r.oldActiveBars>0).length,
    noFinishedFlow:rows.filter(r => r.flowBars===0).length,
    flowLowNoFinishedFlow:low.filter(r => r.flowBars===0).length,
    unfinishedPre:rows.filter(r => r.unfinishedPre>0).length,
    rows});
}
save('codex-r3-audit.json',audit);
console.log('AUDIT',JSON.stringify(audit.map(({rows,...a})=>a)));
