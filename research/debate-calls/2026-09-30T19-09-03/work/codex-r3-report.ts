import { readFileSync, writeFileSync } from 'node:fs';
const ROOT='research/debate-calls/2026-09-30T19-09-03';
const r=JSON.parse(readFileSync(ROOT+'/work/codex-r3-results.json','utf8'));
const f=(v:number|null,d=5)=>v===null?'undefined':v.toFixed(d);
const header='| Strategy / split | n | Total SOL | Mean SOL | Trimmed mean SOL | Total without best SOL | Win % | Captured 5x / 10x |\n|---|---:|---:|---:|---:|---:|---:|---:|';
const row=(label:string,s:any)=>`| ${label} | ${s.n} | ${f(s.total,4)} | ${f(s.mean)} | ${f(s.trimmedMean)} | ${f(s.totalWithoutBest,4)} | ${f(s.winRate,1)} | ${s.captured5x} / ${s.captured10x} |`;
const lines=[
'Final Codex round 3: retain cash. No tested active rule establishes robust after-cost profit on both chronological splits. The submitted strategy mechanically ties Claude\'s final abstention.',
'',
'All inputs are from the sealed snapshot and earlier research inside this debate directory. Fit: calls before 2026-09-18T00:00:00Z. Validation: calls from that instant through 2026-09-26T00:00:00Z exclusive. The simulator deduplicates to first call per mint: 574 eligible fit calls and 351 validation calls; respectively 5 and 1 have no usable data. No later holdout or live data was read. Writes are confined to this debate directory.',
'',
'Reproduce all experiments, trade lists, grid counts, concentrations, and this report from repository root:',
'',
'```powershell',
`node --experimental-transform-types ${ROOT}/work/codex-r3-experiments.ts`,
`node --experimental-transform-types ${ROOT}/work/codex-r3-report.ts`,
'```',
'',
'The experiment imports the unmodified referee evaluate() directly. Its independent six-run audit verifies both the trade counts and each individual P&L against Claude\'s r2-table.json to 1e-12 SOL. The table itself is reproducible with work/r2-table.ts against the sealed data. The same runtime can execute the unmodified CLI (commands below); Node\'s transform-types handles PolicyState\'s TypeScript constructor parameters.',
'',
'Claude audit: 60 threshold/exit/size combinations, 13 fit-positive trimmed means with n>=30, six of those at the required 0.1 SOL size. None of the 13 has a positive validation trimmed mean. Thus larger size is not the sole source of the fit positives, but the validation failure is reproduced. The 0.2 SOL experiments are sensitivity diagnostics, not the proposed 0.1 SOL book.',
'',header,
...r.audit.map((a:any)=>row(`Pre r15>=${a.r15}, liquidity>=${a.liq}, size ${a.size} / ${a.split}`,a.stats)),
'',
'Concentration checks for r15>=5.58 and liquidity>=$5,000 follow. Every displayed comparison has at least 30 retained trades. Small caller/day groups in the raw JSON are descriptive accounting only and are not used to infer an effect. Best-day exclusions are post-hoc robustness diagnostics, not entry rules. Week groups use fixed seven-day UTC bins starting on Thursdays, matching the previous research.',
'',header,
...r.audit.filter((a:any)=>a.r15===5.58).flatMap((a:any)=>[
 row(`Size ${a.size} / ${a.split}, excluding largest caller ${a.withoutLargestCaller.excluded}`,a.withoutLargestCaller),
 row(`Size ${a.size} / ${a.split}, excluding best day ${a.withoutBestDay.excluded}`,a.withoutBestDay),
 ...a.weeks.filter((w:any)=>w.n>=30).map((w:any)=>row(`Size ${a.size} / ${a.split}, week ${w.group}`,w))]),
'',
'At 0.1 SOL, removing September 17 leaves 80 fit trades and -0.1343 SOL total, versus +0.1603 SOL before exclusion (97 trades). At 0.2 SOL, the same 80 trades retain +0.1336 SOL total but have -0.00053 SOL trimmed mean. Excluding the largest caller leaves positive fit and negative validation results at both sizes. Claude\'s validation caller subgroup has only 19 trades: its apparent sign flip is not evidence under the >=30 rule. The strongest fit-sized cell (r15>=8, liquidity>=$10,000) remains positive after its best day is removed: n=39, total +0.3968 SOL, trimmed +0.00602. A blanket claim that one day explains every fit positive is therefore too strong; its n=32 validation failure remains decisive.',
'',
'New attempt: combine a completed pre-call 15-minute run-up >=4x and liquidity >=$5,000 with post-call confirmation. Require the first post bar within two minutes, three contiguous minute bars, current liquidity >=$5,000, recent volume/second >= the completed pre-window average, and price >=1x or >=1.2x the first post open. Wait at least 3, 5, or 15 minutes, at most 30 minutes measured at bar close. Buy next open, always 0.1 SOL. Three exits: +50%/-30%; half at +100% then 50% trail with initial 50% stop; or 12x target with 80% stop. All decisions use observed bars only.',
'',
'This makes 18 configurations. Twelve meet n>=30 on fit (n=41-57); six have n=27-28 and are excluded from inference. Four qualifying variants have positive raw means, zero have positive trimmed means. Selection is by the highest fit trimmed mean among qualifying configurations, written to codex-r3-fit.json before evaluation on validation. The winner waits three minutes, requires price >=1x, and uses +50%/-30%. The 12x-target comparison below keeps exactly the same entry; it is an exit diagnostic, not a validation-selected candidate.',
'',header,
row('Fit-selected confirmation / fit',r.fit.stats),row('Fit-selected confirmation / validation',r.validation.stats),
row('Same entry, 12x target / fit',r.runner.fit.stats),row('Same entry, 12x target / validation',r.runner.validation.stats),
'',
'The runner diagnostic captures four realized 10x moves across 57 fit trades and has a positive raw total, but total without its best trade is negative. Its 30 validation trades capture one realized 10x and still lose. This directly supports rejecting this entry/exit rule under the required robustness criterion. It does not logically refute every possible price/volume strategy or exhaust the space of simple rules.',
'',
'P&L includes venue fees, liquidity impact, and 0.003 SOL per leg. Trimmed mean drops the two best trades; it is not a symmetric trim. captured5x/captured10x use the referee\'s realizedMult (net sale proceeds divided by size, excluding fixed transaction charges); profit statistics include fixed charges. Partial exits incur extra fixed costs. The full audited and selected trade lists, including mint IDs, are in codex-r3-results.json; all fit variant trade lists are in codex-r3-fit.json.',
'',
'The final abstention has n=0, total=0, total without best=0, captures=0/0 on each split. Mean, trimmed mean, and win rate are undefined. No caller or winning trade carries it. It ties Claude rather than demonstrating an edge. Validation has been repeatedly inspected during this debate, so it is a diagnostic chronological split rather than pristine unseen data; only the sealed later holdout can measure genuine unseen performance. No claim of statistical impossibility or superiority on that holdout is warranted.',
'',
'Exact referee CLI checks (the first two verify the actual submission; the latter two verify the active diagnostic):',
'','```powershell',
...['proposals/codex-r3.ts','work/codex-r3-selected.ts'].flatMap(file=>[
`node --experimental-transform-types scripts/calls-eval.ts ${ROOT}/${file} --data ${ROOT}/data --to 2026-09-18 --trades 0`,
`node --experimental-transform-types scripts/calls-eval.ts ${ROOT}/${file} --data ${ROOT}/data --from 2026-09-18 --to 2026-09-26 --trades 0`]),
'```','',
'Concession: Claude\'s abstention is supported by the reproduced losses and concentration tests. Remaining disagreement: failed correlated grids and a losing runner control do not establish that all price/volume information is useless. The practical submission remains unchanged because neither side has established a robust active improvement.'
];
writeFileSync(ROOT+'/work/codex-r3-report.md',lines.join('\n')+'\n');
console.log('Wrote '+ROOT+'/work/codex-r3-report.md');
