// Pre-call run-up filter (close of the last pre-call bar / open of the first bar in the hour before the call)
// x fixed and hold-runner exits, fit and validation. Selection is by FIT; VAL is printed alongside.
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/runup.ts
import { evaluate, type CallCtx, type CallStrategy } from "../../../../scripts/lib/callsSim.ts";
import type { PolicySpec } from "../../../../packages/core/src/callPolicy.ts";

const DATA = "research/debate-calls/2026-09-30T19-09-03/data";
const FIT: [number, number] = [0, Date.parse("2026-09-18")];
const VAL: [number, number] = [Date.parse("2026-09-18"), Date.parse("2026-09-26")];
const fmt = (r: ReturnType<typeof evaluate>) =>
  `n${String(r.entries).padStart(4)} tot${r.totalSol.toFixed(2).padStart(7)} mean${(r.meanSol ?? 0).toFixed(4).padStart(8)} trim${(r.trimmedMeanSol ?? 0).toFixed(4).padStart(8)} woBest${r.totalWithoutBestSol.toFixed(2).padStart(7)} win${String(r.winRate).padStart(5)}% c5/10 ${r.captured5x}/${r.captured10x}`;
export const runup = (c: CallCtx) => {
  const h = c.pre.filter((b) => b.t >= c.callMs - 3_600_000);
  return h.length >= 2 ? h[h.length - 1].c / h[0].o : 0;
};
const filters: [string, (c: CallCtx) => boolean][] = [
  ["all", () => true],
  ["runup<4", (c) => runup(c) > 0 && runup(c) < 4],
  ["runup>=4", (c) => runup(c) >= 4],
  ["runup>=7", (c) => runup(c) >= 7],
  ["runup>=13", (c) => runup(c) >= 13],
];
const exits: [string, PolicySpec][] = [
  ["tp100 sl30", { family: "fixed", tp: 100, sl: 30 }],
  ["tp100 sl50", { family: "fixed", tp: 100, sl: 50 }],
  ["tp50 sl30", { family: "fixed", tp: 50, sl: 30 }],
  ...[30, 50].flatMap((x) => [3, 5].flatMap((tMin) => [40, 50].flatMap((trail) => [20, 30].map((sl) =>
    [`runner x${x} ${tMin}m t${trail} sl${sl}`, { family: "hold-runner", x, tMin, trail, sl }] as [string, PolicySpec])))),
];
for (const [fn, f] of filters) for (const [xn, x] of exits) {
  const s: CallStrategy = { name: `${fn} | ${xn}`, maxWaitMin: 0, shouldEnter: f, exit: x };
  console.log(`${s.name.padEnd(36)} FIT ${fmt(evaluate(s, DATA, ...FIT))} || VAL ${fmt(evaluate(s, DATA, ...VAL))}`);
}
