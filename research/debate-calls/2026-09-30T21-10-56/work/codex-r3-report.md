# Codex round 3: final evidence and submission

From the repository root (Node's built-in TypeScript transform avoids package-manager writes):

```powershell
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r3-experiment.ts > research/debate-calls/2026-09-30T21-10-56/work/codex-r3-experiment.out
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r3-report.ts
```

All numerical tables below come from the unchanged evaluate() and PolicyState. The first command writes results, selection, declaration and audit JSON. Run the three referee commands at the end of this report before the report command; the report command reads their machine-written JSON and checks the final proposal results. No live data or post-snapshot directory is read.

## Decision and experimental scope

Submit abstention. This withdraws the round-2 trade recommendation, ties Claude, and does not meet the goal of beating the live rule across all splits or capturing runners. Zero realized P&L from abstention is certain within this simulator; being optimal on unseen calls is not established.

Eight new candidates: completed pre-call flow count 1–300 or 1–1000, crossed with close-based trailing only, no +30% peak by 5 minutes, no +30% peak by 15 minutes, or selling pressure while underwater. All use a 25% hard stop and a next-open exit signal when the close falls 40% below a peak that reached 3x entry. Timeout modes exit weak positions after the deadline until they reach 1.3x; selling pressure means sell USD exceeds buy USD over the latest five minutes, with at least four finished flow bars and at least five minutes held. This is a bar-resolution simulation, not an intraminute deadline guarantee. Position size is 0.1 SOL; referee fees, impact and fixed costs are unchanged.

Two activity caps and four exit modes were explored; fixed constants are recorded in codex-r3-declaration.json. The close-trail mode controls for execution differences from the round-2 intrabar policy. No caller/day identity is used for entry. These are eight correlated trials, not eight independent confirmations. Earlier rounds and Claude’s results informed the hypotheses; neither later split is pristine.

Selection was frozen on fit before this run evaluated later splits. Basic gate: n>=30, positive trimmed mean and positive total without best. Added concentration gate: after removing the best aggregate-P&L caller, and separately the best UTC day, retain n>=30 and positive trimmed mean. Rank survivors on fit trimmed. This stronger gate is a new final-round research choice, not the original referee scoring rule.

Basic passing candidates: flow300/close-trail. Concentration-gate survivors: none. Frozen selection: **abstain**.

## All candidate and control results

Fit is before 2026-09-18 UTC; validation is September 18–26; test is September 26–29 18:00 UTC. Mean and trimmed are SOL per 0.1 SOL entry; total without best is aggregate SOL. Referee trimmed mean removes the two best trades when n>4. Captures are realized proceeds/initial size >=5 or >=10 (before subtracting fixed fees), not merely an intratrade high. Rows with n<30 are descriptive only and supply no qualifying effect evidence.

| Strategy | Split | n | Mean | Trimmed | Total without best | Win % | Captured5x/10x |
|---|---|---:|---:|---:|---:|---:|---:|
| flow300/close-trail | fit | 60 | 0.03383 | 0.00317 | 0.8546 | 16.7 | 3/1 |
| flow300/timeout5 | fit | 60 | 0.01544 | -0.00509 | 0.2559 | 11.7 | 2/0 |
| flow300/timeout15 | fit | 60 | 0.01802 | -0.00243 | 0.4106 | 16.7 | 2/0 |
| flow300/sell-pressure | fit | 60 | 0.01495 | -0.00560 | 0.2265 | 13.3 | 2/0 |
| flow1000/close-trail | fit | 168 | -0.00214 | -0.01329 | -1.5350 | 9.5 | 3/1 |
| flow1000/timeout5 | fit | 168 | -0.00822 | -0.01569 | -2.0526 | 8.3 | 2/0 |
| flow1000/timeout15 | fit | 168 | -0.00836 | -0.01583 | -2.0760 | 9.5 | 2/0 |
| flow1000/sell-pressure | fit | 168 | -0.00670 | -0.01414 | -1.7965 | 7.7 | 2/0 |
| flow300/close-trail | val | 52 | 0.00614 | -0.01403 | -0.3645 | 17.3 | 1/0 |
| flow300/close-trail | test | 16 | -0.01232 | -0.03177 | -0.3693 | 12.5 | 0/0 |
| flow300/timeout5 | val | 52 | 0.00884 | -0.01123 | -0.2243 | 19.2 | 1/0 |
| flow300/timeout5 | test | 16 | -0.01381 | -0.02767 | -0.3930 | 6.3 | 0/0 |
| flow300/timeout15 | val | 52 | 0.00627 | -0.01390 | -0.3579 | 15.4 | 1/0 |
| flow300/timeout15 | test | 16 | -0.00899 | -0.02795 | -0.3159 | 18.8 | 0/0 |
| flow300/sell-pressure | val | 52 | 0.00552 | -0.01469 | -0.3971 | 13.5 | 1/0 |
| flow300/sell-pressure | test | 16 | -0.01446 | -0.02806 | -0.4034 | 6.3 | 0/0 |
| flow1000/close-trail | val | 144 | -0.01434 | -0.02173 | -2.7490 | 10.4 | 1/0 |
| flow1000/close-trail | test | 55 | -0.01025 | -0.02275 | -0.8905 | 10.9 | 0/0 |
| flow1000/timeout5 | val | 144 | -0.01007 | -0.01740 | -2.1335 | 12.5 | 1/0 |
| flow1000/timeout5 | test | 55 | -0.01345 | -0.02337 | -1.0665 | 9.1 | 0/0 |
| flow1000/timeout15 | val | 144 | -0.01314 | -0.02052 | -2.5763 | 10.4 | 1/0 |
| flow1000/timeout15 | test | 55 | -0.00864 | -0.02108 | -0.8022 | 12.7 | 0/0 |
| flow1000/sell-pressure | val | 144 | -0.01205 | -0.01941 | -2.4187 | 9.0 | 1/0 |
| flow1000/sell-pressure | test | 55 | -0.00762 | -0.02002 | -0.7457 | 9.1 | 0/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | fit | 60 | 0.03916 | 0.00645 | 1.1143 | 16.7 | 4/1 |
| codex-r2: completed flow <=300, stop25, trail200/40 | val | 52 | 0.01265 | -0.01085 | -0.1914 | 17.3 | 1/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | test | 16 | -0.00787 | -0.03177 | -0.3615 | 12.5 | 0/0 |
| claude-r3: stand aside (no leak-free entry survives validation) | fit | 0 | undefined | undefined | 0.0000 | undefined | 0/0 |
| claude-r3: stand aside (no leak-free entry survives validation) | val | 0 | undefined | undefined | 0.0000 | undefined | 0/0 |
| claude-r3: stand aside (no leak-free entry survives validation) | test | 0 | undefined | undefined | 0.0000 | undefined | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | fit | 110 | 0.01573 | 0.01436 | 1.6403 | 50.9 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | val | 73 | 0.03766 | 0.03620 | 2.6596 | 65.8 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | test | 37 | 0.02453 | 0.02081 | 0.8175 | 56.8 | 0/0 |
| flow0-100/fixed | fit | 24 | -0.01759 | -0.02705 | -0.5097 | 20.8 | 0/0 |
| flow0-100/fixed | val | 15 | -0.00698 | -0.02169 | -0.1935 | 33.3 | 0/0 |
| flow0-100/fixed | test | 5 | -0.03959 | -0.04774 | -0.1743 | 0.0 | 0/0 |

## Concentration and influential trades

Claude’s submitted strategy has n=0 in every split, no trading parameters affecting realized outcomes, and no winning caller or day. Its absence of losses is mechanical; it provides no positive evidence about a profitable entry. To attack the alternative fairly, these are the rerun round-2 results and the best new fit candidate, including their highest-contributing caller and UTC day. Full group results for every candidate are in codex-r3-results.json.

| Strategy | Split | Exclusion | Removed group | Remaining n | Mean | Trimmed | Total without best | Win % | Captured5x/10x |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| flow300/close-trail | fit | caller | caller_03 | 50 | 0.00473 | -0.01624 | -0.4343 | 12.0 | 1/0 |
| flow300/close-trail | fit | day | 2026-09-02 | 56 | 0.00644 | -0.01213 | -0.3099 | 14.3 | 1/0 |
| flow300/close-trail | val | caller | caller_07 | 49 | -0.00606 | -0.01791 | -0.6342 | 16.3 | 0/0 |
| flow300/close-trail | val | day | 2026-09-24 | 44 | -0.00344 | -0.01658 | -0.4887 | 18.2 | 0/0 |
| flow300/close-trail | test | caller | caller_07 | 11 | -0.03132 | -0.03336 | -0.3239 | 0.0 | 0/0 |
| flow300/close-trail | test | day | 2026-09-29 | 9 | -0.03220 | -0.03358 | -0.2662 | 0.0 | 0/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | fit | caller | caller_03 | 50 | 0.00857 | -0.01475 | -0.3115 | 12.0 | 2/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | fit | day | 2026-09-02 | 56 | 0.01038 | -0.01029 | -0.1589 | 14.3 | 2/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | val | caller | caller_07 | 49 | -0.00253 | -0.01482 | -0.4752 | 16.3 | 0/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | val | day | 2026-09-24 | 44 | 0.00049 | -0.01312 | -0.3297 | 18.2 | 0/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | test | caller | caller_07 | 11 | -0.03132 | -0.03336 | -0.3239 | 0.0 | 0/0 |
| codex-r2: completed flow <=300, stop25, trail200/40 | test | day | 2026-09-29 | 9 | -0.03220 | -0.03358 | -0.2662 | 0.0 | 0/0 |


Largest three trades per focused strategy/split (individual observations, not inferential samples):

| Strategy | Split / n | UTC call time | Caller | Mint | P&L SOL | Realized multiple |
|---|---|---|---|---|---:|---:|
| flow300/close-trail | fit / 60 | 2026-09-02T15:21:59.000Z | caller_03 | DwDLJfsaodJ78Vq6obqDoypCPVyJK9jzWKT7wk81pump | 1.17487 | 12.81 |
| flow300/close-trail | fit / 60 | 2026-09-16T12:50:01.000Z | caller_01 | 7gKKy2p1SaMkRFPX7caF96YpfuMMpDj82ZpjaffuvaU5 | 0.67076 | 7.77 |
| flow300/close-trail | fit / 60 | 2026-09-02T02:37:16.000Z | caller_03 | BX7SJo6LBpT971MJ4TBcnfEcPRSgnR6ymYEmSsEec79e | 0.55133 | 6.57 |
| flow300/close-trail | val / 52 | 2026-09-24T10:10:49.000Z | caller_07 | G59zeXWwXMw2bb6UJD1ceELXRhNkLXHkYrtBYBV5agnt | 0.68398 | 7.90 |
| flow300/close-trail | val / 52 | 2026-09-23T03:07:35.000Z | caller_05 | ExcKwtZ95yTobhh7xuAysmBcsBTzvosRX3o43rqnMgYY | 0.33718 | 4.43 |
| flow300/close-trail | val / 52 | 2026-09-20T02:33:31.000Z | caller_03 | 6ya9vL1D9frrPtjJKemwNwYCNbA8EbroqBxchJq1STNK | 0.20752 | 3.14 |
| flow300/close-trail | test / 16 | 2026-09-29T06:10:41.000Z | caller_07 | FeTi15LB5PCLhjioeBcJR8p4Xj6izdMztfw3J8nfEZUD | 0.17209 | 2.78 |
| flow300/close-trail | test / 16 | 2026-09-29T04:00:33.000Z | caller_07 | 7zJDJdbiPk7EzpPK8GX6QqHF3zWXFdauNJFiBMYnSTNK | 0.07547 | 1.81 |
| flow300/close-trail | test / 16 | 2026-09-29T09:46:06.000Z | caller_01 | 9HAJX5QCka4Yrgjz7eaJQEhjNuL4N76fQ1VJPFApump | -0.02061 | 0.85 |
| codex-r2: completed flow <=300, stop25, trail200/40 | fit / 60 | 2026-09-02T15:21:59.000Z | caller_03 | DwDLJfsaodJ78Vq6obqDoypCPVyJK9jzWKT7wk81pump | 1.23559 | 13.42 |
| codex-r2: completed flow <=300, stop25, trail200/40 | fit / 60 | 2026-09-16T12:50:01.000Z | caller_01 | 7gKKy2p1SaMkRFPX7caF96YpfuMMpDj82ZpjaffuvaU5 | 0.74026 | 8.46 |
| codex-r2: completed flow <=300, stop25, trail200/40 | fit / 60 | 2026-09-02T02:37:16.000Z | caller_03 | BX7SJo6LBpT971MJ4TBcnfEcPRSgnR6ymYEmSsEec79e | 0.59049 | 6.96 |
| codex-r2: completed flow <=300, stop25, trail200/40 | val / 52 | 2026-09-24T10:10:49.000Z | caller_07 | G59zeXWwXMw2bb6UJD1ceELXRhNkLXHkYrtBYBV5agnt | 0.84933 | 9.55 |
| codex-r2: completed flow <=300, stop25, trail200/40 | val / 52 | 2026-09-23T03:07:35.000Z | caller_05 | ExcKwtZ95yTobhh7xuAysmBcsBTzvosRX3o43rqnMgYY | 0.35130 | 4.57 |
| codex-r2: completed flow <=300, stop25, trail200/40 | val / 52 | 2026-09-20T02:33:31.000Z | caller_03 | 6ya9vL1D9frrPtjJKemwNwYCNbA8EbroqBxchJq1STNK | 0.22135 | 3.27 |
| codex-r2: completed flow <=300, stop25, trail200/40 | test / 16 | 2026-09-29T06:10:41.000Z | caller_07 | FeTi15LB5PCLhjioeBcJR8p4Xj6izdMztfw3J8nfEZUD | 0.23560 | 3.42 |
| codex-r2: completed flow <=300, stop25, trail200/40 | test / 16 | 2026-09-29T04:00:33.000Z | caller_07 | 7zJDJdbiPk7EzpPK8GX6QqHF3zWXFdauNJFiBMYnSTNK | 0.08326 | 1.89 |
| codex-r2: completed flow <=300, stop25, trail200/40 | test / 16 | 2026-09-29T09:46:06.000Z | caller_01 | 9HAJX5QCka4Yrgjz7eaJQEhjNuL4N76fQ1VJPFApump | -0.02061 | 0.85 |

## Paired exit comparison

Same tokens and entry prices: changes below are aggregate P&L relative to close-trail at the same cap, not relative to the round-2 policy. Timing and flow exits are not rescued by comparing against a different execution mechanism.

| Candidate | Split | Paired n | Delta total SOL | Delta captured5x | Delta captured10x |
|---|---|---:|---:|---:|---:|
| flow300/timeout5 | fit | 60 | -1.10284 | -1 | -1 |
| flow300/timeout15 | fit | 60 | -0.94813 | -1 | -1 |
| flow300/sell-pressure | fit | 60 | -1.13227 | -1 | -1 |
| flow1000/timeout5 | fit | 168 | -1.02165 | -1 | -1 |
| flow1000/timeout15 | fit | 168 | -1.04514 | -1 | -1 |
| flow1000/sell-pressure | fit | 168 | -0.76556 | -1 | -1 |
| flow300/timeout5 | val | 52 | 0.14021 | 0 | 0 |
| flow300/timeout5 | test | 16 | -0.02370 | 0 | 0 |
| flow300/timeout15 | val | 52 | 0.00658 | 0 | 0 |
| flow300/timeout15 | test | 16 | 0.05341 | 0 | 0 |
| flow300/sell-pressure | val | 52 | -0.03259 | 0 | 0 |
| flow300/sell-pressure | test | 16 | -0.03416 | 0 | 0 |
| flow1000/timeout5 | val | 144 | 0.61552 | 0 | 0 |
| flow1000/timeout5 | test | 55 | -0.17592 | 0 | 0 |
| flow1000/timeout15 | val | 144 | 0.17265 | 0 | 0 |
| flow1000/timeout15 | test | 55 | 0.08835 | 0 | 0 |
| flow1000/sell-pressure | val | 144 | 0.33031 | 0 | 0 |
| flow1000/sell-pressure | test | 55 | 0.14487 | 0 | 0 |

## Rebuttal: recent flow is not a measured lifetime count

| Split | Eligible n | Event count <=100 | Completed flow <=100 | Both | Flow <=100 but events >100 | No completed flow | Unfinished ctx.pre bars present |
|---|---:|---:|---:|---:|---:|---:|---:|
| fit | 574 | 110 | 24 | 16 | 8 | 1 | 558 |
| val | 351 | 73 | 15 | 10 | 5 | 1 | 338 |
| test | 154 | 37 | 5 | 3 | 2 | 0 | 153 |

Across 1079 eligible calls, the flow proxy selects 44 and the event rule 220, with only 29 in common. Of the 44 flow-qualified calls, 15 have >100 events and 2 have no completed flow bars. These are descriptive coverage counts, not a performance effect. The 44/220 ratio compares different selected sets; it is not an observed live trade-frequency ratio.

The available flow window omits the unfinished call minute and is finite. No older active price bars were available in this audit to establish lifetime age: zero of 1079 eligible calls had positive-volume pre bars ending more than six hours before the call. Thus this negative audit cannot establish that all low-flow tokens are new. The simulator’s documented six-hour flow history is a recent-activity measure; actual lifetime coverage needs a separate source.

Source inspection: apps/telegram/src/trader.ts, tradesBeforeCall(), uses local trades_raw when a recorded launch exists, otherwise an API query over the previous 14 days; “not found” maps to zero. Neither path equals completed six-hour flow bars. Reproduce source inspection: `Get-Content apps/telegram/src/trader.ts -TotalCount 75`. The source explains why equivalence is unproven; the sealed sample has no contemporaneous live decisions establishing the direction or size of the difference.

I concede the event-history comparability problem and the round-2 concentration failure. I dispute declaring abstention the highest expected-value strategy, treating recent flow as exact live youth, or asserting that the next holdout must repeat precisely the same gap. Those are unmeasured forward claims. Likewise, the existence of 116 ex-post 5x opportunities across 1079 eligible calls does not establish a tradable entry rule: Claude captures 0/0 at n=0 on all splits.

## Referee verification of final proposal

| Split | n | Mean | Trimmed | Total without best | Win % | Captured5x/10x |
|---|---:|---:|---:|---:|---:|---:|
| fit | 0 | undefined | undefined | 0.00000 | undefined | 0/0 |
| val | 0 | undefined | undefined | 0.00000 | undefined | 0/0 |
| test | 0 | undefined | undefined | 0.00000 | undefined | 0/0 |


```powershell

node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T21-10-56/proposals/codex-r3.ts --data research/debate-calls/2026-09-30T21-10-56/data --to 2026-09-18T00:00:00Z --trades 0 > research/debate-calls/2026-09-30T21-10-56/work/codex-r3-referee-fit.json

node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T21-10-56/proposals/codex-r3.ts --data research/debate-calls/2026-09-30T21-10-56/data --from 2026-09-18T00:00:00Z --to 2026-09-26T00:00:00Z --trades 0 > research/debate-calls/2026-09-30T21-10-56/work/codex-r3-referee-val.json

node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T21-10-56/proposals/codex-r3.ts --data research/debate-calls/2026-09-30T21-10-56/data --from 2026-09-26T00:00:00Z --to 2026-09-29T18:00:00Z --trades 0 > research/debate-calls/2026-09-30T21-10-56/work/codex-r3-referee-test.json

```


No evidence here proves that the live rule cannot be improved. Final abstention is the defensible submission under the stated robustness checks, with no claim to win the unseen sample. The runner-capture objective remains unmet.
