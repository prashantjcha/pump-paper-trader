// Codex round 2: the sole candidate passing the declared fit-only gate among 12.
// Sealed-snapshot results and commands: ../work/codex-r2-report.md.
// Entry counts completed pre-call FLOW minutes, not the suspect preTrades list.
// The available six-hour flow count is a lower bound on lifetime activity;
// this is a low-recent-activity rule, not proof that the token is newly launched.
//
// At 0.1 SOL per trade, fit / validation / test:
// n                60       52        16 (test is below the 30-trade evidence minimum)
// mean SOL         .03916   .01265   -.00787
// trimmed SOL      .00645  -.01085   -.03177
// without best    1.1143   -.1914    -.3615
// captured5x/10x    4/1      1/0       0/0
// This challenges abstention on fit; it is NOT a demonstrated all-split improvement.
// Retained after validation to honor fit-only selection; no threshold retuning.
import type { CallStrategy } from "../../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "codex-r2: completed flow <=300, stop25, trail200/40",
  description: "Fit-selected paper challenger: enter on 1–300 trades in completed pre-call flow, stop -25%, arm trail at +200%, trail 40%. Validation remains concentrated; not proven superior to the live rule.",
  maxWaitMin: 0,
  shouldEnter(ctx) {
    if (ctx.post.length !== 0) return false;
    let trades = 0;
    for (const b of ctx.flow) {
      if (b.t + 60_000 <= ctx.callMs) trades += b.buys + b.sells;
    }
    return trades > 0 && trades <= 300;
  },
  exit: { family: "trailing", arm: 200, trail: 40, sl: 25 },
};
export default strategy;
