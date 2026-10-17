Final Codex round 3: retain cash. No tested active rule establishes robust after-cost profit on both chronological splits. The submitted strategy mechanically ties Claude's final abstention.

All inputs are from the sealed snapshot and earlier research inside this debate directory. Fit: calls before 2026-09-18T00:00:00Z. Validation: calls from that instant through 2026-09-26T00:00:00Z exclusive. The simulator deduplicates to first call per mint: 574 eligible fit calls and 351 validation calls; respectively 5 and 1 have no usable data. No later holdout or live data was read. Writes are confined to this debate directory.

Reproduce all experiments, trade lists, grid counts, concentrations, and this report from repository root:

```powershell
node --experimental-transform-types research/debate-calls/2026-09-30T19-09-03/work/codex-r3-experiments.ts
node --experimental-transform-types research/debate-calls/2026-09-30T19-09-03/work/codex-r3-report.ts
```

The experiment imports the unmodified referee evaluate() directly. Its independent six-run audit verifies both the trade counts and each individual P&L against Claude's r2-table.json to 1e-12 SOL. The table itself is reproducible with work/r2-table.ts against the sealed data. The same runtime can execute the unmodified CLI (commands below); Node's transform-types handles PolicyState's TypeScript constructor parameters.

Claude audit: 60 threshold/exit/size combinations, 13 fit-positive trimmed means with n>=30, six of those at the required 0.1 SOL size. None of the 13 has a positive validation trimmed mean. Thus larger size is not the sole source of the fit positives, but the validation failure is reproduced. The 0.2 SOL experiments are sensitivity diagnostics, not the proposed 0.1 SOL book.

| Strategy / split | n | Total SOL | Mean SOL | Trimmed mean SOL | Total without best SOL | Win % | Captured 5x / 10x |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pre r15>=5.58, liquidity>=5000, size 0.1 / fit | 97 | 0.1603 | 0.00165 | 0.00083 | 0.1194 | 50.5 | 0 / 0 |
| Pre r15>=5.58, liquidity>=5000, size 0.1 / validation | 61 | -0.2875 | -0.00471 | -0.00625 | -0.3282 | 42.6 | 0 / 0 |
| Pre r15>=5.58, liquidity>=5000, size 0.2 / fit | 97 | 0.8082 | 0.00833 | 0.00666 | 0.7206 | 50.5 | 0 / 0 |
| Pre r15>=5.58, liquidity>=5000, size 0.2 / validation | 61 | -0.2659 | -0.00436 | -0.00743 | -0.3528 | 42.6 | 0 / 0 |
| Pre r15>=8, liquidity>=10000, size 0.2 / fit | 48 | 1.0142 | 0.02113 | 0.01825 | 0.9268 | 58.3 | 0 / 0 |
| Pre r15>=8, liquidity>=10000, size 0.2 / validation | 32 | -0.2239 | -0.00700 | -0.01322 | -0.3108 | 40.6 | 0 / 0 |

Concentration checks for r15>=5.58 and liquidity>=$5,000 follow. Every displayed comparison has at least 30 retained trades. Small caller/day groups in the raw JSON are descriptive accounting only and are not used to infer an effect. Best-day exclusions are post-hoc robustness diagnostics, not entry rules. Week groups use fixed seven-day UTC bins starting on Thursdays, matching the previous research.

| Strategy / split | n | Total SOL | Mean SOL | Trimmed mean SOL | Total without best SOL | Win % | Captured 5x / 10x |
|---|---:|---:|---:|---:|---:|---:|---:|
| Size 0.1 / fit, excluding largest caller caller_01 | 53 | 0.2528 | 0.00477 | 0.00335 | 0.2119 | 54.7 | 0 / 0 |
| Size 0.1 / fit, excluding best day 2026-09-17 | 80 | -0.1343 | -0.00168 | -0.00277 | -0.1752 | 46.3 | 0 / 0 |
| Size 0.1 / fit, week 2026-09-10 | 57 | -0.1171 | -0.00205 | -0.00361 | -0.1580 | 45.6 | 0 / 0 |
| Size 0.1 / validation, excluding largest caller caller_01 | 42 | -0.4214 | -0.01003 | -0.01256 | -0.4621 | 35.7 | 0 / 0 |
| Size 0.1 / validation, excluding best day 2026-09-19 | 46 | -0.4197 | -0.00912 | -0.01138 | -0.4602 | 37.0 | 0 / 0 |
| Size 0.1 / validation, week 2026-09-17 | 53 | -0.2174 | -0.00410 | -0.00585 | -0.2581 | 43.4 | 0 / 0 |
| Size 0.2 / fit, excluding largest caller caller_01 | 53 | 0.7743 | 0.01461 | 0.01175 | 0.6867 | 54.7 | 0 / 0 |
| Size 0.2 / fit, excluding best day 2026-09-17 | 80 | 0.1336 | 0.00167 | -0.00053 | 0.0460 | 46.3 | 0 / 0 |
| Size 0.2 / fit, week 2026-09-10 | 57 | 0.0530 | 0.00093 | -0.00221 | -0.0346 | 45.6 | 0 / 0 |
| Size 0.2 / validation, excluding largest caller caller_01 | 42 | -0.6276 | -0.01494 | -0.02001 | -0.7146 | 35.7 | 0 / 0 |
| Size 0.2 / validation, excluding best day 2026-09-19 | 46 | -0.6034 | -0.01312 | -0.01761 | -0.6892 | 37.0 | 0 / 0 |
| Size 0.2 / validation, week 2026-09-17 | 53 | -0.1643 | -0.00310 | -0.00661 | -0.2512 | 43.4 | 0 / 0 |

At 0.1 SOL, removing September 17 leaves 80 fit trades and -0.1343 SOL total, versus +0.1603 SOL before exclusion (97 trades). At 0.2 SOL, the same 80 trades retain +0.1336 SOL total but have -0.00053 SOL trimmed mean. Excluding the largest caller leaves positive fit and negative validation results at both sizes. Claude's validation caller subgroup has only 19 trades: its apparent sign flip is not evidence under the >=30 rule. The strongest fit-sized cell (r15>=8, liquidity>=$10,000) remains positive after its best day is removed: n=39, total +0.3968 SOL, trimmed +0.00602. A blanket claim that one day explains every fit positive is therefore too strong; its n=32 validation failure remains decisive.

New attempt: combine a completed pre-call 15-minute run-up >=4x and liquidity >=$5,000 with post-call confirmation. Require the first post bar within two minutes, three contiguous minute bars, current liquidity >=$5,000, recent volume/second >= the completed pre-window average, and price >=1x or >=1.2x the first post open. Wait at least 3, 5, or 15 minutes, at most 30 minutes measured at bar close. Buy next open, always 0.1 SOL. Three exits: +50%/-30%; half at +100% then 50% trail with initial 50% stop; or 12x target with 80% stop. All decisions use observed bars only.

This makes 18 configurations. Twelve meet n>=30 on fit (n=41-57); six have n=27-28 and are excluded from inference. Four qualifying variants have positive raw means, zero have positive trimmed means. Selection is by the highest fit trimmed mean among qualifying configurations, written to codex-r3-fit.json before evaluation on validation. The winner waits three minutes, requires price >=1x, and uses +50%/-30%. The 12x-target comparison below keeps exactly the same entry; it is an exit diagnostic, not a validation-selected candidate.

| Strategy / split | n | Total SOL | Mean SOL | Trimmed mean SOL | Total without best SOL | Win % | Captured 5x / 10x |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fit-selected confirmation / fit | 57 | -0.5960 | -0.01046 | -0.01232 | -0.6369 | 35.1 | 0 / 0 |
| Fit-selected confirmation / validation | 30 | -0.2756 | -0.00919 | -0.01275 | -0.3164 | 36.7 | 0 / 0 |
| Same entry, 12x target / fit | 57 | 0.6425 | 0.01127 | -0.02693 | -0.4206 | 12.3 | 4 / 4 |
| Same entry, 12x target / validation | 30 | -1.3244 | -0.04415 | -0.08605 | -2.3839 | 6.7 | 1 / 1 |

The runner diagnostic captures four realized 10x moves across 57 fit trades and has a positive raw total, but total without its best trade is negative. Its 30 validation trades capture one realized 10x and still lose. This directly supports rejecting this entry/exit rule under the required robustness criterion. It does not logically refute every possible price/volume strategy or exhaust the space of simple rules.

P&L includes venue fees, liquidity impact, and 0.003 SOL per leg. Trimmed mean drops the two best trades; it is not a symmetric trim. captured5x/captured10x use the referee's realizedMult (net sale proceeds divided by size, excluding fixed transaction charges); profit statistics include fixed charges. Partial exits incur extra fixed costs. The full audited and selected trade lists, including mint IDs, are in codex-r3-results.json; all fit variant trade lists are in codex-r3-fit.json.

The final abstention has n=0, total=0, total without best=0, captures=0/0 on each split. Mean, trimmed mean, and win rate are undefined. No caller or winning trade carries it. It ties Claude rather than demonstrating an edge. Validation has been repeatedly inspected during this debate, so it is a diagnostic chronological split rather than pristine unseen data; only the sealed later holdout can measure genuine unseen performance. No claim of statistical impossibility or superiority on that holdout is warranted.

Exact referee CLI checks (the first two verify the actual submission; the latter two verify the active diagnostic):

```powershell
node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T19-09-03/proposals/codex-r3.ts --data research/debate-calls/2026-09-30T19-09-03/data --to 2026-09-18 --trades 0
node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T19-09-03/proposals/codex-r3.ts --data research/debate-calls/2026-09-30T19-09-03/data --from 2026-09-18 --to 2026-09-26 --trades 0
node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T19-09-03/work/codex-r3-selected.ts --data research/debate-calls/2026-09-30T19-09-03/data --to 2026-09-18 --trades 0
node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T19-09-03/work/codex-r3-selected.ts --data research/debate-calls/2026-09-30T19-09-03/data --from 2026-09-18 --to 2026-09-26 --trades 0
```

Concession: Claude's abstention is supported by the reproduced losses and concentration tests. Remaining disagreement: failed correlated grids and a losing runner control do not establish that all price/volume information is useless. The practical submission remains unchanged because neither side has established a robust active improvement.
