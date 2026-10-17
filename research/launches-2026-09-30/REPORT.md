# Pump.fun launch entry/exit study — 30 September 2026

**Result: no profitable regime identified. Keep these strategies in paper trading.**

The study tested 98 settings (95 distinct parameter/gate combinations) against the current raw archive. Every setting that traded lost money in the training window; one generated no completed trades. The best eligible active candidate also lost in the later window, at every tested latency. This rejects these candidates under this replay model and sample. It does not prove that all Pump.fun strategies are unprofitable.

The running bot configuration was not changed. The scripts write research artifacts and open the live database read-only. No transactions were signed or sent.

**Data and method**

The frozen event cutoff is `2026-09-30T12:52:21.680Z`. The corpus contains 239,371 events: 236,169 trades, 3,127 creations and 75 completion events. Of the creations, 1,132 are marked Mayhem; those are excluded from entries by the existing strategy. Non-SOL launches are also excluded.

| Window, UTC | Recorded activity | Events | Launches |
|---|---:|---:|---:|
| Training: 06:47:49–07:47:49 | 60.0 minutes | 128,193 | 1,787 |
| Later evaluation: 12:14:26–12:52:21 | 37.9 minutes | 111,178 | 1,340 |

There is a **4h 26m 37s recording gap** between the windows. This is about 98 minutes of market observations from one date, not six continuous hours or multiple market regimes. Activity after the frozen cutoff was not used.

Tests cover entry ages, buyer counts, same-slot participation, SOL raised, net inflow, buy/sell ratios, developer buying, creator history, holding periods, take profits, trailing stops and stop losses. Joint families test momentum acceleration, buyer diversity with volume imbalance, 5–20% pullback rebounds, and wider stops above the fixed-cost loss floor. This is a bounded hypothesis search, not an exhaustive search of all strategies. Creator-sale entries, same-transaction sniping, shorts and post-graduation trading are outside this experiment.

Candidates use the existing engine and reserve-based AMM quotes. Additional research handling:

- Reset state at recording gaps; seed creator history and blacklists using records available before each window. Never bridge a missing interval with fictional fills.
- Disable new entries during the final two minutes of each window, while retaining subsequent observed events for exits. Do not fast-forward ten minutes at stale terminal prices. The reported finalists have no unresolved positions.
- Add 250 ms clock advances between recorded events. This approximates timer operation; it is not an exact reproduction of live scheduling jitter.
- Treat unobserved post-graduation liquidation proceeds as zero in the conservative scenario. This is a stress bound, not a claim that migrated tokens are worthless. Restoring the engine's optimistic graduation fill leaves the selected candidate's result unchanged.
- Include failed-entry costs in total PnL, profit factor and chronological realized drawdown. Drawdown here is realized PnL drawdown, not a full intratrade mark-to-market maximum.
- Run unlimited-capital trials to measure all signals, and separate trials with the 1 SOL book, four-position limit and daily loss pause.

Selection requires at least 20 completed training trades and ranks net expectancy. That minimum only avoids ranking one-trade results; it is **not** sufficient statistical evidence. The selected setting had negative expectancy. Candidates were expanded during this exploratory session after initial baseline evaluations, so the later window should not be described as a pristine, preregistered final test. Final parameter ranking uses training results only. A genuinely untouched future period is still required.

**Results at 600 ms additional decision-to-fill latency**

All rows use 0.1 SOL entries, the configured 0.001 SOL priority fee plus 0.002 SOL tip per successful leg, and event-derived curve fees. PnL includes failed entry costs. Completed trades exclude failures.

| Strategy | Training trades | Training net SOL | Later trades | Later net SOL | Later win rate |
|---|---:|---:|---:|---:|---:|
| Current v2 | 6 | -0.07397 | 4 | -0.02898 | 25.0% |
| Original v1 | 13 | -0.17126 | 13 | -0.16806 | 7.7% |
| Training-selected acceleration | 37 | -0.29666 | 23 | -0.29441 | 13.0% |
| No new entries | 0 | 0 | 0 | 0 | — |

The selected candidate has 2 additional failed entries in the later window. Its profit factor is 0.173 and its realized drawdown is 0.31076 SOL. Its best trade makes 0.03272 SOL; removing it leaves -0.32713 SOL. The 1 SOL constrained version closes 8 trades for **-0.10053 SOL**, then the loss pause limits further entries. That pause reduces exposure; it does not create positive expectancy.

| Selected candidate: additional latency | Completed trades | Net SOL |
|---|---:|---:|
| 0 ms | 25 | -0.17410 |
| 300 ms | 23 | -0.30583 |
| 600 ms | 23 | -0.29441 |
| 1,500 ms | 22 | -0.18597 |

These small-sample results are not monotonic in latency because timing changes entries, exits and which trades land. They provide no basis for concluding that 1,500 ms is superior. Even the idealized zero-additional-latency case is negative; it still inherits the archive's observation delay.

Halving fixed costs leaves **-0.22154 SOL**. Doubling fixed costs produces **-0.37702 SOL**. A seeded 80% entry-landing scenario remains negative; this is a sensitivity scenario, not an empirically calibrated failure model. At a 0.2 SOL position size, the candidate loses **-0.44289 SOL**. Increasing size to amortize tips is not justified by these results.

**Exact rules of the rejected active candidate**

This is provided for reproducibility, **not as a profitable recommendation**. The full parameters are in `candidate.json`; the extra acceleration gate exists only in the research script and is not implemented by the standard replay CLI.

Entry, all required:

- Observed token age 10–180 seconds; 5–50 SOL raised.
- Last 15 seconds: at least 8 distinct buying addresses, at least 2.5 buys per sell by transaction count, and at least 1 SOL net inflow. At least 3 buys in the last 5 seconds.
- Last 10 seconds' buy volume at least 1.2 times the preceding 10 seconds, with positive preceding volume and positive current net flow. Price at most 8% below its observed peak.
- No developer sale observed; developer launch buy 0–4 SOL; developer holding at most 8% of total supply. At most 6 other creation-slot buyers.
- Non-developer top holder at most 15% and non-developer top ten at most 40% of supply, using the bot's trade-derived balance estimates. At most one prior creator launch in the observed previous day and no creator blacklist flag.
- SOL curve, not Mayhem, known creation, not completed, one attempt per mint. Reject an entry if the observed spot price increases more than 15% between decision and simulated fill.

Exit, following the engine's first-trigger ordering:

- Developer sale, a sale at least 1.5 SOL or 5% of supply, or curve completion/95% progress.
- Net liquidation stop at -10%; tighten to -6% after 8 seconds without a buy or when the 10-second buy/sell count ratio drops below 1.
- Net take profit +30% with rising buy volume, +25% flat, +20% falling. Arm an 8% trailing drawdown at +15% net profit.
- Exit after 60 seconds held. No partial exits or averaging down.

The smart-wallet exit flag remains in the saved parameters, but the momentum research runs have no smart-wallet set, so it does not add signals.

**What matters more than another TP/SL sweep**

1. **The fixed costs conflict with the tightened stop.** Using the engine's exact curve math at a 125 bps fee, a flat round trip at 0.1 SOL loses 0.008469 SOL, or **8.22% of the 0.103 SOL initial cash outlay**. A -6% net stop can therefore fire without a price decline. At 0.05 SOL the flat loss is 13.65%; at 0.2 SOL it is 5.39%. Separate price deterioration from the known entry/exit cost floor when designing stops. Wider cost-aware stops were tested here and remained negative; simply widening them is not a recommendation.
2. **A stop threshold is not a maximum loss.** One selected-candidate trade triggered at -10.13% and filled at -49.30% after the modeled 600 ms. Position sizing must allow for gaps, failed exits and correlated launches. The current execution engine models randomized landing only on entry and assumes successful exits, so live losses can differ substantially.
3. **The feed is not validated as an HFT execution feed.** Events arrive a median 1.576 seconds and 90th percentile 2.645 seconds after their second-resolution on-chain timestamp. Those are coarse timing differences affected by timestamp granularity and clock skew, not precise network-latency measurements. The configured 600 ms is additional simulated delay after observation. The strategy's age is also measured from receipt of creation, not exact on-chain launch time.
4. **Receive order can rewind reserve state.** Among 140,968 consecutive nearby normal SOL trade pairs, 163 have lower slots arriving after higher slots; 340 have a SOL-reserve conservation residual greater than 0.00001 SOL. These are diagnostics of ordering/missing-event/decoding issues, not proof that every mismatch is data loss. No exact duplicate events were found. Reserve integrity needs causal reconciliation before trusting a positive HFT result.
5. **Wallet count is not independent demand.** Holdings are reconstructed from observed trades, without transfer tracking. The top-holder measures exclude the creator and do not identify common funders or wallet clusters. A same-slot count cannot certify or rule out a coordinated bundle. Developer history is also incomplete outside recorded coverage.

The replay also approximates the bot's own market impact by adding its buy footprint to recorded reserves. It does not re-simulate other traders' responses or prove that a transaction could land at the quoted reserves. A spot-price slippage check is not a complete transaction-level minimum-output simulation. These limitations are especially relevant before interpreting any future positive paper result.

The backup directory contains readable raw files dating to 06:24 UTC, with overlapping recorder processes. `quality.json` inventories them. They were excluded from the main experiment because they belong to a restored/corrupted database period and require cross-process deduplication and recorder-version checks; no claim is made that those raw files themselves are corrupt.

**External research and its implications**

- [Pump.fun's official fee schedule](https://pump.fun/docs/fees), accessed 30 September 2026, lists 0.95% protocol plus 0.30% creator fees on bonding-curve trades. Network and third-party fees are additional. The study uses recorded event fees rather than assuming every token always pays 125 bps.
- [Solana's fee documentation](https://solana.com/docs/core/fees) distinguishes base and optional prioritization fees. The bot's 0.001 SOL priority fee and 0.002 SOL tip are configuration assumptions, not universal chain requirements. Base signature fees and token-account rent/recovery also need explicit live accounting; this engine does not separately model them.
- [Luo et al., Resisting Manipulative Bots in Meme Coin Copy Trading](https://arxiv.org/html/2601.08641v3), WWW 2026, studies 6,000 coins. Its statistical baselines identify profitable wallets while modeled copiers remain negative; its proposed approach reports about 3% average copier return. This supports testing wallet/coin manipulation features, but does not validate this bot or reproduce an executable 600 ms live copier. The paper's immediate-copy curve model should not be mistaken for measured transaction landing performance.
- [Szwajcok et al., Meme Coin Factories](https://arxiv.org/abs/2609.10246), September 2026, identifies wash trading, creator obfuscation and coordinated selling among manipulation strategies. The practical implication is to add point-in-time funding/transfer clusters and retained ownership measures before treating raw buying activity as organic demand.
- [Kamat, Coordinated Sniper Cohorts, v3](https://arxiv.org/abs/2607.02795v3), August 2026, explicitly revises a much larger naive buyer-flow effect after removing cohort activity and matching launch characteristics; the adjusted SOL-flow interval includes zero. This is observational research with limitations, not a trading signal. It illustrates why wallet-count growth and apparent coordinated activity need careful controls.

**Recommended decision and next entry/exit specification**

The supported live-entry rule today is **no new live positions in these tested regimes**. Continue recording and shadow evaluation. There is no evidence-based reason to adopt the rejected acceleration setting, loosen the bundle limit to six, or enlarge positions.

For the next paper experiment, entry should require complete launch coverage, causally current reserves, measured execution costs, and **positive out-of-sample net expectancy for that specific state**. Model the state using independent-wallet flow, retained balances, creator-linked supply, token age, curve depth and recent return/drawdown. The missing funding and transfer data mean that the independent-wallet condition cannot yet be honestly implemented from this archive alone.

Treat emergency creator/cluster exits separately from an ordinary price stop. Evaluate the decision to keep holding on expected future liquidation value after incremental exit cost, with a hard holding horizon. Set a price-risk stop relative to post-fill liquidation value and budget total costs separately, instead of confusing the unavoidable fee loss with a new price decline. Keep a gap-aware total loss budget and a pre-graduation exit unless PumpSwap execution and data are available. Exact numeric thresholds for these new rules are hypotheses requiring a fresh experiment; this study does not establish them.

Collect continuous data across multiple dates and activity levels. Freeze a small hypothesis set before evaluating new days; split by time and inspect creator/cluster concentration. Require positive net results after realistic delays, exit failures and fee stress, stability across days, and a confidence interval that accounts for time/creator clustering and the search process. Sample size should be driven by measured variance and effect size; an arbitrary 100 trades is not proof. The normal intervals in the JSON are descriptive only and ignore dependence and multiple testing.

**Artifacts and reproduction**

- `audit.json`: coverage, live-DB inspection and frozen event-stream SHA-256. DB summary rows reflect query time and can include activity after the frozen event cutoff; they are not replay PnL.
- `training.json`: all 98 settings, parameters and training statistics.
- `validation.json`: selected-candidate/baseline latency and capital tests plus execution sensitivities.
- `holdout-trades.json`: selected-candidate positions and decision/fill details.
- `quality.json`: reserve/order diagnostics, backup-file inventory and flat-cost calculation.
- `candidate.json`: rejected diagnostic candidate, requiring the custom research gate.

From the repository root in PowerShell:

```powershell
$env:RESEARCH_CUTOFF='1790772741680'
node --import tsx scripts/research-launches.ts
node --import tsx scripts/research-quality.ts
```

Reproduction depends on retaining the raw archive, the v2 configuration in `training.json`'s `current` row and the point-in-time creator context. The bot prunes raw files after 14 days; the event hash identifies this input but does not preserve it. Normal reruns load `config/strategy.json`. If it has changed, save the documented baseline parameters to a research JSON file and set `RESEARCH_STRATEGY_PATH` to that file; the running bot configuration does not need to change.

Validation completed: all 20 existing core tests pass, repository typecheck passes, and both research scripts pass a separate strict TypeScript check. No production files were modified.
