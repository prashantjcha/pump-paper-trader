// What are the calls with zero pre-call trades? Data gap or genuinely brand-new tokens?
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadBars } from "../../../../scripts/lib/callsSim.ts";
const DATA = resolve("research/debate-calls/2026-09-30T21-10-56/data");
const rows: any[] = JSON.parse(readFileSync("research/debate-calls/2026-09-30T21-10-56/work/features.json", "utf8"));
const z = rows.filter((r) => r.n === 0);
const out: Record<string, number> = {};
const inc = (k: string) => (out[k] = (out[k] ?? 0) + 1);
for (const r of z) {
  const dir = resolve(DATA, "ohlcv", r.mint);
  const ev = resolve(dir, "codex_events_pre.json");
  if (!existsSync(ev)) inc("no events file"); else { const j = JSON.parse(readFileSync(ev, "utf8")); inc(`events file, ${j.events.length ? "has events (all after call?)" : "empty"}, complete=${j.complete}`); if (j.events.length) { const first = j.events[0][0] * 1000; inc(`first event after call: ${Math.round((first - r.callMs) / 60000) <= 5 ? "<=5m" : ">5m"}`); } }
  const bars = loadBars(DATA, r.mint)!;
  const pre = bars.filter((b) => b.t < r.callMs);
  inc(`pre bars ${pre.length === 0 ? "0" : pre.length < 10 ? "1-9" : ">=10"}`);
  inc(`mint ${r.mint.endsWith("pump") ? "pump" : "other"}`);
  const flow = existsSync(resolve(dir, "codex_flow_m1.json")) ? JSON.parse(readFileSync(resolve(dir, "codex_flow_m1.json"), "utf8")).bars.filter((b: number[]) => b[0] * 1000 < r.callMs) : [];
  inc(`pre flow bars ${flow.length === 0 ? "0" : flow.length < 10 ? "1-9" : ">=10"}`);
}
console.log(z.length, out);
console.log("sample", z.slice(0, 5).map((r) => [r.mint, new Date(r.callMs).toISOString(), r.liq, r.px]));
