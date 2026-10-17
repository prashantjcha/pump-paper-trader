// Claude, round 1: buy at the call only if the token already ran >= 7x in the hour before the call
// (close of the last pre-call bar / open of the first bar in that hour), then take +50% or stop at -30%.
// Post-call momentum and volume did not change the odds of a later 5x in the fit window, so there is no
// confirmation wait; pre-call run-up is the one call-time feature with a monotonic effect on outcomes.
import type { CallCtx, CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const RUNUP_MIN = 7;
const runup = (c: CallCtx) => {
  const hour = c.pre.filter((b) => b.t >= c.callMs - 3_600_000);
  return hour.length >= 2 ? hour[hour.length - 1].c / hour[0].o : 0;
};

const strategy: CallStrategy = {
  name: "claude-r1: pre-call run-up >= 7x, buy at call, tp +50% / sl -30%",
  maxWaitMin: 0,
  shouldEnter: (c) => runup(c) >= RUNUP_MIN,
  exit: { family: "fixed", tp: 50, sl: 30 },
};
export default strategy;
