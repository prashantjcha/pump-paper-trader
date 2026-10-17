// Leak-free entry: wait for the liquidity jump that marks graduation (visible live in bar liquidity), then buy.
import { fmt, row } from "./grid.ts";
import type { CallCtx, CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const liqAtCall = (c: CallCtx) => (c.pre.length ? c.pre[c.pre.length - 1].liq : c.post[0]?.liq ?? 0);
export const gradEntry = (k: number, minLiq: number, wait: number, preCapMax = Infinity) => (c: CallCtx) => {
  if (!c.post.length) return false;
  const l0 = liqAtCall(c), b = c.post[c.post.length - 1];
  const cap0 = (c.pre.length ? c.pre[c.pre.length - 1].c : c.post[0].o) * 1e9;
  return cap0 <= preCapMax && b.liq >= k * Math.max(1, l0) && b.liq >= minLiq && c.minutesSinceCall <= wait;
};
const exits: PolicySpec[] = [
  { family: "fixed", tp: 100, sl: 50 }, { family: "fixed", tp: 200, sl: 50 }, { family: "fixed", tp: 50, sl: 35 },
  { family: "trailing", arm: 100, trail: 40, sl: 50 }, { family: "trailing", arm: 30, trail: 35, sl: 50 }, { family: "trailing", arm: 0, trail: 30, sl: 40 },
  { family: "time", hMin: 15, sl: 35 },
];
const mode = process.argv[2] ?? "entries";
if (mode === "entries") {
  for (const [k, minLiq, wait] of [[3, 10_000, 60], [3, 10_000, 180], [2, 8_000, 60], [3, 15_000, 60], [5, 10_000, 60]] as const) {
    const s: CallStrategy = { name: "", maxWaitMin: wait, shouldEnter: gradEntry(k, minLiq, wait), exit: { family: "fixed", tp: 100, sl: 50 } };
    console.log(`jump ${k}x >=${minLiq} in ${wait}m, tp100/sl50`.padEnd(40), fmt(row(s)));
  }
} else {
  const [k, minLiq, wait] = mode.split(",").map(Number);
  for (const e of exits) {
    const s: CallStrategy = { name: "", maxWaitMin: wait, shouldEnter: gradEntry(k, minLiq, wait), exit: e };
    console.log(JSON.stringify(e).padEnd(56), fmt(row(s)));
  }
}
