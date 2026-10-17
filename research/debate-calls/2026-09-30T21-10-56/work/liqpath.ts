// Post-call liquidity/price paths: can graduation be seen live (liquidity jump) and how soon after the call?
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBars } from "../../../../scripts/lib/callsSim.ts";
const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
// print a few paths
for (const r of rows.filter((r) => r.n === 0).slice(0, 4)) {
  const bars = loadBars(DATA, r.mint)!;
  const s = bars.filter((b) => b.t >= r.callMs - 5 * 60_000 && b.t <= r.callMs + 90 * 60_000);
  console.log(r.mint.slice(0, 8), s.filter((_, i) => i % 3 === 0).map((b) => `${Math.round((b.t - r.callMs) / 60000)}m:${(b.c * 1e9 / 1000).toFixed(0)}k/L${(b.liq / 1000).toFixed(1)}k`).join(" "));
}
for (const r of rows.filter((r) => r.n > 200).slice(0, 2)) {
  const bars = loadBars(DATA, r.mint)!;
  const s = bars.filter((b) => b.t >= r.callMs - 5 * 60_000 && b.t <= r.callMs + 60 * 60_000);
  console.log("ev>200", r.mint.slice(0, 8), s.filter((_, i) => i % 3 === 0).map((b) => `${Math.round((b.t - r.callMs) / 60000)}m:${(b.c * 1e9 / 1000).toFixed(0)}k/L${(b.liq / 1000).toFixed(1)}k`).join(" "));
}
// liquidity at call vs max liq in 24h after, by group
for (const [lab, rs] of [["empty", rows.filter((r) => r.n === 0)], ["ev>0", rows.filter((r) => r.n > 0)]] as const) {
  const ratios: number[] = [], liq0: number[] = [], tJump: number[] = [];
  for (const r of rs) {
    const bars = loadBars(DATA, r.mint)!;
    const pre = bars.filter((b) => b.t < r.callMs), post = bars.filter((b) => b.t >= r.callMs && b.t <= r.callMs + 86_400_000);
    const l0 = pre.length ? pre[pre.length - 1].liq : post[0].liq;
    liq0.push(l0);
    ratios.push(Math.max(...post.map((b) => b.liq)) / Math.max(1, l0));
    const j = post.find((b) => b.liq >= 3 * l0 && b.liq >= 10_000);
    if (j) tJump.push((j.t - r.callMs) / 60_000);
  }
  console.log(lab, `n${rs.length}`, "liq@call q10/50/90", [0.1, 0.5, 0.9].map((p) => q(liq0, p).toFixed(0)).join("/"), "maxLiq/liq@call q10/50/90", [0.1, 0.5, 0.9].map((p) => q(ratios, p).toFixed(1)).join("/"),
    `jump(3x & >=10k) ${tJump.length}/${rs.length}, minutes q25/50/75/90`, [0.25, 0.5, 0.75, 0.9].map((p) => q(tJump, p).toFixed(0)).join("/"));
}
