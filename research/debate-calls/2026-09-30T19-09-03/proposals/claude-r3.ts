// Claude, round 3 (final): abstain.
// Tested Codex's gross-positive 15-min run-up filter with the fixed charge diluted by the 0.2 SOL cap and liquidity floors
// (work/r3-size.ts over work/r2-table.json). 13 filter/exit/size cells are positive after costs on FIT (n >= 30), e.g.
// liq >= $5k & r15 >= 5.58x, tp50/sl30 @0.2: +0.0067 trimmed (n=97). All 13 are negative on VALIDATION (that one: -0.0074, n=61).
// work/r3-carry.ts: +0.675 of that cell's +0.808 fit total comes from 17 trades on a single day (2026-09-17); the other 80 make +0.13,
// and the caller split flips sign between halves. Size is the last cost lever and it doesn't survive out of sample.
// Re-enter only when a live-feasible rule has a positive trimmed mean on BOTH fit and validation (n >= 30 each)
// and isn't carried by one caller, one week or one day.
import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "claude-r3: abstain; 13 fit-positive cells, 0 survive validation",
  description: "No entries: every filter/exit/size cell that is positive after costs on fit loses on validation.",
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: "fixed", tp: 50, sl: 30 }, // required by the interface; never reached
};
export default strategy;
