import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, type Trade } from '../../../../scripts/lib/callsSim.ts';
import type { PolicySpec } from '../../../../packages/core/src/callPolicy.ts';
import claude from '../proposals/claude-r3.ts';
import { immediate, confirmed, type Config } from './codex-r3-candidates.ts';
const ROOT='research/debate-calls/2026-09-30T19-09-03', DATA=ROOT+'/data';
const CUT=Date.parse('2026-09-18'), END=Date.parse('2026-09-26');
const splits=[['fit',0,CUT],['validation',CUT,END]] as const;
function stats(ts: {pnlSol:number;realizedMult:number}[]) {
  const s=[...ts].sort((a,b)=>a.pnlSol-b.pnlSol), n=s.length, total=s.reduce((a,t)=>a+t.pnlSol,0), trim=n>4?s.slice(0,-2):s;
  return {n,total,mean:n?total/n:null,trimmedMean:trim.length?trim.reduce((a,t)=>a+t.pnlSol,0)/trim.length:null,
    totalWithoutBest:total-(s.at(-1)?.pnlSol??0),winRate:n?100*s.filter(t=>t.pnlSol>0).length/n:null,
    captured5x:s.filter(t=>t.realizedMult>=5).length,captured10x:s.filter(t=>t.realizedMult>=10).length};
}
function detail(ts:Trade[]) {
  const groups=(key:(t:Trade)=>string)=>[...new Set(ts.map(key))].map(group=>({group,...stats(ts.filter(t=>key(t)===group))}));
  const callers=groups(t=>t.caller).sort((a,b)=>b.n-a.n), days=groups(t=>new Date(t.callMs).toISOString().slice(0,10)).sort((a,b)=>b.total-a.total);
  return {stats:stats(ts),callers,days,
    weeks:groups(t=>new Date(Math.floor(t.callMs/604800000)*604800000).toISOString().slice(0,10)),
    withoutLargestCaller:{excluded:callers[0]?.group,...stats(ts.filter(t=>t.caller!==callers[0]?.group))},
    withoutBestDay:{excluded:days[0]?.group,...stats(ts.filter(t=>new Date(t.callMs).toISOString().slice(0,10)!==days[0]?.group))},
    best:[...ts].sort((a,b)=>b.pnlSol-a.pnlSol).slice(0,5),trades:ts};
}
const rows:any[]=JSON.parse(readFileSync(ROOT+'/work/r2-table.json','utf8'));
const cells:any[]=[];
for(const liq of [0,5000,10000,20000,40000])for(const r15 of [4,5.58,8])for(const policy of ['tp50sl30','tp100sl30'])for(const size of [.1,.2]) {
  const selected=rows.filter(r=>r.r15>=r15&&r.liq>=liq);
  const parts=Object.fromEntries(splits.map(([split,from,to])=>[split,stats(selected.filter(r=>r.callMs>=from&&r.callMs<to).map(r=>({pnlSol:r.out[`${policy}@${size}`].pnl,realizedMult:r.out[`${policy}@${size}`].real})))]));
  cells.push({liq,r15,policy,size,...parts});
}
const positive=cells.filter(c=>c.fit.n>=30&&c.fit.trimmedMean>0);
const gridAudit={count:cells.length,positiveFit:positive.length,positiveFitAtPointOne:positive.filter(c=>c.size===.1).length,
  positiveBoth:positive.filter(c=>c.validation.n>=30&&c.validation.trimmedMean>0).length,cells};
console.log('CLAUDE_GRID',JSON.stringify({...gridAudit,cells:positive}));
const audit:any[]=[];
for(const [r15,liq,size] of [[5.58,5000,.1],[5.58,5000,.2],[8,10000,.2]])for(const [split,from,to] of splits) {
  const r=evaluate(immediate(r15,liq,size),DATA,from,to);
  const expected=rows.filter(f=>f.r15>=r15&&f.liq>=liq&&f.callMs>=from&&f.callMs<to);
  const byMint=new Map(expected.map(f=>[f.mint,f]));
  if(r.entries!==expected.length || r.trades.some(t=>Math.abs(t.pnlSol-byMint.get(t.mint).out[`tp50sl30@${size}`].pnl)>1e-12)) throw new Error('Stored table differs from referee');
  audit.push({r15,liq,size,split,...detail(r.trades)});
  console.log('CLAUDE_REFEREE',r15,liq,size,split,JSON.stringify(stats(r.trades)));
}
const abstain=Object.fromEntries(splits.map(([split,from,to])=>{const {trades,...r}=evaluate(claude,DATA,from,to);return [split,r];}));
const exits:PolicySpec[]=[{family:'fixed',tp:50,sl:30},{family:'scale-out',x:100,trail:50,sl:50},{family:'fixed',tp:1100,sl:80}];
const configs:Config[]=[];
for(const delay of [3,5,15])for(const momentum of [1,1.2])for(const exit of exits)configs.push({delay,momentum,exit});
const fit=configs.map((config,i)=>{const result=evaluate(confirmed(config),DATA,0,CUT);console.log('NEW_FIT',i,result.entries,result.meanSol,result.trimmedMeanSol);return {config,result};});
const selected=fit.filter(r=>r.result.entries>=30).sort((a,b)=>(b.result.trimmedMeanSol??-Infinity)-(a.result.trimmedMeanSol??-Infinity))[0];
writeFileSync(ROOT+'/work/codex-r3-fit.json',JSON.stringify({fit,selected:selected?.config},null,2));
if(!selected)throw new Error('No new candidate has 30 fit trades');
const validation=evaluate(confirmed(selected.config),DATA,CUT,END);
// Same selected entry, runner exit: diagnostic only, never chosen using validation.
const runnerConfig={...selected.config,exit:{family:'fixed' as const,tp:1100,sl:80}};
const runner=Object.fromEntries(splits.map(([split,from,to])=>[split,detail(evaluate(confirmed(runnerConfig),DATA,from,to).trades)]));
const output={gridAudit,audit,abstain,newGrid:{count:fit.length,minN:Math.min(...fit.map(r=>r.result.entries)),maxN:Math.max(...fit.map(r=>r.result.entries)),
  qualified:fit.filter(r=>r.result.entries>=30).length,positiveMean:fit.filter(r=>r.result.entries>=30&&(r.result.meanSol??0)>0).length,
  positiveTrimmed:fit.filter(r=>r.result.entries>=30&&(r.result.trimmedMeanSol??0)>0).length},
  selected:selected.config,fit:detail(selected.result.trades),validation:detail(validation.trades),runnerConfig,runner};
writeFileSync(ROOT+'/work/codex-r3-results.json',JSON.stringify(output,null,2));
console.log('FINAL',JSON.stringify({abstain,newGrid:output.newGrid,selected:output.selected,fit:output.fit.stats,validation:output.validation.stats}));
