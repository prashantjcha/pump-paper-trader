// Is "no pre-call events" just "the main pool was created after the call" (i.e. the token graduated later = future info)?
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const D = resolve("research/debate-calls/2026-09-30T21-10-56/data/ohlcv");
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const m = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const tm = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return m(a.length > 4 ? s.slice(0, -2) : s); };
const cell = (rs: any[]) => `n${String(rs.length).padStart(3)} tm${tm(rs.map((r) => r.pnl)).toFixed(4)} live${tm(rs.map((r) => r.pnlLive)).toFixed(4)} p3x${(rs.filter((r) => r.peak >= 3).length / Math.max(1, rs.length) * 100).toFixed(0)}%`;
const show = (lab: string, pred: (r: any) => boolean) => console.log(lab.padEnd(40), ["fit", "val", "test"].map((k) => cell(rows.filter((r) => r.split === k && pred(r)))).join(" | "));
for (const r of rows) {
  const f = resolve(D, r.mint, "meta.json");
  const j = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  r.mainDex = j?.main?.dex ?? "?";
  r.mainAfter = j?.main?.created ? j.main.created > r.callMs : null;
}
const tab = (lab: string, rs: any[]) => { const c: Record<string, number> = {}; for (const r of rs) { const k = `${r.mainDex}/${r.mainAfter ? "after" : r.mainAfter === false ? "before" : "?"}`; c[k] = (c[k] ?? 0) + 1; } console.log(lab, rs.length, c); };
tab("events empty:", rows.filter((r) => r.n === 0));
tab("events 1-100:", rows.filter((r) => r.n > 0 && r.n <= 100));
tab("events >100:", rows.filter((r) => r.n > 100));
console.log();
show("main pool created AFTER call", (r) => r.mainAfter === true);
show("main pool created before call", (r) => r.mainAfter === false);
show("events empty & main after", (r) => r.n === 0 && r.mainAfter === true);
show("events empty & main before", (r) => r.n === 0 && r.mainAfter === false);
show("events >0 & main after", (r) => r.n > 0 && r.mainAfter === true);
