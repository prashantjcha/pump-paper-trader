# Does the first drop from the peak separate runners from dead tokens?

Question (from the user's charts in `charts/`): runners rally, retrace 60–80% from the first high, build a base, break the
downtrend, retest the "first throwback" high and then break out into price discovery. Is that visible in this group's tokens,
and can it be traded?

Data: hourly Codex bars for 1,121 of the 1,136 called tokens, from 3 days before each token's first call to 30 Sep 2026.
Script: `scripts/research-drawdown.ts`. Numbers: `results.json`.

## 1. First-drop depth vs later outcome

Initial peak = highest price within 48 h of the first bar. Drop = deepest point before the price exceeded that peak again.

| First drop | Tokens | Later made a new high | Ran 5x off the low | Ran 10x off the low |
|---|---|---|---|---|
| 0–40% | 22 | 72.7% | 31.8% | 27.3% |
| 40–60% | 26 | 53.8% | 34.6% | 19.2% |
| **60–80%** | **95** | **11.6%** | 9.5% | 7.4% |
| 80–90% | 194 | 6.2% | 7.7% | 4.6% |
| 90–97% | 358 | 3.9% | 8.9% | 6.4% |
| 97–100% | 416 | 0.5% | 7.9% | 5.8% |

- Only 48 of 1,111 tokens (4%) held their first drop under 60%. Most runners in this group are those: they never gave back much.
- A 60–80% drop is not a runner signature here. 88% of those tokens never made a new high, and their chance of a 5x bounce
  (9.5%) is no better than tokens that fell 90–100% (8–9%).
- Caution: the shallow buckets are partly circular (a token that keeps rising has a shallow drop by construction), so this
  table describes shapes; it does not give an entry signal on its own.

## 2. Trading the pattern (point-in-time, one trade per token, after the call)

Rule: running high → drop of at least 50–60% (abandon if it passes 80–90%) → at least 6–24 h since the low → hourly close
above the first-throwback high (highest high between the start of the dump and the low), optionally on 2x base volume →
buy at the next hour's open. Exits: sell at the old high; half there and trail the rest 40%; or trail 40%. Stop below the
base low (at most −35%). Costs as in the other studies. 48 variants plus a control (any 24 h breakout on 2x volume).

- The full pattern completes after a call on only 16–29 tokens per variant over 30 days (the 24 h-base variants: fewer still).
- Every variant lost money on the fit period (before 18 Sep) and the validation period (18–26 Sep). Typical result:
  −0.03 to −0.05 SOL per 0.1 SOL trade. No trade realized 3x.
- The best-looking variant over all periods ("drop 60–80%, 6 h base, 2x volume, trail") made +0.054 SOL on 16 trades, after
  losing on validation (−0.032 per trade, 10 trades). That is noise.
- The control lost too (−0.013 to −0.026 per trade over 431 trades).

## Why it differs from the charts

- The charts show large tokens ($50M–$185M) on 1-hour to 1-day charts over weeks. This group's calls are microcaps whose whole
  life is usually a day or two; after a 60–80% drop most of them simply keep bleeding.
- Pictures of winners show only the tokens that completed the pattern. The same first half (rally, deep drop, base) is drawn by
  hundreds of tokens that never break out.

## What the data does support

A small first drop matters more than a deep one: tokens that never gave back more than about half of their first rally made new
highs 54–73% of the time. That is the opposite of the 60–80% idea, and those tokens are few (48). Whether they can be identified
early enough to buy, after the call and after costs, is untested.
