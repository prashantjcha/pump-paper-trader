// Claude, round 1: stand aside. The live young-token rule's backtest edge is look-ahead, and no leak-free entry
// tested here is positive on the fit split.
//
// Why: ctx.preTrades comes from Codex getTokenEvents fetched on 2026-09-30, which returns events of the token's
// CURRENT top pair. For a token that graduated AFTER the call, that pair (the AMM pool) did not exist before the
// call, so preTrades is empty even though the token had ~1,000 curve trades (median, ctx.flow) before the call.
// "preTrades.length <= 100" therefore mostly means "graduated later". Live, the same query at call time returns
// the curve trades (inferred, not observed: the snapshot's status column is all "historical"), so the bot would reject
// these tokens and buy the genuinely young ones, which lose.
// Evidence (scripts in ../work/, run from the repo root with npx tsx; features.ts first):
//   - analyze2.ts: events-empty calls n 90/64/31 (fit/val/test) carry the rule; events 1-100 (n 35 combined) lose on
//     every split; flow-measured young (flow trades <= 628, n 115/101/36) is negative on every split.
//   - leak2.ts: of calls whose pre-call max cap < $60k, 66% of events-empty (n 179) crossed $60k within 24 h vs 9% of the rest (n 445).
//   - analyze3.ts, gradentry.ts, momentum.ts: no leak-free entry (call-time bars/flow/caller, graduation jump, post-call momentum) is positive on fit.
import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "claude-r1: stand aside (no leak-free entry beats zero on fit)",
  description: "Buys nothing. The young-token edge comes from pre-call events fetched after graduation; see header.",
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: "fixed", tp: 100, sl: 50 },
};
export default strategy;
