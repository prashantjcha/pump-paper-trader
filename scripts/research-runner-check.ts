// Robustness check of the wallet-feature model's best strategies (research/runner-features-2026-09-30/scores.json).
// Re-simulates entries on 1-second bars (the first trade 5 s / 30 s after the call) and never lets an exit fill in the
// entry bar itself, then splits results by how new the token was at the call.
//   npx tsx scripts/research-runner-check.ts
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "../packages/core/src/db.ts";
import { PolicyState, policyName, type PolicySpec } from "../packages/core/src/callPolicy.ts";

type Bar = { t: number; o: number; h: number; l: number; c: number; liq?: number };
const S = JSON.parse(readFileSync(resolve(DATA_DIR, "../research/runner-features-2026-09-30/scores.json"), "utf8"));
const SOL_USD = JSON.parse(readFileSync(resolve(DATA_DIR, "ohlcv/_solusd.json"), "utf8")).usd;
const POS = 0.1, FIXED = 0.003, H = 3_600_000;
const FIT_END = Date.parse("2026-09-18T00:00Z"), VAL_END = Date.parse("2026-09-26T00:00Z");
const impact = (usd: number, liq: number) => Math.min(0.3, liq > 0 ? usd / (usd + liq / 2) : 0.3);

function bars(mint: string) {
  const dir = resolve(DATA_DIR, "ohlcv", mint);
  const secs: Bar[] = [], mins: Bar[] = [];
  for (const f of readdirSync(dir)) {
    if (f.startsWith("codex_s1_")) for (const b of JSON.parse(readFileSync(resolve(dir, f), "utf8")).bars) secs.push({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4] });
    if (f.startsWith("codex_m1_")) for (const b of JSON.parse(readFileSync(resolve(dir, f), "utf8")).bars) mins.push({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], liq: b[6] });
  }
  secs.sort((a, b) => a.t - b.t); mins.sort((a, b) => a.t - b.t);
  return { secs, mins, secEnd: secs.length ? secs[secs.length - 1].t : 0 };
}
const liqAt = (mins: Bar[], t: number) => { let x = 0; for (const b of mins) { if (b.t > t) break; if (b.liq) x = b.liq; } return x; };

type Entry = "minute-bar open (study)" | "1s: +5s" | "1s: +30s";
function sim(call: any, spec: PolicySpec, entryMode: Entry) {
  const { secs, mins, secEnd } = bars(call.mint);
  const fee = call.mint.endsWith("pump") ? 0.0125 : 0.01;
  let entryT: number, entry: number, path: Bar[];
  if (entryMode === "minute-bar open (study)") {
    const i = mins.findIndex((b) => b.t >= call.callMs);
    if (i < 0 || mins[i].t > call.callMs + 10 * 60_000) return null;
    entryT = mins[i].t; entry = mins[i].o; path = mins.slice(i + 1).filter((b) => b.t <= call.callMs + 24 * H); // strict: no exit inside the entry bar
  } else {
    const d = entryMode === "1s: +5s" ? 5 : 30;
    const i = secs.findIndex((b) => b.t >= call.callMs + d * 1000);
    if (i < 0 || secs[i].t > call.callMs + (d + 120) * 1000) return null;
    entryT = secs[i].t; entry = secs[i].o;
    path = [...secs.slice(i + 1), ...mins.filter((b) => b.t > secEnd && b.t <= call.callMs + 24 * H)];
  }
  if (!path.length) return null;
  const tokens = (POS * (1 - fee - impact(POS * SOL_USD, liqAt(mins, entryT)))) / entry;
  const st = new PolicyState(spec, entry, entryT);
  let proceeds = 0, legs = 1;
  let lastFillT = entryT;
  const sell = (px: number, frac: number, t: number) => { const g = tokens * frac * px; proceeds += g * (1 - fee - impact(g * SOL_USD, liqAt(mins, t))); legs++; lastFillT = t; };
  for (const b of path) { for (const f of st.onBar(b)) sell(f.px, f.frac, b.t); if (st.done) break; }
  if (!st.done) { const lb = path[path.length - 1]; for (const f of st.close(lb)) sell(f.px, f.frac, lb.t); }
  return { pnl: proceeds - POS - FIXED * legs, mult: proceeds / POS, entry, holdMin: (lastFillT - entryT) / 60_000 };
}
const stats = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), n = s.length, sum = s.reduce((a, b) => a + b, 0), trim = n > 4 ? s.slice(0, n - 2) : s;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const boot: number[] = []; for (let k = 0; k < 2000 && n; k++) { let t = 0; for (let i = 0; i < n; i++) t += s[Math.floor(rnd() * n)]; boot.push(t / n); } boot.sort((a, b) => a - b);
  return { n, mean: n ? +(sum / n).toFixed(4) : null, trimmed: trim.length ? +(trim.reduce((a, b) => a + b, 0) / trim.length).toFixed(4) : null, total: +sum.toFixed(2), withoutBest: n ? +(sum - s[n - 1]).toFixed(2) : 0,
    win: n ? +(100 * s.filter((x) => x > 0).length / n).toFixed(0) : null, ci95: n ? [+boot[50].toFixed(4), +boot[1949].toFixed(4)] : null };
};
const specs: PolicySpec[] = [{ family: "fixed", tp: 500, sl: 50 }, { family: "fixed", tp: 200, sl: 50 }, { family: "trailing", arm: 100, trail: 50, sl: 50 }];
const periods = [["fit", 0, FIT_END], ["validation", FIT_END, VAL_END], ["recent", VAL_END, Infinity], ["validation+recent", FIT_END, Infinity]] as const;
const out: any[] = [];
const FILTERS: [string, (c: any) => boolean][] = [
  ["model top10", (c) => c.score >= S.thresholds.top10], ["model top20", (c) => c.score >= S.thresholds.top20],
  ["ablation: every call with <100 pre-call trades", (c) => c.trades < 100],
  ["model top20 AND <100 trades", (c) => c.score >= S.thresholds.top20 && c.trades < 100],
];
for (const [fname, fok] of FILTERS) {
  const picked = S.calls.filter(fok);
  for (const spec of specs) for (const mode of ["minute-bar open (study)", "1s: +5s", "1s: +30s"] as Entry[]) {
    const res: any = { filter: fname, exit: policyName(spec), entry: mode };
    for (const [name, a, b] of periods) {
      const r = picked.filter((c: any) => c.callMs >= a && c.callMs < b).map((c: any) => ({ c, r: sim(c, spec, mode) })).filter((x: any) => x.r);
      res[name] = stats(r.map((x: any) => x.r.pnl));
      if (name === "validation+recent") {
        res.newLaunches = stats(r.filter((x: any) => x.c.trades < 100).map((x: any) => x.r.pnl));
        res.olderTokens = stats(r.filter((x: any) => x.c.trades >= 100).map((x: any) => x.r.pnl));
      }
    }
    out.push(res);
  }
}
writeFileSync(resolve(DATA_DIR, "../research/runner-features-2026-09-30/robustness.json"), JSON.stringify(out, null, 1));
console.log("filter | exit | entry || fit n/trim | val n/trim/total/w-o-best | recent n/trim/total | val+recent mean CI95 | new launches (<100 trades) n/trim | older n/trim");
for (const r of out) console.log(`${r.filter} | ${r.exit.padEnd(26)} | ${r.entry.padEnd(24)} || ${r.fit.n}/${r.fit.trimmed} | ${r.validation.n}/${r.validation.trimmed}/${r.validation.total}/${r.validation.withoutBest} | ${r.recent.n}/${r.recent.trimmed}/${r.recent.total} | ${JSON.stringify(r["validation+recent"].ci95)} | ${r.newLaunches.n}/${r.newLaunches.trimmed} | ${r.olderTokens.n}/${r.olderTokens.trimmed}`);

// Concentration: validation+recent trades of "top20 | tp200 sl50 | 1s +5s" by caller and by day.
{
  const th = S.thresholds.top20, spec: PolicySpec = { family: "fixed", tp: 200, sl: 50 };
  const tr = S.calls.filter((c: any) => c.score >= th && c.callMs >= FIT_END).map((c: any) => ({ c, r: sim(c, spec, "1s: +5s") })).filter((x: any) => x.r);
  const group = (key: (x: any) => string) => { const m = new Map<string, number[]>(); for (const x of tr) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x.r.pnl]); } return [...m.entries()].map(([k, v]) => ({ k, n: v.length, total: +v.reduce((a, b) => a + b, 0).toFixed(3) })).sort((a, b) => b.total - a.total); };
  const byCaller = group((x) => x.c.caller), byDay = group((x) => new Date(x.c.callMs).toISOString().slice(0, 10));
  const total = tr.reduce((a: number, x: any) => a + x.r.pnl, 0);
  console.log(`
concentration (top20, tp200 sl50, 1s +5s entry), validation+recent: ${tr.length} trades, total ${total.toFixed(3)} SOL`);
  console.log("by caller:", byCaller.map((x) => `${x.k} ${x.n}/${x.total}`).join(", "));
  console.log("by day:", byDay.map((x) => `${x.k.slice(5)} ${x.n}/${x.total}`).join(", "));
  console.log(`positive days ${byDay.filter((x) => x.total > 0).length} of ${byDay.length}; without best day ${(total - byDay[0].total).toFixed(3)}; without best caller ${(total - byCaller[0].total).toFixed(3)}`);
}

// Hold time of the strategy's trades (validation+recent).
{
  const th = S.thresholds.top20, spec: PolicySpec = { family: "fixed", tp: 200, sl: 50 };
  const tr = S.calls.filter((c: any) => c.score >= th && c.callMs >= FIT_END).map((c: any) => sim(c, spec, "1s: +5s")).filter((x: any) => x);
  const q = (v: number[], p: number) => { const s2 = [...v].sort((a, b) => a - b); return s2.length ? +s2[Math.floor(p * (s2.length - 1))].toFixed(1) : null; };
  const wins = tr.filter((x: any) => x.pnl > 0), losses = tr.filter((x: any) => x.pnl <= 0);
  console.log(`hold minutes (top20, tp200 sl50): wins ${wins.length} median ${q(wins.map((x: any) => x.holdMin), 0.5)} p25 ${q(wins.map((x: any) => x.holdMin), 0.25)} p75 ${q(wins.map((x: any) => x.holdMin), 0.75)}; losses ${losses.length} median ${q(losses.map((x: any) => x.holdMin), 0.5)}; wins within 5 min: ${wins.filter((x: any) => x.holdMin <= 5).length}`);
}
