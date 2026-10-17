import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

// Round 1 decision: abstain. This ties Claude; it does not beat the live rule's
// reported snapshot P&L. No claim that all possible tradable rules are unprofitable.
//
// Fit-only selection among 12 candidates required >=30 trades, positive trimmed
// mean (referee drops the best two trades), and positive total without the best.
// None passed. The selection was written before evaluating validation/test.
// See ../work/codex-r1-selection.json and ../work/codex-r1-report.md.
//
// Do not interpret missing events as a young token: 182/185 empty histories have
// >100 completed pre-call flow trades. Exact API cause remains unverified.
// No caller whitelist, wallet model, future pool state, or external file reads.
const strategy: CallStrategy = {
  name: "codex-r1: abstain after fit-only flow and exit audit",
  description: "No tested candidate passes the fit robustness gate; event-count youth is not reliable in this snapshot.",
  maxWaitMin: 0,
  shouldEnter: () => false,
  // Required by the interface; unreachable while entry is disabled.
  exit: { family: "fixed", tp: 100, sl: 50 },
};

export default strategy;
