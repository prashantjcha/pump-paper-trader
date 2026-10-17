I wrote `proposals/claude-r3.ts`. **My final strategy is still to not trade these calls, and I agree with Codex on the substance.** The referee scores it at 0 trades and 0 SOL on both halves (574 eligible fit calls, 351 validation).

**What I tested.** Codex's round-2 point was that my best filter (15-minute run-up of at least 5.58x before the call, sell at +50% / stop at −30%) makes money before costs, and that the 0.006 SOL fixed charge per round trip is what kills it. Buying 0.2 SOL (the most the referee allows) halves that charge's share. `work/r3-size.ts` crosses the run-up threshold (4x, 5.58x, 8x) with a minimum liquidity ($0 to $40K), two exits and both sizes. It reads `work/r2-table.json`, which is built by `work/r2-table.ts`. Run with `npx tsx research/debate-calls/2026-09-30T19-09-03/work/r3-size.ts`.

**What I concede, and my own mistakes:**
- **Two of my round-2 claims were wrong.** I said nothing was positive on the fit half and that doubling size doubles the loss. In fact 13 combinations (at least 30 trades each) are positive after costs on fit. The best-sized one is at least $5K liquidity, run-up at least 5.58x, 0.2 SOL: +0.0067 trimmed mean, n=97.
- **Codex is right that this filter is positive before costs, and right that doubling size didn't separate out the costs.**

**But none of the 13 survives validation.** That same combination returns −0.0074 trimmed on validation (n=61). The strongest fit result (at least $10K liquidity, run-up at least 8x, 0.2 SOL) goes from +0.0183 (n=48) to −0.0132 (n=32). No 5x or 10x move was realized in any of them.

**One day carries them** (`work/r3-carry.ts`). Of the best-sized combination's +0.808 SOL fit total, +0.675 comes from 17 trades on 2026-09-17, a single day. The other 80 fit trades make +0.13. The caller effect flips between halves:

| | caller_01 | everyone else |
|---|---|---|
| Fit trimmed mean | −0.0033 (n=44) | +0.0118 (n=53) |
| Validation trimmed mean | +0.0113 (n=19) | −0.0200 (n=42) |

That is noise, not an edge. Bigger size was the last way to cut costs, and it doesn't work out of sample.

**Where I still disagree:**
1. **"Negative before costs."** I drop this claim for the run-up filter. I keep it for buying every call and for the high-liquidity filter: Codex's own replay has both negative before costs on both halves (trimmed −0.0024 / −0.0030 and −0.0017 / −0.0017).
2. **"This doesn't refute every possible strategy."** That's true logically. But the live-feasible space of simple rules has now been swept: about 650 of my filter-exit pairs, Codex's 75 and 24 rules, and this grid. Nothing survives both halves.
3. **The user's belief is refuted.** Codex's 12x-target test did capture 13 10x moves on validation and still lost 11.5 SOL.

**Why this should hold on unseen calls:** the holdout comes after validation, and every rule that looked good on fit failed there. A tie with Codex's identical abstention measures no skill. The joint answer to give the user is: **don't trade these calls.**

The two new scripts are in `work/`: `r3-size.ts` and `r3-carry.ts`.
