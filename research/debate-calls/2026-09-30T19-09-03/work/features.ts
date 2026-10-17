// Feature study on the fit window: at checkpoint T minutes after the call, which bar features predict the
// forward outcome (from the next bar's open to the 24 h horizon)? Prints bucketed forward stats.
//   npx tsx research/debate-calls/2026-09-30T19-09-03/work/features.ts [T] [from ISO] [to ISO]
import { loadBars, loadCalls, HORIZON_MS } from "../../../../scripts/lib/callsSim.ts";

const DATA = "research/debate-calls/2026-09-30T19-09-03/data";
const T = Number(process.argv[2] ?? 15);
const from = Date.parse(process.argv[3] ?? "2026-01-01"), to = Date.parse(process.argv[4] ?? "2026-09-18");

interface Row { f: Record<string, number>; fwdPeak: number; fwdEnd: number; fwdMin: number }
const rows: Row[] = [];
for (const c of loadCalls(DATA, from, to)) {
  const bars = loadBars(DATA, c.mint);
  if (!bars) continue;
  const post = bars.filter((b) => b.t >= c.callMs && b.t <= c.callMs + HORIZON_MS);
  if (!post.length || post[0].t > c.callMs + 10 * 60_000) continue;
  const pre = bars.filter((b) => b.t < c.callMs && b.t >= c.callMs - 60 * 60_000);
  const preVol = pre.reduce((a, b) => a + b.v, 0);
  // T = 0: features from the hour before the call only; the forward path starts at the first post-call bar
  const i = T === 0 ? 0 : post.findIndex((b) => b.t - c.callMs > T * 60_000);
  if (T === 0 ? pre.length < 2 : i < 1) continue;
  const seen = T === 0 ? pre : post.slice(0, i), fwd = post.slice(i);
  const o0 = seen[0].o, cur = seen[seen.length - 1];
  const hi = Math.max(...seen.map((b) => b.h));
  const vol = seen.reduce((a, b) => a + b.v, 0);
  const oldest = bars[0].t;
  const last5 = seen.slice(-5).reduce((a, b) => a + b.v, 0);
  const green = seen.filter((b) => b.c > b.o).length / seen.length;
  const entry = fwd[0].o;
  rows.push({
    f: {
      ret: cur.c / o0, hiMult: hi / o0, offHi: cur.c / hi, volK: vol / 1000, preVolK: preVol / 1000,
      volRatio: preVol > 0 ? vol / preVol : 99, last5Share: vol > 0 ? last5 / vol : 0, bars: seen.length, green,
      liqK: cur.liq / 1000, mcapProxy: cur.c * 1e9 / 1000, ageH: (c.callMs - oldest) / 3_600_000,
    },
    fwdPeak: Math.max(...fwd.map((b) => b.h)) / entry, fwdEnd: fwd[fwd.length - 1].c / entry, fwdMin: Math.min(...fwd.map((b) => b.l)) / entry,
  });
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`T=${T}m n=${rows.length}  all: p5x ${(rows.filter((r) => r.fwdPeak >= 5).length / rows.length * 100).toFixed(1)}% p2x ${(rows.filter((r) => r.fwdPeak >= 2).length / rows.length * 100).toFixed(1)}% medEnd ${med(rows.map((r) => r.fwdEnd)).toFixed(2)}`);
for (const k of Object.keys(rows[0].f)) {
  const s = [...rows].sort((a, b) => a.f[k] - b.f[k]);
  const q = 5, parts: string[] = [];
  for (let j = 0; j < q; j++) {
    const g = s.slice(Math.floor(j * s.length / q), Math.floor((j + 1) * s.length / q));
    parts.push(`[${g[0].f[k].toFixed(2)}..${g[g.length - 1].f[k].toFixed(2)}] n${g.length} 2x${(g.filter((r) => r.fwdPeak >= 2).length / g.length * 100).toFixed(0)}% 5x${(g.filter((r) => r.fwdPeak >= 5).length / g.length * 100).toFixed(0)}% end${med(g.map((r) => r.fwdEnd)).toFixed(2)}`);
  }
  console.log(`${k.padEnd(11)} ${parts.join(" | ")}`);
}
