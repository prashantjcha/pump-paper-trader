import { writeFileSync } from 'node:fs';
import { evaluate, loadBars, solUsd, type Trade, type CallCtx, type CallStrategy } from '../../../../scripts/lib/callsSim.ts';
import { PolicyState, venueFeePct, type PolicySpec } from '../../../../packages/core/src/callPolicy.ts';
import claude from '../proposals/claude-r2.ts';
import { makeStrategy, type Config } from './codex-r2-candidates.ts';

const ROOT='research/debate-calls/2026-09-30T19-09-03', DATA=ROOT+'/data';
const CUT=Date.parse('2026-09-18'), END=Date.parse('2026-09-26');
const SOL_USD=solUsd(DATA);
let maxReplayError=0;
function stats(ts: Trade[]) {
  const s=[...ts].sort((a,b)=>a.pnlSol-b.pnlSol), n=s.length, total=s.reduce((a,t)=>a+t.pnlSol,0), tr=n>4?s.slice(0,-2):s;
  return {n,total,mean:n?total/n:null,trimmedMean:tr.length?tr.reduce((a,t)=>a+t.pnlSol,0)/tr.length:null,
    totalWithoutBest:total-(s.at(-1)?.pnlSol??0),winRate:n?100*s.filter(t=>t.pnlSol>0).length/n:null,
    captured5x:s.filter(t=>t.realizedMult>=5).length,captured10x:s.filter(t=>t.realizedMult>=10).length};
}
function groups(ts:Trade[],key:(t:Trade)=>string) {
  return [...new Set(ts.map(key))].map(k=>({group:k,...stats(ts.filter(t=>key(t)===k))}));
}
function detail(ts:Trade[]) {
  const callers=groups(ts,t=>t.caller).sort((a,b)=>b.n-a.n);
  const weeks=groups(ts,t=>new Date(Math.floor(t.callMs/(7*86400000))*7*86400000).toISOString().slice(0,10));
  return {stats:stats(ts),callers,weeks,withoutLargestCaller:{excluded:callers[0]?.group,...stats(ts.filter(t=>t.caller!==callers[0]?.group))},
    best:[...ts].sort((a,b)=>b.pnlSol-a.pnlSol).slice(0,5),trades:ts};
}
const splits=[['fit',0,CUT],['validation',CUT,END]] as const;
const abstain=Object.fromEntries(splits.map(([name,from,to])=>{
  const r=evaluate(claude,DATA,from,to); const {trades,...metrics}=r;return [name,metrics];
}));
console.log('CLAUDE_R2',JSON.stringify(abstain));

// Counterfactual cost attribution: replay the EXACT entry bars and policy fills,
// with costs set to zero only in accounting. This is diagnostic, not a tradable result.
const features=new Map<string,{r15:number;liq:number;callMs:number}>();
function feature(c:CallCtx) {
  const done=c.pre.filter(b=>b.t+b.res*1000<=c.callMs), w=done.filter(b=>b.t>=c.callMs-15*60000);
  return {r15:w.length>=2?w.at(-1)!.c/w[0].o:0,liq:done.at(-1)?.liq??0,callMs:c.callMs};
}
function grossTrade(t:Trade,p:PolicySpec):Trade {
  const bars=loadBars(DATA,t.mint)!.filter(b=>b.t>=t.entryMs&&b.t<=t.callMs+86400000);
  const st=new PolicyState(p,t.entryPx,t.entryMs);let proceeds=0,left=1;
  const impact=(usd:number,liq:number,vol:number)=>Math.min(.3,liq>0?usd/(usd+liq/2):usd/(usd+2*Math.max(0,vol)));
  const fee=venueFeePct(t.mint.endsWith('pump')?'pump-fun':'other')/100;
  const tokens=t.sizeSol*(1-fee-impact(t.sizeSol*SOL_USD,bars[0].liq,bars[0].v))/t.entryPx;
  let netProceeds=0,legs=1;
  function account(px:number,frac:number,b:typeof bars[number]) {
    proceeds+=frac*px/t.entryPx;
    const gross=tokens*frac*px;
    netProceeds+=gross*(1-fee-impact(gross*SOL_USD,b.liq,b.v));legs++;
  }
  for(const b of bars) {
    for(const f of st.onBar(b)) {const sold=Math.min(left,f.frac);account(f.px,sold,b);left-=sold;}
    if(st.done)break;
  }
  if(left>1e-9)account(bars.at(-1)!.c,left,bars.at(-1)!);
  const error=Math.abs(netProceeds-t.sizeSol-.003*legs-t.pnlSol);
  maxReplayError=Math.max(maxReplayError,error);
  if(error>1e-12)throw new Error(`Cost replay differs from referee for ${t.mint}: ${error}`);
  return {...t,pnlSol:t.sizeSol*(proceeds-1),realizedMult:proceeds};
}
const policies: [string,PolicySpec][]=[['tp50sl30',{family:'fixed',tp:50,sl:30}],['tp30sl20',{family:'fixed',tp:30,sl:20}],['tp1100sl90',{family:'fixed',tp:1100,sl:90}]];
const costRuns:any[]=[];
for(const [name,exit] of policies)for(const size of [.1,.2]) {
  const s:CallStrategy={name,maxWaitMin:0,exit,size:()=>size,shouldEnter(c){features.set(c.mint,feature(c));return true;}};
  const r=evaluate(s,DATA,0,END);
  const gross=r.trades.map(t=>grossTrade(t,exit));
  costRuns.push({name,size,net:r.trades,gross});
  console.log('COST_REPLAY',name,size,r.entries);
}
const fitFeat=[...features.values()].filter(f=>f.callMs<CUT);
const quartile=(k:'r15'|'liq')=>fitFeat.map(f=>f[k]).sort((a,b)=>a-b)[Math.floor(.75*(fitFeat.length-1))];
const thresholds={r15:quartile('r15'),liq:quartile('liq')};
const filters:[string,(t:Trade)=>boolean][]=[['all',()=>true],['r15-top-quartile',t=>features.get(t.mint)!.r15>=thresholds.r15],['liquidity-top-quartile',t=>features.get(t.mint)!.liq>=thresholds.liq]];
const costSummary=costRuns.flatMap(r=>filters.flatMap(([filter,fn])=>splits.map(([split,from,to])=>{
  const pick=(ts:Trade[])=>ts.filter(t=>t.callMs>=from&&t.callMs<to&&fn(t));
  const net=pick(r.net),gross=pick(r.gross);
  return {policy:r.name,size:r.size,filter,split,net:stats(net),gross:stats(gross),
    // Fixed costs are 0.006 for these one-exit policies. Variable cost is the residual.
    fixedCostTotal:net.length*.006,variableCostTotal:stats(gross).total-stats(net).total-net.length*.006};
})));
const costConcentration=Object.fromEntries(splits.map(([split,from,to])=>{
  const run=costRuns.find(r=>r.name==='tp50sl30'&&r.size===.1);
  const pick=(ts:Trade[])=>ts.filter(t=>t.callMs>=from&&t.callMs<to&&features.get(t.mint)!.r15>=thresholds.r15);
  return [split,{net:detail(pick(run.net)),gross:detail(pick(run.gross))}];
}));
writeFileSync(ROOT+'/work/codex-r2-cost-audit.json',JSON.stringify({thresholds,maxReplayError,features:[...features],costSummary,costConcentration,costRuns},null,2));
console.log('COST_SUMMARY',JSON.stringify(costSummary.filter(r=>r.size===.1&&(r.policy==='tp50sl30'||r.filter==='liquidity-top-quartile'))));

const exits:PolicySpec[]=[{family:'fixed',tp:50,sl:30},{family:'fixed',tp:1100,sl:80},{family:'trailing',arm:100,trail:50,sl:50}];
const configs:Config[]=[];
for(const wait of [15,60])for(const window of [5,15])for(const volumeRatio of [1,2])for(const exit of exits)configs.push({wait,window,volumeRatio,exit});
const fit=configs.map((config,i)=>{
  const result=evaluate(makeStrategy(config),DATA,0,CUT);
  console.log('FIT',i,JSON.stringify(config),result.entries,result.meanSol,result.trimmedMeanSol);
  return {config,result};
});
// Freeze one candidate using fit only, before any new-rule validation evaluation.
const selected=fit.filter(r=>r.result.entries>=30).sort((a,b)=>(b.result.trimmedMeanSol??-Infinity)-(a.result.trimmedMeanSol??-Infinity))[0];
writeFileSync(ROOT+'/work/codex-r2-fit.json',JSON.stringify({configs:fit,selected:selected?.config},null,2));
if(!selected)throw new Error('No candidate meets the fit sample minimum');
const validation=evaluate(makeStrategy(selected.config),DATA,CUT,END);
const result={abstain,thresholds,selected:selected.config,fit:detail(selected.result.trades),validation:detail(validation.trades),
  grid:{count:fit.length,minN:Math.min(...fit.map(r=>r.result.entries)),maxN:Math.max(...fit.map(r=>r.result.entries)),
    positiveMean:fit.filter(r=>r.result.entries>=30&&(r.result.meanSol??0)>0).length,
    positiveTrimmedMean:fit.filter(r=>r.result.entries>=30&&(r.result.trimmedMeanSol??0)>0).length}};
writeFileSync(ROOT+'/work/codex-r2-results.json',JSON.stringify(result,null,2));
console.log('SELECTED',JSON.stringify({config:selected.config,fit:result.fit.stats,validation:result.validation.stats,grid:result.grid}));
