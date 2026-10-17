"use client";
import Link from "next/link";
import { usePoll, Card, Stat, Loading, Empty, Badge, sol, signedSol, pct, ratio, num, tone, ago, dur, PnlText } from "@/components/ui";
import { TimeLines, SERIES } from "@/components/charts";

const LABEL: Record<string, string> = { momentum: "Momentum", copy: "Copy smart wallets", manual: "Manual caller signals", runner: "Runner model (10 s)", telegram: "Telegram calls" };

export default function Overview() {
  const { data, error } = usePoll<any>("/api/data?view=overview", 3000);
  if (!data) return <Loading error={error} />;
  const h = data.health;
  const stale = !h || Date.now() - h.ts > 30_000;

  // equity series: pivot to one row per timestamp
  const byT = new Map<number, Record<string, number>>();
  for (const e of data.equity) {
    const t = Math.round(e.ts_ms / 60_000) * 60_000;
    byT.set(t, { ...(byT.get(t) ?? { t }), [e.book]: e.equity_sol });
  }
  const eq = [...byT.values()].sort((a, b) => a.t - b.t);
  const main = data.books.find((b: any) => b.book === "momentum");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={stale ? "bad" : "good"}>{stale ? "bot offline" : "bot live"}</Badge>
        {data.killed && <Badge tone="bad">kill switch engaged</Badge>}
        {data.strategy && <Badge>strategy v{data.strategy.version} · {data.strategy.status}</Badge>}
        {h && <span className="text-ink-2">{num(h.eventsPerSec, 1)} events/s · {h.trackedTokens} tokens tracked · chain-clock offset {num(h.lagS, 1)}s</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Momentum equity" value={`${num(main?.equityNow ?? main?.cash_sol, 4)} SOL`} hint={`started ${num(main?.start_sol, 2)} SOL`} />
        <Stat label="Realized PnL" value={signedSol(main?.kpis.pnlSol)} tone={tone(main?.kpis.pnlSol)} hint={`24h ${signedSol(main?.kpis24h.pnlSol)}`} />
        <Stat label="Win rate" value={ratio(main?.kpis.winRate)} hint={`${main?.kpis.trades ?? 0} closed trades`} />
        <Stat label="Expectancy" value={signedSol(main?.kpis.expectancySol, 5)} tone={tone(main?.kpis.expectancySol)} hint="per trade, after all costs" />
        <Stat label="Profit factor" value={num(main?.kpis.profitFactor)} hint={`avg win ${pct(main?.kpis.avgWinPct)} · loss ${pct(main?.kpis.avgLossPct)}`} />
        <Stat label="Max drawdown" value={`${sol(main?.kpis.maxDrawdownSol)} SOL`} hint={`avg hold ${dur(main?.kpis.avgHoldS)}`} />
        <Stat label="Trades today" value={main?.kpis.tradesToday ?? 0} hint={`${main?.kpis.failed ?? 0} entries failed`} />
      </div>

      <Card title="Equity by book" sub={`Each book starts with 1 SOL of paper capital${data.resetMs ? `, last reset ${new Date(data.resetMs).toLocaleString()}` : ""}. Sampled once a minute.`}>
        {eq.length < 2 ? <Empty>Equity history appears after the bot has run a few minutes.</Empty> : (
          <TimeLines data={eq} baseline={1} yFmt={(v) => v.toFixed(3)}
            series={data.books.map((b: any, i: number) => ({ key: b.book, label: LABEL[b.book], color: SERIES[i] }))} />
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {data.books.map((b: any) => (
          <Card key={b.book} title={LABEL[b.book]} right={b.paused ? <Badge tone="bad">paused: daily loss</Badge> : null}>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Equity</dt><dd className="num text-right">{num(b.equityNow ?? b.cash_sol, 4)} SOL</dd>
              <dt className="text-muted">Realized</dt><dd className="num text-right"><PnlText v={b.kpis.pnlSol}>{signedSol(b.kpis.pnlSol)}</PnlText></dd>
              <dt className="text-muted">Trades / win rate</dt><dd className="num text-right">{b.kpis.trades} / {ratio(b.kpis.winRate)}</dd>
              <dt className="text-muted">Open positions</dt><dd className="num text-right">{b.open}</dd>
              <dt className="text-muted">Avg entry slippage</dt><dd className="num text-right">{pct(b.kpis.avgSlippagePct)}</dd>
            </dl>
          </Card>
        ))}
      </div>

      <Card title="Open positions" sub="Live mark-to-market after curve fee and exit costs. Exit parameters are frozen at entry.">
        {!data.open.length ? <Empty>No open positions.</Empty> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Book</th><th>Token</th><th>Signal</th><th>Held</th><th>Entry</th><th>PnL now</th><th>Peak</th><th>Low</th><th>TP band</th><th>Stop</th><th>Time stop</th></tr></thead>
              <tbody>
                {data.open.map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.book}</td>
                    <td><a className="underline decoration-dotted" href={`https://pump.fun/coin/${p.mint}`} target="_blank" rel="noreferrer">{p.symbol || p.mint.slice(0, 6)}</a></td>
                    <td className="text-ink-2">{p.signal}</td>
                    <td>{dur((Date.now() - p.entry_fill_ms) / 1000)}</td>
                    <td>{sol(p.entry_sol, 3)} SOL</td>
                    <td><PnlText v={p.pnl_pct}>{pct(p.pnl_pct)}</PnlText></td>
                    <td>{pct(p.peak_pnl_pct)}</td>
                    <td>{pct(p.min_pnl_pct)}</td>
                    <td>+{p.tpRange[0]}…{p.tpRange[1]}%</td>
                    <td>−{p.sl}%</td>
                    <td>{p.timeStopS}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent closed trades" right={<Link href="/trades" className="text-xs text-ink-2 underline">all trades</Link>}>
          {!data.recent.length ? <Empty>No closed trades yet. The momentum filters are strict, so the first trade can take a while.</Empty> : (
            <table className="data">
              <thead><tr><th>When</th><th>Book</th><th>Token</th><th>Exit</th><th>Hold</th><th>PnL</th></tr></thead>
              <tbody>
                {data.recent.map((r: any) => (
                  <tr key={r.id}>
                    <td className="text-ink-2">{ago(r.exit_fill_ms)}</td><td>{r.book}</td><td>{r.symbol}</td><td>{r.exit_reason}</td><td>{dur(r.hold_s)}</td>
                    <td><PnlText v={r.pnl_sol}>{signedSol(r.pnl_sol)} ({pct(r.pnl_pct)})</PnlText></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Shadow book, last 24h" sub="Counterfactual trades on every active launch using the same exit rules. The learning loop uses these to measure what each entry filter costs.">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Shadow trades" value={data.shadow.trades} />
            <Stat label="Win rate" value={ratio(data.shadow.winRate)} />
            <Stat label="Expectancy" value={signedSol(data.shadow.expectancySol, 5)} tone={tone(data.shadow.expectancySol)} />
            <Stat label="Avg hold" value={dur(data.shadow.avgHoldS)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
