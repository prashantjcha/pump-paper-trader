// Per-caller and per-caller-stat breakdown of one reference strategy (buy at call, trail arm100 t50 sl50).
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/callers.ts [from ISO] [to ISO]
import { evaluate, loadCalls, type CallStrategy, type Trade } from "../../../../scripts/lib/callsSim.ts";

const DATA = "research/debate-calls/2026-09-30T19-09-03/data";
const from = Date.parse(process.argv[2] ?? "2026-01-01"), to = Date.parse(process.argv[3] ?? "2026-09-18");
let statsOf = new Map<string, { calls: number; hit2x: number; hit5x: number; minute0: number }>();
const s: CallStrategy = {
  name: "ref", maxWaitMin: 0, exit: { family: "trailing", arm: 100, trail: 50, sl: 50 },
  shouldEnter: (c) => {
    statsOf.set(c.mint, { ...c.callerStats, minute0: c.pre.length });
    if (!process.argv.includes("--runup7")) return true;
    const h = c.pre.filter((b) => b.t >= c.callMs - 3_600_000);
    return h.length >= 2 && h[h.length - 1].c / h[0].o >= 7;
  },
};
const r = evaluate(s, DATA, from, to);
const summ = (name: string, t: Trade[]) => {
  if (!t.length) return;
  const v = t.map((x) => x.pnlSol).sort((a, b) => a - b), tot = v.reduce((a, b) => a + b, 0);
  const trim = v.length > 4 ? v.slice(0, -2).reduce((a, b) => a + b, 0) / (v.length - 2) : NaN;
  console.log(`${name.padEnd(28)} n${String(t.length).padStart(4)} tot${tot.toFixed(2).padStart(7)} trim${trim.toFixed(4).padStart(8)} peak5x ${(t.filter((x) => x.peakMult >= 5).length / t.length * 100).toFixed(0)}% peak2x ${(t.filter((x) => x.peakMult >= 2).length / t.length * 100).toFixed(0)}%`);
};
const by = (k: (t: Trade) => string) => { const m = new Map<string, Trade[]>(); for (const t of r.trades) m.set(k(t), [...(m.get(k(t)) ?? []), t]); return [...m.entries()].sort((a, b) => b[1].length - a[1].length); };
console.log("-- by caller"); for (const [k, t] of by((t) => t.caller)) if (t.length >= 15) summ(k, t);
console.log("-- by point-in-time caller 2x rate");
for (const [k, t] of by((t) => { const st = statsOf.get(t.mint)!; return st.calls < 10 ? "<10 known" : st.hit2x / st.calls >= 0.4 ? ">=40% 2x" : st.hit2x / st.calls >= 0.25 ? "25-40% 2x" : "<25% 2x"; })) summ(k, t);
console.log("-- by UTC hour block"); for (const [k, t] of by((t) => `h${String(Math.floor(new Date(t.callMs).getUTCHours() / 4) * 4).padStart(2, "0")}`).sort()) summ(k, t);
console.log("-- by weekday"); for (const [k, t] of by((t) => "SMTWTFS"[new Date(t.callMs).getUTCDay()] + new Date(t.callMs).getUTCDay())) summ(k, t);
