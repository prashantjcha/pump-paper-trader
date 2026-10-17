# Shallow-drop tokens, and the full study on five callers

Requested: (1) study the tokens whose first drop from the initial peak stayed under 50%; (2) rerun the full study on calls by
caller_05, caller_09, caller_03, caller_06 and caller_01 only.

Scripts: `scripts/research-shallow.ts`, `scripts/calls-backtest.ts --callers`, `scripts/research-drawdown.ts --callers`.
Results: `shallow/`, `backtest/`, `drawdown/` in this folder, and `research/shallow-2026-09-30/` for all callers.
Periods: fit before 18 Sep, validation 18–26 Sep, recent after 26 Sep. Costs as in the earlier studies.

**Answer: nothing is profitable in either universe.** No rule based on the shallow-drop idea, on what is known at the call,
or on the drawdown pattern made money on the validation period, for all callers or for the five.

## 1. Tokens with a first drop under 50%

40 of 1,121 tokens (3.6%); 28 of 766 among the five callers. They are mostly a different kind of token:

| Median at the call | Shallow (all callers) | Rest | Shallow (five callers) | Rest |
|---|---|---|---|---|
| Market cap | $42,500 | $16,400 | $91,800 | $20,500 |
| Liquidity | $14,500 | $4,430 | $19,800 | $5,990 |
| Down from its high at the call | 25% | 68% | 25% | 66% |
| Token age | ~3 days (older than the data window) | < 1 h | ~3 days | ~1 h |

So a shallow first drop mostly marks tokens that were already established when called, not fresh launches that held up.

**Can they be found in time?** A point-in-time rule checked each call 1, 3, 6 or 12 h after it and bought only if the token was
still within 30–50% of its high (optionally above the call price), then trailed 40–50% or sold half at 2x. 72 variants:

- All callers: best fit result −0.017 SOL per 0.1 SOL trade (trimmed); 0 of 72 positive on validation.
- Five callers: best fit −0.017; 0 of 72 positive on validation.
- Baseline (every call, bought 1 h after): −0.018 to −0.025.

**Segments known at the call** (buy at the first hourly bar after the call, trail 40%): age, liquidity, and drawdown at the
call all lost in every period for both universes. Tokens aged 6–48 h and liquidity $5k–$20k had the best 24 h hit rates
(33–34% reached 2x, 10–15% reached 5x) but still lost after costs (−0.011 to −0.030 per trade).

## 2. Full study on the five callers

- 775 tokens first called by one of them; 654 with data and a full 72 h horizon.
- Outcomes are almost identical to the whole group: 35.5% reach 2x, 12.4% reach 5x, 6.1% reach 10x within 72 h (group: 35.3%, 11.5%, 5.4%).
- Minute-bar backtest (88 exit rules × 4 entry filters, selection on training by trimmed mean):
  - Split A test: −0.0109 per trade trimmed (55 trades). Split B test: −0.0132 trimmed (76 trades).
  - Split B: 50 of 320 combinations had a positive test average, and 0 stayed positive after dropping their two best trades.
- Drawdown pattern (48 variants): 702 trades across variants, −12.6 SOL combined, no trade realized 3x, 0 variants positive on validation.
- First-drop table for the five callers matches the group: 0–60% drops made new highs 65–67% of the time (35 tokens); 60–80%, 15%; deeper, 1–10%.

## 3. Were these five callers identifiable in advance?

24 h hit rates from the call, fit period vs later (the whole group is about 22% for 2x):

| Caller | Fit calls | Fit 2x / 5x | Later calls | Later 2x / 5x |
|---|---|---|---|---|
| caller_01 | 223 | 26.0% / 9.0% | 196 | 22.4% / 8.2% |
| caller_03 | 88 | 20.5% / 11.4% | 82 | 23.2% / 7.3% |
| caller_05 | 36 | 16.7% / 2.8% | 69 | 33.3% / 10.1% |
| caller_06 | 39 | 28.2% / 7.7% | 15 | 40.0% / 13.3% |
| caller_09 | 7 | 71.4% / 28.6% | 11 | 45.5% / 18.2% |

caller_05 was below average in the fit period and only looked good later, so choosing it required hindsight. caller_09
has 18 calls in total. The group's two largest callers are close to the group average in both periods.

## Conclusion

Across every study so far (all calls with fixed exits, post-call momentum, the Claude–Codex debate, the drawdown pattern,
shallow-drop tokens, at-call segments, and the five-caller subset), no rule made money on data it was not tuned on.
The group produces real runners, but nothing measurable at or after the call separates them early enough to pay for the losers
and the costs at this entry speed.
