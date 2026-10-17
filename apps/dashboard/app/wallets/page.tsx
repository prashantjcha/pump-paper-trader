"use client";
import { useState } from "react";
import { usePoll, Card, Stat, Loading, Empty, Badge, num, ratio, dur, short, signedSol, PnlText, ago } from "@/components/ui";

export default function Wallets() {
  const { data, error } = usePoll<any>("/api/data?view=wallets", 60000);
  const [sel, setSel] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const c = data.counts ?? {};
  const table = (rows: any[]) => (
    <div className="max-h-[520px] overflow-auto">
      <table className="data">
        <thead><tr><th>Wallet</th><th>Tokens 7d</th><th>PnL 7d</th><th>Win rate</th><th>Volume</th><th>Avg hold</th><th>Avg entry age</th><th>Tags</th></tr></thead>
        <tbody>{rows.map((w) => (
          <tr key={w.wallet} className="click" onClick={() => setSel(w.wallet)}>
            <td className="font-mono">{short(w.wallet)}</td><td>{w.tokens_7d}</td><td><PnlText v={w.pnl_7d}>{signedSol(w.pnl_7d, 3)}</PnlText></td>
            <td>{ratio(w.win_rate_7d)}</td><td>{num(w.volume_7d, 1)}</td><td>{dur(w.avg_hold_s)}</td><td>{dur(w.avg_entry_age_s)}</td>
            <td className="space-x-1">{(w.tags ?? "").split(",").filter(Boolean).map((t: string) => <Badge key={t} tone={t === "smart" ? "good" : t === "too_good" || t === "creator_profits" ? "bad" : "neutral"}>{t}</Badge>)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Wallets tracked (3+ tokens, 7d)" value={c.wallets ?? 0} />
        <Stat label="Profitable" value={ratio(c.wallets ? c.profitable / c.wallets : null)} />
        <Stat label="Create-slot snipers" value={c.snipers ?? 0} />
        <Stat label="Sub-5s bots" value={c.bots ?? 0} />
        <Stat label="Copy candidates" value={c.smart ?? 0} hint="40–65% win, 20+ tokens, holds 30s+" />
      </div>
      {sel && <WalletDetail wallet={sel} onClose={() => setSel(null)} />}
      <Card title="Watchlist (copy-trade book)" sub="Rebuilt every 6h. Research found copying selected winners often loses to latency and fees, so this book is measured separately rather than trusted.">
        {!data.watch.length ? <Empty>No wallet meets the criteria yet. It needs a few days of history: 20+ tokens per wallet.</Empty> : (
          <table className="data"><thead><tr><th>Wallet</th><th>Score</th><th>Reason</th><th>Added</th></tr></thead>
            <tbody>{data.watch.map((w: any) => <tr key={w.wallet} className="click" onClick={() => setSel(w.wallet)}><td className="font-mono">{short(w.wallet)}</td><td>{num(w.score, 2)}</td><td className="text-ink-2">{w.reason}</td><td>{ago(w.added_ms)}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Card title="Top wallets by 7-day PnL" sub="Tags flag behaviour: sniper (buys in the create slot), creator_profits (earns from own launches), too_good (>65% win rate, a manipulation flag), hft_bot (holds under 5s).">
        {data.top.length ? table(data.top) : <Empty>Wallet stats compute every 15 minutes once tokens finalize.</Empty>}
      </Card>
      <Card title="Biggest losers">{data.bottom.length ? table(data.bottom) : <Empty>None yet.</Empty>}</Card>
    </div>
  );
}

function WalletDetail({ wallet, onClose }: { wallet: string; onClose: () => void }) {
  const { data } = usePoll<any>(`/api/data?view=wallet&wallet=${wallet}`, 60000);
  return (
    <Card title={`Wallet ${short(wallet)}`} sub={wallet} right={<button onClick={onClose} className="rounded-md border border-line px-2 py-1 text-xs">Close</button>}>
      {!data ? <Loading /> : (
        <div className="max-h-[400px] overflow-auto">
          <table className="data"><thead><tr><th>Token</th><th>Bought</th><th>Sold</th><th>Realized</th><th>Hold</th><th>Entry age</th><th>SOL raised at entry</th><th>Sniper</th><th>Status</th></tr></thead>
            <tbody>{data.positions.map((p: any) => (
              <tr key={p.mint}><td>{p.symbol || p.mint.slice(0, 6)}</td><td>{num(p.buy_sol, 3)}</td><td>{num(p.sell_sol, 3)}</td><td><PnlText v={p.realized_sol}>{p.realized_sol == null ? "open" : signedSol(p.realized_sol, 3)}</PnlText></td>
                <td>{dur(p.hold_s)}</td><td>{dur(p.first_buy_age_s)}</td><td>{num(p.first_buy_sol_raised, 1)}</td><td>{p.sniper ? "yes" : ""}</td><td>{p.closed ? "closed" : "open"}</td></tr>
            ))}</tbody></table>
        </div>
      )}
    </Card>
  );
}
