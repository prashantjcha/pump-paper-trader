"use client";
import { useState } from "react";
import { usePoll, Card, Stat, Loading, Empty, Badge, num, ago, time } from "@/components/ui";
import { TimeLines } from "@/components/charts";

export default function System() {
  const { data, error, reload } = usePoll<any>("/api/data?view=system", 5000);
  const [mint, setMint] = useState("");
  const [source, setSource] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const h = data.health;
  const control = async (body: any) => {
    const r = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setMsg(r.ok ? (body.action === "signal" ? `Signal #${j.id} queued.` : j.killed ? "Kill switch engaged. The bot closes positions and stops entering within a second." : "Kill switch released.") : j.error);
    reload();
  };
  const feeds = h ? Object.entries(h.feed.endpoints) as [string, any][] : [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Bot heartbeat" value={h ? ago(h.ts) : "never"} hint={h && Date.now() - h.ts < 30_000 ? "live" : "offline"} />
        <Stat label="Events/s" value={num(h?.eventsPerSec, 1)} hint={`${data.counts?.trades ?? 0} trades stored`} />
        <Stat label="Receive vs chain clock" value={`${num(h?.lagS, 1)}s`} hint="chain clock skews 1–2s; not pipeline delay" />
        <Stat label="Tokens seen" value={data.counts?.tokens ?? 0} hint={`${data.counts?.outcomes ?? 0} finalized`} />
        <Stat label="Database" value={`${num(data.dbSizeMb, 0)} MB`} hint={`${data.counts?.walletPositions ?? 0} wallet positions`} />
        <Stat label="Failed txs filtered" value={h?.feed?.failedTx ?? 0} hint={`${h?.feed?.duplicates ?? 0} duplicates dropped`} />
      </div>

      <Card title="Controls" sub="Paper mode only: the bot holds no keys and never signs a transaction.">
        <div className="flex flex-wrap items-center gap-3">
          {data.killed
            ? <button onClick={() => control({ action: "unkill" })} className="rounded-md border border-line px-3 py-1.5 text-sm">Release kill switch</button>
            : <button onClick={() => control({ action: "kill" })} className="rounded-md bg-[var(--critical)] px-3 py-1.5 text-sm text-white">Engage kill switch</button>}
          <Badge tone={data.killed ? "bad" : "good"}>{data.killed ? "kill switch engaged" : "trading enabled"}</Badge>
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); control({ action: "signal", mint, source }); setMint(""); }}>
          <label className="text-xs text-muted">Token mint from a caller
            <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="mint address" className="mt-1 block w-[380px] max-w-full rounded-md border border-line bg-page px-2 py-1.5 font-mono text-sm text-ink" />
          </label>
          <label className="text-xs text-muted">Caller name
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. telegram channel" className="mt-1 block w-[200px] rounded-md border border-line bg-page px-2 py-1.5 text-sm text-ink" />
          </label>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm">Queue signal</button>
        </form>
        {msg && <p className="mt-2 text-xs text-ink-2">{msg}</p>}
        {data.signals.length > 0 && (
          <table className="data mt-3"><thead><tr><th>#</th><th>Mint</th><th>Source</th><th>Status</th><th>Detail</th><th>When</th></tr></thead>
            <tbody>{data.signals.map((s: any) => <tr key={s.id}><td>{s.id}</td><td className="font-mono">{s.mint.slice(0, 10)}…</td><td>{s.source}</td><td>{s.status}</td><td className="text-ink-2">{s.detail}</td><td>{ago(s.created_ms)}</td></tr>)}</tbody></table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Decoded events per second" sub="Last 6 hours, 10-second samples.">
          {data.eventsPerSec.length < 2 ? <Empty>Collecting…</Empty> : <TimeLines data={data.eventsPerSec.map((r: any) => ({ t: r.t, v: r.v }))} series={[{ key: "v", label: "events/s", color: "var(--series-1)" }]} yFmt={(v) => v.toFixed(0)} height={200} />}
        </Card>
        <Card title="Receive time vs chain clock (seconds)" sub="Local receive time minus the on-chain clock, which has 1-second resolution and routinely skews 1–2 seconds. Watch for changes, not the level.">
          {data.lag.length < 2 ? <Empty>Collecting…</Empty> : <TimeLines data={data.lag.map((r: any) => ({ t: r.t, v: r.v }))} series={[{ key: "v", label: "lag s", color: "var(--series-1)" }]} yFmt={(v) => v.toFixed(1)} height={200} />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Feeds" sub="Two free public websockets run together; the first to deliver a transaction wins. Helius starts only if both are down, under a daily byte budget.">
          <table className="data"><thead><tr><th>Endpoint</th><th>State</th><th>Messages</th><th>Delivered first</th><th>MB</th><th>Reconnects</th></tr></thead>
            <tbody>{feeds.map(([name, s]) => <tr key={name}><td>{name}</td><td><Badge tone={s.connected ? "good" : name === "helius" ? "neutral" : "bad"}>{s.connected ? "connected" : name === "helius" ? "standby" : "down"}</Badge></td><td>{s.msgs}</td><td>{s.firsts}</td><td>{num(s.bytes / 1e6, 1)}</td><td>{s.reconnects}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Analyst jobs">
          {!data.analyst ? <Empty>Analyst has not reported yet.</Empty> : (
            <table className="data"><thead><tr><th>Job</th><th>Last run</th><th>Took</th><th>Result</th></tr></thead>
              <tbody>{Object.entries(data.analyst).map(([k, v]: any) => <tr key={k}><td>{k}</td><td>{ago(v.lastRun)}</td><td>{v.ms}ms</td><td className={`max-w-[360px] truncate ${v.lastResult.startsWith("error") ? "text-critical" : "text-ink-2"}`} title={v.lastResult}>{v.lastResult}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>

      <Card title="Log">
        <div className="max-h-[420px] overflow-auto font-mono text-xs">
          {data.logs.map((l: any, i: number) => (
            <div key={i} className={`border-b border-grid py-0.5 ${l.level === "error" ? "text-critical" : l.level === "warn" ? "text-ink" : "text-ink-2"}`}>
              {time(l.ts_ms)} [{l.source}] {l.msg}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
