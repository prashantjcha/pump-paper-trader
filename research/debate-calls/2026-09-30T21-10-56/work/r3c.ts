// Round 3, part C: the live rule measured without the events leak. Live counts bonding-curve trades before the call
// (trader.ts:57-60); the leak-free stand-in is completed pre-call flow trades (buys + sells in flow bars ending by the call).
// Pre-registered: count <= 100 (the live threshold), with and without requiring >= 1 trade; live exit and trailing exit.
//   npx tsx research/debate-calls/2026-09-30T21-10-56/work/r3c.ts
import { fmt, row } from "./grid.ts";
import type { CallCtx, CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const flowTrades = (c: CallCtx) => c.flow.filter((b) => b.t + 60_000 <= c.callMs).reduce((s, b) => s + b.buys + b.sells, 0);
const exits: [string, PolicySpec][] = [["fixed100/50", { family: "fixed", tp: 100, sl: 50 }], ["trail200/40/50", { family: "trailing", arm: 200, trail: 40, sl: 50 }]];
for (const lo of [0, 1])
  for (const [xn, x] of exits) {
    const s: CallStrategy = {
      name: `flow ${lo}-100 ${xn}`, maxWaitMin: 0,
      shouldEnter: (c) => { if (c.post.length !== 0) return false; const t = flowTrades(c); return t >= lo && t <= 100; },
      exit: x,
    };
    console.log(`flow ${lo}-100 ${xn}`.padEnd(26), fmt(row(s)));
  }
