// Claude, round 2: abstain. Conceded to the evidence: with the pre-call lookahead fixed (completed bars only),
// the round-1 run-up rule loses on both halves (trimmed -0.0085 fit n=222, -0.0051 val n=115), and none of the
// 47 call-time filters x 14 exit/size combinations in work/r2-table.ts + work/r2-slice.ts has a positive fit
// trimmed mean at n >= 30. Doubling size to 0.2 SOL roughly doubles the loss even at high liquidity, so the
// calls have a negative edge before costs, not just a cost problem.
// Re-enter only when a live-feasible rule shows a positive trimmed mean on BOTH fit and validation (n >= 30 each)
// that is not carried by one caller or one week.
import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "claude-r2: abstain; every tested entry/exit loses on both halves",
  description: "No entries until a rule is positive (trimmed mean, n>=30) on fit and validation and not carried by one caller.",
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: "fixed", tp: 50, sl: 30 }, // required by the interface; never reached
};
export default strategy;
