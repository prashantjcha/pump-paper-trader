import {readFileSync,writeFileSync} from 'node:fs';
import {evaluate,type CallStrategy} from '../../../../scripts/lib/callsSim.ts';
import {makeStrategy} from './codex-candidates.ts';
import cash from '../proposals/codex-r1.ts';
const ROOT='research/debate-calls/2026-09-30T19-09-03',DATA=ROOT+'/data';
const grid=JSON.parse(readFileSync(ROOT+'/work/codex-fit-grid.json','utf8'));
const adequate=grid.filter((r:any)=>r.metrics.entries>=30);
const best=grid.find((r:any)=>r.metrics.entries>=60);
const breakout=grid.find((r:any)=>r.metrics.entries>=60&&r.config.family==='breakout');
// These diagnostic choices use fit data only. No changes follow validation.
const choices:[string,CallStrategy][]=[['fit-best',makeStrategy(best.config)],['fit-best-breakout',makeStrategy(breakout.config)],
  ['at-call-12x',{name:'at call, 12x target, 90% stop',maxWaitMin:0,shouldEnter:()=>true,exit:{family:'fixed',tp:1100,sl:90}}],['cash',cash]];
const results:any={gridAudit:{tested:grid.length,adequate:adequate.length,minimumN:Math.min(...adequate.map((r:any)=>r.metrics.entries)),maximumN:Math.max(...adequate.map((r:any)=>r.metrics.entries)),positiveMean:adequate.filter((r:any)=>r.metrics.meanSol>0).length,positiveTrimmedMean:adequate.filter((r:any)=>r.metrics.trimmedMeanSol>0).length},selectedFitBest:best.config,selectedBreakout:breakout.config,strategies:{}};
for(const [name,s] of choices){
  results.strategies[name]={};
  for(const [split,from,to] of [['fit',0,Date.parse('2026-09-18')],['validation',Date.parse('2026-09-18'),Date.parse('2026-09-26')]] as const){
    const r=evaluate(s,DATA,from,to);results.strategies[name][split]=r;
    const {trades,...summary}=r;console.log(name,split,JSON.stringify(summary));
  }
}
console.log('GRID',JSON.stringify(results.gridAudit));
writeFileSync(ROOT+'/work/codex-validation.json',JSON.stringify(results,null,2));
