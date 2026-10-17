// Offline research only. Never changes the running strategy or writes to the live DB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readRaw, serialize } from '../packages/core/src/rawio.ts';
import { openDb } from '../packages/core/src/db.ts';
import { loadStrategy, DEFAULT_PARAMS, type StrategyParams } from '../packages/core/src/config.ts';
import { Engine, type Position } from '../packages/core/src/engine.ts';
import { summarize } from '../packages/core/src/replay.ts';
import { replayContext } from '../packages/core/src/replayContext.ts';
import type { PumpEvent } from '../packages/core/src/events.ts';
import { features, type TokenState } from '../packages/core/src/tokenState.ts';

const out = 'research/launches-2026-09-30';
mkdirSync(out, { recursive: true });
const cutoff = Number(process.env.RESEARCH_CUTOFF ?? Date.now());
const events = [...readRaw(Date.parse('2026-09-30T00:00:00Z'), cutoff)];
if (!events.length) throw new Error('No archived events');
const db = openDb({ readOnly: true });
const gaps: { from: number; to: number; seconds: number }[] = [];
for (let i = 1; i < events.length; i++) {
  const seconds = (events[i].recvMs - events[i-1].recvMs) / 1000;
  if (seconds > 30) gaps.push({ from: events[i-1].recvMs, to: events[i].recvMs, seconds });
}
const segments: PumpEvent[][] = [];
let start = 0;
for (let i = 1; i <= events.length; i++) {
  if (i === events.length || events[i].recvMs - events[i-1].recvMs > 30_000) {
    segments.push(events.slice(start, i)); start = i;
  }
}
const audit = {
  cutoff: new Date(cutoff).toISOString(), events: events.length,
  corpusSha256: events.reduce((h,e)=>h.update(serialize(e)+'\n'),createHash('sha256')).digest('hex'),
  segments: segments.map(s => ({ from: new Date(s[0].recvMs).toISOString(), to: new Date(s.at(-1)!.recvMs).toISOString(), events: s.length, launches: s.filter(e => e.kind === 'create').length })),
  gaps, kinds: Object.fromEntries(['create','trade','complete'].map(k => [k, events.filter(e => e.kind === k).length])),
  mayhemLaunches: events.filter(e => e.kind === 'create' && e.mayhem).length,
  dbPositions: db.prepare('SELECT book,status,COUNT(*) n,SUM(pnl_sol) pnl FROM positions GROUP BY book,status').all(),
  dbCoverage: db.prepare('SELECT COUNT(*) n,MIN(recv_ms) first,MAX(recv_ms) last FROM trades_raw').get(),
};
writeFileSync(`${out}/audit.json`, JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
if (process.argv.includes('--audit')) { db.close(); process.exit(0); }

// Freeze the later segment as holdout before examining strategy results.
// A two-minute purge at each segment end leaves observed execution/exit data.
const train = segments.filter(s => s[0].recvMs < Date.parse('2026-09-30T10:00Z'));
const test = segments.filter(s => s[0].recvMs >= Date.parse('2026-09-30T10:00Z'));
if (!train.length || !test.length) throw new Error('Need both pre-10:00 and post-10:00 segments');
const baseline = loadStrategy(process.env.RESEARCH_STRATEGY_PATH);
class ResearchEngine extends Engine {
  conservative = true;
  gate = 'none';
  override holding(book: Parameters<Engine['holding']>[0], mint:string) {
    if (super.holding(book,mint)) return true;
    if(this.gate==='none') return false;
    const s=this.tracker.get(mint); if(!s) return true;
    const f=features(s,this.now,this.params.entry.windowS);
    if(this.gate==='acceleration') return !(f.buyVolPrev10>0 && f.buyVol10>=1.2*f.buyVolPrev10 && f.netFlow10>0 && f.drawFromPeakPct<=8);
    if(this.gate==='diverse-flow') {
      const trades=s.trades.filter(t=>t.t>=this.now-this.params.entry.windowS*1000);
      const buys=trades.filter(t=>t.isBuy).reduce((a,t)=>a+t.sol,0);
      const sells=trades.filter(t=>!t.isBuy).reduce((a,t)=>a+t.sol,0);
      return !(f.uniqueBuyersW/Math.max(1,f.buysW)>=0.7 && buys>=2.5*sells && f.drawFromPeakPct<=8);
    }
    if(this.gate==='pullback') return !(f.drawFromPeakPct>=5 && f.drawFromPeakPct<=20 && f.netFlow10>0 && s.trades.at(-1)?.isBuy && s.price>(s.trades.at(-2)?.price??Infinity));
    throw new Error('Unknown research gate '+this.gate);
  }
  // Missing PumpSwap data means post-graduation proceeds are unidentified.
  // Zero recovery is a stress bound, NOT an assertion that migrated tokens are worthless.
  override markValue(p: Position, s: TokenState) {
    if (this.conservative && s.complete) return 0;
    return super.markValue(p, s);
  }
}
function evaluate(params: StrategyParams, parts: PumpEvent[][], unlimited = true, conservative = true, seed = 7, gate = 'none') {
  const closed: Position[] = [], failed: Position[] = [], censored: Position[] = [];
  let hours = 0, count = 0;
  for (const evs of parts) {
    const first = evs[0].recvMs, last = evs.at(-1)!.recvMs;
    const ctx = replayContext(db, first);
    const engine = new ResearchEngine({ params: structuredClone(params), version: 0, books: ['momentum'], startSol: 1, seed, ...ctx,
      hooks: { onClose: p => closed.push({...p}), onFail: p => failed.push({...p}) } });
    engine.conservative = conservative;
    engine.gate = gate;
    engine.books.get('momentum')!.unlimited = unlimited;
    for (const c of ctx.seedCreators) engine.noteCreate(c.creator, c.t);
    let tick = first, evict = first;
    for (const e of evs) {
      while (tick < e.recvMs) { engine.advance(tick); tick += 250; }
      // Stop opening near the end; retain all market events to settle existing positions.
      if (e.recvMs >= last - 120_000) engine.params.entry.maxAgeS = -1;
      engine.onEvent(e);
      if (e.recvMs - evict > 60_000) { engine.evict(e.recvMs); evict = e.recvMs; }
    }
    // No artificial ten-minute forward jump priced using stale end-of-file reserves.
    censored.push(...[...engine.positions.values()].map(p => ({...p})));
    count += evs.length; hours += (last-first) / 3_600_000;
  }
  const stats = summarize(closed, failed, count, hours);
  // Correct PF and realized drawdown to include failed entry costs at their actual times.
  const ledger = [...closed.map(p => ({t:p.exitFillMs!,v:p.pnlSol!})), ...failed.map(p=>({t:p.fillMs,v:p.pnlSol!}))].sort((a,b)=>a.t-b.t);
  let sum=0, peak=0, dd=0, gp=0, gl=0;
  for (const x of ledger) { sum+=x.v; peak=Math.max(peak,sum); dd=Math.max(dd,peak-sum); if(x.v>0)gp+=x.v;else gl-=x.v; }
  const values=closed.map(p=>p.pnlSol!);
  const mean=values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
  const se=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,values.length-1)/Math.max(1,values.length));
  // Normal intervals are descriptive only: they ignore selection and correlated
  // launches. They are not evidence for deployment, especially in this small sample.
  return { stats:{...stats, profitFactor:gl?gp/gl:0, maxDrawdownSol:dd, censored:censored.length, meanClosed95Normal:[mean-1.96*se,mean+1.96*se], worstSol:Math.min(0,...values), bestSol:Math.max(0,...values), pnlWithoutBest:sum-Math.max(0,...values)}, closed, failed };
}
type Candidate = { name:string; params:StrategyParams; gate?:string };
const candidates:Candidate[] = [];
function add(name:string, entry:Partial<StrategyParams['entry']>={}, exit:Partial<StrategyParams['exit']>={}) {
  const params=structuredClone(baseline); Object.assign(params.entry,entry); Object.assign(params.exit,exit); candidates.push({name,params});
}
add('current'); candidates.push({name:'original-v1',params:structuredClone(DEFAULT_PARAMS)});
for(const age of [3,10,20,30]) for(const buyers of [5,8,12]) for(const bundle of [0,2])
  add(`age${age}-buyers${buyers}-bundle${bundle}`,{minAgeS:age,minUniqueBuyers:buyers,maxSameSlotBuyers:bundle});
for(const raised of [5,10,15]) add(`raised${raised}`,{minSolRaised:raised});
for(const n of [1,2,4]) add(`inflow${n}`,{minNetInflowSol:n});
for(const n of [1.5,4,6]) add(`ratio${n}`,{minBuySellRatio:n});
for(const n of [30,60,180]) add(`maxAge${n}`,{maxAgeS:n});
add('no-dev-min',{devBuyMin:0});
add('clean-creator',{maxCreatorPriorLaunches:0});
for(const hold of [15,30,60]) add(`hold${hold}`,{}, {timeStopS:hold});
for(const tp of [15,20,40,60]) add(`tp${tp}`,{}, {tpRisingPct:tp,tpFlatPct:Math.min(tp,50),tpFallingPct:Math.min(tp,40)});
add('trail-wide',{}, {trailArmPct:20,trailPct:15});
add('stop-wide',{}, {slBasePct:15,slTightPct:10});
add('stop-tight',{}, {slBasePct:6,slTightPct:4});
// Joint families investigate whether strict developer-buy / bundle filters hide
// the opportunity set. These are paper-only hypotheses, inside numeric bounds.
for(const age of [3,10,20]) for(const buyers of [3,8,15]) for(const bundle of [2,6])
  add(`broad-age${age}-buyers${buyers}-bundle${bundle}`,{
    minAgeS:age,maxAgeS:180,devBuyMin:0,maxSameSlotBuyers:bundle,
    minUniqueBuyers:buyers,minSolRaised:2,maxSolRaised:50,
  });
for(const hold of [15,30,60,120]) for(const tp of [15,30,60])
  add(`broad-hold${hold}-tp${tp}`,{
    minAgeS:10,maxAgeS:180,devBuyMin:0,maxSameSlotBuyers:6,
    minUniqueBuyers:8,minSolRaised:5,maxSolRaised:50,
  },{timeStopS:hold,tpRisingPct:tp,tpFlatPct:Math.min(tp,50),tpFallingPct:Math.min(tp,40)});
for(const gate of ['acceleration','diverse-flow','pullback']) for(const hold of [30,60]) for(const bundle of [2,6]) {
  add(`${gate}-hold${hold}-bundle${bundle}`,{minAgeS:10,maxAgeS:180,devBuyMin:0,maxSameSlotBuyers:bundle,minSolRaised:5,maxSolRaised:50}, {timeStopS:hold});
  candidates.at(-1)!.gate=gate;
}
for(const age of [3,10,20]) for(const bundle of [2,6]) {
  add(`cost-aware-age${age}-bundle${bundle}`,{minAgeS:age,maxAgeS:180,devBuyMin:0,maxSameSlotBuyers:bundle,minSolRaised:5,maxSolRaised:50},
    {slBasePct:15,slTightPct:10,noBuyTightenS:15,bsTightenRatio:0.5,timeStopS:60});
}
const training:any[]=[];
for(const c of candidates){const r=evaluate(c.params,train,true,true,7,c.gate);training.push({name:c.name,params:c.params,gate:c.gate??'none',...r.stats});console.log('TRAIN',c.name,r.stats.trades,r.stats.totalPnlSol.toFixed(5));}
// Do not select on the holdout. Require >=20 training fills, rank net expectancy.
const ranked=training.filter(r=>r.trades>=20).sort((a,b)=>b.expectancySol-a.expectancySol);
const winner=ranked[0]??training.find(r=>r.name==='current');
writeFileSync(`${out}/training.json`,JSON.stringify({candidateCount:candidates.length,selection:'>=20 closed trades; maximum net expectancy on training only',selected:winner.name,results:training},null,2));
const finalists=[candidates[0],candidates[1],{name:'train-selected',params:winner.params,gate:winner.gate}];
const validation:any[]=[];
for(const c of finalists) for(const latency of [0,300,600,1500]) {
  const p=structuredClone(c.params);p.exec.latencyMs=latency;
  for(const unlimited of [true,false]){const r=evaluate(p,test,unlimited,true,7,c.gate);validation.push({name:c.name,latency,unlimited,...r.stats});console.log('TEST',c.name,latency,unlimited,r.stats.trades,r.stats.totalPnlSol.toFixed(5));}
}
const chosen=evaluate(winner.params,test,true,true,7,winner.gate);
const stress:any[]=[];
for(const [label,mutation,conservative] of [
  ['optimistic-graduation',(p:StrategyParams)=>{},false],
  ['half-fixed-fees',(p:StrategyParams)=>{p.exec.priorityFeeSol*=0.5;p.exec.tipSol*=0.5;},true],
  ['double-fixed-fees',(p:StrategyParams)=>{p.exec.priorityFeeSol*=2;p.exec.tipSol*=2;},true],
  ['80pct-entry-landing',(p:StrategyParams)=>{p.exec.landProbability=0.8;},true],
  ['position-0.05',(p:StrategyParams)=>{p.risk.positionSol=0.05;},true],
  ['position-0.2',(p:StrategyParams)=>{p.risk.positionSol=0.2;},true],
] as const){const p=structuredClone(winner.params);mutation(p);stress.push({label,...evaluate(p,test,true,conservative,7,winner.gate).stats});}
writeFileSync(`${out}/validation.json`,JSON.stringify({selected:winner.name,validation,stress},null,2));
writeFileSync(`${out}/candidate.json`,JSON.stringify({researchOnly:true,deploymentStatus:winner.totalPnlSol<=0 || chosen.stats.totalPnlSol<=0?'rejected-negative-results':'unvalidated-paper-only',selectedOn:'training only',name:winner.name,gate:winner.gate,params:winner.params,
  warning:'Diagnostic candidate, not a recommended live strategy. The standard replay CLI does not implement the research gate. Read REPORT.md.'},null,2));
writeFileSync(`${out}/holdout-trades.json`,JSON.stringify(chosen,(_k,v)=>typeof v==='bigint'?v.toString():v,2));
console.log('SELECTED',winner.name,JSON.stringify(chosen.stats));
db.close();
