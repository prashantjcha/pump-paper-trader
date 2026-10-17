import type { CallStrategy } from '../../../../scripts/lib/callsSim.ts';

// Round 1 decision: retain cash. No tested entry/exit demonstrated a positive
// fit trimmed mean at adequate sample size. A losing trade is not mandatory.
// This is an explicit no-entry policy, not an estimated zero-return trading edge.
// All active candidate definitions and referee results are preserved in work/.
const strategy: CallStrategy = {
  name: 'codex-r1: abstain; no demonstrated net edge',
  description: 'Preserve capital until a live-feasible rule demonstrates positive after-cost returns.',
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: 'fixed', tp: 50, sl: 30 }, // Required interface field; unreachable.
};
export default strategy;
