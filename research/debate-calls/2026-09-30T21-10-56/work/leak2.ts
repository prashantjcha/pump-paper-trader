// Market cap (price x 1e9 supply) at the call vs max within 24 h after, by events group.
// If "events empty" = "graduated after the call", those tokens should sit below the graduation cap at the call and cross it later.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadBars } from "../../../../scripts/lib/callsSim.ts";
const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
for (const r of rows) {
  const bars = loadBars(DATA, r.mint)!;
  const pre = bars.filter((b) => b.t < r.callMs), post = bars.filter((b) => b.t >= r.callMs && b.t <= r.callMs + 86_400_000);
  r.capCall = (pre.length ? pre[pre.length - 1].c : post[0].o) * 1e9;
  r.capPreMax = Math.max(0, ...pre.map((b) => b.h)) * 1e9;
  r.capPostMax = Math.max(...post.map((b) => b.h)) * 1e9;
  r.liqPost = Math.max(...post.map((b) => b.liq));
}
const k = (x: number) => (x / 1000).toFixed(0) + "k";
for (const [lab, rs] of [["events empty", rows.filter((r) => r.n === 0)], ["events 1-100", rows.filter((r) => r.n > 0 && r.n <= 100)], ["events 101-1000", rows.filter((r) => r.n > 100 && r.n <= 1000)], ["events >1000", rows.filter((r) => r.n > 1000)]] as const) {
  console.log(lab.padEnd(16), `n${rs.length}`, "cap@call q10/50/90", [0.1, 0.5, 0.9].map((p) => k(q(rs.map((r) => r.capCall), p))).join("/"),
    " preMax q50/90", [0.5, 0.9].map((p) => k(q(rs.map((r) => r.capPreMax), p))).join("/"),
    " postMax q10/50/90", [0.1, 0.5, 0.9].map((p) => k(q(rs.map((r) => r.capPostMax), p))).join("/"),
    " share postMax>=60k", (rs.filter((r) => r.capPostMax >= 60_000).length / rs.length * 100).toFixed(0) + "%",
    " share preMax>=60k", (rs.filter((r) => r.capPreMax >= 60_000).length / rs.length * 100).toFixed(0) + "%");
}
// among tokens that were below 60k before the call AND had events, how many crossed later? vs events-empty
const below = rows.filter((r) => r.capPreMax < 60_000);
console.log("\npre-call max cap < 60k:", below.length);
for (const [lab, rs] of [["  events empty", below.filter((r) => r.n === 0)], ["  events >0", below.filter((r) => r.n > 0)]] as const)
  console.log(lab.padEnd(16), `n${rs.length}`, "crossed 60k within 24h", (rs.filter((r) => r.capPostMax >= 60_000).length / Math.max(1, rs.length) * 100).toFixed(0) + "%");
