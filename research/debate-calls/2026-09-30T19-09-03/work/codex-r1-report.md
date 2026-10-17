# Codex round 1: retain cash

The submitted strategy is an explicit no-entry policy. The active alternatives failed to establish an after-cost edge; abstention is not an estimated profitable trading effect. All position sizes tested are 0.1 SOL. No later holdout was opened.

Fit calls precede 2026-09-18 UTC; validation calls are in [2026-09-18, 2026-09-26) UTC. There are 574 and 351 eligible first calls respectively. These are token-level trades, not all Telegram messages. The existing referee and policy code were used without edits.

## Reproduce

Run from D:/pumpfun. The installed tsx runner failed with spawn EPERM, so Node 24 native TypeScript transformation runs the exact same referee. Scripts write only inside the debate directory.

```powershell
node --experimental-transform-types research/debate-calls/2026-09-30T19-09-03/work/codex-experiments.ts > research/debate-calls/2026-09-30T19-09-03/work/codex-experiments.log
node --experimental-transform-types research/debate-calls/2026-09-30T19-09-03/work/codex-validate.ts > research/debate-calls/2026-09-30T19-09-03/work/codex-validate.log
node --experimental-transform-types research/debate-calls/2026-09-30T19-09-03/work/codex-report.ts
node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T19-09-03/proposals/codex-r1.ts --data research/debate-calls/2026-09-30T19-09-03/data --to 2026-09-18 --trades 0
node --experimental-transform-types scripts/calls-eval.ts research/debate-calls/2026-09-30T19-09-03/proposals/codex-r1.ts --data research/debate-calls/2026-09-30T19-09-03/data --from 2026-09-18 --to 2026-09-26 --trades 0
```

The first command produces Claude replication, timing audit, caller/week breakdowns, and all 75 fit-only candidate results. The second evaluates the fit-selected dip and breakout candidates, a 12x runner control, and abstention on both windows. The final two independently check the submitted strategy through the referee CLI. Full trade lists are in codex-baseline.json, codex-fit-grid.json, and codex-validation.json alongside this report.

## Results

All P&L columns are SOL after referee costs. Trimmed mean removes the two largest P&Ls; total without best removes one. Captures are the referee realizedMult counts, which deduct venue fees and impact but not fixed SOL charges; P&L does deduct fixed charges.

| Strategy | Split | n | Total | Mean | Trimmed mean | Total without best | Win % | Captured 5x / 10x |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| claude | fit | 234 | -2.0339 | -0.00869 | -0.00912 | -2.0748 | 37.6 | 0 / 0 |
| claude | validation | 125 | -0.4698 | -0.00376 | -0.00448 | -0.5106 | 44.0 | 0 / 0 |
| claude-completed-bars | fit | 222 | -1.7955 | -0.00809 | -0.00853 | -1.8364 | 38.3 | 0 / 0 |
| claude-completed-bars | validation | 115 | -0.4961 | -0.00431 | -0.00511 | -0.5370 | 43.5 | 0 / 0 |
| fit-best | fit | 373 | -3.3655 | -0.00902 | -0.01166 | -3.8455 | 8.3 | 21 / 0 |
| fit-best | validation | 205 | -5.0273 | -0.02452 | -0.02944 | -5.5056 | 6.3 | 6 / 0 |
| fit-best-breakout | fit | 126 | -1.4319 | -0.01136 | -0.01930 | -1.9128 | 11.9 | 12 / 0 |
| fit-best-breakout | validation | 61 | -0.2681 | -0.00439 | -0.02074 | -0.7465 | 11.5 | 7 / 0 |
| at-call-12x | fit | 574 | -19.9543 | -0.03476 | -0.03860 | -21.0193 | 8.9 | 20 / 18 |
| at-call-12x | validation | 351 | -11.5192 | -0.03282 | -0.03910 | -12.5834 | 7.4 | 13 / 13 |
| cash | fit | 0 | 0.0000 | N/A | N/A | 0.0000 | N/A | 0 / 0 |
| cash | validation | 0 | 0.0000 | N/A | N/A | 0.0000 | N/A | 0 / 0 |

## What was tested and frozen

All 75 candidate configurations had at least 30 fit trades (range 74–530); none had positive mean or trimmed mean. They are overlapping experiments, not 75 independent samples. Selection used the highest fit trimmed mean among configurations with at least 60 trades. The best candidate in each tested family was already negative; validation did not change the abstention decision.

The 75 configurations comprise 54 dip rules (wait 5/15/60 minutes, close at most 25%/50%/75% of the first post-call open, optional green-bar recovery, targets +50%/+100%/+500%, stop -50%); 12 breakout rules (close up 25%/100% from the first open and above all prior post-call highs, volume unrestricted or at least twice prior mean, targets +100%/+500%/+1100%, stop -60%); and nine delayed entries (15/60/180 minutes, targets +50%/+100%/+500%, stop -50%). All require a current 1-minute bar, at least $1,000 reported liquidity, and a first post-call bar within ten minutes. Entries use observed closes and next-open fills. Dip search ends at 180 minutes; breakout search ends at 60 minutes. These restrictions are part of the tested rules, not proven independent predictors.

Frozen best dip configuration: {"family":"dip","wait":60,"dip":0.5,"recovery":true,"tp":500,"sl":50}. This buys a green-bar recovery after at least one hour, while price remains at most half the first post-call open, and targets 6x gross with a 50% stop. Frozen best breakout: {"family":"breakout","mult":1.25,"volume":2,"tp":500,"sl":60}.

The control buys at the call with a 12x gross target and a 90% stop. It demonstrates that the referee can record realized 10x captures; it does not establish a profitable runner strategy. Unlike a 10x gross target, a 12x target leaves room for selling costs.

## Rebuttal and concessions

Claude's reported aggregate losses reproduce. Its largest fit winners are each about 0.0409 SOL; removing the best leaves -2.0748 SOL (n=234). Validation also remains negative after removing the best (-0.5106 SOL, n=125). There is no outlier-supported positive aggregate result to defend.

Caller concentration matters to the apparent validation improvement. The following are descriptive slices, not rules chosen for deployment. No subgroup below 30 trades is interpreted.

| Claude slice | Split | n | Mean | Trimmed mean | Total without best | Win % | Captured 5x / 10x |
|---|---|---:|---:|---:|---:|---:|---:|
| caller_01 | fit | 90 | -0.01214 | -0.01334 | -1.1334 | 33.3 | 0 / 0 |
| excluding caller_01 | fit | 144 | -0.00654 | -0.00720 | -0.9822 | 40.3 | 0 / 0 |
| UTC week starting 2026-09-03 | fit | 44 | -0.00282 | -0.00488 | -0.1647 | 45.5 | 0 / 0 |
| UTC week starting 2026-09-10 | fit | 139 | -0.01102 | -0.01177 | -1.5721 | 34.5 | 0 / 0 |
| UTC week starting 2026-09-17 | fit | 34 | -0.00117 | -0.00378 | -0.0805 | 47.1 | 0 / 0 |
| caller_01 | validation | 36 | 0.00720 | 0.00525 | 0.2187 | 58.3 | 0 / 0 |
| excluding caller_01 | validation | 89 | -0.00819 | -0.00932 | -0.7699 | 38.2 | 0 / 0 |
| UTC week starting 2026-09-17 | validation | 100 | -0.00219 | -0.00307 | -0.2600 | 46.0 | 0 / 0 |

Removing caller_01 makes validation worse, not better: its 36 validation trades earn +0.2593 SOL, while the other 89 lose -0.7290 SOL. The same caller does not demonstrate a stable profitable fit edge (see table). Every week slice meeting the minimum 30-trade requirement is negative. Week bins are fixed seven-day UTC intervals anchored to the Unix epoch and clipped to each research split.

There is an input-timing defect for call-time decisions: pre is filtered by candle start, not candle completion. 558/574 eligible fit calls and 338/351 validation calls contain a pre candle that finishes after the call. Claude's last-pre-close feature can therefore use information unavailable at call time. Filtering to b.t + b.res * 1000 <= callMs changes entries from 234 to 222 on fit and 125 to 115 on validation, but both remain negative (full metrics above). This sensitivity only fixes the strategy's pre-candle input; it does not change the referee.

I concede the tested evidence supports declining these calls. My dip and volume-breakout variants do not improve on Claude robustly. I dispute treating “least bad active strategy” as a reason to deploy, and I dispute inferring that realized 10x captures are impossible: the 12x control records 18 on fit (n=574) and 13 on validation (n=351), yet loses heavily. Capturing runners is insufficient if the losing positions consume more capital.

This is finite exploratory evidence, not proof that every possible chart/volume rule fails. Claude already inspected validation while choosing its proposal; that window is not untouched for the debate. My grid ranking used fit only, with one subsequent validation pass for the two chosen candidates. There are no statistical independence or significance claims for this parameter search.

## Submission

proposals/codex-r1.ts always declines entry. Both splits have n=0, total P&L 0, total without best 0, captured5x/captured10x 0/0, and undefined mean, trimmed mean, and win rate. The 30-trade minimum precludes calling this an estimated trading effect. It is a capital-allocation decision supported by the adequately sampled losing alternatives. In the referee, cash mechanically avoids trading losses; it can lose a future comparison if another strategy actually earns positive P&L. No unseen-call superiority is claimed as established.
