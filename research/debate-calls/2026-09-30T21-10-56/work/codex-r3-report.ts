// Builds a report from machine-written experiment and referee CLI results.
// All generated files stay in this debate directory.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT=resolve('research/debate-calls/2026-09-30T21-10-56'), WORK=resolve(ROOT,'work');
const read=(name:string)=>JSON.parse(readFileSync(resolve(WORK,name),'utf8'));
const results=read('codex-r3-results.json'), audit=read('codex-r3-audit.json'), selection=read('codex-r3-selection.json');
const fmt=(v:number|null,d=5)=>v===null?'undefined':v.toFixed(d);
const commands = `From the repository root (Node's built-in TypeScript transform avoids package-manager writes):

\`\`\`powershell
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r3-experiment.ts > research/debate-calls/2026-09-30T21-10-56/work/codex-r3-experiment.out
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r3-report.ts
\`\`\`

All numerical tables below come from the unchanged evaluate() and PolicyState. The first command writes results, selection, declaration and audit JSON. Run the three referee commands at the end of this report before the report command; the report command reads their machine-written JSON and checks the final proposal results. No live data or post-snapshot directory is read.`;
const out:string[]=[
  '# Codex round 3: final evidence and submission',commands,
  '## Decision and experimental scope',
  'Submit abstention. This withdraws the round-2 trade recommendation, ties Claude, and does not meet the goal of beating the live rule across all splits or capturing runners. Zero realized P&L from abstention is certain within this simulator; being optimal on unseen calls is not established.',
  'Eight new candidates: completed pre-call flow count 1–300 or 1–1000, crossed with close-based trailing only, no +30% peak by 5 minutes, no +30% peak by 15 minutes, or selling pressure while underwater. All use a 25% hard stop and a next-open exit signal when the close falls 40% below a peak that reached 3x entry. Timeout modes exit weak positions after the deadline until they reach 1.3x; selling pressure means sell USD exceeds buy USD over the latest five minutes, with at least four finished flow bars and at least five minutes held. This is a bar-resolution simulation, not an intraminute deadline guarantee. Position size is 0.1 SOL; referee fees, impact and fixed costs are unchanged.',
  'Two activity caps and four exit modes were explored; fixed constants are recorded in codex-r3-declaration.json. The close-trail mode controls for execution differences from the round-2 intrabar policy. No caller/day identity is used for entry. These are eight correlated trials, not eight independent confirmations. Earlier rounds and Claude’s results informed the hypotheses; neither later split is pristine.',
  'Selection was frozen on fit before this run evaluated later splits. Basic gate: n>=30, positive trimmed mean and positive total without best. Added concentration gate: after removing the best aggregate-P&L caller, and separately the best UTC day, retain n>=30 and positive trimmed mean. Rank survivors on fit trimmed. This stronger gate is a new final-round research choice, not the original referee scoring rule.',
  `Basic passing candidates: ${selection.basicPassing.join(', ')||'none'}. Concentration-gate survivors: ${selection.robustPassing.join(', ')||'none'}. Frozen selection: **${selection.selected}**.`,
  '## All candidate and control results',
  'Fit is before 2026-09-18 UTC; validation is September 18–26; test is September 26–29 18:00 UTC. Mean and trimmed are SOL per 0.1 SOL entry; total without best is aggregate SOL. Referee trimmed mean removes the two best trades when n>4. Captures are realized proceeds/initial size >=5 or >=10 (before subtracting fixed fees), not merely an intratrade high. Rows with n<30 are descriptive only and supply no qualifying effect evidence.',
  '| Strategy | Split | n | Mean | Trimmed | Total without best | Win % | Captured5x/10x |',
  '|---|---|---:|---:|---:|---:|---:|---:|',
];
for(const r of results) out.push(`| ${r.strategy} | ${r.split} | ${r.entries} | ${fmt(r.meanSol)} | ${fmt(r.trimmedMeanSol)} | ${fmt(r.totalWithoutBestSol,4)} | ${fmt(r.winRate,1)} | ${r.captured5x}/${r.captured10x} |`);
out.push('## Concentration and influential trades',
  'Claude’s submitted strategy has n=0 in every split, no trading parameters affecting realized outcomes, and no winning caller or day. Its absence of losses is mechanical; it provides no positive evidence about a profitable entry. To attack the alternative fairly, these are the rerun round-2 results and the best new fit candidate, including their highest-contributing caller and UTC day. Full group results for every candidate are in codex-r3-results.json.',
  '| Strategy | Split | Exclusion | Removed group | Remaining n | Mean | Trimmed | Total without best | Win % | Captured5x/10x |',
  '|---|---|---|---|---:|---:|---:|---:|---:|---:|');
const focused=results.filter((r:any)=>r.strategy.startsWith('codex-r2:')||r.strategy==='flow300/close-trail');
for(const r of focused) for(const s of r.stress) {
  const g=s.excludingBest;
  if(g) out.push(`| ${r.strategy} | ${r.split} | ${s.kind} | ${g.key} | ${g.n} | ${fmt(g.mean)} | ${fmt(g.trimmed)} | ${fmt(g.withoutBest,4)} | ${fmt(g.winRate,1)} | ${g.captured5x}/${g.captured10x} |`);
}
out.push('\nLargest three trades per focused strategy/split (individual observations, not inferential samples):',
  '| Strategy | Split / n | UTC call time | Caller | Mint | P&L SOL | Realized multiple |',
  '|---|---|---|---|---|---:|---:|');
for(const r of focused) for(const t of [...r.trades].sort((a:any,b:any)=>b.pnlSol-a.pnlSol).slice(0,3))
  out.push(`| ${r.strategy} | ${r.split} / ${r.entries} | ${new Date(t.callMs).toISOString()} | ${t.caller} | ${t.mint} | ${fmt(t.pnlSol)} | ${fmt(t.realizedMult,2)} |`);
out.push('## Paired exit comparison',
  'Same tokens and entry prices: changes below are aggregate P&L relative to close-trail at the same cap, not relative to the round-2 policy. Timing and flow exits are not rescued by comparing against a different execution mechanism.',
  '| Candidate | Split | Paired n | Delta total SOL | Delta captured5x | Delta captured10x |',
  '|---|---|---:|---:|---:|---:|');
for(const r of results.filter((r:any)=>/^flow(300|1000)\//.test(r.strategy)&&!r.strategy.endsWith('/close-trail'))) {
  const base=results.find((b:any)=>b.strategy===r.strategy.split('/')[0]+'/close-trail'&&b.split===r.split);
  const bm=new Map(base.trades.map((t:any)=>[t.mint,t]));
  if(r.trades.some((t:any)=>!(bm.get(t.mint) as any)||t.entryPx!==(bm.get(t.mint) as any).entryPx)||r.entries!==base.entries) throw Error('Paired entries differ');
  const delta=r.trades.reduce((s:number,t:any)=>s+t.pnlSol-(bm.get(t.mint) as any).pnlSol,0);
  out.push(`| ${r.strategy} | ${r.split} | ${r.entries} | ${fmt(delta)} | ${r.captured5x-base.captured5x} | ${r.captured10x-base.captured10x} |`);
}
out.push('## Rebuttal: recent flow is not a measured lifetime count',
  '| Split | Eligible n | Event count <=100 | Completed flow <=100 | Both | Flow <=100 but events >100 | No completed flow | Unfinished ctx.pre bars present |',
  '|---|---:|---:|---:|---:|---:|---:|---:|');
for(const a of audit) out.push(`| ${a.split} | ${a.n} | ${a.eventLow} | ${a.flowLow} | ${a.overlap} | ${a.flowLowEventsOver100} | ${a.noFinishedFlow} | ${a.unfinishedPre} |`);
const sum=(k:string)=>audit.reduce((s:number,a:any)=>s+a[k],0);
out.push(`Across ${sum('n')} eligible calls, the flow proxy selects ${sum('flowLow')} and the event rule ${sum('eventLow')}, with only ${sum('overlap')} in common. Of the ${sum('flowLow')} flow-qualified calls, ${sum('flowLowEventsOver100')} have >100 events and ${sum('flowLowNoFinishedFlow')} have no completed flow bars. These are descriptive coverage counts, not a performance effect. The 44/220 ratio compares different selected sets; it is not an observed live trade-frequency ratio.`,
  'The available flow window omits the unfinished call minute and is finite. No older active price bars were available in this audit to establish lifetime age: zero of 1079 eligible calls had positive-volume pre bars ending more than six hours before the call. Thus this negative audit cannot establish that all low-flow tokens are new. The simulator’s documented six-hour flow history is a recent-activity measure; actual lifetime coverage needs a separate source.',
  'Source inspection: apps/telegram/src/trader.ts, tradesBeforeCall(), uses local trades_raw when a recorded launch exists, otherwise an API query over the previous 14 days; “not found” maps to zero. Neither path equals completed six-hour flow bars. Reproduce source inspection: `Get-Content apps/telegram/src/trader.ts -TotalCount 75`. The source explains why equivalence is unproven; the sealed sample has no contemporaneous live decisions establishing the direction or size of the difference.',
  'I concede the event-history comparability problem and the round-2 concentration failure. I dispute declaring abstention the highest expected-value strategy, treating recent flow as exact live youth, or asserting that the next holdout must repeat precisely the same gap. Those are unmeasured forward claims. Likewise, the existence of 116 ex-post 5x opportunities across 1079 eligible calls does not establish a tradable entry rule: Claude captures 0/0 at n=0 on all splits.',
  '## Referee verification of final proposal');
const bounds=[['fit','--to','2026-09-18T00:00:00Z'],['val','--from','2026-09-18T00:00:00Z','--to','2026-09-26T00:00:00Z'],['test','--from','2026-09-26T00:00:00Z','--to','2026-09-29T18:00:00Z']];
out.push('| Split | n | Mean | Trimmed | Total without best | Win % | Captured5x/10x |','|---|---:|---:|---:|---:|---:|---:|');
const verifyCommands:string[]=[];
for(const [split,...bound] of bounds) {
  const args=['--experimental-transform-types','scripts/calls-eval.ts','research/debate-calls/2026-09-30T21-10-56/proposals/codex-r3.ts','--data','research/debate-calls/2026-09-30T21-10-56/data',...bound,'--trades','0'];
  const r=read(`codex-r3-referee-${split}.json`);
  if(r.entries!==0||r.totalSol!==0||r.meanSol!==null||r.trimmedMeanSol!==null||r.winRate!==null||r.captured5x!==0||r.captured10x!==0) throw Error('Final abstention verification failed');
  out.push(`| ${split} | ${r.entries} | ${fmt(r.meanSol)} | ${fmt(r.trimmedMeanSol)} | ${fmt(r.totalWithoutBestSol)} | ${fmt(r.winRate)} | ${r.captured5x}/${r.captured10x} |`);
  verifyCommands.push('node '+args.join(' ')+` > research/debate-calls/2026-09-30T21-10-56/work/codex-r3-referee-${split}.json`);
}
out.push('\n```powershell',...verifyCommands,'```',
  '\nNo evidence here proves that the live rule cannot be improved. Final abstention is the defensible submission under the stated robustness checks, with no claim to win the unseen sample. The runner-capture objective remains unmet.');
writeFileSync(resolve(WORK,'codex-r3-report.md'),out.join('\n\n').replace(/\|\n\n(?=\|)/g,'|\n')+'\n');
console.log('Report written; three independent referee CLI results checked.');
