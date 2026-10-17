"use client";
import { useMemo, useState } from "react";
import { usePoll, Card, Stat, Loading, Empty, Badge, sol, signedSol, pct, ratio, num, tone, time, dur, PnlText } from "@/components/ui";
import { SignedBars, PricePath } from "@/components/charts";

const BOOKS = ["momentum", "copy", "manual", "runner", "telegram", "shadow"];
type SortKey = "decision_ms" | "pnl_sol" | "pnl_pct" | "hold_s" | "entry_slippage_pct";

export default function Trades() {
  const [book, setBook] = useState("momentum");
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "decision_ms", desc: true });
  const [sel, setSel] = useState<number | null>(null);
  const { data, error } = usePoll<any>(`/api/data?view=trades&book=${book}`, 5000);
  const rows = useMemo(() => {
    if (!data) return [];
    const r = [...data.rows];
    r.sort((a, b) => ((a[sort.k] ?? -Infinity) - (b[sort.k] ?? -Infinity)) * (sort.desc ? -1 : 1));
    return r;
  }, [data, sort]);
  const th = (k: SortKey, label: string) => (
    <th><button className="hover:text-ink" onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : true })}>{label}{sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}</button></th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {BOOKS.map((b) => (
          <button key={b} onClick={() => { setBook(b); setSel(null); }} className={`rounded-md border px-3 py-1.5 text-sm ${b === book ? "border-ink bg-surface font-medium" : "border-line text-ink-2"}`}>{b}</button>
        ))}
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Closed" value={data.kpis.trades} hint={`${data.kpis.failed} entries failed`} />
            <Stat label="PnL" value={signedSol(data.kpis.pnlSol)} tone={tone(data.kpis.pnlSol)} />
            <Stat label="Win rate" value={ratio(data.kpis.winRate)} />
            <Stat label="Expectancy" value={signedSol(data.kpis.expectancySol, 5)} tone={tone(data.kpis.expectancySol)} />
            <Stat label="Avg win / loss" value={`${pct(data.kpis.avgWinPct)} / ${pct(data.kpis.avgLossPct)}`} />
            <Stat label="Profit factor" value={num(data.kpis.profitFactor)} hint={`max DD ${sol(data.kpis.maxDrawdownSol)} SOL`} />
          </div>
          <Card title="PnL by exit reason" sub="Total SOL per exit reason. Hover for trade counts and average return.">
            {!data.byReason.length ? <Empty>No closed trades yet.</Empty> : (
              <SignedBars data={data.byReason.map((r: any) => ({ ...r, reason: r.reason ?? "?" }))} x="reason" y="pnl" yFmt={(v) => v.toFixed(3)}
                extra={(d) => `${d.n} trades, avg ${pct(d.avg_pct)}`} />
            )}
          </Card>
          {sel !== null && <TradeDetail id={sel} onClose={() => setSel(null)} />}
          <Card title={`${book} trades`} sub="Click a row for the price path, entry features and post-mortem.">
            {!rows.length ? <Empty>No trades in this book yet.</Empty> : (
              <div className="max-h-[640px] overflow-auto">
                <table className="data">
                  <thead><tr>{th("decision_ms", "Time")}<th>Token</th><th>Status</th><th>v</th><th>Exit</th>{th("pnl_sol", "PnL SOL")}{th("pnl_pct", "PnL %")}{th("hold_s", "Hold")}<th>Peak / low</th>{th("entry_slippage_pct", "Slippage")}<th>Review</th></tr></thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.id} className="click" onClick={() => setSel(r.id)}>
                        <td className="text-ink-2">{time(r.decision_ms)}</td>
                        <td>{r.symbol || r.mint.slice(0, 6)}</td>
                        <td>{r.status}</td>
                        <td>{r.strategy_version}</td>
                        <td>{r.exit_reason ?? "–"}</td>
                        <td><PnlText v={r.pnl_sol}>{signedSol(r.pnl_sol)}</PnlText></td>
                        <td><PnlText v={r.pnl_pct}>{pct(r.pnl_pct)}</PnlText></td>
                        <td>{dur(r.hold_s)}</td>
                        <td className="text-ink-2">{pct(r.peak_pnl_pct)} / {pct(r.min_pnl_pct)}</td>
                        <td>{pct(r.entry_slippage_pct)}</td>
                        <td className="text-ink-2">{r.tags ? JSON.parse(r.tags).join(", ") || `${r.decision_grade} / ${r.outcome_grade}` : "pending"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const FEATURE_KEYS: [string, string, (v: any) => string][] = [
  ["ageS", "Age at entry", (v) => `${num(v, 1)}s`], ["solRaised", "SOL raised", (v) => num(v, 2)], ["mcapSol", "Market cap (SOL)", (v) => num(v, 1)],
  ["uniqueBuyersW", "Unique buyers (window)", (v) => String(v)], ["bsRatioW", "Buy/sell ratio", (v) => num(v, 2)], ["netInflowW", "Net inflow SOL", (v) => num(v, 2)],
  ["buys5s", "Buys last 5s", (v) => String(v)], ["devBuySol", "Dev buy SOL", (v) => num(v, 2)], ["devHoldPct", "Dev holds %", (v) => num(v, 1)],
  ["sameSlotBuyers", "Same-slot buyers", (v) => String(v)], ["top1Pct", "Top holder %", (v) => num(v, 1)], ["top10Pct", "Top 10 %", (v) => num(v, 1)],
  ["smartBuyers", "Watchlist buyers", (v) => String(v)], ["hourUtc", "Hour (UTC)", (v) => String(v)],
];

function TradeDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error } = usePoll<any>(`/api/data?view=trade&id=${id}`, 15000);
  if (!data) return <Card title="Trade"><Loading error={error} /></Card>;
  const p = data.position;
  const pm = data.postmortem;
  return (
    <Card title={`${p.symbol || p.mint.slice(0, 8)} · ${p.book} · ${p.status}`} sub={`${p.signal} · strategy v${p.strategy_version} · ${p.mint}`}
      right={<button onClick={onClose} className="rounded-md border border-line px-2 py-1 text-xs">Close</button>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {data.path.length < 2 ? <Empty>Price path is unavailable (raw trades older than the retention window).</Empty> : (
            <PricePath path={data.path} entry={p.entry_fill_ms ? { t: p.entry_fill_ms, price: p.entry_price } : undefined} exit={p.exit_fill_ms ? { t: p.exit_fill_ms, price: p.exit_price } : undefined} />
          )}
          <p className="mt-1 text-xs text-muted">Each dot is a real trade on the curve; dot size is SOL amount. Dashed lines mark our simulated fills.</p>
        </div>
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted">Result</dt><dd className="text-right"><PnlText v={p.pnl_sol}>{signedSol(p.pnl_sol)} ({pct(p.pnl_pct)})</PnlText></dd>
            <dt className="text-muted">Exit reason</dt><dd className="text-right">{p.exit_reason ?? "–"}</dd>
            <dt className="text-muted">Hold</dt><dd className="text-right">{dur(p.hold_s)}</dd>
            <dt className="text-muted">Entry slippage</dt><dd className="text-right">{pct(p.entry_slippage_pct)}</dd>
            <dt className="text-muted">Fees + tips</dt><dd className="text-right">{sol((p.entry_fixed_sol ?? 0) + (p.exit_fixed_sol ?? 0))} SOL + 2×1.25%</dd>
            <dt className="text-muted">Token outcome</dt><dd className="text-right">{data.token?.outcome ?? "pending"}{data.token?.peak_mult ? ` · peak ${num(data.token.peak_mult, 1)}×` : ""}</dd>
          </dl>
          {pm && (
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="mb-1 flex flex-wrap gap-1">
                <Badge tone={pm.decision_grade === "good" ? "good" : "bad"}>{pm.decision_grade} decision</Badge>
                <Badge tone={pm.outcome_grade === "win" ? "good" : "bad"}>{pm.outcome_grade}</Badge>
                {pm.tags.map((t: string) => <Badge key={t}>{t}</Badge>)}
              </div>
              <p className="text-xs text-ink-2">{pm.notes}. After exit the price moved {pct(pm.max_after_5m_pct)} at best and {pct(pm.min_after_5m_pct)} at worst within 5 minutes.</p>
            </div>
          )}
        </div>
      </div>
      <h3 className="mb-1 mt-4 text-xs font-semibold text-muted">Features at entry decision</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
        {FEATURE_KEYS.filter(([k]) => p.features[k] !== undefined).map(([k, label, f]) => (
          <div key={k} className="flex justify-between border-b border-grid py-0.5"><span className="text-muted">{label}</span><span className="num">{f(p.features[k])}</span></div>
        ))}
        {p.features.fails?.length ? <div className="col-span-full pt-1 text-ink-2">Failed filters (shadow): {p.features.fails.join(", ")}</div> : null}
      </div>
    </Card>
  );
}
