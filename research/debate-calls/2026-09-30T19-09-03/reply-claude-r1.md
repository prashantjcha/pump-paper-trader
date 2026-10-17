I've written the round-1 proposal to `proposals/claude-r1.ts`. **No strategy I tested makes money, on either half of the data.** Not trading at all beats every one of them.

**The proposal:** buy at the call only if the token already rose 7x or more in the hour before the call. Then sell at +50% or stop out at −30%.

Referee runs (`npx tsx scripts/calls-eval.ts .../proposals/claude-r1.ts --data .../data`, with `--to 2026-09-18` for fit and `--from 2026-09-18 --to 2026-09-26` for validation):

| | n | mean | trimmed mean | total without best | win rate | captured 5x / 10x |
|---|---|---|---|---|---|---|
| Fit | 234 | −0.0087 | −0.0091 | −2.07 | 37.6% | 0/0 |
| Validation | 125 | −0.0038 | −0.0045 | −0.51 | 44.0% | 0/0 |

Each trade wins about +0.041 SOL or loses about −0.039 SOL, so it needs about a 49% win rate to break even. No outlier carries it: the best trade is +0.041 SOL. On the fit trades one caller is the largest share (caller_01, 90 of 234, 38%), not a majority.

**Testing the belief that post-call movement and volume reveal runners (`work/features.ts`, fit n≈572):** it fails. At 5, 15 and 60 minutes after the call, the chance of a later 5x is 7–11% in every price-move and volume band (about 114 calls each). Waiting to confirm just means paying more for the same odds, and entering 5 minutes after the call does worse than buying at the call with every exit I tried. The caller's past hit rate doesn't help either (`work/callers.ts`): callers with ≥40% past 2x hits did worse than those under 25%.

**Aiming for runners loses more.** Holding for a 10x take-profit with a −90% stop captured 27 of the 5x moves and still lost −0.033 per trade trimmed (`work/tpsl.ts`). `captured10x` is 0 everywhere because selling costs push a 10x peak down to about 9.4x realized, so it doesn't mean those runs never happened.

**Costs:** about 0.0095 SOL per trade at 0.1 SOL. Buying at the call with +100%/−30% loses −0.0144 trimmed (fit), so before costs the calls are close to zero edge. Buying 0.2 SOL is worse on every exit because of price impact.

**How I picked it:** the best fit-window result was a "sell unless it's running" exit on tokens with a small run-up (−0.0053 trimmed). It fell to −0.0147 on validation, so I rejected it. Pre-call run-up with a fixed exit is the only effect that kept its direction on both halves:

| Run-up | under 4x | 4x+ | 7x+ | 13x+ |
|---|---|---|---|---|
| Fit trimmed mean | −0.0146 | −0.0106 | −0.0091 | −0.0056 |
| Validation trimmed mean | −0.0171 | −0.0088 | −0.0045 | −0.0062 |

I chose 7x over 13x for sample size (234 trades vs 118). Validation numbers were visible while I chose, so that half isn't fully clean.

**Why it should win on the holdout:** it loses least, it doesn't depend on any single trade, and it never bets on catching 5x–10x moves, which this data doesn't support. It is still negative, and I'd tell the user plainly: don't trade these calls unless Codex shows a strategy with a positive trimmed mean on both halves.

The grid scripts are in `work/`: `grid.ts`, `tpsl.ts`, `filters.ts`, `runup.ts`, `features.ts`, `callers.ts`.
