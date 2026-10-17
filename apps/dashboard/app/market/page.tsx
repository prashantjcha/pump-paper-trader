"use client";
import { usePoll, Card, Stat, Loading, Empty, ratio, num, pct, dur, ago } from "@/components/ui";
import { SignedBars, Bars } from "@/components/charts";

export default function Market() {
  const { data, error } = usePoll<any>("/api/data?view=market", 30000);
  if (!data) return <Loading error={error} />;
  const m = data.market, b = data.behaviour;
  const outcomes = Object.fromEntries(data.outcomes24.map((o: any) => [o.outcome, o.n]));
  const total = data.outcomes24.reduce((a: number, o: any) => a + o.n, 0);
  const perHour = data.perHour.map((h: any) => ({ hour: new Date(h.hour).toLocaleTimeString([], { hour: "2-digit" }), launches: h.launches }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Launches finalized (24h)" value={total} />
        <Stat label="Runners (2×+)" value={ratio(total ? (outcomes.runner ?? 0) / total : null, 1)} hint={`${outcomes.runner ?? 0} tokens`} />
        <Stat label="Graduated" value={ratio(total ? (outcomes.graduated ?? 0) / total : null, 2)} hint={`${outcomes.graduated ?? 0} tokens`} />
        <Stat label="Rugs" value={ratio(total ? (outcomes.rug ?? 0) / total : null, 1)} hint="dev sold <5m and 50%+ drawdown" />
        <Stat label="Median lifetime" value={dur(m?.medianLifetimeS)} hint={`median time to peak ${dur(m?.medianTimeToPeakS)}`} />
        <Stat label="Wallet win rate" value={ratio(b?.marketWinRate)} hint={`${b?.positions ?? 0} wallet-token positions`} />
      </div>

      <Card title="Launches per hour" sub="All pump.fun creates seen by the feed, last 48h.">
        {perHour.length ? <Bars data={perHour} x="hour" y="launches" /> : <Empty>No launches recorded yet.</Empty>}
      </Card>

      {!b ? <Card title="How people make and lose money"><Empty>The behaviour study runs every 30 minutes once tokens start finalizing (10 minutes after they go quiet).</Empty></Card> : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Return by entry timing" sub="Average realized return per wallet position, by seconds after launch the wallet first bought. Excludes creators.">
              <SignedBars data={b.byEntryAge.map((x: any) => ({ ...x, avgPct: (x.avg ?? 0) * 100 }))} x="bucket" y="avgPct" yFmt={(v) => `${v.toFixed(0)}%`} extra={(d) => `n=${d.n}, win ${ratio(d.winRate)}`} />
            </Card>
            <Card title="Return by hold time" sub="How long wallets held before their last trade on the token.">
              <SignedBars data={b.byHold.map((x: any) => ({ ...x, avgPct: (x.avg ?? 0) * 100 }))} x="bucket" y="avgPct" yFmt={(v) => `${v.toFixed(0)}%`} extra={(d) => `n=${d.n}, win ${ratio(d.winRate)}`} />
            </Card>
            <Card title="Return by entry point on the curve" sub="SOL already raised on the bonding curve when the wallet first bought.">
              <SignedBars data={b.byEntrySolRaised.map((x: any) => ({ ...x, avgPct: (x.avg ?? 0) * 100 }))} x="bucket" y="avgPct" yFmt={(v) => `${v.toFixed(0)}%`} extra={(d) => `n=${d.n}, win ${ratio(d.winRate)}`} />
            </Card>
            <Card title="Return by position size (SOL)">
              <SignedBars data={b.bySize.map((x: any) => ({ ...x, avgPct: (x.avg ?? 0) * 100 }))} x="bucket" y="avgPct" yFmt={(v) => `${v.toFixed(0)}%`} extra={(d) => `n=${d.n}, win ${ratio(d.winRate)}`} />
            </Card>
          </div>
          <Card title="Winners versus losers" sub={`Top and bottom 10% of wallets by PnL in the study window (3+ tokens each). Creators made ${num(b.creatorsPnlSol, 2)} SOL; all other traders ${num(b.tradersPnlSol, 2)} SOL.`}>
            <table className="data">
              <thead><tr><th></th><th>Wallets</th><th>Avg PnL SOL</th><th>Win rate</th><th>Median entry age</th><th>Median hold</th><th>Median size</th><th>Median SOL raised at entry</th><th>Create-slot snipes</th></tr></thead>
              <tbody>
                {[["Top decile", b.topDecile], ["Bottom decile", b.bottomDecile]].map(([label, p]: any) => (
                  <tr key={label}><td className="font-medium">{label}</td><td>{p.wallets}</td><td>{num(p.avgPnlSol, 3)}</td><td>{ratio(p.winRate)}</td><td>{dur(p.medianEntryAgeS)}</td><td>{dur(p.medianHoldS)}</td><td>{num(p.medianSizeSol, 3)}</td><td>{num(p.medianEntrySolRaised, 1)}</td><td>{ratio(p.sniperShare)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {m && (
        <div className="grid gap-4 lg:grid-cols-3">
          {([["byDevBuy", "Outcomes by dev initial buy (SOL)"], ["bySameSlotBuyers", "Outcomes by same-slot (bundled) buyers"], ["byDevSold", "Outcomes by when the dev sold"]] as const).map(([k, title]) => (
            <Card key={k} title={title}>
              <table className="data">
                <thead><tr><th>Bucket</th><th>n</th><th>Runner</th><th>Rug</th><th>Median peak</th></tr></thead>
                <tbody>{m[k].map((r: any) => <tr key={r.bucket}><td>{r.bucket}</td><td>{r.n}</td><td>{ratio(r.runner, 1)}</td><td>{ratio(r.rug, 1)}</td><td>{num(r.medianPeakMult, 2)}×</td></tr>)}</tbody>
              </table>
            </Card>
          ))}
        </div>
      )}

      <Card title="Biggest movers, last 24h" sub="Peak price relative to the first trade.">
        {!data.runners.length ? <Empty>No finalized tokens yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Token</th><th>Outcome</th><th>Peak</th><th>Time to peak</th><th>Peak SOL raised</th><th>Traders</th><th>Volume SOL</th><th>Dev buy</th><th>Same-slot buyers</th><th>Launched</th></tr></thead>
              <tbody>{data.runners.map((r: any) => (
                <tr key={r.mint}><td><a className="underline decoration-dotted" href={`https://pump.fun/coin/${r.mint}`} target="_blank" rel="noreferrer">{r.symbol || r.mint.slice(0, 6)}</a></td><td>{r.outcome}</td><td>{num(r.peak_mult, 1)}×</td><td>{dur(r.time_to_peak_s)}</td><td>{num(r.peak_sol_raised, 1)}</td><td>{r.unique_traders}</td><td>{num(r.volume_sol, 1)}</td><td>{num(r.dev_buy_sol, 2)}</td><td>{r.same_slot_buyers}</td><td className="text-ink-2">{ago(r.create_ms)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      {data.shadow && <p className="text-xs text-muted">Shadow study covers {data.shadow.all.n} counterfactual trades (avg {pct(data.shadow.all.avgPnlPct)}). See Learning for filter attribution.</p>}
    </div>
  );
}
