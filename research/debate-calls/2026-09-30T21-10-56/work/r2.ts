// Round 2: pre-registered leak-free candidates (thresholds fixed before any run; all results reported).
// Uses only ctx.post, ctx.callerStats (point-in-time). No ctx.pre, no ctx.preTrades.
//   C1 dip:      within 60 min of the call, enter at the close of a bar that closes <= 0.5x the call-time fill price (post[0].o)
//   C2 caller5x: enter at the call if the caller has >= 10 resolved calls and >= 20% of them reached 5x within 24 h
// Exits: E1 = live fixed +100%/-50%; E2 = trailing arm +200%, trail 40%, stop -50%.
// Selection rule (fit only): n >= 30, trimmed mean > 0 and total without best > 0; else abstain.
//   npx tsx research/debate-calls/2026-09-30T21-10-56/work/r2.ts
import { fmt, row } from "./grid.ts";
import type { CallCtx, CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const dip = (c: CallCtx) => c.post.length > 0 && c.post[c.post.length - 1].c <= 0.5 * c.post[0].o;
const caller5x = (c: CallCtx) => c.callerStats.calls >= 10 && c.callerStats.hit5x / c.callerStats.calls >= 0.2;
const exits: [string, PolicySpec][] = [["E1 fixed100/50", { family: "fixed", tp: 100, sl: 50 }], ["E2 trail200/40/50", { family: "trailing", arm: 200, trail: 40, sl: 50 }]];
const entries: [string, number, (c: CallCtx) => boolean][] = [["all calls (reference)", 0, () => true], ["C1 dip 0.5x in 60m", 60, dip], ["C2 caller5x", 0, caller5x]];
for (const [en, w, f] of entries)
  for (const [xn, x] of exits) {
    const s: CallStrategy = { name: `${en} ${xn}`, maxWaitMin: w, shouldEnter: f, exit: x };
    console.log(`${en} / ${xn}`.padEnd(40), fmt(row(s)));
  }
