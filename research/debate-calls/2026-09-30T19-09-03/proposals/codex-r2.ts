import type { CallStrategy } from '../../../../scripts/lib/callsSim.ts';

// Round 2: retain cash under the required 0.1 SOL book and referee costs.
// Another 24 live-feasible sustained-recovery rules failed on fit (n=57-253);
// the fit-selected rule also failed validation (n=148). Evidence and exact
// reproduction commands: ../work/codex-r2-report.md.
// Correction to Claude: one pre-call run-up filter has positive gross trimmed
// returns on both splits, but fixed charges alone erase them. Negative net
// returns do not prove that prices have no predictive information.
// Abstention estimates no trading edge and mechanically ties Claude's R2 rule.
// A future active proposal needs positive after-cost trimmed returns on fit
// and validation, >=30 trades each, concentration checks, and sealed evaluation.
const strategy: CallStrategy = {
  name: 'codex-r2: retain cash; no demonstrated edge after costs',
  description: 'No entry: new recovery tests lose; positive gross run-up returns do not survive the required costs.',
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: 'fixed', tp: 50, sl: 30 },
};
export default strategy;
