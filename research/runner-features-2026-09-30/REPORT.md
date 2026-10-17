# RETRACTED: the positive result below is a look-ahead leak

**Found by the Claude-vs-Codex debate (research/debate-calls/2026-09-30T21-10-56), verified 30 Sep 2026.**
The pre-call trade fetch stored Codex "token not found" answers as complete, empty trade histories. That happened for 196
of 1,139 tokens, and it is not random: every one of 60 sampled pump.fun tokens with an empty history later graduated from
the bonding curve, versus 55% of tokens whose history came back. So "no trades before the call" secretly meant "this token
later made it", which is information from the future.

- The young-token rule's profit came entirely from those tokens (trimmed mean +0.026 / +0.044 / +0.030 SOL per trade on the
  three periods). Calls on genuinely young tokens, counted from order-flow bars, lost on every period (−0.027 / −0.022 / −0.048;
  44 trades in total).
- The features that "separated runners" (few trades, few holders, low concentration, fresh wallets defaulting to 0.5) read as
  zero or default for exactly those tokens, so the model largely learned the leak.
- Fixes: the fetcher no longer caches "not found" as empty history, and the live call trader no longer treats "not found" as
  zero trades. The conclusion of the other studies stands: no rule has shown an edge on this group's calls.

---

# What runners have in common: wallet, holder and order-flow features at the call

> **Run 2 (current numbers below the update box are run 1; this box supersedes them).** A review found that the order-flow
> bar features used the minute bar containing the call, so they included up to 59 s of post-call trading, and that the
> pre-call trade window included the call second. Both were fixed (only bars that ended before the call; only trades
> before the call second) and everything was rerun.
>
> - Model AUC: fit 0.81, **validation 0.75, recent 0.83** (run 1: 0.77 / 0.84). Liquidity dropped out of the top weights.
> - Wallet age is measured at trade time (8% of buys before 8 Sep came from wallets under a day old), so the fresh-wallet
>   feature is point-in-time.
> - **Ablation:** most of the edge is "called very early". Buying every call on a token with fewer than 100 trades before
>   the call (no model), TP +100% / SL −50%, 1 s entry at +5 s: validation +0.035 per 0.1 SOL trade (72 trades, +2.83 SOL),
>   recent +0.044 (37, +1.90), 95% CI +0.023 to +0.066. The model on top of that filter adds a little:
>   validation +0.039 (61), recent +0.062 (29), CI +0.029 to +0.077. Model top 20% alone: +0.025 (78) / +0.059 (32).
> - All 36 tested variants (4 filters × 3 exits × 3 entry timings) keep a 95% CI above zero on validation+recent except
>   one (model top 10%, TP +400%, +30 s entry: −0.001 to +0.122).
> - Concentration (model top 20%, TP +100%, SL −50%, +5 s): 110 trades, +4.43 SOL; without the best caller +3.06; without the
>   best day +3.47; 9 of 12 days positive.
> - Hold times: winners median 11 min (25–75%: 4–39 min); only 14 of 45 wins closed within 5 minutes, so this is not only
>   the launch spike.
> - The 18–26 Sep window has now been used as validation by eight studies in this project. The forward paper test is the
>   only clean test left.

**First positive out-of-sample result.** Features built from each token's trade history before the call (wallets, holders,
big buys, fresh wallets, early buyers) separate runners from dead calls consistently across periods, and the strategy
chosen on the fit period made money on the later periods, including with a stricter 1-second entry.

Scripts: `scripts/calls-fetch-flow.ts` (data), `scripts/research-runner-features.ts` (study), `scripts/research-runner-check.ts`
(robustness). Results: `results.json`, `scores.json`, `robustness.json`.

## Data

- Every trade before each token's first call in the group (Codex `getTokenEvents`, with wallet address, wallet age, and
  wash/sandwich labels; up to 8,000 trades, newest first), and minute bars with order flow (buys, sells, buyers, sellers,
  buy/sell volume) from 6 h before to 19 h after the call.
- 1,076 calls with data: fit before 18 Sep (572), validation 18–26 Sep (350), recent 26–29 Sep (154).
- Label: reached 3x (and 5x) within 24 h of the first price after the call. Base rates: 3x ≈ 20–21%, 5x ≈ 10%.

## Features that separate runners in both periods

Quintiles set on the fit period; runner (3x) rate in the lowest vs highest quintile, fit and validation:

| Feature (before the call) | Direction | Fit: low → high quintile | Validation: low → high |
|---|---|---|---|
| Fresh-wallet share of buyers in the last hour (< 1 day old) | more is better | 13.9% → 47.0% | 11.7% → 45.5% |
| Buy/sell USD ratio since launch | less net buying is better | 33.9% → 7.0% | 38.3% → 5.3% |
| Buy/sell USD ratio, last hour | same | 35.4% → 8.7% | 38.1% → 6.2% |
| Buyers in the launch block | fewer is better | 39.4% → 9.9% | 43.3% → 9.2% |
| Top-1 holder share | lower is better | 52.2% → 12.2% | 41.6% → 10.3% |
| Top-10 holder share / concentration (HHI) | lower is better | ~49% → 12% | ~45% → 12% |
| Trades, holders, unique traders, token age | fewer / younger is better | ~45% → ~24% | ~46% → ~15% |

In plain terms: runners were typically called very early (few trades, young), had low holder concentration, no bundled
launch block, many brand-new wallets buying, and had not already been bought up (more selling relative to buying so far).
Big buys (≥ $500) before the call were the strongest single term in the combined model.

Combined logistic model (label 3x in 24 h, trained on fit only): AUC 0.81 fit, **0.77 validation, 0.84 recent**
(the earlier price-only model reached 0.62).

## Strategies (chosen on fit, scored on later periods; SOL per 0.1 SOL trade after all costs)

About 700 filter × exit combinations were evaluated on the fit period. The best used the model's top 10–20% of calls with a
wide stop and a large take-profit. Robustness check: entry at the first 1-second trade 5 s or 30 s after the call instead of
the minute-bar open, and no exit allowed in the entry bar.

| Strategy (1 s entry, +5 s) | Validation (trimmed mean, n, total) | Recent (trimmed, n, total) | Validation+recent mean, 95% CI |
|---|---|---|---|
| Top 10%, TP +100% (2x), stop −50% | +0.057 (34), +2.19 | +0.099 (11), +1.27 | +0.043 to +0.109 |
| Top 10%, TP +400% (5x), stop −50% | +0.038 (34), +2.15 | +0.019 (11), +1.11 | +0.012 to +0.136 |
| Top 20%, TP +100%, stop −50% | +0.028 (81), +2.56 | +0.055 (33), +2.07 | +0.021 to +0.062 |
| Top 20%, TP +400%, stop −50% | +0.027 (81), +3.11 | +0.101 (33), +4.07 | +0.024 to +0.102 |
| Top 20%, trail 50% after +100%, stop −50% | +0.010 (81), +1.75 | +0.072 (33), +3.29 | +0.021 to +0.071 |

All 18 tested variants (2 filters × 3 exits × 3 entry timings) have a 95% interval above zero on validation+recent.

**Concentration check** (top 20%, TP +100%, stop −50%, 1 s entry; validation+recent, 114 trades, +4.63 SOL): profit spread
across callers (caller_05 +1.51, caller_01 +1.50, caller_03 +0.93, caller_07 +0.54 …); without the best caller
+3.12 SOL; 9 of 12 days positive; without the best day +3.78 SOL.

**Where it works:** calls on new launches (fewer than 100 trades before the call): +0.05 to +0.08 per trade. Calls on older
tokens lose (−0.04 to −0.06), so the filter should require a young token.

## Caveats

- Selection: ~700 combinations were searched on the fit period. Validation and recent periods were not used for choosing,
  but the recent period is only 3.5 days.
- The simulation buys at the first trade after the call; a real transaction lands later and competes with other buyers.
  The +30 s variant (still positive) is a rough stress test of that.
- Features depend on Codex's indexing of each token's early trades. The live version must compute them the same way at the
  moment of the call (one Codex request per ~200 trades, a few seconds for a young token).
- Costs assume 0.1 SOL positions with liquidity-based impact; larger sizes will do worse on these thin tokens.

## Next step

Forward-test it on paper: at each live call, pull the token's trade history from Codex, compute these features, score with the
fit-trained model, and buy only the top 20% (young tokens), exit at +100% or −50%. Then compare live fills and results with
this backtest before considering real money.
