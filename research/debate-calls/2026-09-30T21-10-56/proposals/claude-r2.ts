// Claude, round 2: stand aside again. Nothing leak-free passes the fit gate (n >= 30, trimmed mean > 0,
// total without best > 0), so buying nothing beats every tested entry.
//
// Why the live young-token rule's backtest can't be trusted:
//   - Observed: when the bot saw the launch, live counts pre-call trades from its own trades_raw
//     (apps/telegram/src/trader.ts:57-60), i.e. bonding-curve trades.
//   - Observed: otherwise live falls back to Codex getTokenEvents (trader.ts:64), the same query the snapshot ran
//     (scripts/calls-fetch-flow.ts:49); the only difference is that the snapshot ran it on 2026-09-30, after many tokens
//     had graduated. A Codex "not found" error counts as 0 trades, i.e. young (trader.ts:67).
//   - Inferred, supported by data: that timing difference changes the answer. 182/185 empty event lists have > 100
//     completed pre-call flow trades (Codex r1 audit). So in the backtest "<= 100 trades" mostly selects "graduated
//     later"; live, it should select genuinely young tokens.
//   - The holdout is scored with evaluate() on the live data dir (scripts/debate-calls.ts:145), whose events are fetched
//     the same way after the fact, so the young rule's holdout numbers carry the same leak.
//
// Round 2 evidence (scripts in ../work/, run from the repo root with npx tsx; features.ts first):
//   - analyze3b.ts: Codex was right that ctx.pre's last bar ends after the call (1049/1079 calls). Re-anchored on the last
//     FINISHED flow bar, all 30 fit quintile cells of cap, liquidity, 5/15-min momentum, run-up and distance from high are
//     negative with the trailing exit (n ~115 each); with the live exit 29/30 are negative. The only exception, 15-min
//     momentum Q5 (+0.0029, n 115), is negative on val (n 72) and test (n 26).
//   - r2.ts (pre-registered, 2 entries x 2 exits): dip to 0.5x of the call fill within 60 min, fit n 384, trimmed -0.024/-0.025;
//     caller with >= 10 resolved calls and >= 20% hit 5x, fit n 25 (< 30, and negative).
// This strategy reads no ctx field, so neither the pre-bar lookahead nor the events leak applies to it.
import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "claude-r2: stand aside (no leak-free entry passes the fit gate)",
  description: "Buys nothing. The young-token edge rests on events fetched after graduation; leak-free entries all lose on fit. See header.",
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: "fixed", tp: 100, sl: 50 },
};
export default strategy;
