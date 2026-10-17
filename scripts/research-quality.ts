// Read-only corpus diagnostics and cost arithmetic for the launch study.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { deserialize, readRaw } from '../packages/core/src/rawio.ts';
import type { TradeEv } from '../packages/core/src/events.ts';
import { buyQuote, sellQuote, applyBuy, INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, INITIAL_REAL_TOKENS } from '../packages/core/src/curve.ts';

const out='research/launches-2026-09-30';
const cutoff=1790772741680;
const evs=[...readRaw(Date.parse('2026-09-30T00:00Z'),cutoff)];
const quantiles=(xs:number[])=>{
  xs.sort((a,b)=>a-b);
  return Object.fromEntries([0,0.5,0.9,0.99,1].map(q=>[String(q),xs.length?xs[Math.min(xs.length-1,Math.floor(q*(xs.length-1)))]:null]));
};
const prior=new Map<string,TradeEv>();
const fees:Record<string,number>={};
const seen=new Set<string>();
let duplicates=0,regressions=0,pairs=0,mismatches=0;
const residuals:number[]=[];
for(const e of evs){
  // Event contents distinguish multiple swaps in a transaction; ignore receive time.
  const key=JSON.stringify({...e,recvMs:0},(_k,v)=>typeof v==='bigint'?v.toString():v);
  if(seen.has(key))duplicates++;seen.add(key);
  if(e.kind!=='trade')continue;
  const fee=e.feeBps+e.creatorFeeBps;fees[fee]=(fees[fee]??0)+1;
  const p=prior.get(e.mint);
  if(p&&e.recvMs-p.recvMs<30_000 && p.solQuote && e.solQuote && !p.mayhem && !e.mayhem){
    pairs++;if(e.slot<p.slot)regressions++;
    const expected=p.vSol+(e.isBuy?e.sol:-e.sol);
    const error=Number(e.vSol-expected)/1e9;
    residuals.push(Math.abs(error));
    if(Math.abs(error)>0.00001)mismatches++;
  }
  prior.set(e.mint,e);
}
const archive=[];
for(const file of readdirSync('data-corrupted-20260930T0647/raw/2026-09-30').sort()){
  let lines:string[]=[];
  try{lines=gunzipSync(readFileSync(resolve('data-corrupted-20260930T0647/raw/2026-09-30',file)),{finishFlush:2}).toString('utf8').split('\n').filter(Boolean);}
  catch(err){archive.push({file,error:String(err)});continue;}
  let malformed=0,first=Infinity,last=0,n=0,creates=0;
  for(const line of lines){try{const e=deserialize(line);n++;creates+=Number(e.kind==='create');first=Math.min(first,e.recvMs);last=Math.max(last,e.recvMs);}catch{malformed++;}}
  archive.push({file,events:n,creates,malformed,from:new Date(first).toISOString(),to:new Date(last).toISOString()});
}
const r={vSol:INITIAL_VIRTUAL_SOL,vTok:INITIAL_VIRTUAL_TOKENS,rTok:INITIAL_REAL_TOKENS};
const costs=[0.05,0.1,0.2].map(size=>{
  const q=buyQuote(r,BigInt(Math.round(size*1e9)),125);
  const back=sellQuote(applyBuy(r,q.net,q.tokens),q.tokens,125);
  const loss=size+0.003-(Number(back.net)/1e9-0.003);
  return{size,fixedPerLeg:0.003,flatRoundTripLossSol:loss,flatRoundTripLossPct:loss/(size+0.003)*100};
});
const train=JSON.parse(readFileSync(`${out}/training.json`,'utf8'));
const validation=JSON.parse(readFileSync(`${out}/validation.json`,'utf8'));
const trade=JSON.parse(readFileSync(`${out}/holdout-trades.json`,'utf8'));
const summary={
  events:evs.length,duplicates,normalSolReservePairs:pairs,receiveOrderSlotRegressions:regressions,solReserveResidualOver10000Lamports:mismatches,
  absoluteSolReserveResidual:quantiles(residuals),feeBpsDistribution:fees,
  receiveMinusChainTimestampMs:quantiles(evs.filter(e=>e.chainTs>0).map(e=>e.recvMs-e.chainTs*1000)),
  backupRawFiles:archive,costs,
  uniqueConfigurations:new Set(train.results.map((r:any)=>JSON.stringify([r.params,r.gate]))).size,
  trainingPositive:train.results.filter((r:any)=>r.totalPnlSol>0).length,
  trainingZeroTrade:train.results.filter((r:any)=>r.trades===0).length,
  topTraining:train.results.filter((r:any)=>r.trades>=20).sort((a:any,b:any)=>b.expectancySol-a.expectancySol).slice(0,8).map((r:any)=>({name:r.name,trades:r.trades,wins:r.wins,pnl:r.totalPnlSol,expectancy:r.expectancySol})),
  holdout600:validation.validation.filter((r:any)=>r.latency===600),stress:validation.stress,
  selectedExitDetail:trade.closed.map((p:any)=>({mint:p.mint,reason:p.exitReason,hold:p.holdS,pnl:p.pnlSol,pct:p.pnlPct,decisionPct:p.exitFeatures.pnlAtDecision,age:p.features.ageS,slotBuyers:p.features.sameSlotBuyers})),
};
writeFileSync(`${out}/quality.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
