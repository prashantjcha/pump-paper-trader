// Round 3 experiments. Run from the repo root:  npx tsx research/debate-calls/2026-09-30T21-10-56/work/r3.ts
// A. Neighbourhood of Codex r2 (completed pre-call flow trades in [1, cap], trailing arm 200 / trail 40, stop sl):
//    cap in {150, 200, 250, 300, 400, 500} x sl in {20, 25, 30, 35, 50}. A real effect should not be a single cell.
// B. Pre-registered leak-free "age" entry (thresholds fixed before running): token age = call time minus the first
//    completed flow bar with a trade; the flow window starts 6 h before the call, so age < 330 min means the first
//    trade we can see is well inside the window. Entry: age <= A min, A in {30, 60, 120}. Exits: live fixed +100/-50
//    and trailing 200/40/50. Same fit gate as before (n >= 30, trimmed > 0, total without best > 0).
import { fmt, row } from "./grid.ts";
import type { CallCtx, CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const done = (c: CallCtx) => c.flow.filter((b) => b.t + 60_000 <= c.callMs);
const flowTrades = (c: CallCtx) => done(c).reduce((s, b) => s + b.buys + b.sells, 0);
const ageMin = (c: CallCtx) => {
  const f = done(c).find((b) => b.buys + b.sells > 0);
  return f ? (c.callMs - f.t) / 60_000 : null;
};

const part = process.argv[2] ?? "AB";
if (part.includes("A")) {
  console.log("== A: Codex r2 neighbourhood (trail 200/40) ==");
  for (const cap of [150, 200, 250, 300, 400, 500])
    for (const sl of [20, 25, 30, 35, 50]) {
      const s: CallStrategy = {
        name: `flow<=${cap} sl${sl}`, maxWaitMin: 0,
        shouldEnter: (c) => { if (c.post.length !== 0) return false; const t = flowTrades(c); return t > 0 && t <= cap; },
        exit: { family: "trailing", arm: 200, trail: 40, sl },
      };
      console.log(`cap${cap} sl${sl}`.padEnd(14), fmt(row(s)));
    }
}
if (part.includes("B")) {
  console.log("== B: age entry ==");
  const exits: [string, PolicySpec][] = [["fixed100/50", { family: "fixed", tp: 100, sl: 50 }], ["trail200/40/50", { family: "trailing", arm: 200, trail: 40, sl: 50 }]];
  for (const A of [30, 60, 120])
    for (const [xn, x] of exits) {
      const s: CallStrategy = {
        name: `age<=${A} ${xn}`, maxWaitMin: 0,
        shouldEnter: (c) => { if (c.post.length !== 0) return false; const a = ageMin(c); return a !== null && a <= A; },
        exit: x,
      };
      console.log(`age<=${A} ${xn}`.padEnd(24), fmt(row(s)));
    }
}
