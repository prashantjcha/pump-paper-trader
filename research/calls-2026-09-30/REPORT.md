# Telegram call backtest: "Degen Diamonds" group, 31 Aug – 30 Sep 2026

**Answer: no entry filter or exit rule made money on calls it had not been tuned on.** The group does produce real 50–600× runners, but most calls lose most of their value within hours. A 30-second entry delay and realistic costs leave no strategy with a positive out-of-sample result.

Scripts: `scripts/calls-fetch-codex.ts` (price history), `scripts/calls-backtest.ts` (search and scoring), `packages/core/src/callPolicy.ts` (exit rules shared with the live trader). Full numbers: `results.json`.

## Data

- 30 days of messages, 1,384 calls from 16 human callers (bot echoes such as @Phanes_bot removed), 1,133 distinct tokens.
- Each token is traded once, on the group's first call. 992 calls have a full 72-hour horizon; 983 have usable price data. Only 6 had no data anywhere and 3 had no trade within 10 minutes of the call.
- Price history from Codex: token-level 1-minute bars for 25 hours from the call, then 15-minute bars to 72 hours, with pool liquidity on each bar.

## Simulation rules

- Entry at the open of the first 1-minute bar at or after the message (about 30 s average delay), 0.1 SOL.
- Costs: venue fee per side (1.25% for pump.fun mints, 1% otherwise), 0.003 SOL fixed per leg, price impact from the bar's liquidity.
- Within a bar the stop is checked before any target; a gap through the stop fills at the bar open.
- Selection on training data only; two splits (first 50% → next 25%, first 75% → last 25%).

## What calls actually do

| After entry | Median price vs entry | Share below 0.3× |
|---|---|---|
| 1 hour | 0.41× | 40% |
| 6 hours | 0.26× | 56% |
| 24 hours | 0.20× | 67% |

Reached within 72 h: 1.5× 51%, 2× 35%, 5× 12%, 10× 5%, 100× 0.2%. The largest peaks (596×, 209×, 142×, 125×, 91×) are real: backed by $20k–$740k bar volume and $75k–$415k liquidity, and the bars closed near the highs. caller_01 called 5 of the top 10.

| Caller | Calls | With data | Reached 2× | Reached 5× |
|---|---|---|---|---|
| caller_01 | 335 | 335 | 37.6% | 12.8% |
| caller_02 | 180 | 179 | 37.4% | 11.7% |
| caller_03 | 147 | 146 | 28.1% | 10.3% |
| caller_05 | 93 | 92 | 33.7% | 14.1% |
| caller_04 | 87 | 86 | 37.2% | 5.8% |
| caller_06 | 48 | 45 | 33.3% | 11.1% |
| caller_07 | 37 | 37 | 24.3% | 10.8% |
| caller_09 | 16 | 15 | 73.3% | 20.0% |

Hit rates are similar across the active callers; caller_09's 73% is 15 calls, too few to trust.

## Strategy search

Candidates: 88 exit rules in 5 families (fixed take-profit/stop, trailing stop, sell half then trail, hold-runner, time stop) × 4 entry filters (all calls; a logistic model's top 50% and top 30%; callers with at least 5 earlier calls and an above-group 2× rate, computed point-in-time).

**Run 1 (selection by average profit per trade)** picked "proven callers, hold 6 h" (+0.044 SOL/trade in training) and "model top 30%, hold 6 h, stop −60%". Both were carried by one or two lottery winners: without the single best trade every top-10 training result was negative. On the test periods they lost 0.075 and 0.048 SOL per 0.1 SOL trade.

**Run 2 (changed after seeing run 1):** selection by a trimmed average that drops each candidate's two best trades, and 16 added "fail-fast runner" rules (exit within 3–5 minutes unless already up 30–50%, then trail 40–50%).

| Split | Chosen on training | Test trades | Test result per trade | 95% interval |
|---|---|---|---|---|
| A | model top 50%, trailing 20% from entry, stop −35% | 209 | −0.0057 SOL (−5.7%) | −0.0096 to −0.0017 |
| B | model top 30%, runner +100% in 15 m then trail 40% | 78 | −0.0084 SOL (−8.4%) | −0.0236 to +0.0108 |

Diagnostic (hindsight, never used for selection): of 320 combinations with at least 30 test trades, 5 (split A) and 3 (split B) had a positive test average, none were positive after dropping their two best trades, the positive ones differ between splits, and all of them lost in training. That is what chance produces.

The model (reached 2× within 72 h) has weak skill: in-sample AUC 0.62. Its largest weights are recent momentum before the call (1 h and 6 h returns) and token age; tokens still on the bonding curve did slightly worse.

## Forward test

The live call trader is paper-trading the strategy selected on split B training among rules it can run live: **every call, trailing stop 20% from entry, hard stop −35%**. On split B test data this lost 0.009 SOL per trade (245 trades). It is deployed to measure live behaviour, not because it is expected to profit. The model filter is not used live yet; it needs price history at call time.

## What could change the answer

1. **Entry speed.** Median price is already 0.41× one hour after the call; much of the move happens in the first minutes. A bot that sees the message within 1–2 seconds and fills on the curve may capture moves this 30-second, minute-bar simulation cannot. The live trader measures its real delay per trade.
2. **Seconds-level data.** Codex offers 1-second bars on Solana; rerunning the first hour at that resolution would test whether faster entries change the result.
3. **More days.** 30 days of one group, two splits. A strategy that only works on runners needs many more runners to evaluate.

Caveats: 1-minute bars cannot show order within the minute; exits are assumed to fill; token-level bars do not say which pool traded, so fees are approximated by mint type.
