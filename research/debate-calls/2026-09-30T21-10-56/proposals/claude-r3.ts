// Claude, round 3 (final): stand aside. Scripts are in ../work/ and run from the repo root with npx tsx.
//
// r3.ts part A: 30-cell grid around Codex r2 (completed pre-call flow trades 1..cap, cap 150-500 x stop 20-50,
// trailing arm 200 / trail 40).
//   - Some cells pass the fit gate: caps 300-500 with stops of 20-35 (n 60-96, trimmed +0.0015..+0.0100).
//   - Every cell has a negative validation trimmed mean (30/30, n 24-76) and a negative test trimmed mean (30/30).
//   - Only cap500 reaches n >= 30 on test.
//   - On validation the tighter stop does not help consistently (Codex's paired change at sl25: -0.09 SOL, n 52).
//   - Excluding caller_03 turns Codex's fit result negative (n 50, trimmed -0.0148, Codex r2 report).
// r3.ts part B: token age <= 30/60/120 min (first completed flow trade). Fit n 359-482, trimmed -0.017..-0.025.
//   Negative on every split under both the live exit and the trailing exit.
// r3c.ts: the live rule with youth measured leak-free (<= 100 completed flow trades) fires on only 24/15/5 calls
//   (fit/val/test), against 110/73/37 for the preTrades rule. With the live exit it is negative on every split
//   (n < 30 each, descriptive only).
// This strategy reads no ctx field.
import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "claude-r3: stand aside (no leak-free entry survives validation)",
  description: "Buys nothing. Fit-passing flow rules all fail validation; the young-token backtest rests on after-the-fact events. See header.",
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: "fixed", tp: 100, sl: 50 },
};
export default strategy;
