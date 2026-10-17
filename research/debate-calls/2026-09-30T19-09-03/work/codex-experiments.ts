import { writeFileSync } from 'node:fs';
import { evaluate, loadCalls, loadBars, type CallStrategy, type CallCtx, type Trade } from '../../../../scripts/lib/callsSim.ts';
import claude from '../proposals/claude-r1.ts';
import { makeStrategy } from './codex-candidates.ts';

const ROOT = 'research/debate-calls/2026-09-30T19-09-03';
const DATA = ROOT + '/data';
const CUT = Date.parse('2026-09-18'), END = Date.parse('2026-09-26');
export function summary(trades: Trade[]) {
  const s = [...trades].sort((a,b)=>a.pnlSol-b.pnlSol), n=s.length;
  const total=s.reduce((a,b)=>a+b.pnlSol,0), trim=n>4?s.slice(0,-2):s;
  return {n, total, mean:n?total/n:null, trimmedMean:trim.length?trim.reduce((a,b)=>a+b.pnlSol,0)/trim.length:null,
    totalWithoutBest:total-(s.at(-1)?.pnlSol??0), winRate:n?100*s.filter(t=>t.pnlSol>0).length/n:null,
    captured5x:s.filter(t=>t.realizedMult>=5).length,captured10x:s.filter(t=>t.realizedMult>=10).length};
}
function run(s:CallStrategy, from=0,to=CUT) { const r=evaluate(s,DATA,from,to); const {trades,...metrics}=r; return {metrics,trades}; }
function groups(ts:Trade[], key:(t:Trade)=>string) {
  const keys=[...new Set(ts.map(key))];
  return keys.map(k=>({group:k,...summary(ts.filter(t=>key(t)===k))}));
}
const closedRunup=(c:CallCtx)=> {
  const b=c.pre.filter(b=>b.t>=c.callMs-3600000 && b.t+b.res*1000<=c.callMs);
  return b.length>=2?b.at(-1)!.c/b[0].o:0;
};
const baseline:any={};
for(const [name,s] of [['claude',claude],['claude-completed-bars',{...claude,name:'claude completed bars only',shouldEnter:(c:CallCtx)=>closedRunup(c)>=7}]] as const) {
  baseline[name]={};
  for(const [split,from,to] of [['fit',0,CUT],['validation',CUT,END]] as const) {
    const r=run(s,from,to);
    baseline[name][split]={...r,callers:groups(r.trades,t=>t.caller),weeks:groups(r.trades,t=>new Date(Math.floor(t.callMs/(7*86400000))*7*86400000).toISOString().slice(0,10)),
      withoutLargestCaller: (()=>{const gs=groups(r.trades,t=>t.caller).sort((a,b)=>b.n-a.n);return {excluded:gs[0]?.group,...summary(r.trades.filter(t=>t.caller!==gs[0]?.group))};})()};
    console.log(name,split,JSON.stringify(r.metrics));
  }
}
const audit={fit:{calls:0,unfinishedPre:0,lateFirst:0,horizonShort:0},validation:{calls:0,unfinishedPre:0,lateFirst:0,horizonShort:0}};
for(const c of loadCalls(DATA,0,END)) {
  const bars=loadBars(DATA,c.mint);if(!bars)continue;
  const post=bars.filter(b=>b.t>=c.callMs&&b.t<=c.callMs+86400000);if(!post.length)continue;
  const a=c.callMs<CUT?audit.fit:audit.validation;a.calls++;
  if(bars.some(b=>b.t<c.callMs&&b.t+b.res*1000>c.callMs))a.unfinishedPre++;
  if(post[0].t>c.callMs+10*60000)a.lateFirst++;
  if(post.at(-1)!.t<c.callMs+23*3600000)a.horizonShort++;
}
writeFileSync(ROOT+'/work/codex-baseline.json',JSON.stringify({baseline,audit},null,2));
console.log('AUDIT',JSON.stringify(audit));

// Fit-only exploration. All sizes remain the book's 0.1 SOL. No caller/mint identifiers.
const configs:any[]=[];
for(const wait of [5,15,60])for(const dip of [.25,.5,.75])for(const recovery of [false,true])for(const tp of [50,100,500])configs.push({family:'dip',wait,dip,recovery,tp,sl:50});
for(const mult of [1.25,2])for(const volume of [0,2])for(const tp of [100,500,1100])configs.push({family:'breakout',mult,volume,tp,sl:60});
for(const delay of [15,60,180])for(const tp of [50,100,500])configs.push({family:'delayed',delay,tp,sl:50});
const results=[];
for(const [i,p] of configs.entries()) {
  const r=run(makeStrategy(p));results.push({config:p,...r});
  if(i%15===0)console.log('FIT progress',i,'/',configs.length);
}
results.sort((a,b)=>(b.metrics.trimmedMeanSol??-Infinity)-(a.metrics.trimmedMeanSol??-Infinity));
writeFileSync(ROOT+'/work/codex-fit-grid.json',JSON.stringify(results,null,2));
console.log('FIT top n>=60',JSON.stringify(results.filter(r=>r.metrics.entries>=60).slice(0,10).map(({config,metrics})=>({config,metrics})),null,2));
