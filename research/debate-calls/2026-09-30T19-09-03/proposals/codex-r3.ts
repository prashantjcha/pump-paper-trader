import type { CallStrategy } from '../../../../scripts/lib/callsSim.ts';

// Final submission: keep the book in cash. See ../work/codex-r3-report.md.
// Claude's 13 fit-positive cells all fail validation, including six at 0.1 SOL.
// Added 18 pre-run-up/post-confirmation configurations at the required 0.1 SOL:
// 12 have >=30 fit trades; none has a positive trimmed mean. The fit-selected
// configuration also loses on validation (30 trades). Six smaller samples are
// excluded from inference. Positive raw means do not establish robust profit.
// This decision ties Claude's final abstention, not a demonstrated trading edge.
// Reconsider only with an implementable after-cost rule supported by adequate
// samples, caller/day robustness, and genuinely unseen chronological evaluation.
const strategy: CallStrategy = {
  name: 'codex-r3: retain cash; no robust after-cost edge demonstrated',
  description: 'Final abstention after independent referee audit and pre/post momentum confirmation experiments.',
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: 'fixed', tp: 50, sl: 30 },
};
export default strategy;
