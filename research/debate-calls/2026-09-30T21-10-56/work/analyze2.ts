// Events-empty vs flow-measured youth. Rows are every first call (entered at the call; exits: trail arm200/40 sl50 and live tp100/sl50).
import { readFileSync } from "node:fs";
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const m = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const tm = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return m(a.length > 4 ? s.slice(0, -2) : s); };
const cell = (rs: any[]) => `n${String(rs.length).padStart(3)} tm${tm(rs.map((r) => r.pnl)).toFixed(4)} live${tm(rs.map((r) => r.pnlLive)).toFixed(4)} p3x${(rs.filter((r) => r.peak >= 3).length / Math.max(1, rs.length) * 100).toFixed(0)}%`;
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const show = (lab: string, pred: (r: any) => boolean) => console.log(lab.padEnd(34), ["fit", "val", "test"].map((k) => cell(rows.filter((r) => r.split === k && pred(r)))).join(" | "));

const z = rows.filter((r) => r.n === 0), nz = rows.filter((r) => r.n > 0);
console.log("events empty:", z.length, "flowTrades q10/50/90", [0.1, 0.5, 0.9].map((p) => q(z.map((r) => r.flowTrades), p)), "flowAge", [0.1, 0.5, 0.9].map((p) => q(z.map((r) => r.flowAgeMin), p).toFixed(0)));
console.log("events non-empty:", nz.length, "flowTrades q10/50/90", [0.1, 0.5, 0.9].map((p) => q(nz.map((r) => r.flowTrades), p)), "n q50", q(nz.map((r) => r.n), 0.5), "flowAge", [0.1, 0.5, 0.9].map((p) => q(nz.map((r) => r.flowAgeMin), p).toFixed(0)));
console.log("preBars (empty events) q10/50/90", [0.1, 0.5, 0.9].map((p) => q(z.map((r) => r.preBars), p)), " non-empty", [0.1, 0.5, 0.9].map((p) => q(nz.map((r) => r.preBars), p)));
console.log("liq empty q50", q(z.map((r) => r.liq), 0.5).toFixed(0), "non-empty q50", q(nz.map((r) => r.liq), 0.5).toFixed(0));
console.log("pump suffix: empty", (z.filter((r) => r.mint.endsWith("pump")).length / z.length * 100).toFixed(0) + "%", "non-empty", (nz.filter((r) => r.mint.endsWith("pump")).length / nz.length * 100).toFixed(0) + "%");

console.log("\nbaseline groups");
show("all calls", () => true);
show("live rule n<=100", (r) => r.n <= 100);
show("events empty", (r) => r.n === 0);
show("events 1-100", (r) => r.n > 0 && r.n <= 100);
console.log("\nflowTrades bins (all calls)");
for (const [lo, hi] of [[0, 100], [101, 300], [301, 1000], [1001, 3000], [3001, 1e9]]) show(`flowTrades ${lo}-${hi}`, (r) => r.flowTrades >= lo && r.flowTrades <= hi);
console.log("\nflowTrades bins (events empty)");
for (const [lo, hi] of [[0, 100], [101, 300], [301, 1000], [1001, 3000], [3001, 1e9]]) show(`empty & flowTrades ${lo}-${hi}`, (r) => r.n === 0 && r.flowTrades >= lo && r.flowTrades <= hi);
console.log("\nflowAge bins (all calls)");
for (const [lo, hi] of [[0, 15], [15, 60], [60, 180], [180, 400]]) show(`flowAge ${lo}-${hi}m`, (r) => r.flowAgeMin >= lo && r.flowAgeMin < hi);
console.log("\nflowAge bins (events empty)");
for (const [lo, hi] of [[0, 15], [15, 60], [60, 180], [180, 400]]) show(`empty & flowAge ${lo}-${hi}m`, (r) => r.n === 0 && r.flowAgeMin >= lo && r.flowAgeMin < hi);
console.log("\nliq bins (events empty)");
for (const [lo, hi] of [[0, 2000], [2000, 3000], [3000, 5000], [5000, 1e12]]) show(`empty & liq ${lo}-${hi}`, (r) => r.n === 0 && r.liq >= lo && r.liq < hi);
console.log("\nrunup (call px / first flow px), events empty");
for (const [lo, hi] of [[0, 1], [1, 2], [2, 5], [5, 1e9]]) show(`empty & runup ${lo}-${hi}`, (r) => r.n === 0 && r.runup != null && r.runup >= lo && r.runup < hi);
console.log("\noffHigh (call px / pre high), events empty");
for (const [lo, hi] of [[0, 0.5], [0.5, 0.8], [0.8, 1.01]]) show(`empty & offHigh ${lo}-${hi}`, (r) => r.n === 0 && r.offHigh != null && r.offHigh >= lo && r.offHigh < hi);
