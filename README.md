# Pump Paper Trader

A self-learning **paper-trading** bot for brand-new pump.fun launches, plus a live analytics dashboard.
It watches every launch and every trade on the bonding curve, trades a 1 SOL paper account per strategy book,
studies how the whole market makes and loses money, reviews its own mistakes, and tunes its own rules inside hard limits.

**Paper mode only.** No private keys exist anywhere in this codebase and nothing is ever signed or sent.

> **Safety design write-up:** [Letting an LLM retune a trading agent: hard limits, unseen data, automatic rollback](docs/guardrails.md). Telegram caller handles in `research/` are pseudonymised (`caller_01`...).

## Run it

```bash
npm install
npm run up          # builds the dashboard, starts bot + analyst + dashboard under pm2 (auto-restart)
npm run status      # pm2 process table
npm run logs        # tail logs
npm run down        # stop everything
```

Dashboard: http://localhost:3077

Optional `.env` values:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Claude retrospective. Without it a data-driven proposer runs instead. |
| `ANTHROPIC_WORKSPACE_ID` | Required only when the API key is not scoped to a workspace (the API returns a 400 asking for it). |
| `HELIUS_API_KEY` | Fallback feed, used only when both free public feeds are down. |
| `HELIUS_DAILY_MB` | Daily byte cap for the Helius fallback (default 1000 MB, about 20k credits). |
| `EXTRA_WS` | Comma-separated extra RPC websocket URLs to race alongside the public ones. |

Other commands:

```bash
npm run replay -- --hours 6 --sweep --unlimited   # replay recorded data at 0/300/600/1500 ms latency
npm run signal -- <mint> --source "caller name"   # feed a caller's token into the manual book
npm run retro -- --force                          # run one retrospective now
npm test                                          # unit tests (curve math, decoder on live fixtures, engine)
```

Kill switch: create the file `data/KILL` (or use the System page). Open positions are closed and no new entries are made.

## How it works

```
public RPC websockets (x2, raced, de-duplicated)  ── Helius fallback, budget-capped
        │ logsSubscribe(pump program)
        ▼
decoder (IDL-driven, drops failed txs)  ──►  raw archive  data/raw/YYYY-MM-DD/HH.*.jsonl.gz   (replay corpus, 14 days)
        │                                ──►  SQLite       data/pumpfun.db                      (analyst input)
        ▼
engine: token state → rules → paper fills at decision + latency
  books: momentum · copy (watchlist wallets) · manual (caller signals) · shadow (counterfactual)
        │
analyst (separate process)
  token outcomes · wallet ledger · behaviour study · shadow filter attribution · post-mortems
  retrospective every 6h → bounded proposals → replay on unseen data → provisional version → forward test → confirm or auto-revert
        │
dashboard (Next.js, read-only on the same SQLite)
```

### Honest fills

- A decision at time *t* fills at *t + 600 ms* against the real reserves at that moment, not the price that triggered it.
- Every leg pays the on-chain curve fee (read from each trade event: 0.95% protocol + 0.30% creator), a 0.001 SOL priority fee and a 0.002 SOL tip.
- An entry whose price moved more than 15% during the latency window does not land, and the priority fee is still charged.
- At 0.1 SOL per trade the round trip costs about 8–9% before any price move. Take-profit and stop thresholds are measured on net liquidation value, so "+20%" means +20% after costs.

### Strategy v1 (every number is bounded in `packages/core/src/config.ts`)

Entry, all required: token age 3–90 s, 2–25 SOL raised, dev buy 0.3–4 SOL, dev holds ≤ 8%, ≤ 2 same-slot (bundled) buyers,
top holder ≤ 15%, top 10 ≤ 40%, in the last 15 s ≥ 8 unique buyers, buy/sell ≥ 2.5 and ≥ 1 SOL net inflow, ≥ 3 buys in the last 5 s,
creator not blacklisted and not a serial launcher. Mayhem Mode and non-SOL-quoted tokens are never traded.

Exit, first trigger wins: take profit +30/+25/+20% depending on whether buy volume is rising, flat or falling; trailing stop 8% once +15% is reached;
stop −10%, tightened to −6% when buying stalls; instant exit on a dev sell, a sell ≥ 1.5 SOL or ≥ 5% of supply, or a watchlist wallet exiting; 120 s time stop;
exit before 95% curve progress.

Risk: 0.1 SOL per trade, ≤ 4 open per book, 10% daily loss pause. Hard caps the learning loop cannot exceed: 0.2 SOL, 6 open, 15% daily loss.

### How it learns

1. **Whole market.** Every launch is finalized with its outcome (runner, graduated, rug, fizzle). Every wallet's position on every token is reconstructed with realized PnL, entry timing, hold time and size. The behaviour study compares the top and bottom 10% of wallets.
2. **Shadow book.** Every active launch is traded counterfactually with the same exit rules, recording which entry filters it failed. That shows what each filter costs or saves.
3. **Own trades.** Fifteen minutes after each exit, a post-mortem grades the decision separately from the outcome and tags the mistake: exit too early, stopped then recovered, dev dump, gave back gains, and others.
4. **Retrospective, every 6 hours.** It studies an older window and proposes at most 3 parameter changes. Claude does this when `ANTHROPIC_API_KEY` is set, and a data-driven proposer runs otherwise. Each change is replayed on the newest 24 h, which the study never saw, and is kept only if expectancy and drawdown are not worse. Loosening anything requires 100 of the bot's own trades first.
5. **Forward test.** A winning change goes live as provisional. After 24 h of new data it is confirmed, or automatically reverted if it did worse than its parent.

## Claude vs Codex research debate

```bash
npm run debate -- --rounds 3 --holdout-hours 6
```

The runner snapshots the data up to a cutoff (now minus the holdout) and gives both agents only that snapshot.
It alternates `claude -p` and `codex exec` turns. Each turn reads the transcript, runs replays, rebuts the other side,
and writes a full strategy proposal. At the end the runner, not either model, scores every proposal and the live strategy
on the sealed holdout hours and writes `research/debate/<id>/verdict.md`. Nothing is applied automatically.

Wait for at least a day of recorded data before running it: with a few hours the holdout has too few trades to separate proposals.
Each turn is a full agent session (up to 25 minutes), so a 3-round debate is six sessions.

## What the research says (read before trusting any result)

- The seconds-to-minutes window is where insiders exit. Over half of launches are sniped in the creation block by deployer-funded wallets, and most of those snipers sell within a minute (Pine Analytics). Filters reduce how often the bot is exit liquidity; they do not change who it trades against.
- Holders between 30 s and 5 min win about 32% of the time on pump.fun (a study of 1.43M trades). Only sub-5-second MEV bots exceed 50%.
- Copying "smart" wallets carries an imitation penalty: statistically selected winners did not produce positive copier returns under realistic latency and fees (arXiv 2601.08641). The copy book exists to measure this, not to assume it works.
- 50 trades gives a ±14 percentage-point uncertainty on win rate. Around 780 trades are needed to tell 55% from 50%. The learning loop's gates are built around this.
- Paper results overstate live results. Real fills add failed transactions, slower landing under congestion, and MEV. Treat paper profit as necessary, not sufficient.

## Observed in the first hour of live data

- About 57% of transactions that touch the pump program fail. The decoder drops them.
- About two-thirds of active launches were Mayhem Mode tokens, where the protocol's agent trades on different virtual reserves. They are excluded.
- One creator relaunched the same token eight times in ten minutes. The serial-launcher filter and instant creator blacklist were added in response.
- Stop-loss exits gap well past −10%: price jumps between trades and the latency window adds more.

## Not in this version

- **Live trading.** Execution via PumpPortal's local API or direct instructions with Jito tips would be a separate, reviewed step, and it needs a funded wallet.
- **Telegram caller ingestion.** It needs your own Telegram session and risks an account ban. Use the manual signal book to test callers by hand first.
- **Paid low-latency feeds** (Helius LaserStream, Yellowstone gRPC). They matter for live trading, not for paper.
- **Start on boot.** pm2 restarts crashed processes, but on Windows starting at boot needs `pm2-installer` or Task Scheduler, set up with admin rights.
