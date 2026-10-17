// Leak-free post-call confirmation: buy once the price is up x from the call price within w minutes (optionally with buy-side flow).
import { fmt, row } from "./grid.ts";
import type { CallCtx, CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";
const callPx = (c: CallCtx) => (c.pre.length ? c.pre[c.pre.length - 1].c : c.post[0].o);
const mom = (x: number, w: number, flowReq: boolean) => (c: CallCtx) => {
  if (!c.post.length || c.minutesSinceCall > w) return false;
  const b = c.post[c.post.length - 1];
  if (b.c < (1 + x) * callPx(c)) return false;
  if (!flowReq) return true;
  const f = c.flow.slice(-3), bu = f.reduce((a, z) => a + z.buyVolUsd, 0), su = f.reduce((a, z) => a + z.sellVolUsd, 0);
  return bu > 1.2 * su;
};
const exits: PolicySpec[] = [{ family: "fixed", tp: 100, sl: 50 }, { family: "trailing", arm: 100, trail: 40, sl: 50 }, { family: "trailing", arm: 0, trail: 30, sl: 35 }];
for (const [x, w, fr] of [[0.3, 5, false], [0.5, 5, false], [1, 15, false], [0.5, 15, false], [0.3, 5, true], [0.5, 15, true]] as const)
  for (const e of exits) {
    const s: CallStrategy = { name: "", maxWaitMin: w, shouldEnter: mom(x, w, fr), exit: e };
    console.log(`+${x * 100}% in ${w}m${fr ? " +flow" : ""} ${JSON.stringify(e)}`.padEnd(70), fmt(row(s)));
  }
