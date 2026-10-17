# Codex round 2: a fit-selected challenger, not a validated winner

Submitted: proposals/codex-r2.ts, **flow300/stop25**. Entry: at the call, count buys plus sells in completed pre-call flow minutes; accept 1–300. Exit: -25% initial stop, arm at +200%, then trail 40%. Size defaults to 0.1 SOL. No preTrades, ctx.pre, caller identity or calendar exclusions. The six-hour count is a lower bound on lifetime activity, not proof of youth. This is a paper-debate challenger, not evidence for deploying a profitable rule.

## Reproduction

From D:/pumpfun (only this debate folder is written):

```powershell
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r2-experiment.ts > research/debate-calls/2026-09-30T21-10-56/work/codex-r2-experiment.out
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r2-report.ts
$debateDir = 'research/debate-calls/2026-09-30T21-10-56'
node --experimental-transform-types scripts/calls-eval.ts $debateDir/proposals/codex-r2.ts --data $debateDir/data --to 2026-09-18T00:00:00Z --trades 0
node --experimental-transform-types scripts/calls-eval.ts $debateDir/proposals/codex-r2.ts --data $debateDir/data --from 2026-09-18T00:00:00Z --to 2026-09-26T00:00:00Z --trades 0
node --experimental-transform-types scripts/calls-eval.ts $debateDir/proposals/codex-r2.ts --data $debateDir/data --from 2026-09-26T00:00:00Z --to 2026-09-29T18:00:00Z --trades 0
```

Node's TypeScript transform runs the original referee evaluate() and PolicyState without changes, using the read-only cache from grid.ts. The npx/tsx launcher failed in round 1; no dependency install or external data is needed. The first command produces all experiment numbers and trade records; the second produces the derived concentration and paired comparisons here. CLI verification JSON is stored in codex-r2-referee-{fit,val,test}.json. Every summary field except the strategy name matched the experiment on all three splits. No live data or post-snapshot cohort was accessed.

## Selection, search scope and rebuttal

Three entries times four exits = 12 candidates fixed in the experiment source before running. One entry repeats round 1's 1–300 completed-flow trade rule. The other entries require completed post-call flow confirmation between 5 and 15 minutes: more buy than sell USD during the most recent five minutes (at least four fully post-call minutes), plus a close above the last finished pre-call close with flow <=1,000, or above the prior 15-minute high without that count cap. All confirmation decisions use completed one-minute bars; fill is at the next bar's open.

Four exits: the prior +200% arm/40% trail/-50% stop; a wider 60% trail; half out at +100% then 60% trail with -50% initial stop; and the original trailing exit with a tighter -25% stop. The submitted rule has four numerical thresholds (300, 25, 200, 40); arm/trail were inherited, the count was explored in round 1, and the stop is the new change. Twelve candidate fits are not twelve independent discoveries. All three controls and all later-split outcomes are disclosed. Across my two rounds there were 24 candidate configurations including repeated references; Codex's round-1 report documents Claude's 98-exit exploratory grid, and Claude r2 adds four entry/exit candidates and 30 feature quintile cells under two exits. No one has a pristine internal test set now.

Selection gate: at least 30 fit trades, positive trimmed mean, positive total without best, then maximize trimmed mean. **One of 12 passes: flow300/stop25.** Selection was saved before later-split evaluation. I retain that selection rather than switching strategies after seeing validation. This is a rebuttal of the claim that no tested eligible causal-input rule can pass the fit gate, not a claim that fit selection proves an edge.

The selected rule's fit n=60, mean +0.03916, trimmed +0.00645 and total without best +1.1143 beat zero on fit. However, validation n=52 has trimmed -0.01085 and total without best -0.1914. Test n=16 is below the required minimum and is descriptive only. The live rule's trimmed means +0.01436/+0.03620/+0.02081 (n=110/73/37) exceed the submission on all three splits. **The all-splits bar is not met.**

Claude's proposal buys nothing: n=0 in each split, P&L=0, no influential trades/callers/days, zero fitted entry thresholds. It cannot demonstrate positive runner capture or statistically supported future superiority from a sample of zero trades. Its caution is justified: validation's strongest trade below contributes +0.84933 SOL against total +0.65796 (52 trades), so one runner carries that result. Removing the strongest validation caller leaves n=49, mean -0.00253; removing the strongest day leaves n=44, trimmed -0.01312. Even fit's positive trim fails after the best caller is excluded (n=50, trimmed -0.01475, without-best -0.3115). These are group exclusion diagnostics, not assertions of caller skill from small subgroups.

Concede Claude's critique of my earlier flow300/trail40: n=60 fit trimmed -0.00591 and n=52 validation without-best -0.1056. Also concede that buying all calls with trailing loses before trimming: mean -0.01848/-0.01320/-0.01164 (n=574/351/154); the trimmed-mean definition is not the cause of those losses. Trimming removes the top two P&Ls, an asymmetric robustness test rather than an unbiased estimate of expected return. Raw mean and runner capture must therefore be shown alongside it.

The historical event-count coverage concern remains unresolved; using completed flow avoids relying on that count, but does not prove the provider's entire historical dataset is free of revision or selection effects. I do not equate missing events with youth or claim all uses of ctx.pre are invalid: filtering to bars whose ends precede the decision is valid in principle. No new causal claim about the provider API is required by this proposal.

The reason to carry this challenger forward is testable: the tighter stop may reduce dead-call losses while retaining large runners. Its fit result supports that mechanism, but the paired validation comparison below contradicts a stable improvement. I make no claim that it should reliably win unseen calls. A true forward sample must resolve it; thresholds remain frozen.

## All referee results

Fit before Sep 18 UTC; validation Sep 18–26; test Sep 26–Sep 29 18:00 UTC. P&L is SOL per 0.1 SOL position after referee costs. Trim removes the best two trades when n>4. Capture uses proceeds/size after variable costs, before fixed leg costs. * means n<30: ignore as evidence. NA means undefined, not zero. All rows are generated by the experiment command above.

| Strategy | Split | n | Mean | Trim | Total | Without best | Win % | Captured5x/10x |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| flow300/trail40 | fit | 60 | 0.02721 | -0.00591 | 1.6328 | 0.3972 | 18.3 | 4/1 |
| flow300/trail60 | fit | 60 | 0.00444 | -0.01685 | 0.2665 | -0.5181 | 18.3 | 3/0 |
| flow300/scale-half | fit | 60 | -0.00620 | -0.01866 | -0.3721 | -0.8121 | 23.3 | 1/0 |
| flow300/stop25 | fit | 60 | 0.03916 | 0.00645 | 2.3499 | 1.1143 | 16.7 | 4/1 |
| flow1000-confirm/trail40 | fit | 75 | 0.00424 | -0.02030 | 0.3178 | -0.9973 | 20.0 | 2/1 |
| flow1000-confirm/trail60 | fit | 75 | -0.01505 | -0.03087 | -1.1286 | -1.9656 | 20.0 | 1/0 |
| flow1000-confirm/scale-half | fit | 75 | -0.01323 | -0.02255 | -0.9926 | -1.4598 | 29.3 | 1/0 |
| flow1000-confirm/stop25 | fit | 75 | 0.01206 | -0.01226 | 0.9045 | -0.4107 | 14.7 | 2/1 |
| breakout-confirm/trail40 | fit | 209 | -0.01356 | -0.02239 | -2.8347 | -4.1499 | 16.3 | 3/1 |
| breakout-confirm/trail60 | fit | 209 | -0.02563 | -0.03133 | -5.3577 | -6.1947 | 16.3 | 1/0 |
| breakout-confirm/scale-half | fit | 209 | -0.02312 | -0.02651 | -4.8328 | -5.3000 | 24.4 | 1/0 |
| breakout-confirm/stop25 | fit | 209 | -0.00138 | -0.01009 | -0.2888 | -1.6039 | 11.5 | 3/1 |
| flow300/trail40 | val | 52 | 0.01430 | -0.00914 | 0.7437 | -0.1056 | 23.1 | 1/0 |
| flow300/trail40 | test | 16* | -0.01855 | -0.04397 | -0.2967 | -0.5323 | 18.8 | 0/0 |
| flow300/trail60 | val | 52 | -0.00364 | -0.02252 | -0.1892 | -0.9150 | 23.1 | 1/0 |
| flow300/trail60 | test | 16* | -0.02645 | -0.04397 | -0.4232 | -0.5953 | 18.8 | 0/0 |
| flow300/scale-half | val | 52 | -0.01647 | -0.02247 | -0.8565 | -1.0039 | 32.7 | 0/0 |
| flow300/scale-half | test | 16* | -0.02364 | -0.03991 | -0.3782 | -0.5069 | 25.0 | 0/0 |
| flow300/stop25 | val | 52 | 0.01265 | -0.01085 | 0.6580 | -0.1914 | 17.3 | 1/0 |
| flow300/stop25 | test | 16* | -0.00787 | -0.03177 | -0.1259 | -0.3615 | 12.5 | 0/0 |
| flow1000-confirm/trail40 | val | 67 | -0.01926 | -0.03292 | -1.2903 | -1.8609 | 14.9 | 1/0 |
| flow1000-confirm/trail40 | test | 26* | -0.02484 | -0.04823 | -0.6459 | -0.9054 | 11.5 | 0/0 |
| flow1000-confirm/trail60 | val | 67 | -0.02985 | -0.04171 | -1.9998 | -2.4827 | 14.9 | 1/0 |
| flow1000-confirm/trail60 | test | 26* | -0.02672 | -0.05091 | -0.6948 | -1.0890 | 11.5 | 1/0 |
| flow1000-confirm/scale-half | val | 67 | -0.02684 | -0.03440 | -1.7985 | -2.0825 | 22.4 | 0/0 |
| flow1000-confirm/scale-half | test | 26* | -0.02878 | -0.04562 | -0.7482 | -0.9866 | 15.4 | 0/0 |
| flow1000-confirm/stop25 | val | 67 | -0.02077 | -0.02713 | -1.3914 | -1.5935 | 7.5 | 0/0 |
| flow1000-confirm/stop25 | test | 26* | -0.01718 | -0.03307 | -0.4468 | -0.7063 | 7.7 | 0/0 |
| breakout-confirm/trail40 | val | 121 | -0.02818 | -0.03731 | -3.4096 | -3.9801 | 11.6 | 2/0 |
| breakout-confirm/trail40 | test | 53 | -0.02445 | -0.03628 | -1.2959 | -1.5984 | 13.2 | 0/0 |
| breakout-confirm/trail60 | val | 121 | -0.03782 | -0.04480 | -4.5765 | -5.0594 | 11.6 | 1/0 |
| breakout-confirm/trail60 | test | 53 | -0.03424 | -0.04229 | -1.8145 | -1.9905 | 13.2 | 0/0 |
| breakout-confirm/scale-half | val | 121 | -0.02934 | -0.03370 | -3.5497 | -3.8337 | 23.1 | 0/0 |
| breakout-confirm/scale-half | test | 53 | -0.02735 | -0.03341 | -1.4497 | -1.5791 | 22.6 | 0/0 |
| breakout-confirm/stop25 | val | 121 | -0.02213 | -0.02806 | -2.6775 | -3.1368 | 5.8 | 1/0 |
| breakout-confirm/stop25 | test | 53 | -0.01202 | -0.02324 | -0.6371 | -0.9396 | 9.4 | 0/0 |
| claude-r2: stand aside (no leak-free entry passes the fit gate) | fit | 0* | NA | NA | 0.0000 | 0.0000 | NA | 0/0 |
| claude-r2: stand aside (no leak-free entry passes the fit gate) | val | 0* | NA | NA | 0.0000 | 0.0000 | NA | 0/0 |
| claude-r2: stand aside (no leak-free entry passes the fit gate) | test | 0* | NA | NA | 0.0000 | 0.0000 | NA | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | fit | 110 | 0.01573 | 0.01436 | 1.7301 | 1.6403 | 50.9 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | val | 73 | 0.03766 | 0.03620 | 2.7490 | 2.6596 | 65.8 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | test | 37 | 0.02453 | 0.02081 | 0.9075 | 0.8175 | 56.8 | 0/0 |
| all/trail40 | fit | 574 | -0.01848 | -0.02277 | -10.6071 | -11.8427 | 15.0 | 8/3 |
| all/trail40 | val | 351 | -0.01320 | -0.01754 | -4.6330 | -5.4824 | 16.0 | 7/0 |
| all/trail40 | test | 154 | -0.01164 | -0.01816 | -1.7932 | -2.2923 | 17.5 | 3/0 |

## Paired effect of reducing the stop from 50% to 25%

Same entries, arm and trail; only initial stop changes. Individual improved/hurt counts describe the complete cohorts; they are not separate small-sample significance claims.

| Split | n | Improved trades | Hurt trades | Unchanged | Change in total SOL | Old captures5x/10x | New captures5x/10x |
|---|---:|---:|---:|---:|---:|---:|---:|
| fit | 60 | 38 | 1 | 21 | 0.71707 | 4/1 | 4/1 |
| val | 52 | 32 | 5 | 15 | -0.08574 | 1/0 | 1/0 |
| test | 16* | 10 | 1 | 5 | 0.17084 | 0/0 | 0/0 |

## Exclude the largest P&L caller or UTC day

Exclusions are diagnostics only, selected separately within each split, never trading filters. The empty Claude strategy has no groups to exclude. Full group records for every candidate are in codex-r2-stress.json.

| Strategy | Split | Excluded group | Remaining n | Mean | Trim | Without best | Win % | Captured5x/10x |
|---|---|---|---:|---:|---:|---:|---:|---:|
| flow300/stop25 | fit | caller: caller_03 | 50 | 0.00857 | -0.01475 | -0.3115 | 12.0 | 2/0 |
| flow300/stop25 | fit | day: 2026-09-02 | 56 | 0.01038 | -0.01029 | -0.1589 | 14.3 | 2/0 |
| flow300/stop25 | val | caller: caller_07 | 49 | -0.00253 | -0.01482 | -0.4752 | 16.3 | 0/0 |
| flow300/stop25 | val | day: 2026-09-24 | 44 | 0.00049 | -0.01312 | -0.3297 | 18.2 | 0/0 |
| flow300/stop25 | test | caller: caller_07 | 11* | -0.03132 | -0.03336 | -0.3239 | 0.0 | 0/0 |
| flow300/stop25 | test | day: 2026-09-29 | 9* | -0.03220 | -0.03358 | -0.2662 | 0.0 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | fit | caller: caller_02 | 81 | 0.00572 | 0.00360 | 0.3735 | 43.2 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | fit | day: 2026-09-17 | 95 | 0.01357 | 0.01194 | 1.1997 | 49.5 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | val | caller: caller_01 | 51 | 0.03424 | 0.03199 | 1.6568 | 62.7 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | val | day: 2026-09-20 | 58 | 0.03672 | 0.03484 | 2.0402 | 65.5 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | test | caller: caller_05 | 30 | 0.01796 | 0.01288 | 0.4496 | 53.3 | 0/0 |
| young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | test | day: 2026-09-29 | 24* | 0.02087 | 0.01468 | 0.4118 | 54.2 | 0/0 |

## Trades carrying the selected challenger

These are individual contribution records, not claims based on sub-30-trade effects.

| Split | Mint | Caller | Call UTC | P&L SOL | Realized multiple |
|---|---|---|---|---:|---:|
| fit | DwDLJfsaodJ78Vq6obqDoypCPVyJK9jzWKT7wk81pump | caller_03 | 2026-09-02T15:21:59.000Z | 1.23559 | 13.42 |
| fit | 7gKKy2p1SaMkRFPX7caF96YpfuMMpDj82ZpjaffuvaU5 | caller_01 | 2026-09-16T12:50:01.000Z | 0.74026 | 8.46 |
| fit | BX7SJo6LBpT971MJ4TBcnfEcPRSgnR6ymYEmSsEec79e | caller_03 | 2026-09-02T02:37:16.000Z | 0.59049 | 6.96 |
| val | G59zeXWwXMw2bb6UJD1ceELXRhNkLXHkYrtBYBV5agnt | caller_07 | 2026-09-24T10:10:49.000Z | 0.84933 | 9.55 |
| val | ExcKwtZ95yTobhh7xuAysmBcsBTzvosRX3o43rqnMgYY | caller_05 | 2026-09-23T03:07:35.000Z | 0.35130 | 4.57 |
| val | 6ya9vL1D9frrPtjJKemwNwYCNbA8EbroqBxchJq1STNK | caller_03 | 2026-09-20T02:33:31.000Z | 0.22135 | 3.27 |
| test | FeTi15LB5PCLhjioeBcJR8p4Xj6izdMztfw3J8nfEZUD | caller_07 | 2026-09-29T06:10:41.000Z | 0.23560 | 3.42 |
| test | 7zJDJdbiPk7EzpPK8GX6QqHF3zWXFdauNJFiBMYnSTNK | caller_07 | 2026-09-29T04:00:33.000Z | 0.08326 | 1.89 |
| test | 9HAJX5QCka4Yrgjz7eaJQEhjNuL4N76fQ1VJPFApump | caller_01 | 2026-09-29T09:46:06.000Z | -0.02061 | 0.85 |
