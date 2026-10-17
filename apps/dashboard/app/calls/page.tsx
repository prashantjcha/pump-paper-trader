"use client";
import { usePoll, Card, Stat, Loading, Empty, Badge, pct, ratio, ago, signedSol, PnlText } from "@/components/ui";

export default function Calls() {
  const { data, error } = usePoll<any>("/api/data?view=calls", 10000);
  if (!data) return <Loading error={error} />;
  const h = data.health, t = data.totals ?? {};
  const live = h && Date.now() - h.ts < 60_000;
  const scored = t.scored ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={live && h.state === "listening" ? "good" : "bad"}>{h ? h.state : "listener not running"}</Badge>
        {h?.chatTitle && <span className="text-ink-2">{h.chatTitle} · last call {ago(h.lastMessageMs)}</span>}
        <Badge tone={data.trader?.version ? "good" : "warn"}>{data.trader?.strategy ?? "call trader not running"}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Calls recorded" value={t.calls ?? 0} hint={`${t.live ?? 0} live · ${t.historical ?? 0} backfilled`} />
        <Stat label="Scored" value={scored} hint={`${t.no_data ?? 0} not on our recorded curve data`} />
        <Stat label="Reached +25% in 60 min" value={ratio(scored ? t.hit25 / scored : null)} hint="price from call time, before fees" />
        <Stat label="Doubled in 60 min" value={ratio(scored ? t.hit100 / scored : null)} />
        <Stat label="Callers" value={data.callers.length} />
        <Stat label="Paper trades" value={data.callers.reduce((a: number, c: any) => a + (c.paper?.n ?? 0), 0)} hint="telegram book, since last reset" />
      </div>
      <Card title="Callers" sub="Scorecard uses the price path after each call (gross, no fees). Paper results use the telegram book with full costs and the same exits as momentum.">
        {!data.callers.length ? <Empty>No calls yet. Run the login script, then calls appear here within a minute.</Empty> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Caller</th><th>Calls</th><th>Scored</th><th>+25% in 60m</th><th>+50%</th><th>2×</th><th>Avg best in 15m</th><th>Avg worst in 60m</th><th>Paper trades</th><th>Paper win rate</th><th>Paper PnL</th><th>Last call</th></tr></thead>
              <tbody>{data.callers.map((c: any) => (
                <tr key={c.caller}>
                  <td>{c.caller}</td><td>{c.calls}</td><td>{c.scored}</td>
                  <td>{ratio(c.scored ? c.hit25 / c.scored : null)}</td><td>{ratio(c.scored ? c.hit50 / c.scored : null)}</td><td>{ratio(c.scored ? c.hit100 / c.scored : null)}</td>
                  <td>{pct(c.avg_max15)}</td><td>{pct(c.avg_min60)}</td>
                  <td>{c.paper?.n ?? 0}</td><td>{ratio(c.paper?.n ? c.paper.wins / c.paper.n : null)}</td>
                  <td><PnlText v={c.paper?.pnl}>{c.paper ? signedSol(c.paper.pnl) : "–"}</PnlText></td><td className="text-ink-2">{ago(c.last_call)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Recent calls">
        {!data.recent.length ? <Empty>No calls recorded.</Empty> : (
          <div className="max-h-[640px] overflow-auto">
            <table className="data">
              <thead><tr><th>Called</th><th>Caller</th><th>Token</th><th>Status</th><th>Outcome</th><th>Best 5m</th><th>Best 15m</th><th>Best 60m</th><th>Worst 60m</th><th>Paper result</th><th>Message</th></tr></thead>
              <tbody>{data.recent.map((r: any) => (
                <tr key={r.id}>
                  <td className="text-ink-2">{ago(r.call_ms)}</td><td>{r.caller}</td>
                  <td><a className="underline decoration-dotted" href={`https://pump.fun/coin/${r.mint}`} target="_blank" rel="noreferrer">{r.mint.slice(0, 6)}…</a></td>
                  <td title={r.detail ?? ""}>{r.status}</td><td>{r.outcome ?? "pending"}</td>
                  <td>{pct(r.max_5m_pct)}</td><td>{pct(r.max_15m_pct)}</td><td>{pct(r.max_60m_pct)}</td><td>{pct(r.min_60m_pct)}</td>
                  <td>{r.pnl_sol != null ? <PnlText v={r.pnl_sol}>{signedSol(r.pnl_sol)} ({r.exit_reason})</PnlText> : "–"}</td>
                  <td className="max-w-[360px] truncate text-ink-2" title={r.msg_text ?? ""}>{r.msg_text}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
