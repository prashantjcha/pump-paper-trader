I've written `proposals/claude-r2.ts`. It stands aside again: nothing I tested without leaked data passes the gate on the fit split (at least 30 trades, trimmed mean above 0, total without the best trade above 0). Scripts are in `work/` and run from the repo root with `npx tsx`. The `.ts` files are the record; I copied the `.out` files by hand.

**Rebutting Codex r1.** Codex's best candidate, completed pre-call flow ≤300 trades with the trailing exit, fails Codex's own gate:
- Fit (n 60): trimmed mean −0.006.
- Validation (n 52): total without best −0.106.
- Its fit mean of +0.027 comes from two trades, at 13.4x and 8.5x (`codex-r1-report.md`).

Codex's abstention is equivalent to mine.

**Conceded: `ctx.pre` looks ahead.** Codex is right that the last `ctx.pre` bar ends after the call in 1049/1079 calls. That doesn't rescue anything. In `analyze3b.ts` I anchored cap, liquidity, 5- and 15-min momentum, run-up and distance from the high on the last finished flow bar instead:
- **Trailing exit:** all 30 fit quintile cells are negative (n≈115 each).
- **Live exit (+100%/−50%):** 29/30 are negative. The only positive one, 15-min momentum Q5 at +0.0029 (n 115), is negative on validation (n 72) and test (n 26).

**New tests (`r2.ts`, 2 entries × 2 exits, thresholds fixed before running, all reported):**
- **Dip-buy** (price falls to 0.5x the call-time fill within 60 min): fit n 384, trimmed −0.024 (live exit) and −0.025 (trailing).
- **Caller filter** (≥10 resolved calls, ≥20% of them hit 5x): fit n 25, below the 30-trade minimum, and negative anyway.

**What the live bot actually counts:**
- **Read in the source:** when the bot saw the launch, it counts its own bonding-curve trades (`trader.ts:57-60`). Otherwise it falls back to Codex `getTokenEvents` (`trader.ts:64`), the same query the snapshot ran after the fact (`calls-fetch-flow.ts:49`). A "not found" answer from Codex counts as 0 trades, so the token is treated as young and bought (`trader.ts:67`).
- **Inferred from data:** running that query later is what turns "≤100 trades" into "graduated later". The evidence is Codex's audit: 182/185 empty event lists had more than 100 pre-call flow trades.

**For the user:** the runners are there. With the referee's `calls-eval.ts` on `claude-r2.ts`:

| Split | Eligible calls | Ran 5x | Ran 10x |
|---|---:|---:|---:|
| Fit | 574 | 60 | 26 |
| Validation | 351 | 36 | 14 |
| Test | 154 | 20 | 10 |

No filter using only data available at the call picked them out. The trimmed mean also drops the best two trades whatever n is (`callsSim.ts:201`), so it throws away exactly the trades you want to catch. Buying every call with the trailing exit catches 8 of the fit 5x runners and still scores −0.023 trimmed.

**I concede:** the bar of beating the live rule on all three splits is not met by either of us.

**I dispute:** any number built on `preTrades` or `ctx.pre`, including the live rule's holdout score. The holdout is scored with events fetched after the fact (`debate-calls.ts:145`). Referee: please measure youth from a count recorded at call time, or from `ctx.flow`.

**Why abstaining should win on unseen calls:** it reads no context field, so neither leak can touch it. Every leak-free entry either of us tested, 30+ strategy variants plus 30 quintile cells, loses on fit. Zero beats all of them.

`claude-r2.ts` is n=0 on all three splits (fit/validation/test). Command: `npx tsx scripts/calls-eval.ts research/debate-calls/2026-09-30T21-10-56/proposals/claude-r2.ts --data research/debate-calls/2026-09-30T21-10-56/data [--from/--to] --trades 0`.
