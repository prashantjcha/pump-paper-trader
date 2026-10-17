// Codex round 3, final: abstain. Withdraw the round-2 trading recommendation.
// Evidence and exact reproduction commands: ../work/codex-r3-report.md.
// Eight new fit-selected candidates were tested with the unchanged referee.
// None survived the declared fit gate plus best-caller/day exclusions.
// All eight had negative validation trimmed means (n=52 or 144).
// This ties Claude's action, captures no runners, and does NOT beat the
// event-history live rule's snapshot P&L or prove that no profitable rule exists.
// No runtime data fields, historical identities, or tunable entry thresholds.
import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "codex-r3: abstain after concentration and exit checks",
  description: "Final research decision: no tested challenger passes the evidence requirements. Reassess with call-time history and a genuinely forward sample.",
  maxWaitMin: 0,
  shouldEnter: () => false,
  exit: { family: "fixed", tp: 100, sl: 50 },
};
export default strategy;
