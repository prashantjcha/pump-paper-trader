// The strategy now running live: buy a call only if the token had at most 100 trades before it; exit +100% / -50%.
import type { CallStrategy } from "../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2)",
  maxWaitMin: 0,
  shouldEnter: (ctx) => ctx.preTrades.length <= 100,
  exit: { family: "fixed", tp: 100, sl: 50 },
};
export default strategy;
