"use client";
import { usePoll, Card, Stat, Loading, Empty, Badge, num, pct, ratio, ago } from "@/components/ui";
import { SignedBars, Bars } from "@/components/charts";

const STATUS_TONE: Record<string, "good" | "bad" | "warn" | "neutral"> = { accepted: "good", passed: "good", confirmed: "good", active: "good", provisional: "warn", rejected: "bad", reverted: "bad", deferred: "neutral" };

export default function Learning() {
  const { data, error } = usePoll<any>("/api/data?view=learning", 30000);
  if (!data) return <Loading error={error} />;
  const sh = data.shadow, mk = data.mistakes;
  const cur = data.versions.find((v: any) => ["active", "provisional", "confirmed"].includes(v.status));
  const lastRetro = data.retros[0];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Live strategy" value={cur ? `v${cur.version}` : "–"} hint={cur?.status} />
        <Stat label="Versions tried" value={data.versions.length} hint={`${data.versions.filter((v: any) => v.status === "reverted").length} reverted`} />
        <Stat label="Retrospectives" value={data.retros.length} hint={lastRetro ? `last ${ago(lastRetro.created_ms)} · ${lastRetro.model}` : "first one needs ~30h of data"} />
        <Stat label="Proposals accepted" value={data.proposals.filter((p: any) => p.status === "accepted").length} hint={`of ${data.proposals.length}`} />
        <Stat label="Trades reviewed (24h)" value={mk?.reviewed ?? 0} />
      </div>

      <Card title="How the bot learns" sub="Every 6 hours: study the market, the shadow book and our own mistakes on an older window; propose at most 3 bounded parameter changes; replay each on the newest 24h the study never saw; activate a winner provisionally; after 24h of forward data, confirm it or auto-revert. Hard risk limits sit outside this loop.">
        {lastRetro ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-muted">Latest lesson ({ago(lastRetro.created_ms)}, {lastRetro.model}):</span> {lastRetro.learned}</p>
            {lastRetro.output?.observations?.length ? <ul className="list-disc space-y-0.5 pl-5 text-ink-2">{lastRetro.output.observations.map((o: string, i: number) => <li key={i}>{o}</li>)}</ul> : null}
            {lastRetro.error && <p className="text-xs text-critical">Proposer error: {lastRetro.error}</p>}
          </div>
        ) : <Empty>No retrospective yet. It waits for about 30 hours of recorded data so it can study one window and validate on another it never saw.</Empty>}
      </Card>

      <Card title="Proposals" sub="Each is replayed against the baseline on unseen data. Loosening is blocked until the bot has 100 of its own momentum trades.">
        {!data.proposals.length ? <Empty>No proposals yet.</Empty> : (
          <div className="max-h-[480px] overflow-auto">
            <table className="data">
              <thead><tr><th>When</th><th>Parameter</th><th>Change</th><th>Status</th><th>Replay expectancy (base → new)</th><th>Replay trades</th><th>Hypothesis</th></tr></thead>
              <tbody>{data.proposals.map((p: any) => (
                <tr key={p.id}>
                  <td className="text-ink-2">{ago(p.created_ms)}</td><td className="font-mono text-xs">{p.param}</td><td>{num(p.from_val, 2)} → {num(p.to_val, 2)}</td>
                  <td><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                  <td>{p.replay?.baseline ? `${num(p.replay.baseline.expectancySol, 5)} → ${num(p.replay.candidate.expectancySol, 5)}` : <span className="text-ink-2">{p.replay?.reason ?? "–"}</span>}</td>
                  <td>{p.replay?.candidate?.trades ?? "–"}</td>
                  <td className="max-w-[420px] truncate text-ink-2" title={`${p.hypothesis}\n${p.evidence}`}>{p.hypothesis}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What each entry filter costs" sub={sh ? `Shadow trades that failed only this filter vs all shadow trades (avg ${pct(sh.all.avgPnlPct)} over ${sh.all.n}). A filter whose blocked trades earn more than average is costing money.` : ""}>
          {!sh?.perFilter?.length ? <Empty>Shadow attribution appears after the first studies run.</Empty> : (
            <table className="data">
              <thead><tr><th>Filter</th><th>Blocked (any)</th><th>Avg %</th><th>Blocked only by this</th><th>Avg %</th><th>Passing avg %</th></tr></thead>
              <tbody>{sh.perFilter.map((f: any) => (
                <tr key={f.filter}><td>{f.filter}</td><td>{f.failing.n}</td><td>{pct(f.failing.avgPnlPct)}</td><td>{f.onlyFailing.n}</td><td>{pct(f.onlyFailing.avgPnlPct)}</td><td>{pct(f.passing.avgPnlPct)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
        <Card title="Mistakes found in post-mortems (24h)" sub="Decision quality is graded apart from outcome: a good entry that lost points at exits, a bad entry that won was luck.">
          {!mk?.reviewed ? <Empty>Post-mortems run 15 minutes after each exit.</Empty> : (
            <div className="space-y-3">
              <Bars data={Object.entries(mk.tags).map(([tag, n]) => ({ tag, trades: n as number })).sort((a, b) => b.trades - a.trades)} x="tag" y="trades" height={200} />
              <div className="flex flex-wrap gap-2 text-xs">{Object.entries(mk.quadrants).map(([q, n]) => <Badge key={q}>{q}: {String(n)}</Badge>)}</div>
            </div>
          )}
        </Card>
      </div>

      {sh && (
        <div className="grid gap-4 lg:grid-cols-3">
          {([["byAge", "Shadow return by token age at entry"], ["byUniqueBuyers", "by unique buyers in window"], ["byNetInflow", "by net SOL inflow in window"], ["bySolRaised", "by SOL raised at entry"], ["byDevBuy", "by dev initial buy"], ["byHourUtc", "by hour (UTC)"]] as const).map(([k, title]) => (
            <Card key={k} title={title}>
              <SignedBars data={sh[k] ?? []} x="bucket" y="avg" height={180} yFmt={(v) => `${v.toFixed(0)}%`} extra={(d) => `n=${d.n}, win ${ratio(d.winRate)}`} />
            </Card>
          ))}
        </div>
      )}

      <Card title="Strategy versions">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Version</th><th>Status</th><th>Parent</th><th>Created</th><th>Reason</th></tr></thead>
            <tbody>{data.versions.map((v: any) => (
              <tr key={v.version}><td>v{v.version}</td><td><Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge></td><td>{v.parent_version ? `v${v.parent_version}` : "–"}</td><td>{ago(v.created_ms)}</td><td className="max-w-[700px] truncate text-ink-2" title={v.reason}>{v.reason}</td></tr>
            ))}</tbody>
          </table>
        </div>
        {cur && <ParamsTable params={cur.params} bounds={data.bounds} />}
      </Card>
    </div>
  );
}

function ParamsTable({ params, bounds }: { params: any; bounds: any }) {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Object.entries(params).map(([section, vals]: any) => (
        <div key={section}>
          <h3 className="mb-1 text-xs font-semibold text-muted">{section}</h3>
          <table className="data"><tbody>{Object.entries(vals).map(([k, v]: any) => (
            <tr key={k}><td className="text-ink-2">{k}</td><td className="text-right">{String(v)}</td><td className="text-right text-muted">{bounds?.[section]?.[k] ? `[${bounds[section][k].join(", ")}]` : ""}</td></tr>
          ))}</tbody></table>
        </div>
      ))}
    </div>
  );
}
