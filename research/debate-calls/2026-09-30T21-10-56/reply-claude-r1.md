I propose standing aside: `proposals/claude-r1.ts` buys nothing. The live rule's backtest edge comes from future information, and none of the entries I tested without that leak makes money on the fit split. Scripts are in `work/`, run from the repo root with `npx tsx`; run `features.ts` first. The referee's figures for the live rule reproduce exactly: trimmed mean +0.0144 / +0.0362 / +0.0208 (fit/val/test, n 110/73/37), `work/grid.ts`.

**The leak.** `preTrades` comes from Codex events fetched on Sep 30 for the token's current top pair. If a token graduated after the call, that pair (its post-graduation pool) didn't exist before the call, so the list is empty. Yet the flow bars show a median of ~1,000 trades before the call for these tokens.
- **Example:** Repos… was called at 18:54 and its PumpSwap pool was created at 19:16. Its events file is empty and marked complete.
- **Graduation test (`leak2.ts`):** among tokens under $60k market cap before the call, 66% of the empty-events ones crossed $60k within 24 h (n 179), against 9% of the rest (n 445).
- **Pool dates:** only 17 tokens have `pools.json`. None of the 6 empty-events ones had a post-graduation pool before the call; 8 of 11 tokens with >100 events did.
- **Where the edge sits (`analyze2.ts`):** the empty-events calls (n 90/64/31) carry the whole result. Calls with 1–100 real events lose on every split (n 35 combined, trimmed mean about −0.05). Tokens that are young by flow count (≤628 trades, n 115/101/36) are negative on all three splits.

**Live and holdout.** This part is inferred, not observed. At call time the same query (`apps/telegram/src/trader.ts:64`) should return the curve trades, so live would reject these tokens and buy the truly young ones. The snapshot's `status` column is all `historical`, so I couldn't confirm it. Referee: please compare live "not young: N" rejections since commit 2def494 with the snapshot counts. The holdout (`scripts/debate-calls.ts:145`) reads events fetched after the fact by `calls-fetch-flow.ts:49`, so it has the same leak. Please score it on the count recorded at call time, or measure youth from `ctx.flow`.

**Leak-free tries, all negative on fit:**
- **Call-time features (`analyze3.ts`):** every fit quintile of 17 bar, flow and caller features is negative (n≈115 each).
- **Buying on the graduation liquidity jump (`gradentry.ts`):** 3×, ≥$10k, within 60 min gave trimmed mean −0.029 / −0.009 / −0.016 (n 49/29/23). The 2× version was negative on fit and val for every exit (n 86/60/31).
- **Momentum (`momentum.ts`):** +30% within 5 min, n 187/108/43, negative on every split and exit.

**What stands only if live also sees empty lists.** With the same entry, a trailing exit (arm +200%, trail 40%, stop −50%) beats +100%/−50% on all three splits. Trimmed mean is .0232/.0380/.0377 against .0144/.0362/.0208; captured 5x is 5/3/2 against 0.

**The earlier runner-features report.** Its new-wallet, top-holder, launch-block and holder-count features all have a fit median of 0, and every half above 0 is negative. They measure "empty events", so the AUC 0.75/0.83 model needs re-running on tokens that have events.

**I concede:** the live rule's referee numbers can't be reached as a young-token rule.

**I dispute:** any proposal that uses `preTrades` on this snapshot.

**Why standing aside should win on unseen calls:** zero beats a rule that should lose live, and it forces the holdout to be scored on data available at the time of the call.
