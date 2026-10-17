import {readFileSync,writeFileSync} from 'node:fs';
const ROOT='research/debate-calls/2026-09-30T19-09-03';
const b=JSON.parse(readFileSync(ROOT+'/work/codex-baseline.json','utf8'));
const v=JSON.parse(readFileSync(ROOT+'/work/codex-validation.json','utf8'));
const num=(n:number|null,d=5)=>n===null?'N/A':n.toFixed(d);
const lines=[
'# Codex round 1: retain cash',
'',
'The submitted strategy is an explicit no-entry policy. The active alternatives failed to establish an after-cost edge; abstention is not an estimated profitable trading effect. All position sizes tested are 0.1 SOL. No later holdout was opened.',
'',
'Fit calls precede 2026-09-18 UTC; validation calls are in [2026-09-18, 2026-09-26) UTC. There are 574 and 351 eligible first calls respectively. These are token-level trades, not all Telegram messages. The existing referee and policy code were used without edits.',
'',
'## Reproduce',
'',
'Run from D:/pumpfun. The installed tsx runner failed with spawn EPERM, so Node 24 native TypeScript transformation runs the exact same referee. Scripts write only inside the debate directory.',
'',
'```powershell',
`node --experimental-transform-types ${ROOT}/work/codex-experiments.ts > ${ROOT}/work/codex-experiments.log`,
`node --experimental-transform-types ${ROOT}/work/codex-validate.ts > ${ROOT}/work/codex-validate.log`,
`node --experimental-transform-types ${ROOT}/work/codex-report.ts`,
`node --experimental-transform-types scripts/calls-eval.ts ${ROOT}/proposals/codex-r1.ts --data ${ROOT}/data --to 2026-09-18 --trades 0`,
`node --experimental-transform-types scripts/calls-eval.ts ${ROOT}/proposals/codex-r1.ts --data ${ROOT}/data --from 2026-09-18 --to 2026-09-26 --trades 0`,
'```',
'',
'The first command produces Claude replication, timing audit, caller/week breakdowns, and all 75 fit-only candidate results. The second evaluates the fit-selected dip and breakout candidates, a 12x runner control, and abstention on both windows. The final two independently check the submitted strategy through the referee CLI. Full trade lists are in codex-baseline.json, codex-fit-grid.json, and codex-validation.json alongside this report.',
'',
'## Results',
'',
'All P&L columns are SOL after referee costs. Trimmed mean removes the two largest P&Ls; total without best removes one. Captures are the referee realizedMult counts, which deduct venue fees and impact but not fixed SOL charges; P&L does deduct fixed charges.',
'',
'| Strategy | Split | n | Total | Mean | Trimmed mean | Total without best | Win % | Captured 5x / 10x |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const [name,runs] of [...Object.entries(b.baseline).map(([name,runs]:any)=>[name,Object.fromEntries(Object.entries(runs).map(([s,r]:any)=>[s,r.metrics]))]),...Object.entries(v.strategies)] as any){
  for(const [split,r] of Object.entries(runs) as any)lines.push(`| ${name} | ${split} | ${r.entries} | ${num(r.totalSol,4)} | ${num(r.meanSol)} | ${num(r.trimmedMeanSol)} | ${num(r.totalWithoutBestSol,4)} | ${num(r.winRate,1)} | ${r.captured5x} / ${r.captured10x} |`);
}
lines.push('', '## What was tested and frozen', '',
`All ${v.gridAudit.tested} candidate configurations had at least 30 fit trades (range ${v.gridAudit.minimumN}–${v.gridAudit.maximumN}); none had positive mean or trimmed mean. They are overlapping experiments, not 75 independent samples. Selection used the highest fit trimmed mean among configurations with at least 60 trades. The best candidate in each tested family was already negative; validation did not change the abstention decision.`, '',
'The 75 configurations comprise 54 dip rules (wait 5/15/60 minutes, close at most 25%/50%/75% of the first post-call open, optional green-bar recovery, targets +50%/+100%/+500%, stop -50%); 12 breakout rules (close up 25%/100% from the first open and above all prior post-call highs, volume unrestricted or at least twice prior mean, targets +100%/+500%/+1100%, stop -60%); and nine delayed entries (15/60/180 minutes, targets +50%/+100%/+500%, stop -50%). All require a current 1-minute bar, at least $1,000 reported liquidity, and a first post-call bar within ten minutes. Entries use observed closes and next-open fills. Dip search ends at 180 minutes; breakout search ends at 60 minutes. These restrictions are part of the tested rules, not proven independent predictors.', '',
`Frozen best dip configuration: ${JSON.stringify(v.selectedFitBest)}. This buys a green-bar recovery after at least one hour, while price remains at most half the first post-call open, and targets 6x gross with a 50% stop. Frozen best breakout: ${JSON.stringify(v.selectedBreakout)}.`, '',
'The control buys at the call with a 12x gross target and a 90% stop. It demonstrates that the referee can record realized 10x captures; it does not establish a profitable runner strategy. Unlike a 10x gross target, a 12x target leaves room for selling costs.', '',
'## Rebuttal and concessions', '',
'Claude\'s reported aggregate losses reproduce. Its largest fit winners are each about 0.0409 SOL; removing the best leaves -2.0748 SOL (n=234). Validation also remains negative after removing the best (-0.5106 SOL, n=125). There is no outlier-supported positive aggregate result to defend.', '',
'Caller concentration matters to the apparent validation improvement. The following are descriptive slices, not rules chosen for deployment. No subgroup below 30 trades is interpreted.', '',
'| Claude slice | Split | n | Mean | Trimmed mean | Total without best | Win % | Captured 5x / 10x |',
'|---|---|---:|---:|---:|---:|---:|---:|');
for(const split of ['fit','validation']){
 const r=b.baseline.claude[split];
 for(const [label,g] of [['caller_01',r.callers.find((x:any)=>x.group==='caller_01')],['excluding caller_01',r.withoutLargestCaller],...r.weeks.filter((x:any)=>x.n>=30).map((x:any)=>['UTC week starting '+x.group,x])] as any){
 lines.push(`| ${label} | ${split} | ${g.n} | ${num(g.mean)} | ${num(g.trimmedMean)} | ${num(g.totalWithoutBest,4)} | ${num(g.winRate,1)} | ${g.captured5x} / ${g.captured10x} |`);
 }
}
lines.push('',
'Removing caller_01 makes validation worse, not better: its 36 validation trades earn +0.2593 SOL, while the other 89 lose -0.7290 SOL. The same caller does not demonstrate a stable profitable fit edge (see table). Every week slice meeting the minimum 30-trade requirement is negative. Week bins are fixed seven-day UTC intervals anchored to the Unix epoch and clipped to each research split.', '',
`There is an input-timing defect for call-time decisions: pre is filtered by candle start, not candle completion. ${b.audit.fit.unfinishedPre}/${b.audit.fit.calls} eligible fit calls and ${b.audit.validation.unfinishedPre}/${b.audit.validation.calls} validation calls contain a pre candle that finishes after the call. Claude's last-pre-close feature can therefore use information unavailable at call time. Filtering to b.t + b.res * 1000 <= callMs changes entries from 234 to 222 on fit and 125 to 115 on validation, but both remain negative (full metrics above). This sensitivity only fixes the strategy's pre-candle input; it does not change the referee.`, '',
'I concede the tested evidence supports declining these calls. My dip and volume-breakout variants do not improve on Claude robustly. I dispute treating “least bad active strategy” as a reason to deploy, and I dispute inferring that realized 10x captures are impossible: the 12x control records 18 on fit (n=574) and 13 on validation (n=351), yet loses heavily. Capturing runners is insufficient if the losing positions consume more capital.', '',
'This is finite exploratory evidence, not proof that every possible chart/volume rule fails. Claude already inspected validation while choosing its proposal; that window is not untouched for the debate. My grid ranking used fit only, with one subsequent validation pass for the two chosen candidates. There are no statistical independence or significance claims for this parameter search.', '',
'## Submission', '',
'proposals/codex-r1.ts always declines entry. Both splits have n=0, total P&L 0, total without best 0, captured5x/captured10x 0/0, and undefined mean, trimmed mean, and win rate. The 30-trade minimum precludes calling this an estimated trading effect. It is a capital-allocation decision supported by the adequately sampled losing alternatives. In the referee, cash mechanically avoids trading losses; it can lose a future comparison if another strategy actually earns positive P&L. No unseen-call superiority is claimed as established.', '');
writeFileSync(ROOT+'/work/codex-r1-report.md',lines.join('\n'));
